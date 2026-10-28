// The History chart: reported cases and deaths over time, drawn with uPlot
// (https://github.com/leeoniya/uPlot).
//
// Cases and deaths get a panel each, one above the other, with the same time
// axis. A single chart with two y-axes would scale them separately and make
// a few hundred deaths look as big as hundreds of thousands of cases; two
// panels keep each scale honest. The panels share the cursor and the zoom,
// so the lag from cases to deaths lines up.
//
// With a second outbreak picked, drawComparison puts both on each panel
// instead, counted in days since each one's first case (see
// shared/compare.ts) on a log scale. The outbreaks can differ ten
// thousandfold in size (188 cases of measles in Hagelloch, 8.6 million of
// COVID-19 in the Netherlands); on a log scale both stay readable, and the
// same growth rate gives the same slope, which is what a comparison of how
// fast they spread needs. The scale is uPlot's asinh one: logarithmic
// from 1 up, but with room for days of 0, which a pure log scale would
// have to leave out.
import uPlot from "uplot";
import { align, daysBetween, mergeDays } from "../shared/compare";
import type { Outbreak } from "../shared/outbreak";

// What each panel shows: a column from data/<id>.json and the CSS colour
// token to draw it in. A panel whose column is empty is left out.
const PANELS = [
	{ column: "cases", colour: "--fg" },
	{ column: "deaths", colour: "--accent" },
] as const;

const PANEL_HEIGHT = 220;
const UNIT = { day: "day", week: "week", year: "year" } as const;
// Panels with the same key move their cursors together.
const SYNC_KEY = "history";

let charts: uPlot[] = [];
// True while one panel copies its zoom to the others, see syncZoom().
let syncing = false;

