// The Simulate tab: a setting, the dials, run controls and the canvas. The
// engine runs in a Web Worker (src/engine/worker.ts); this file only sends
// it messages and draws what comes back.
//
// "from history" loads a past outbreak: R fits it (the same fit cache as the
// History tab), four dials take the fitted values (fromhistory.ts says which
// and why), and the outbreak's reported cases are drawn behind the run.
import { PRESET_IDS, type PresetId, preset } from "../engine/presets";
import { type Counts, type Params, type Settings, State, TICKS_PER_DAY } from "../engine/types";
import type { FromWorker, ToWorker } from "../engine/worker";
import { comparable } from "../shared/compare";
import { growthLine } from "../shared/fit";
import type { Outbreak, OutbreakInfo } from "../shared/outbreak";
import { type AgentFrame, STATE_TOKENS, drawAgents, fitCanvas } from "./canvas";
import { DIAL_GROUPS, DIALS, type Dial, formatDial } from "./dials";
import type { FitCache } from "./fits";
import {
	type Loaded,
	applyLoaded,
	describeLoad,
	describeOverlay,
	growthCheck,
	loadedFrom,
	restoreFrom,
} from "./fromhistory";
import { label } from "./history";
import { addDay, initSimChart, resetSimChart, setReported } from "./simchart";

// Where the tab gets past outbreaks and their fits. index.ts passes in the
// same RPC requests and fit cache as the History tab's.
export interface SimulateSource {
	list: () => Promise<OutbreakInfo[]>;
	load: (id: string) => Promise<Outbreak>;
	fits: FitCache;
	log: (text: string) => void;
}

// What the rest of the app can ask of the tab: History's "load into
// simulator", and a fresh list after an import.
export interface SimulateHandle {
	loadFromHistory(id: string): Promise<void>;
	refreshList(): Promise<void>;
}

const STATE_NAMES = ["susceptible", "exposed", "infectious", "recovered", "dead"] as const;

// The speed slider steps through these, in simulated days per second of
// real time. The worker starts at 2.
const SPEEDS = [0.5, 1, 2, 5, 10, 20, 30];
const DEFAULT_SPEED = SPEEDS.indexOf(2);

const settingPicker = document.querySelector<HTMLSelectElement>("#sim-setting")!;
const settingInfo = document.querySelector<HTMLParagraphElement>("#sim-setting-info")!;
const seedInput = document.querySelector<HTMLInputElement>("#sim-seed")!;
const runButton = document.querySelector<HTMLButtonElement>("#sim-run")!;
const stepButton = document.querySelector<HTMLButtonElement>("#sim-step")!;
const resetButton = document.querySelector<HTMLButtonElement>("#sim-reset")!;
const speedInput = document.querySelector<HTMLInputElement>("#sim-speed")!;
const speedOutput = document.querySelector<HTMLOutputElement>("#sim-speed-value")!;
const canvas = document.querySelector<HTMLCanvasElement>("#sim-canvas")!;
const statusLine = document.querySelector<HTMLParagraphElement>("#sim-status")!;
const dialsForm = document.querySelector<HTMLFormElement>("#sim-dials")!;
const chartBox = document.querySelector<HTMLDivElement>("#sim-chart")!;
const historyPicker = document.querySelector<HTMLSelectElement>("#sim-history")!;
const historyNote = document.querySelector<HTMLParagraphElement>("#sim-history-note")!;
const growthNote = document.querySelector<HTMLParagraphElement>("#sim-growth")!;
const chartNote = document.querySelector<HTMLParagraphElement>("#sim-chart-note")!;

// The inputs for one dial; off is the checkbox of a dial that can be null.
interface DialInputs {
	slider: HTMLInputElement;
	output: HTMLOutputElement;
	off?: HTMLInputElement;
}

const number = (n: number) => n.toLocaleString("en-GB");

// The setting and dials the next reset starts from. Dial changes also go
// to the running engine straight away, except the ones that need a reset.
let settings: Settings;
let params: Params;
let running = false;
// The outbreak loaded from history, if any.
let loaded: Loaded | null = null;
let latest: AgentFrame | null = null;
let drawQueued = false;

// Frames can come in faster than the screen redraws; only the newest one
// is drawn, once per screen refresh.
function queueDraw(): void {
	if (drawQueued || !latest) return;
	drawQueued = true;
	requestAnimationFrame(() => {
		drawQueued = false;
		if (latest) drawAgents(canvas, latest);
	});
}

// The status line doubles as the colour legend: a swatch, the state's name
// and its count, kept as elements so a frame only changes the numbers.
const statusDay = document.createElement("span");
const statusCounts = STATE_NAMES.map((name, s) => {
	const item = document.createElement("span");
	item.className = "state";
	const swatch = document.createElement("i");
	swatch.className = "swatch";
	swatch.style.background = `var(${STATE_TOKENS[s]})`;
	const count = document.createElement("b");
	item.append(swatch, `${name} `, count);
	return { item, count };
});
statusLine.append(statusDay, ...statusCounts.map((c) => c.item));

