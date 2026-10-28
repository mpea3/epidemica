// Putting two outbreaks on the same axes. Their dates can be centuries
// apart (measles 1861, COVID-19 2020), so the chart counts days since each
// outbreak's first reported case instead. Weekly counts are divided by 7, so
// both lines are per day. Yearly counts are too coarse to set against daily
// ones and are left out of comparisons.
import type { Outbreak } from "./outbreak";

const DAY_MS = 24 * 60 * 60 * 1000;
const PER_DAY = { day: 1, week: 7 } as const;

// One column of one outbreak, by day since its first case.
export interface Aligned {
	start: string; // date of the first case: day 0
	days: number[];
	values: (number | null)[];
}

export function comparable(outbreak: Pick<Outbreak, "interval">): boolean {
	return outbreak.interval !== "year";
}

// Whole days from start to date. The dates are calendar days, read as UTC.
export function daysBetween(start: string, date: string): number {
	return Math.round((Date.parse(date) - Date.parse(start)) / DAY_MS);
}

// Day 0 is the first row with more than zero cases: some series open with
// rows of nothing before the outbreak arrives. With no cases at all, the
// first row.
export function firstCase(outbreak: Outbreak): string {
	const cases = outbreak.columns["cases"] ?? [];
	const i = cases.findIndex((value) => value !== null && value > 0);
	return outbreak.dates[Math.max(0, i)];
}

// Index of the last row with a case or death count. covid_nl's dates run
// on for years of wastewater after the counts stop.
function lastCounted(outbreak: Outbreak): number {
	const cases = outbreak.columns["cases"] ?? [];
	const deaths = outbreak.columns["deaths"] ?? [];
	let last = outbreak.dates.length - 1;
	while (last > 0 && cases[last] == null && deaths[last] == null) last--;
	return last;
}

// Rows before day 0 and after the last count are dropped, the same for
// every column so the panels end together.
export function align(outbreak: Outbreak, column: string): Aligned {
	if (!comparable(outbreak)) throw new Error(`${outbreak.id} counts per year and cannot be compared`);
	const start = firstCase(outbreak);
	const last = lastCounted(outbreak);
	const divide = PER_DAY[outbreak.interval as keyof typeof PER_DAY];
	const source = outbreak.columns[column] ?? [];
	const days: number[] = [];
	const values: (number | null)[] = [];
	outbreak.dates.forEach((date, i) => {
		const day = daysBetween(start, date);
		if (day < 0 || i > last) return;
		const value = source[i] ?? null;
		days.push(day);
		values.push(value === null ? null : value / divide);
	});
	return { start, days, values };
}

// A series on the shared day column: undefined where the outbreak has no
// row that day, null where it has a row but no number.
export type Merged = (number | null | undefined)[];

// uPlot wants one x column shared by every series: the days of both, in
// order. A day only one outbreak has a row for (a weekly series between
// its weeks, the shorter outbreak after it ended) is undefined for the
// other. uPlot draws a line across undefined but leaves a gap at null, so
// a weekly series stays one line and a missing number stays missing.
export function mergeDays(a: Aligned, b: Aligned): [number[], Merged, Merged] {
	const days = [...new Set([...a.days, ...b.days])].sort((x, y) => x - y);
	const lookup = (s: Aligned): Merged => {
		const byDay = new Map(s.days.map((day, i) => [day, s.values[i]]));
		return days.map((day) => byDay.get(day));
	};
	return [days, lookup(a), lookup(b)];
}
