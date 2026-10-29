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
// fast they spread needs. The scale is uPlot's asinh one: logarithmic down
// to about 0.1 a day and linear below that, which leaves room for days of
// 0 that a pure log scale would have to leave out.
//
// Once R has fitted an outbreak (the fit button, see shared/fit.ts), the
// cases panel shades the growth window R0 was estimated from and draws the
// fitted early growth over it, and an R(t) panel joins below: the fitted
// reproduction number with its 95% band and a line at R = 1. The R(t) axis
// follows the means, not the band: early windows with few cases have bands
// reaching 10 or more, which would flatten everything else, so the band is
// cut off at the top and the legend gives its real numbers.
import uPlot from "uplot";
import { align, daysBetween, mergeDays } from "../shared/compare";
import { type Fit, growthCurve, rtByDay, rtColumns, rtTop } from "../shared/fit";
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
// seconds, or days since the first case when comparing). With to, the
// stretch from x to to is shaded instead (the growth window).
export interface Mark {
	x: number;
	text: string;
	to?: number;
}

// A dashed line across the panel at one y value (R = 1).
export interface Level {
	y: number;
	text: string;
}

// Text on the chart, on a box of the background colour so it stays readable
// over the lines, and kept inside the plot: at x, or ending at x with
// alignRight, moved in where it would run off an edge.
function drawLabel(u: uPlot, text: string, x: number, y: number, alignRight: boolean): void {
	const { ctx, bbox } = u;
	const dpr = devicePixelRatio;
	const width = ctx.measureText(text).width;
	const pad = 3 * dpr;
	let left = alignRight ? x - width : x;
	left = Math.max(bbox.left + pad, Math.min(left, bbox.left + bbox.width - width - pad));
	ctx.fillStyle = token("--bg");
	ctx.fillRect(left - pad, y - 12 * dpr, width + 2 * pad, 16 * dpr);
	ctx.fillStyle = token("--muted");
	ctx.textAlign = "left";
	ctx.fillText(text, left, y);
}