function showStatus(tick: number, counts: Counts, over: boolean): void {
	statusDay.textContent = `day ${Math.floor(tick / TICKS_PER_DAY)}${over ? " (over)" : ""}`;
	counts.forEach((n, s) => {
		statusCounts[s].count.textContent = number(n);
	});
}

function setRunning(on: boolean): void {
	running = on;
	runButton.textContent = on ? "pause" : "start";
	stepButton.disabled = on;
}

// --- Dials ------------------------------------------------------------------

const dialInputs = new Map<keyof Params, DialInputs>();

// One fieldset per group, one row per dial: name, slider, value, and an
// "off" box for the dials that can be switched off.
function buildDials(send: (msg: ToWorker) => void): void {
	for (const group of DIAL_GROUPS) {
		const fieldset = document.createElement("fieldset");
		const legend = document.createElement("legend");
		legend.textContent = group;
		fieldset.append(legend);

		for (const dial of DIALS.filter((d) => d.group === group)) {
			const row = document.createElement("div");
			row.className = "dial";
			const label = document.createElement("label");
			label.textContent = dial.label;
			const slider = document.createElement("input");
			slider.type = "range";
			slider.id = label.htmlFor = `dial-${dial.key}`;
			slider.min = String(dial.min);
			slider.max = String(dial.max);
			slider.step = String(dial.step);
			const output = document.createElement("output");
			output.htmlFor.add(slider.id);
			row.append(label, slider, output);

			const inputs: DialInputs = { slider, output };
			if (dial.nullable) {
				const offLabel = document.createElement("label");
				offLabel.className = "off";
				inputs.off = document.createElement("input");
				inputs.off.type = "checkbox";
				offLabel.append(inputs.off, " off");
				row.append(offLabel);
				inputs.off.addEventListener("change", () => changeDial(dial, send));
			}
			if (dial.needsReset) {
				const note = document.createElement("small");
				note.className = "muted";
				note.textContent = "applies on reset";
				row.append(note);
			}
			slider.addEventListener("input", () => changeDial(dial, send));
			dialInputs.set(dial.key, inputs);
			fieldset.append(row);
		}
		dialsForm.append(fieldset);
	}
}

// Read one dial back into params and pass it on to the engine.
function changeDial(dial: Dial, send: (msg: ToWorker) => void): void {
	const { slider, output, off } = dialInputs.get(dial.key)!;
	const value = off?.checked ? null : Number(slider.value);
	slider.disabled = value === null;
	output.value = formatDial(dial, value);
	(params as Record<keyof Params, number | null>)[dial.key] = value;
	if (!dial.needsReset) send({ type: "set", key: dial.key, value });
	showLoadNotes();
}

// What loading set and left alone, and the growth check, for the dials as
// they are now: both quote dial values (fatality "stays at 1%"), so they are
// written again after every dial change and setting pick.
function showLoadNotes(): void {
	growthNote.textContent = loaded ? growthCheck(loaded.fit, params) : "";
	if (loaded) {
		historyNote.className = "";
		historyNote.textContent = describeLoad(loaded, params);
	}
}

// The loaded outbreak on the chart and in the note under it.
function showOverlay(): void {
	if (!loaded) {
		setReported(null);
		chartNote.textContent = "";
		return;
	}
	setReported({
		name: loaded.name,
		start: loaded.fit.window[0],
		reported: loaded.reported,
		growth: growthLine(loaded.fit),
		windowDays: loaded.windowDays,
		agents: settings.agents,
	});
	chartNote.textContent = describeOverlay(loaded, settings);
}

// "R could not fit X: ..." already names the outbreak; other errors do not.
function loadError(name: string, error: string): string {
	const text = error.replace(/\.$/, "");
	return `${text.startsWith("R could not fit") ? text : `could not fit ${name}: ${text}`}. dials not changed.`;
}

// Put params on the sliders, after a setting is picked.
function showDials(): void {
	for (const dial of DIALS) {
		const { slider, output, off } = dialInputs.get(dial.key)!;
		const value = params[dial.key];
		// A switched-off slider waits at the value it will start from.
		slider.value = String(value ?? dial.nullable!.onValue);
		slider.disabled = value === null;
		if (off) off.checked = value === null;
		output.value = formatDial(dial, value);
	}
}

// --- Setting and run controls -------------------------------------------------

function describeSetting(s: Settings): string {
	const density = s.agents / (s.worldSize * s.worldSize);
	return `${number(s.agents)} people on ${s.worldSize} x ${s.worldSize} (${density.toFixed(2)} per square unit), ${s.initialInfected} infected at the start`;
}

