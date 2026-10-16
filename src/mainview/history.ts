// The History tab: pick a past outbreak from data/ and show it.
import type { Outbreak, OutbreakInfo } from "../shared/outbreak";
import { drawOutbreak, fitChartTo } from "./chart";

// How the tab gets its data. index.ts passes in the RPC requests; the tab
// itself does not know about the main process.
export interface HistorySource {
	list: () => Promise<OutbreakInfo[]>;
	load: (id: string) => Promise<Outbreak>;
	log: (text: string) => void;
}

const picker = document.querySelector<HTMLSelectElement>("#outbreak")!;
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

async function show(source: HistorySource, id: string): Promise<void> {
	summary.textContent = "loading...";
	sourceLine.textContent = "";
	try {
		const outbreak = await source.load(id);
		// The user may have picked another outbreak while this one loaded.
		if (picker.value !== id) return;
		summary.textContent = summarise(outbreak);
		drawOutbreak(chartBox, outbreak);
		sourceLine.textContent = describeSource(outbreak);
	} catch (err) {
		summary.textContent = `could not load ${id}: ${err}`;
		source.log(summary.textContent);
	}
}

// "Flu, my town 2025 (imported)": imported datasets are marked in the list,
// since they are not part of the app's own data.
function label(outbreak: OutbreakInfo): string {
	return outbreak.imported ? `${outbreak.name} (imported)` : outbreak.name;
}

// Fills the picker from data/ and the imports and shows one outbreak: the
// one with id select if given (a dataset just imported), else the first.
async function fill(source: HistorySource, select?: string): Promise<void> {
	try {
		const outbreaks = await source.list();
		picker.replaceChildren(...outbreaks.map((outbreak) => new Option(label(outbreak), outbreak.id)));
		picker.disabled = false;
		if (select && outbreaks.some((outbreak) => outbreak.id === select)) picker.value = select;
		source.log(`history: ${outbreaks.length} outbreaks`);
		if (outbreaks.length > 0) await show(source, picker.value);
	} catch (err) {
		picker.replaceChildren(new Option("no data"));
		summary.textContent = `could not list data/: ${err}`;
		source.log(summary.textContent);
	}
}

// Returns a function that reloads the list, for after an import.
export async function initHistory(source: HistorySource): Promise<(select?: string) => Promise<void>> {
	picker.addEventListener("change", () => show(source, picker.value));
	await fill(source);
	return (select) => fill(source, select);
}
