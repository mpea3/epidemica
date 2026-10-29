// The Simulate chart: daily totals from the worker, drawn with uPlot as the
// run goes. Two panels with the same day axis, like the History chart:
//
// 1. agents in each state. All five are head counts out of the same
//    population, so one y-axis is fair to all of them.
// 2. new infections and deaths per day: the shape a reported outbreak has.
//    The worker counts infections (agents becoming Exposed), not cases at
//    symptoms, hence "infections".
//
// With an outbreak loaded from history (setReported), the second panel also
// draws that outbreak's reported cases as a grey area behind the simulated
// lines, the early growth R fitted (dashed purple), the growth window
// (shaded) and the day 10% of the agents have been infected. It then
// switches to a log scale: the real outbreak's population is not in the data
// and is far bigger than the simulation's, so the heights cannot be compared,
// but on a log scale a growth rate is a slope, and slopes can. See
// describeOverlay in fromhistory.ts for the note under the chart.
//
// Every series is labelled "(simulated)", "(reported)" or "(fitted)" (see
// README, "What it is").
import uPlot from "uplot";
import type { Counts } from "../engine/types";
import type { FromWorker } from "../engine/worker";
import { type Aligned, dateAfter, mergeDays } from "../shared/compare";
import { STATE_TOKENS } from "./canvas";
import { type Mark, drawMarks, powersOfTen, rowWithin, token } from "./chart";
import { depletionDay } from "./fromhistory";

type Day = Extract<FromWorker, { type: "day" }>;

// A loaded outbreak, as the per-day panel draws it behind the simulation.
export interface Comparison {
	name: string;
	start: string; // the date of day 0: the first day of the growth window
	reported: Aligned; // cases per day by day since start
	growth: { days: number[]; values: number[] }; // the fitted early growth
	windowDays: number; // the growth window is days 0 to this one
	agents: number; // the simulated population, for the 10% line
}

const PANEL_HEIGHT = 180;
const SYNC_KEY = "simulate";
const STATE_LABELS = ["susceptible", "exposed", "infectious", "recovered", "dead"];

// One array per column, as uPlot wants them: days, then the five states,
// then new infections and new deaths.
let columns: number[][] = [];
let charts: uPlot[] = [];
let comparison: Comparison | null = null;
let perDayBox: HTMLElement | null = null;

function emptyColumns(): number[][] {
	return Array.from({ length: 1 + STATE_LABELS.length + 2 }, () => []);
}

function axisStyle() {
	const line = token("--line");
	return { stroke: token("--muted"), grid: { stroke: line, width: 1 }, ticks: { stroke: line, width: 1 } };
}

// The last simulated day so far.
const lastDay = () => columns[0][columns[0].length - 1] ?? 0;

// With an outbreak loaded, both panels show day 0 to the end of the growth
// window before the run starts, then grow with the run: the reported data
// beyond is revealed as the run goes, and three years of COVID-19 never
// squash a run of 100 days. Dragging is off (see panel), so nothing else
// sets the x scale.
function xRange(_: uPlot, min: number | null, max: number | null): uPlot.Range.MinMax {
	if (comparison) return [0, Math.max(lastDay(), comparison.windowDays, 1)];
	const from = min ?? 0;
	return [from, Math.max(max ?? from, from + 1)];
}