// Marks and levels, drawn on the chart's canvas after uPlot has drawn the
// series: a dashed line at each annotated date with its text at the top, a
// shaded stretch for a mark with to, a dashed line across for each level.
// uPlot's canvas counts device pixels, so sizes are multiplied by
// devicePixelRatio to look the same on a HiDPI screen.
export function drawMarks(u: uPlot, marks: Mark[], levels: Level[] = []): void {
	const { ctx, bbox } = u;
	const dpr = devicePixelRatio;
	const right = bbox.left + bbox.width;
	ctx.save();
	ctx.lineWidth = dpr;
	ctx.font = `${12 * dpr}px ${getComputedStyle(document.body).fontFamily}`;
	for (const mark of marks) {
		const x = u.valToPos(mark.x, "x", true);
		if (mark.to !== undefined) {
			// Only the part that is on the chart, when zoomed in.
			const from = Math.max(bbox.left, x);
			const to = Math.min(right, u.valToPos(mark.to, "x", true));
			if (to <= from) continue;
			ctx.fillStyle = token("--fitted-band");
			ctx.fillRect(from, bbox.top, to - from, bbox.height);
			// On the second row, so a date's note on the first does not cover it.
			drawLabel(u, mark.text, from + 6 * dpr, bbox.top + 32 * dpr, false);
			continue;
		}
		// Zoomed in on another stretch: the date is off the chart.
		if (x < bbox.left || x > right) continue;
		ctx.strokeStyle = token("--muted");
		ctx.fillStyle = token("--muted");
		ctx.setLineDash([4 * dpr, 4 * dpr]);
		ctx.beginPath();
		ctx.moveTo(x, bbox.top);
		ctx.lineTo(x, bbox.top + bbox.height);
		ctx.stroke();
		// Text on whichever side of the line has more room.
		const onLeft = x > bbox.left + bbox.width / 2;
		drawLabel(u, mark.text, x + (onLeft ? -6 : 6) * dpr, bbox.top + 14 * dpr, onLeft);
	}
	for (const level of levels) {
		const y = u.valToPos(level.y, "y", true);
		if (y < bbox.top || y > bbox.top + bbox.height) continue;
		ctx.strokeStyle = token("--muted");
		ctx.fillStyle = token("--muted");
		ctx.setLineDash([4 * dpr, 4 * dpr]);
		ctx.beginPath();
		ctx.moveTo(bbox.left, y);
		ctx.lineTo(right, y);
		ctx.stroke();
		drawLabel(u, level.text, bbox.left + 6 * dpr, y - 4 * dpr, false);
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

// What only some panels need.
interface PanelExtras {
	levels?: Level[];
	// Runs after every change of the x range: the panel's own zoom, or one
	// copied from another panel.
	onZoom?: (u: uPlot) => void;
	// Per series, how far along x the legend may look for a row when the
	// series has none at the cursor (undefined in the data, see mergeDays).
	// uPlot's own rule looks as far as it takes, so past the end of an
	// outbreak the legend would show its last number as if it were that
	// day's. A weekly series gets 3 days, so each day shows its week.
	reach?: number[];
}

// The cursor's row for each series, within that series' reach. The Simulate
// chart uses it too.
export function rowWithin(reach: number[]): uPlot.Cursor.DataIdxRefiner {
	return (u, series, row) => {
		const values = u.data[series];
		if (series === 0 || values[row] !== undefined) return row;
		const x = u.data[0];
		const far = reach[series] ?? 0;
		let best: number | null = null;
		for (let i = row - 1; i >= 0 && x[row] - x[i] <= far; i--) {
			if (values[i] !== undefined) {
				best = i;
				break;
			}
		}
		for (let i = row + 1; i < x.length && x[i] - x[row] <= far; i++) {
			if (values[i] !== undefined) {
				if (best === null || x[i] - x[row] < x[row] - x[best]) best = i;
				break;
			}
		}
		return best;
	};
}

// One panel: what both chart kinds share (size, synced cursor and zoom,
// annotations).
function addPanel(
	container: HTMLElement,
	options: Partial<uPlot.Options>,
	marks: Mark[],
	data: uPlot.AlignedData,
	{ levels = [], onZoom, reach }: PanelExtras = {},
): void {
	const box = document.createElement("div");
	container.append(box);
	const chart = new uPlot(
		{
			width: container.clientWidth,
			height: PANEL_HEIGHT,
			series: [],
			cursor: { sync: { key: SYNC_KEY }, ...(reach ? { dataIdx: rowWithin(reach) } : {}) },
			hooks: {
				draw: [(u) => drawMarks(u, marks, levels)],
				setScale: [
					(u, key) => {
						if (key !== "x") return;
						onZoom?.(u);
						syncZoom(u);
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

// uPlot wants time as Unix seconds.
const seconds = (date: string) => Date.parse(date) / 1000;

// The dates are calendar days, parsed as midnight UTC. Showing them in local
// time would put them at 1:00 or 2:00 in the Netherlands.
const utc = (s: number) => uPlot.tzDate(new Date(s * 1000), "UTC");

// An outbreak's annotations for one column, on a dated x-axis.
function datedMarks(outbreak: Outbreak, column: string): Mark[] {
	return (outbreak.annotations ?? [])
		.filter((note) => note.column === column)
		.map((note) => ({ x: seconds(note.date), text: `${note.date}: ${note.text}` }));
}

const R_ONE: Level = { y: 1, text: "R = 1: above it cases grow, below it they shrink" };

// "1.39", or "-" where there is no estimate.
function formatR(value: number | null | undefined): string {
	return value == null ? "-" : value.toFixed(2);
}

// The legend value of an R(t) line: "1.39 (1.01 to 1.84)", with the band
// read from the lo and hi columns at the same row.
function rWithBand(loIndex: number, hiIndex: number) {
	return (u: uPlot, value: number | null, _series: number, row: number | null): string => {
		if (value == null || row == null) return "-";
		return `${formatR(value)} (${formatR(u.data[loIndex][row])} to ${formatR(u.data[hiIndex][row])})`;
	};
}

// The R(t) means in columns meanIndexes of data, between min and max on x
// (all of them without a range).
function meansIn(data: uPlot.AlignedData, meanIndexes: number[], min?: number, max?: number): (number | null)[] {
	const x = data[0];
	const means: (number | null)[] = [];
	for (const index of meanIndexes) {
		data[index].forEach((value, row) => {
			if (min == null || max == null || (x[row] >= min && x[row] <= max)) means.push(value ?? null);
		});
	}
	return means;
}

// The R(t) y-axis: from 0 to the top that rtTop gives the means in view. It
// starts on all of them; after each zoom (onZoom, which runs once the new x
// range is set) it is set again for the stretch in view. A range function
// would not do: uPlot works out y while x is still the old range.
function rtAxis(data: uPlot.AlignedData, meanIndexes: number[]) {
	return {
		scale: { auto: false, range: [0, rtTop(meansIn(data, meanIndexes))] as uPlot.Range.MinMax },
		onZoom: (u: uPlot) => {
			const { min, max } = u.scales["x"] ?? {};
			u.setScale("y", { min: 0, max: rtTop(meansIn(u.data, meanIndexes, min, max)) });
		},
	};
}

// A note in the chart box instead of a panel.
function noPanel(container: HTMLElement, text: string): void {
	const note = document.createElement("p");
	note.className = "muted";
	note.textContent = text;
	container.append(note);
}

export function drawOutbreak(container: HTMLElement, outbreak: Outbreak, fit: Fit | null = null): void {
	clear(container);
	const [from, to] = countedRange(outbreak.columns["cases"] ?? [], outbreak.columns["deaths"] ?? []);
	const dates = outbreak.dates.slice(from, to);
	const time = dates.map(seconds);
	const unit = UNIT[outbreak.interval];
	const axis = axisStyle();
	// A yearly outbreak cannot be fitted (fit.R refuses it), so a fit always
	// has daily or weekly rows.
	const interval = outbreak.interval === "week" ? "week" : "day";

	for (const panel of PANELS) {
		const values = (outbreak.columns[panel.column] ?? []).slice(from, to);
		if (!values.some((value) => value !== null)) continue;

		const marks = datedMarks(outbreak, panel.column);
		const series: uPlot.Series[] = [
			{ label: "date", value: (_, s) => formatDay(s) },
			{ label: `${panel.column} (reported)`, stroke: token(panel.colour), width: 1 },
		];
		const data: (number | null)[][] = [time, values];
		if (fit && panel.column === "cases") {
			marks.unshift({ x: seconds(fit.window[0]), to: seconds(fit.window[1]), text: "growth window for R0" });
			series.push({ label: "early growth (fitted)", stroke: token("--fitted"), width: 1.5, dash: [6, 4], points: { show: false } });
			data.push(growthCurve(fit, dates, interval));
		}
		addPanel(
			container,
			{
				series,
				// size is the room for the tick numbers and the axis title, in pixels.
				axes: [axis, { ...axis, label: `${panel.column} per ${unit}`, size: 80 }],
				scales: { x: { time: true } },
				tzDate: utc,
			},
			marks,
			data as uPlot.AlignedData,
		);
	}
	if (fit) addRtPanel(container, outbreak, dates, fit);
}

// R(t) under the counts, on the same dated axis. R(t) comes from the cases,
// so the cases annotations (a reporting backlog) are drawn here too.
function addRtPanel(container: HTMLElement, outbreak: Outbreak, dates: string[], fit: Fit): void {
	if (fit.rt.length === 0) {
		noPanel(container, "no 7-day window had 12 or more cases, so there is no R(t)");
		return;
	}
	const axis = axisStyle();
	const columns = rtColumns(dates, fit.rt);
	const data: uPlot.AlignedData = [columns.dates.map(seconds), columns.mean, columns.lo, columns.hi];
	const y = rtAxis(data, [1]);
	const band = token("--fitted-band");
	addPanel(
		container,
		{
			series: [
				{ label: "date", value: (_, s) => formatDay(s) },
				{ label: "R(t) (fitted)", stroke: token("--fitted"), width: 1.5, points: { show: false }, value: rWithBand(2, 3) },
				{ label: "R(t) lower 95% (fitted)", stroke: band, width: 1, points: { show: false }, value: (_, v) => formatR(v) },
				{ label: "R(t) upper 95% (fitted)", stroke: band, width: 1, points: { show: false }, value: (_, v) => formatR(v) },
			],
			bands: [{ series: [3, 2], fill: band }],
			axes: [axis, { ...axis, label: "R(t)", size: 80 }],
			scales: { x: { time: true }, y: y.scale },
			tzDate: utc,
		},
		datedMarks(outbreak, "cases"),
		data,
		{ levels: [R_ONE], onZoom: y.onZoom },
	);
}

// "1,234.5", or "-" for a day without a number.
function formatCount(value: number | null): string {
	return value == null ? "-" : value.toLocaleString("en-GB", { maximumFractionDigits: 1 });
}

// Lines at 0, 1, 10, 100, ... only on a log axis; uPlot also draws 2 to 9.
export function powersOfTen(_: uPlot, splits: number[]): (number | null)[] {
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
// With either fitted, an R(t) panel follows: R is a ratio, not a count, so
// unlike the counts the two R(t) lines can be compared by height too. Only
// the first has its band, to keep the panel readable.
export function drawComparison(
	container: HTMLElement,
	first: Outbreak,
	second: Outbreak,
	fits: [Fit | null, Fit | null] = [null, null],
): void {
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
				// distr 4 is uPlot's asinh scale: logarithmic, except linear below
				// asinh (0.1 a day), which leaves room for days of 0.
				scales: { x: { time: false }, y: { distr: 4, asinh: 0.1 } },
			},
			[...marksFor(first, panel.column, a.start), ...marksFor(second, panel.column, b.start)],
			mergeDays(a, b),
			{ reach: [0, 3, 3] },
		);
	}
	if (fits[0] || fits[1]) addRtComparison(container, first, second, fits);
}

function addRtComparison(container: HTMLElement, first: Outbreak, second: Outbreak, fits: [Fit | null, Fit | null]): void {
	const axis = axisStyle();
	const a = align(first, "cases");
	const b = align(second, "cases");
	const none = { days: [], mean: [], lo: [], hi: [] };
	const ra = fits[0] ? rtByDay(fits[0].rt, a.start) : none;
	const rb = fits[1] ? rtByDay(fits[1].rt, b.start) : none;
	if (ra.days.length === 0 && rb.days.length === 0) {
		noPanel(container, "no 7-day window had 12 or more cases, so there is no R(t)");
		return;
	}
	// The case days are in the x column (and not drawn) so the x range is the
	// same as the panels above.
	const [days, , , mean, lo, hi, otherMean] = mergeDays(
		a,
		b,
		{ days: ra.days, values: ra.mean },
		{ days: ra.days, values: ra.lo },
		{ days: ra.days, values: ra.hi },
		{ days: rb.days, values: rb.mean },
	);
	const data: uPlot.AlignedData = [days, mean, lo, hi, otherMean];
	const y = rtAxis(data, [1, 4]);
	const band = token("--fitted-band");
	const label = (outbreak: Outbreak, fit: Fit | null) => `${outbreak.name} R(t) (${fit ? "fitted" : "not fitted"})`;
	addPanel(
		container,
		{
			series: [
				{ label: "day", value: (_, day) => (day == null ? "-" : `day ${day}`) },
				{ label: label(first, fits[0]), stroke: token("--fitted"), width: 1.5, points: { show: false }, value: rWithBand(2, 3) },
				{ label: "lower 95%", stroke: band, width: 1, points: { show: false }, value: (_, v) => formatR(v) },
				{ label: "upper 95%", stroke: band, width: 1, points: { show: false }, value: (_, v) => formatR(v) },
				{
					label: label(second, fits[1]),
					stroke: token("--muted"),
					width: 1.5,
					dash: [6, 4],
					points: { show: false },
					value: (_, v) => formatR(v),
				},
			],
			bands: fits[0] ? [{ series: [3, 2], fill: band }] : [],
			axes: [
				{ ...axis, label: "days since the first case" },
				{ ...axis, label: "R(t)", size: 80 },
			],
			scales: { x: { time: false }, y: y.scale },
		},
		[],
		data,
		// R(t) is daily inside its span; outside it there is no estimate.
		{ levels: [R_ONE], onZoom: y.onZoom, reach: [0, 0, 0, 0, 0] },
	);
}

// Keep the panels as wide as their box when the window is resized.
export function fitChartTo(container: HTMLElement): void {
	new ResizeObserver(() => {
		for (const chart of charts) chart.setSize({ width: container.clientWidth, height: PANEL_HEIGHT });
	}).observe(container);
}
