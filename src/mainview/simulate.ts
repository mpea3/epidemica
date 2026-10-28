// The Simulate tab: a setting, the dials, run controls and the canvas. The
// engine runs in a Web Worker (src/engine/worker.ts); this file only sends
// it messages and draws what comes back.
import { PRESET_IDS, type PresetId, preset } from "../engine/presets";
import { type Counts, type Params, type Settings, State, TICKS_PER_DAY } from "../engine/types";
import type { FromWorker, ToWorker } from "../engine/worker";
import { type AgentFrame, STATE_TOKENS, drawAgents, fitCanvas } from "./canvas";
import { DIAL_GROUPS, DIALS, type Dial, formatDial } from "./dials";

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

export function initSimulate(worker: Worker): void {
	const send = (msg: ToWorker) => worker.postMessage(msg);

	// A fresh run from the current setting, seed and dials. Copies, so the
	// dials can keep changing params without touching the worker's copy.
	function reset(): void {
		setRunning(false);
		runButton.disabled = false;
		stepButton.disabled = false;
		const seed = Math.max(1, Math.floor(Number(seedInput.value)) || 1);
		seedInput.value = String(seed);
		send({ type: "reset", settings: { ...settings, seed }, params: { ...params } });
	}

	function pickSetting(id: PresetId): void {
		const p = preset(id);
		settings = p.settings;
		params = p.params;
		settingInfo.textContent = describeSetting(settings);
		showDials();
		reset();
	}

	for (const id of PRESET_IDS) settingPicker.add(new Option(preset(id).label.toLowerCase(), id));
	settingPicker.addEventListener("change", () => pickSetting(settingPicker.value as PresetId));
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
		}
	});

	buildDials(send);
	fitCanvas(canvas, queueDraw);
	changeSpeed();
	pickSetting(settingPicker.value as PresetId);
}
