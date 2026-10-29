// The History tab: pick a past outbreak from data/ and show it.
// A second outbreak can be picked to compare with the first. The fit button
// has R estimate R0 and R(t) (shared/fit.ts), and "load into simulator"
// hands the first outbreak to the Simulate tab.
import { comparable, firstCase } from "../shared/compare";
import { type Fit, describeFit, describeFitSources } from "../shared/fit";
import type { Outbreak, OutbreakInfo } from "../shared/outbreak";
import { drawComparison, drawOutbreak, fitChartTo } from "./chart";
import type { FitCache } from "./fits";

// How the tab gets its data. index.ts passes in the RPC requests; the tab
// itself does not know about the main process.
export interface HistorySource {
	list: () => Promise<OutbreakInfo[]>;
	load: (id: string) => Promise<Outbreak>;
	fits: FitCache;
	log: (text: string) => void;
}

const picker = document.querySelector<HTMLSelectElement>("#outbreak")!;
const fitButton = document.querySelector<HTMLButtonElement>("#fit")!;
const loadButton = document.querySelector<HTMLButtonElement>("#load-into-simulator")!;
const fitSummary = document.querySelector<HTMLParagraphElement>("#fit-summary")!;
const comparePicker = document.querySelector<HTMLSelectElement>("#compare")!;
const compareNote = document.querySelector<HTMLParagraphElement>("#compare-note")!;
const summary = document.querySelector<HTMLParagraphElement>("#outbreak-summary")!;
const sourceLine = document.querySelector<HTMLParagraphElement>("#outbreak-source")!;
const chartBox = document.querySelector<HTMLDivElement>("#outbreak-chart")!;
fitChartTo(chartBox);

// One line under the picker, for example
// "92 days, 1918-09-01 to 1918-11-30. 1,234 cases, deaths not reported."
export function summarise(outbreak: Outbreak): string {
	const cases = outbreak.columns["cases"] ?? [];
	// Only the rows with a case count: covid_nl's wastewater carries on for
	// years after the case counts stop, and those years have no cases to show.
	const counted = outbreak.dates.filter((_, i) => cases[i] != null);
	const period =
		counted.length > 0
			? `${counted.length} ${UNIT[outbreak.interval]}, ${counted[0]} to ${counted[counted.length - 1]}`
			: "no case counts";
	return `${period}. ${total(cases, "cases")}, ${total(outbreak.columns["deaths"], "deaths")}.`;
}

const UNIT = { day: "days", week: "weeks", year: "years" } as const;

// "1,234 cases", or "deaths not reported" when the column is missing or
// empty. null is not 0: a source that did not count deaths did not report
// zero deaths.
function total(column: (number | null)[] | undefined, label: string): string {
	const values = (column ?? []).filter((value): value is number => value !== null);
	if (values.length === 0) return `${label} not reported`;
	const sum = values.reduce((a, b) => a + b, 0);
	return `${Math.round(sum).toLocaleString("en-GB")} ${label}`;
}

// Where the numbers come from, under the chart.
function describeSource(outbreak: Outbreak): string {
	const parts = [`source: ${outbreak.source}`, `licence: ${outbreak.licence}`, `accessed ${outbreak.accessed}`];
	if (outbreak.notes) parts.push(outbreak.notes);
	return parts.join(". ");
}

// What is on screen: the outbreak picked and the one compared with, if any.
// Empty while a new pick loads, so the buttons never act on the old one.
let shown: Outbreak[] = [];
// Why the last fit of an outbreak failed, until it is fitted. Failures are
// not cached (see fits.ts), so pressing fit again asks R again.
const fitErrors = new Map<string, string>();
// The outbreaks this tab has asked R to fit that have not come back yet.
const fitting = new Set<string>();

const intervalOf = (outbreak: Outbreak) => (outbreak.interval === "week" ? "week" : "day");