export function initSimulate(worker: Worker, source: SimulateSource): SimulateHandle {
	const send = (msg: ToWorker) => worker.postMessage(msg);
	let outbreaks: OutbreakInfo[] = [];
	// The first list; a load from History may come in before it is there.
	let listReady: Promise<void> = Promise.resolve();
	// Counts loads; only the last one asked for is applied.
	let loadToken = 0;

	// A fresh run from the current setting, seed and dials. Copies, so the
	// dials can keep changing params without touching the worker's copy.
	function reset(): void {
		setRunning(false);
		runButton.disabled = false;
		stepButton.disabled = false;
		const seed = Math.max(1, Math.floor(Number(seedInput.value)) || 1);
		seedInput.value = String(seed);
		resetSimChart();
		send({ type: "reset", settings: { ...settings, seed }, params: { ...params } });
	}

	// A loaded outbreak stays loaded: its four dials go on top of the new
	// setting's ("measles in a village" keeps measles' R0).
	function pickSetting(id: PresetId): void {
		const p = preset(id);
		settings = p.settings;
		params = loaded ? applyLoaded(p.params, loaded.values) : p.params;
		settingInfo.textContent = describeSetting(settings);
		showDials();
		showOverlay();
		showLoadNotes();
		reset();
	}

	// Load an outbreak ("" for nothing): fit it if it is not fitted yet, set
	// the four dials, draw it behind the run and reset (without starting, so
	// day 0 lines up with the reported curve). A failed fit changes nothing.
	async function loadFromHistory(id: string): Promise<void> {
		const token = ++loadToken;
		await listReady;
		if (token !== loadToken) return;
		if (historyPicker.value !== id) historyPicker.value = id;
		if (!id) {
			// Also clears "R is fitting ..." of a load this one cancels.
			historyNote.textContent = "";
			historyNote.className = "";
			if (!loaded) return;
			params = restoreFrom(params, preset(settingPicker.value as PresetId).params);
			loaded = null;
			showDials();
			showOverlay();
			showLoadNotes();
			reset();
			return;
		}
		const name = outbreaks.find((o) => o.id === id)?.name ?? id;
		if (!source.fits.peek(id)) {
			historyNote.className = "muted";
			historyNote.textContent = `R is fitting ${name} (about 5 seconds)... the current run carries on.`;
		}
		let outbreak: Outbreak;
		let result: Awaited<ReturnType<FitCache["get"]>>;
		try {
			[outbreak, result] = await Promise.all([source.load(id), source.fits.get(id, name)]);
		} catch (err) {
			result = { ok: false, error: String(err) };
		}
		if (token !== loadToken) return;
		if (!result.ok) {
			historyNote.className = "error";
			historyNote.textContent = loadError(name, result.error);
			source.log(`load ${id} failed: ${result.error}`);
			historyPicker.value = loaded?.id ?? "";
			return;
		}
		loaded = loadedFrom(outbreak!, result.fit);
		params = applyLoaded(params, loaded.values);
		// The list may have been rebuilt while R was fitting.
		historyPicker.value = id;
		source.log(`loaded ${id} into the simulator`);
		showDials();
		showOverlay();
		showLoadNotes();
		reset();
		runButton.focus();
	}

	// The outbreaks that can be loaded: not the yearly ones, which R cannot fit.
	async function refreshList(): Promise<void> {
		try {
			outbreaks = (await source.list()).filter(comparable);
		} catch (err) {
			source.log(`simulate: could not list outbreaks: ${err}`);
			return;
		}
		// What the picker shows, which can be a load still being fitted.
		const keep = historyPicker.value;
		historyPicker.replaceChildren(new Option("nothing", ""), ...outbreaks.map((o) => new Option(label(o), o.id)));
		historyPicker.value = outbreaks.some((o) => o.id === keep) ? keep : "";
	}

	for (const id of PRESET_IDS) settingPicker.add(new Option(preset(id).label.toLowerCase(), id));
	settingPicker.addEventListener("change", () => pickSetting(settingPicker.value as PresetId));
	historyPicker.addEventListener("change", () => loadFromHistory(historyPicker.value));
	resetButton.addEventListener("click", reset);
	runButton.addEventListener("click", () => {
		send({ type: running ? "pause" : "start" });
		setRunning(!running);
	});
	stepButton.addEventListener("click", () => send({ type: "step" }));

	speedInput.min = "0";
	speedInput.max = String(SPEEDS.length - 1);
	speedInput.step = "1";
	speedInput.value = String(DEFAULT_SPEED);
	const changeSpeed = () => {
		const daysPerSecond = SPEEDS[Number(speedInput.value)];
		speedOutput.value = `${daysPerSecond} days/s`;
		send({ type: "speed", daysPerSecond });
	};
	speedInput.addEventListener("input", changeSpeed);

	worker.addEventListener("message", (event: MessageEvent<FromWorker>) => {
		const msg = event.data;
		if (msg.type === "frame") {
			// The worker stops by itself once nobody is Exposed or Infectious.
			const over = msg.counts[State.Exposed] + msg.counts[State.Infectious] === 0;
			if (over) {
				setRunning(false);
				runButton.disabled = true;
				stepButton.disabled = true;
			}
			latest = msg;
			showStatus(msg.tick, msg.counts, over);
			queueDraw();
		} else if (msg.type === "day") {
			addDay(msg);
		}
	});

	buildDials(send);
	fitCanvas(canvas, queueDraw);
	initSimChart(chartBox);
	changeSpeed();
	pickSetting(settingPicker.value as PresetId);
	listReady = refreshList();
	return { loadFromHistory, refreshList };
}