// Colours come from the CSS tokens in style.css, so the chart follows the
// light or dark theme it is drawn in.
export function token(name: string): string {
	return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

// First and last row that has a case or death count. covid_nl's dates run
// on for years of wastewater after the counts stop; without this the chart
// would end in a long empty stretch.
function countedRange(cases: (number | null)[], deaths: (number | null)[]): [number, number] {
	const counted = (i: number) => cases[i] != null || deaths[i] != null;
	let first = 0;
	let last = cases.length - 1;
	while (first < last && !counted(first)) first++;
	while (last > first && !counted(last)) last--;
	return [first, last + 1];
}

// Zooming one panel (drag across it; double-click to zoom out) sets the same
// time range on the others. setScale on another panel runs this hook again
// for that panel, so the flag stops them calling each other forever.
function syncZoom(source: uPlot): void {
	if (syncing) return;
	const { min, max } = source.scales["x"] ?? {};
	if (min == null || max == null) return;
	syncing = true;
	for (const other of charts) {
		if (other !== source) other.setScale("x", { min, max });
	}
	syncing = false;
}

// The day under the cursor as 1918-09-01, not uPlot's date and time.
function formatDay(seconds: number | null): string {
	return seconds == null ? "-" : new Date(seconds * 1000).toISOString().slice(0, 10);
}

// An annotation placed on the x-axis: x is in the panel's own unit (Unix
// seconds, or days since the first case when comparing).
interface Mark {
	x: number;
	text: string;
}

// A dashed line at each annotated date with its text at the top, drawn on
// the chart's canvas after uPlot has drawn the series. uPlot's canvas
// counts device pixels, so sizes are multiplied by devicePixelRatio to look
// the same on a HiDPI screen.
function drawAnnotations(u: uPlot, marks: Mark[]): void {
	const { ctx, bbox } = u;
	const dpr = devicePixelRatio;
	ctx.save();
	ctx.strokeStyle = token("--muted");
	ctx.fillStyle = token("--muted");
	ctx.lineWidth = dpr;
	ctx.setLineDash([4 * dpr, 4 * dpr]);
	ctx.font = `${12 * dpr}px ${getComputedStyle(document.body).fontFamily}`;
	for (const mark of marks) {
		const x = u.valToPos(mark.x, "x", true);
		// Zoomed in on another stretch: the date is off the chart.
		if (x < bbox.left || x > bbox.left + bbox.width) continue;
		ctx.beginPath();
		ctx.moveTo(x, bbox.top);
		ctx.lineTo(x, bbox.top + bbox.height);
		ctx.stroke();
		// Text on whichever side of the line has more room.
		const onLeft = x > bbox.left + bbox.width / 2;
		ctx.textAlign = onLeft ? "right" : "left";
		ctx.fillText(mark.text, x + (onLeft ? -6 : 6) * dpr, bbox.top + 14 * dpr);
	}
	ctx.restore();
}

function clear(container: HTMLElement): void {
	for (const chart of charts) chart.destroy();
	charts = [];
	container.replaceChildren();
}

function axisStyle() {
	const line = token("--line");
	return { stroke: token("--muted"), grid: { stroke: line, width: 1 }, ticks: { stroke: line, width: 1 } };
}

// One panel: what both chart kinds share (size, synced cursor and zoom,
// annotations).
function addPanel(container: HTMLElement, options: Partial<uPlot.Options>, marks: Mark[], data: uPlot.AlignedData): void {
	const box = document.createElement("div");
	container.append(box);
	const chart = new uPlot(
		{
			width: container.clientWidth,
			height: PANEL_HEIGHT,
			series: [],
			cursor: { sync: { key: SYNC_KEY } },
			hooks: {
				draw: [(u) => drawAnnotations(u, marks)],
				setScale: [
					(u, key) => {
						if (key === "x") syncZoom(u);
					},
				],
			},
			...options,
		},
		data,
		box,
	);
	charts.push(chart);
}

export function drawOutbreak(container: HTMLElement, outbreak: Outbreak): void {
	clear(container);
	const [from, to] = countedRange(outbreak.columns["cases"] ?? [], outbreak.columns["deaths"] ?? []);
	// uPlot wants time as Unix seconds.
	const time = outbreak.dates.slice(from, to).map((date) => Date.parse(date) / 1000);
	const unit = UNIT[outbreak.interval];
	const axis = axisStyle();

	for (const panel of PANELS) {
		const values = (outbreak.columns[panel.column] ?? []).slice(from, to);
		if (!values.some((value) => value !== null)) continue;

		const marks = (outbreak.annotations ?? [])
			.filter((note) => note.column === panel.column)
			.map((note) => ({ x: Date.parse(note.date) / 1000, text: `${note.date}: ${note.text}` }));
		addPanel(
			container,
			{
				series: [
					{ label: "date", value: (_, seconds) => formatDay(seconds) },
					// Every line here is reported data; fitted and simulated lines
					// get their own labels when they arrive (see README, "What it is").
					{ label: `${panel.column} (reported)`, stroke: token(panel.colour), width: 1 },
				],
				// size is the room for the tick numbers and the axis title, in pixels.
				axes: [axis, { ...axis, label: `${panel.column} per ${unit}`, size: 80 }],
				scales: { x: { time: true } },
				// The dates are calendar days, parsed as midnight UTC. Showing them
				// in local time would put them at 1:00 or 2:00 in the Netherlands.
				tzDate: (seconds) => uPlot.tzDate(new Date(seconds * 1000), "UTC"),
			},
			marks,
			[time, values],
		);
	}
}

// "1,234.5", or "-" for a day without a number.
function formatCount(value: number | null): string {
	return value == null ? "-" : value.toLocaleString("en-GB", { maximumFractionDigits: 1 });
}

function powersOfTen(_: uPlot, splits: number[]): (number | null)[] {
	return splits.map((value) => (value === 0 || Number.isInteger(Math.round(Math.log10(value) * 1e6) / 1e6) ? value : null));
}

// Annotations of one outbreak, moved to its days since the first case.
function marksFor(outbreak: Outbreak, column: string, start: string): Mark[] {
	return (outbreak.annotations ?? [])
		.filter((note) => note.column === column)
		.map((note) => ({ x: daysBetween(start, note.date), text: `${outbreak.name}, ${note.date}: ${note.text}` }))
		.filter((mark) => mark.x >= 0);
}

// first is drawn in the panel's colour, second in grey. Both are reported.
export function drawComparison(container: HTMLElement, first: Outbreak, second: Outbreak): void {
	clear(container);
	const axis = axisStyle();

	for (const panel of PANELS) {
		const a = align(first, panel.column);
		const b = align(second, panel.column);
		const reported = (values: (number | null)[]) => values.some((value) => value !== null);
		if (!reported(a.values) && !reported(b.values)) continue;

		const label = (outbreak: Outbreak, values: (number | null)[]) =>
			`${outbreak.name} (${reported(values) ? "reported" : "not reported"})`;
		const line = (colour: string, outbreak: Outbreak, values: (number | null)[]): uPlot.Series => ({
			label: label(outbreak, values),
			stroke: token(colour),
			width: 1,
			value: (_, v) => formatCount(v),
		});
		addPanel(
			container,
			{
				series: [
					{ label: "day", value: (_, day) => (day == null ? "-" : `day ${day}`) },
					line(panel.colour, first, a.values),
					line("--muted", second, b.values),
				],
				axes: [
					{ ...axis, label: "days since the first case" },
					// Lines at 0, 1, 10, 100, ... only; uPlot also draws 2 to 9.
					{
						...axis,
						label: `${panel.column} per day (log)`,
						size: 80,
						filter: powersOfTen,
						grid: { ...axis.grid, filter: powersOfTen },
						ticks: { ...axis.ticks, filter: powersOfTen },
					},
				],
				// distr 4 is uPlot's asinh scale, linear below asinh (1 a day).
				scales: { x: { time: false }, y: { distr: 4, asinh: 1 } },
			},
			[...marksFor(first, panel.column, a.start), ...marksFor(second, panel.column, b.start)],
			mergeDays(a, b),
		);
	}
}

// Keep the panels as wide as their box when the window is resized.
export function fitChartTo(container: HTMLElement): void {
	new ResizeObserver(() => {
		for (const chart of charts) chart.setSize({ width: container.clientWidth, height: PANEL_HEIGHT });
	}).observe(container);
}