// The lines under the summary for one outbreak: its fit, why it failed, or
// how to get one.
function fitLines(source: HistorySource, outbreak: Outbreak): string[] {
	if (!comparable(outbreak)) return ["counted per year, so R cannot fit R0 or R(t): that needs daily or weekly counts."];
	const fit = source.fits.peek(outbreak.id);
	if (fit) return describeFit(fit, intervalOf(outbreak));
	if (fitting.has(outbreak.id)) return [`R is fitting ${outbreak.name} (about 5 seconds)...`];
	const error = fitErrors.get(outbreak.id);
	if (error) return [error];
	return ["not fitted yet. press fit to have R estimate R0 and R(t) (about 5 seconds)."];
}

// The fit lines for what is on screen, and the two buttons to match.
function showFitState(source: HistorySource): void {
	const fits = shown.map((o) => source.fits.peek(o.id));
	const blocks = shown.map((o) => fitLines(source, o));
	fitSummary.textContent =
		shown.length > 1
			? blocks.map((lines, i) => [`${shown[i].name}: ${lines[0]}`, ...lines.slice(1)].join("\n")).join("\n")
			: (blocks[0] ?? []).join("\n");
	const failed = shown.some((o) => fitErrors.has(o.id) && !source.fits.peek(o.id));
	fitSummary.className = failed ? "error" : fits.some(Boolean) ? "" : "muted";

	const first = shown[0];
	const yearly = !first || !comparable(first);
	const allFitted = shown.length > 0 && fits.every(Boolean);
	// Waiting for every outbreak on screen that is not fitted yet.
	const waiting = shown.length > 0 && shown.every((o) => source.fits.peek(o.id) || fitting.has(o.id));
	fitButton.textContent = allFitted ? "fitted" : waiting ? "fitting..." : shown.length > 1 ? "fit both" : "fit";
	fitButton.disabled = allFitted || waiting || yearly;
	fitButton.title = yearly ? "counted per year: R needs daily or weekly counts" : "";
	// Loading does not wait for a fit here: the Simulate tab fits and says so.
	loadButton.disabled = yearly;
	loadButton.title = yearly ? "counted per year: R needs daily or weekly counts" : shown.length > 1 ? `loads ${first.name}` : "";
}

// The charts and source lines for what is on screen, with any fits.
function draw(source: HistorySource): void {
	const [outbreak, other] = shown;
	const fit = (o: Outbreak): Fit | null => source.fits.peek(o.id) ?? null;
	const sources = (o: Outbreak) => {
		const f = fit(o);
		return f ? `${describeSource(o)}\n${describeFitSources(f)}` : describeSource(o);
	};
	if (!other) {
		drawOutbreak(chartBox, outbreak, fit(outbreak));
		sourceLine.textContent = sources(outbreak);
	} else {
		const fitted = fit(outbreak) || fit(other);
		compareNote.textContent =
			`Both start at their first reported case (${outbreak.name} on ${firstCase(outbreak)}, ` +
			`${other.name} on ${firstCase(other)}), on a log scale. Weekly counts are shown per day. ` +
			"A dataset that starts mid-outbreak starts at its first row." +
			(fitted
				? " R(t) is a ratio, not a count, so the two R(t) lines can be compared by height too; the band is shown for the first."
				: "");
		drawComparison(chartBox, outbreak, other, [fit(outbreak), fit(other)]);
		sourceLine.textContent = [outbreak, other].map((o) => `${o.name}: ${sources(o)}`).join("\n");
	}
	showFitState(source);
}

// The outbreak picked, and the one to compare it with if any.
async function show(source: HistorySource): Promise<void> {
	const id = picker.value;
	const otherId = comparePicker.value;
	summary.textContent = "loading...";
	sourceLine.textContent = "";
	compareNote.textContent = "";
	shown = [];
	showFitState(source);
	try {
		const [outbreak, other] = await Promise.all([source.load(id), otherId ? source.load(otherId) : null]);
		// The user may have picked something else while these loaded.
		if (picker.value !== id || comparePicker.value !== otherId) return;
		shown = other ? [outbreak, other] : [outbreak];
		summary.textContent = other
			? shown.map((o) => `${o.name}: ${summarise(o)}`).join("\n")
			: summarise(outbreak);
		draw(source);
	} catch (err) {
		summary.textContent = `could not load ${otherId ? `${id} or ${otherId}` : id}: ${err}`;
		source.log(summary.textContent);
	}
}

