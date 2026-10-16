// Web Worker that owns one Engine. The dashboard sends control messages and
// gets frames back; frames carry typed arrays so drawing 5,000 agents per
// tick stays cheap.
import type { Counts, Params, Settings } from "./types";

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
	| { type: "day"; day: number; counts: Counts };

const post = (msg: FromWorker) => postMessage(msg);

onmessage = (event: MessageEvent<ToWorker>) => {
	const msg = event.data;
	switch (msg.type) {
		// TODO: create the Engine on reset, run a tick loop on start, post a
		// frame per drawn tick and a day message every 24 ticks.
		default:
			break;
	}
};

post({ type: "ready" });
