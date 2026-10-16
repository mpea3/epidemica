// Web Worker that owns one Engine. The dashboard sends control messages and
// gets frames back; frames carry typed arrays so drawing 5,000 agents per
// tick stays cheap.
import { Engine } from "./engine";
import { type Counts, type Params, type Settings, TICKS_PER_DAY } from "./types";

export type ToWorker =
	| { type: "reset"; settings: Settings; params: Params }
	| { type: "start" }
	| { type: "pause" }
	| { type: "step" }
	| { type: "set"; key: keyof Params; value: number | null }
	| { type: "speed"; daysPerSecond: number };

export type FromWorker =
	| { type: "ready" }
	// x, y in 0-1 and one state byte per agent.
	| { type: "frame"; tick: number; counts: Counts; x: Float32Array; y: Float32Array; states: Uint8Array }
	// Sent on reset (day 0) and after every 24 ticks.
	| { type: "day"; day: number; counts: Counts };

// The screen redraws about 60 times a second, so there is no point sending
// frames faster than that.
const FRAME_MS = 1000 / 60;

// Transferred arrays move to the UI thread instead of being copied.
const post = (msg: FromWorker, transfer: Transferable[] = []) => postMessage(msg, { transfer });

let engine: Engine | null = null;
let running = false;
let daysPerSecond = 2;
// Ticks that are due but have not run yet. Speed changes how fast this
// grows, never how long a tick is, so the model is the same at any speed.
let ticksOwed = 0;
let lastTime = 0;
let loopTimer: ReturnType<typeof setTimeout> | undefined;

// One tick, plus the daily totals for the charts at the end of each day.
function runTick(e: Engine): void {
	e.step();
	const tick = e.currentTick();
	if (tick % TICKS_PER_DAY === 0) post({ type: "day", day: tick / TICKS_PER_DAY, counts: e.counts() });
}

// The engine's own arrays keep changing, so the frame gets copies. Positions
// are divided by the world size so the canvas does not need to know it.
function postFrame(e: Engine): void {
	const world = e.world();
	const size = e.worldSettings().worldSize;
	const n = world.x.length;
	const x = new Float32Array(n);
	const y = new Float32Array(n);
	for (let i = 0; i < n; i++) {
		x[i] = world.x[i] / size;
		y[i] = world.y[i] / size;
	}
	const states = world.state.slice();
	post({ type: "frame", tick: e.currentTick(), counts: e.counts(), x, y, states }, [x.buffer, y.buffer, states.buffer]);
}

// Called about 60 times a second while running: run the ticks that are due
// since last time, then send one frame.
function loop(): void {
	if (!engine || !running) return;
	const now = performance.now();
	ticksOwed += ((now - lastTime) / 1000) * daysPerSecond * TICKS_PER_DAY;
	lastTime = now;

	let ran = 0;
	while (ticksOwed >= 1 && !engine.done()) {
		runTick(engine);
		ticksOwed--;
		ran++;
		// If the machine cannot keep up, let the run go slower rather than
		// freeze the worker: drop what is still owed and draw what we have.
		if (performance.now() - now > FRAME_MS) {
			ticksOwed = 0;
			break;
		}
	}
	if (ran > 0) postFrame(engine);

	if (engine.done()) {
		running = false;
		return;
	}
	loopTimer = setTimeout(loop, FRAME_MS);
}

function stop(): void {
	running = false;
	clearTimeout(loopTimer);
}

onmessage = (event: MessageEvent<ToWorker>) => {
	const msg = event.data;
	switch (msg.type) {
		case "reset":
			stop();
			engine = new Engine(msg.settings, msg.params);
			post({ type: "day", day: 0, counts: engine.counts() });
			postFrame(engine);
			break;
		case "start":
			if (!engine || running || engine.done()) break;
			running = true;
			ticksOwed = 0;
			lastTime = performance.now();
			loopTimer = setTimeout(loop, FRAME_MS);
			break;
		case "pause":
			stop();
			break;
		case "step":
			// One tick at a time, only while paused.
			if (!engine || running) break;
			runTick(engine);
			postFrame(engine);
			break;
		case "set":
			engine?.setParam(msg.key, msg.value);
			break;
		case "speed":
			daysPerSecond = Math.max(0, msg.daysPerSecond);
			break;
	}
};

post({ type: "ready" });