// Fit what is on screen that is not fitted or being fitted yet, then redraw
// with the fits. R runs one fit at a time (fits.ts), about 5 seconds each.
async function fitShown(source: HistorySource): Promise<void> {
	const outbreaks = shown.filter((o) => comparable(o) && !source.fits.peek(o.id) && !fitting.has(o.id));
	if (outbreaks.length === 0) {
		// Fitted meanwhile (by the Simulate tab, say): show what there is.
		if (shown.length > 0) draw(source);
		return;
	}
	for (const o of outbreaks) fitting.add(o.id);
	showFitState(source);
	await Promise.all(
		outbreaks.map(async (o) => {
			const result = await source.fits.get(o.id, o.name);
			fitting.delete(o.id);
			if (result.ok) {
				fitErrors.delete(o.id);
				source.log(`fit ${o.id}: R0 ${result.fit.r0}, ${result.fit.rt.length} R(t) values`);
			} else {
				fitErrors.set(o.id, result.error);
				source.log(`fit ${o.id} failed: ${result.error}`);
			}
			// Whatever is on screen now (the user may have picked another
			// outbreak meanwhile) is drawn with the fits there are.
			if (shown.length > 0) draw(source);
		}),
	);
}

// Every outbreak but the one picked, leaving out the yearly ones, which
// are too coarse to set against daily counts. A yearly outbreak picked
// first cannot be compared at all. Keeps the choice if it is still there.
function fillCompare(outbreaks: OutbreakInfo[]): void {
	const keep = comparePicker.value;
	const first = outbreaks.find((outbreak) => outbreak.id === picker.value);
	const others = outbreaks.filter((outbreak) => outbreak.id !== picker.value && comparable(outbreak));
	comparePicker.replaceChildren(
		new Option("nothing", ""),
		...others.map((outbreak) => new Option(label(outbreak), outbreak.id)),
	);
	comparePicker.disabled = !first || !comparable(first);
	comparePicker.title = comparePicker.disabled ? "counted per year, so it cannot be compared with daily counts" : "";
	comparePicker.value = !comparePicker.disabled && others.some((outbreak) => outbreak.id === keep) ? keep : "";
}

// "Flu, my town 2025 (imported)": imported datasets are marked in the list,
// since they are not part of the app's own data. The Simulate tab's list
// uses it too.
export function label(outbreak: OutbreakInfo): string {
	return outbreak.imported ? `${outbreak.name} (imported)` : outbreak.name;
}

// The list from the last fill(), for fillCompare().
let known: OutbreakInfo[] = [];

// Fills the picker from data/ and the imports and shows one outbreak: the
// one with id select if given (a dataset just imported), else the first.
async function fill(source: HistorySource, select?: string): Promise<void> {
	try {
		const outbreaks = await source.list();
		known = outbreaks;
		picker.replaceChildren(...outbreaks.map((outbreak) => new Option(label(outbreak), outbreak.id)));
		picker.disabled = false;
		if (select && outbreaks.some((outbreak) => outbreak.id === select)) picker.value = select;
		fillCompare(outbreaks);
		source.log(`history: ${outbreaks.length} outbreaks`);
		if (outbreaks.length > 0) await show(source);
	} catch (err) {
		picker.replaceChildren(new Option("no data"));
		summary.textContent = `could not list data/: ${err}`;
		source.log(summary.textContent);
	}
}

// Returns a function that reloads the list, for after an import. onLoad is
// "load into simulator": index.ts switches tabs and hands the id over.
export async function initHistory(
	source: HistorySource,
	onLoad: (id: string) => void,
): Promise<(select?: string) => Promise<void>> {
	picker.addEventListener("change", () => {
		fillCompare(known);
		show(source);
	});
	comparePicker.addEventListener("change", () => show(source));
	fitButton.addEventListener("click", () => fitShown(source));
	// A fit asked for by the Simulate tab: draw it if it is on screen here.
	source.fits.onFitted((id) => {
		if (shown.some((o) => o.id === id)) {
			fitErrors.delete(id);
			draw(source);
		}
	});
	loadButton.addEventListener("click", () => {
		if (shown[0]) onLoad(shown[0].id);
	});
	await fill(source);
	return (select) => fill(source, select);
}
