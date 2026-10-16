// The History chart: reported cases and deaths over time, drawn with uPlot
// (https://github.com/leeoniya/uPlot).
//
// Cases and deaths get a panel each, one above the other, with the same time
// axis. A single chart with two y-axes would scale them separately and make
// a few hundred deaths look as big as hundreds of thousands of cases; two
// panels keep each scale honest. The panels share the cursor and the zoom,
// so the lag from cases to deaths lines up.
import uPlot from "uplot";
import type { Annotation, Outbreak } from "../shared/outbreak";

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
function token(name: string): string {
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

// A dashed line at each annotated date with its text at the top, drawn on
// the chart's canvas after uPlot has drawn the series. uPlot's canvas
// counts device pixels, so sizes are multiplied by devicePixelRatio to look
// the same on a HiDPI screen.
function drawAnnotations(u: uPlot, notes: Annotation[]): void {
	const { ctx, bbox } = u;
	const dpr = devicePixelRatio;
	ctx.save();
	ctx.strokeStyle = token("--muted");
	ctx.fillStyle = token("--muted");
	ctx.lineWidth = dpr;
	ctx.setLineDash([4 * dpr, 4 * dpr]);
	ctx.font = `${12 * dpr}px ${getComputedStyle(document.body).fontFamily}`;
	for (const note of notes) {
		const x = u.valToPos(Date.parse(note.date) / 1000, "x", true);
		// Zoomed in on another stretch: the date is off the chart.
		if (x < bbox.left || x > bbox.left + bbox.width) continue;
		ctx.beginPath();
		ctx.moveTo(x, bbox.top);
		ctx.lineTo(x, bbox.top + bbox.height);
		ctx.stroke();
		// Text on whichever side of the line has more room.
		const onLeft = x > bbox.left + bbox.width / 2;
		ctx.textAlign = onLeft ? "right" : "left";
		ctx.fillText(`${note.date}: ${note.text}`, x + (onLeft ? -6 : 6) * dpr, bbox.top + 14 * dpr);
	}
	ctx.restore();
}

export function drawOutbreak(container: HTMLElement, outbreak: Outbreak): void {
	for (const chart of charts) chart.destroy();
	charts = [];
	container.replaceChildren();

	const [from, to] = countedRange(outbreak.columns["cases"] ?? [], outbreak.columns["deaths"] ?? []);
	// uPlot wants time as Unix seconds.
	const time = outbreak.dates.slice(from, to).map((date) => Date.parse(date) / 1000);
	const unit = UNIT[outbreak.interval];
	const muted = token("--muted");
	const line = token("--line");
	const axis = { stroke: muted, grid: { stroke: line, width: 1 }, ticks: { stroke: line, width: 1 } };

	for (const panel of PANELS) {
		const values = (outbreak.columns[panel.column] ?? []).slice(from, to);
		if (!values.some((value) => value !== null)) continue;

		const notes = (outbreak.annotations ?? []).filter((note) => note.column === panel.column);
		const box = document.createElement("div");
		container.append(box);
		const chart = new uPlot(
			{
				width: container.clientWidth,
				height: PANEL_HEIGHT,
				series: [
					{ label: "date", value: (_, seconds) => formatDay(seconds) },
					// Every line here is reported data; fitted and simulated lines
					// get their own labels when they arrive (see README, "What it is").
					{ label: `${panel.column} (reported)`, stroke: token(panel.colour), width: 1 },
				],
				// size is the room for the tick numbers and the axis title, in pixels.
				axes: [axis, { ...axis, label: `${panel.column} per ${unit}`, size: 80 }],
				scales: { x: { time: true } },
				cursor: { sync: { key: SYNC_KEY } },
				hooks: {
					draw: [(u) => drawAnnotations(u, notes)],
					setScale: [
						(u, key) => {
							if (key === "x") syncZoom(u);
						},
					],
				},
				// The dates are calendar days, parsed as midnight UTC. Showing them
				// in local time would put them at 1:00 or 2:00 in the Netherlands.
				tzDate: (seconds) => uPlot.tzDate(new Date(seconds * 1000), "UTC"),
			},
			[time, values],
			box,
		);
		charts.push(chart);
	}
}

// Keep the panels as wide as their box when the window is resized.
export function fitChartTo(container: HTMLElement): void {
	new ResizeObserver(() => {
		for (const chart of charts) chart.setSize({ width: container.clientWidth, height: PANEL_HEIGHT });
	}).observe(container);
}
