// The Simulate chart: daily totals from the worker, drawn with uPlot as the
// run goes. Two panels with the same day axis, like the History chart:
//
// 1. agents in each state. All five are head counts out of the same
//    population, so one y-axis is fair to all of them.
// 2. new cases and deaths per day: the shape a reported outbreak has, so a
//    real curve can be drawn behind it later ("Load from history").
//
// Every series is labelled "(simulated)" (see README, "What it is").
import uPlot from "uplot";
import type { Counts } from "../engine/types";
import type { FromWorker } from "../engine/worker";
import { STATE_TOKENS } from "./canvas";
import { token } from "./chart";

type Day = Extract<FromWorker, { type: "day" }>;

const PANEL_HEIGHT = 180;
const SYNC_KEY = "simulate";
const STATE_LABELS = ["susceptible", "exposed", "infectious", "recovered", "dead"];

// One array per column, as uPlot wants them: days, then the five states,
// then new cases and new deaths.
let columns: number[][] = [];
let charts: uPlot[] = [];

function emptyColumns(): number[][] {
	return Array.from({ length: 1 + STATE_LABELS.length + 2 }, () => []);
}

function panel(box: HTMLElement, width: number, yLabel: string, series: uPlot.Series[]): uPlot {
	const muted = token("--muted");
	const line = token("--line");
	const axis = { stroke: muted, grid: { stroke: line, width: 1 }, ticks: { stroke: line, width: 1 } };
	return new uPlot(
		{
			width,
			height: PANEL_HEIGHT,
			series: [{ label: "day" }, ...series],
			axes: [axis, { ...axis, label: yLabel, size: 80 }],
			scales: { x: { time: false } },
			// The data changes every simulated day, which would undo a zoom
			// straight away, so dragging only moves the cursor.
			cursor: { sync: { key: SYNC_KEY }, drag: { x: false, y: false } },
		},
		[[], ...series.map(() => [])],
		box,
	);
}

const simulated = (label: string, colour: string): uPlot.Series => ({
	label: `${label} (simulated)`,
	stroke: token(colour),
	width: 1.5,
	// uPlot dots every value while a run is short; a plain line reads better.
	points: { show: false },
});

export function initSimChart(container: HTMLElement): void {
	const width = container.clientWidth;
	const top = document.createElement("div");
	const bottom = document.createElement("div");
	container.append(top, bottom);
	charts = [
		panel(
			top,
			width,
			"agents",
			STATE_LABELS.map((label, s) => simulated(label, STATE_TOKENS[s])),
		),
		panel(bottom, width, "per day", [simulated("new cases", "--state-i"), simulated("new deaths", "--state-d")]),
	];
	resetSimChart();
	new ResizeObserver(() => {
		for (const chart of charts) chart.setSize({ width: container.clientWidth, height: PANEL_HEIGHT });
	}).observe(container);
}

// Before a new run: the worker sends day 0 straight after its reset.
export function resetSimChart(): void {
	columns = emptyColumns();
	draw();
}

export function addDay(day: Day): void {
	const values: number[] = [day.day, ...(day.counts as Counts), day.newCases, day.newDeaths];
	values.forEach((value, i) => columns[i].push(value));
	draw();
}

function draw(): void {
	const [days, ...rest] = columns;
	const states = rest.slice(0, STATE_LABELS.length);
	const perDay = rest.slice(STATE_LABELS.length);
	charts[0]?.setData([days, ...states]);
	charts[1]?.setData([days, ...perDay]);
}
