// The Simulate canvas: one dot per agent, coloured by its state.
import { NUM_STATES, State } from "../engine/types";
import { token } from "./chart";

// CSS colour token for each State, in State order. The live chart uses the
// same ones, so a colour means the same thing everywhere on the tab.
export const STATE_TOKENS = ["--state-s", "--state-e", "--state-i", "--state-r", "--state-d"] as const;

// What the canvas needs from a worker frame: x, y in 0-1, one state byte
// per agent.
export interface AgentFrame {
	x: Float32Array;
	y: Float32Array;
	states: Uint8Array;
}

// Dots shrink as the population grows so a crowd does not turn into one
// blob, but stay big enough to see in a care home of 80.
function dotSize(side: number, agents: number): number {
	const dpr = devicePixelRatio;
	return Math.min(8 * dpr, Math.max(2 * dpr, (0.35 * side) / Math.sqrt(agents)));
}

// Everyone but the Susceptible is drawn this much bigger: the few infected
// agents in a city of 5,000 are what you want to follow.
const STANDOUT = 1.8;

// One pass per state, so the fill colour is set 5 times rather than once
// per agent; squares, because fillRect is much cheaper than arcs at 50,000
// agents. States are drawn in order, so the Infectious dots sit on top of
// the Susceptible ones they are about to meet.
export function drawAgents(canvas: HTMLCanvasElement, frame: AgentFrame): void {
	const ctx = canvas.getContext("2d");
	const { width, height } = canvas;
	if (!ctx || width === 0) return;
	ctx.fillStyle = token("--bg");
	ctx.fillRect(0, 0, width, height);

	const { x, y, states } = frame;
	const base = dotSize(width, states.length);
	for (let s = 0; s < NUM_STATES; s++) {
		const size = s === State.Susceptible ? base : base * STANDOUT;
		const half = size / 2;
		ctx.fillStyle = token(STATE_TOKENS[s]);
		for (let i = 0; i < states.length; i++) {
			if (states[i] === s) ctx.fillRect(x[i] * width - half, y[i] * height - half, size, size);
		}
	}
}

// Keep the canvas's own pixels matched to its size on screen (times
// devicePixelRatio, so dots stay sharp on a HiDPI screen), and redraw after
// a resize, which clears it. While the tab is hidden the size is 0 and
// nothing is drawn; showing the tab counts as a resize.
export function fitCanvas(canvas: HTMLCanvasElement, redraw: () => void): void {
	new ResizeObserver(() => {
		canvas.width = Math.round(canvas.clientWidth * devicePixelRatio);
		canvas.height = Math.round(canvas.clientHeight * devicePixelRatio);
		redraw();
	}).observe(canvas);
}
