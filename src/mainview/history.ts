// The History tab: pick a past outbreak from data/ and show it.
// A second outbreak can be picked to compare with the first.
import { comparable, firstCase } from "../shared/compare";
import type { Outbreak, OutbreakInfo } from "../shared/outbreak";
import { drawComparison, drawOutbreak, fitChartTo } from "./chart";

// How the tab gets its data. index.ts passes in the RPC requests; the tab
// itself does not know about the main process.
export interface HistorySource {
	list: () => Promise<OutbreakInfo[]>;
	load: (id: string) => Promise<Outbreak>;
	log: (text: string) => void;
}

const picker = document.querySelector<HTMLSelectElement>("#outbreak")!;
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

// The outbreak picked, and the one to compare it with if any.
async function show(source: HistorySource): Promise<void> {
	const id = picker.value;
	const otherId = comparePicker.value;
	summary.textContent = "loading...";
	sourceLine.textContent = "";
	compareNote.textContent = "";
	try {
		const [outbreak, other] = await Promise.all([source.load(id), otherId ? source.load(otherId) : null]);
		// The user may have picked something else while these loaded.
		if (picker.value !== id || comparePicker.value !== otherId) return;
		if (!other) {
			summary.textContent = summarise(outbreak);
			drawOutbreak(chartBox, outbreak);
			sourceLine.textContent = describeSource(outbreak);
			return;
		}
		summary.textContent = [outbreak, other].map((o) => `${o.name}: ${summarise(o)}`).join("\n");
		compareNote.textContent =
			`Both start at their first reported case (${outbreak.name} on ${firstCase(outbreak)}, ` +
			`${other.name} on ${firstCase(other)}), on a log scale. Weekly counts are shown per day. ` +
			"A dataset that starts mid-outbreak starts at its first row.";
		drawComparison(chartBox, outbreak, other);
		sourceLine.textContent = [outbreak, other].map((o) => `${o.name}: ${describeSource(o)}`).join("\n");
	} catch (err) {
		summary.textContent = `could not load ${otherId ? `${id} or ${otherId}` : id}: ${err}`;
		source.log(summary.textContent);
	}
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
// since they are not part of the app's own data.
function label(outbreak: OutbreakInfo): string {
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

// Returns a function that reloads the list, for after an import.
export async function initHistory(source: HistorySource): Promise<(select?: string) => Promise<void>> {
	picker.addEventListener("change", () => {
		fillCompare(known);
		show(source);
	});
	comparePicker.addEventListener("change", () => show(source));
	await fill(source);
	return (select) => fill(source, select);
}
