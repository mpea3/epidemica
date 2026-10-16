// A past outbreak as the R pipeline writes it to data/<id>.json (see
// r/common.R), and the column form the charts use.

// Everything about the dataset except the numbers.
export interface OutbreakInfo {
	id: string;
	name: string;
	source: string;
	url: string;
	accessed: string;
	licence: string;
	interval: "day" | "week" | "year"; // what one row counts
	notes?: string;
}

// One row per date, as in the file: { date, cases, deaths, ... }.
export type Row = { date: string } & Record<string, string | number | null>;

export interface OutbreakFile extends OutbreakInfo {
	series: Row[];
}

// The same numbers turned into columns: every column has one value per
// date, so dates[i], columns.cases[i] and columns.deaths[i] belong together.
// null means the source has no number for that date.
export interface Outbreak extends OutbreakInfo {
	dates: string[];
	columns: Record<string, (number | null)[]>;
}

// Rows to columns. The column names come from the first row; a row that
// lacks one gets null there, so the columns always stay the same length as
// dates.
export function toColumns(file: OutbreakFile): Outbreak {
	const { series, ...info } = file;
	const names = Object.keys(series[0] ?? {}).filter((name) => name !== "date");
	const columns: Outbreak["columns"] = {};
	for (const name of names) {
		columns[name] = series.map((row) => {
			const value = row[name];
			return typeof value === "number" ? value : null;
		});
	}
	return { ...info, dates: series.map((row) => row.date), columns };
}