function panel(box: HTMLElement, width: number, options: Partial<uPlot.Options>, data: uPlot.AlignedData): uPlot {
	return new uPlot(
		{
			width,
			height: PANEL_HEIGHT,
			series: [],
			scales: { x: { time: false, range: xRange } },
			// The data changes every simulated day, which would undo a zoom
			// straight away, so dragging only moves the cursor.
			cursor: { sync: { key: SYNC_KEY }, drag: { x: false, y: false } },
			...options,
		},
		data,
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

// "12 on 1861-11-25": the reported count under the cursor with its real date.
function reportedValue(start: string) {
	return (u: uPlot, value: number | null, _series: number, row: number | null): string => {
		if (value == null || row == null) return "-";
		const day = u.data[0][row];
		const count = value.toLocaleString("en-GB", { maximumFractionDigits: 1 });
		return `${count} on ${dateAfter(start, day)}`;
	};
}

// The growth window and the 10% line, for the draw hook.
function comparisonMarks(): Mark[] {
	if (!comparison) return [];
	const marks: Mark[] = [{ x: 0, to: comparison.windowDays, text: "growth window" }];
	const day = depletionDay(columns[0], columns[1 + STATE_LABELS.length], comparison.agents);
	if (day !== null) marks.push({ x: day, text: "10% of agents infected" });
	return marks;
}

// The per-day panel, built again whenever an outbreak is loaded or unloaded,
// since its series and y scale change.
function perDayPanel(width: number): uPlot {
	const axis = axisStyle();
	const own = [simulated("new infections", "--state-i"), simulated("new deaths", "--state-d")];
	if (!comparison) {
		return panel(
			perDayBox!,
			width,
			{
				series: [{ label: "day" }, ...own],
				axes: [axis, { ...axis, label: "per day", size: 80 }],
			},
			[[], [], []],
		);
	}
	// Drawn in order, so the reported area is behind everything else.
	const reported: uPlot.Series = {
		label: `cases, ${comparison.name} (reported)`,
		stroke: token("--muted"),
		fill: token("--reported-band"),
		width: 1,
		points: { show: false },
		value: reportedValue(comparison.start),
	};
	const fitted: uPlot.Series = {
		label: "early growth (fitted)",
		stroke: token("--fitted"),
		width: 1.5,
		dash: [6, 4],
		points: { show: false },
	};
	return panel(
		perDayBox!,
		width,
		{
			series: [{ label: "day" }, reported, fitted, ...own],
			axes: [
				axis,
				{
					...axis,
					label: "per day (log)",
					size: 80,
					filter: powersOfTen,
					grid: { ...axis.grid, filter: powersOfTen },
					ticks: { ...axis.ticks, filter: powersOfTen },
				},
			],
			// distr 4 is uPlot's asinh scale: logarithmic, except linear below
			// asinh (0.1 a day), which leaves room for days of 0.
			scales: { x: { time: false, range: xRange }, y: { distr: 4, asinh: 0.1 } },
			// The four series have rows on different days (mergeDays). Only the
			// reported one, weekly for some outbreaks, may show a row up to 3
			// days off; the others show "-" where they have none, such as days
			// the run has not reached yet.
			cursor: { sync: { key: SYNC_KEY }, drag: { x: false, y: false }, dataIdx: rowWithin([0, 3, 0, 0, 0]) },
			hooks: { draw: [(u) => drawMarks(u, comparisonMarks())] },
		},
		[[], [], [], [], []],
	);
}

export function initSimChart(container: HTMLElement): void {
	const width = container.clientWidth;
	const top = document.createElement("div");
	perDayBox = document.createElement("div");
	container.append(top, perDayBox);
	const axis = axisStyle();
	charts = [
		panel(
			top,
			width,
			{
				series: [{ label: "day" }, ...STATE_LABELS.map((label, s) => simulated(label, STATE_TOKENS[s]))],
				axes: [axis, { ...axis, label: "agents", size: 80 }],
			},
			[[], ...STATE_LABELS.map(() => [])],
		),
		perDayPanel(width),
	];
	resetSimChart();
	new ResizeObserver(() => {
		for (const chart of charts) chart.setSize({ width: container.clientWidth, height: PANEL_HEIGHT });
	}).observe(container);
}

// An outbreak to draw behind the simulation, or null for none.
export function setReported(next: Comparison | null): void {
	comparison = next;
	if (!perDayBox || charts.length < 2) return;
	const width = charts[1].width;
	charts[1].destroy();
	charts[1] = perDayPanel(width);
	draw();
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
	const [infections, deaths] = rest.slice(STATE_LABELS.length);
	charts[0]?.setData([days, ...states]);
	if (!comparison) {
		charts[1]?.setData([days, infections, deaths]);
		return;
	}
	// One day column for all four; a day only some of them have is undefined
	// for the others, which uPlot draws across (weekly reported rows).
	charts[1]?.setData(
		mergeDays(
			comparison.reported,
			{ days: comparison.growth.days, values: comparison.growth.values },
			{ days, values: infections },
			{ days, values: deaths },
		) as uPlot.AlignedData,
	);
}
