// Helpers for the import form that do not touch the page, so they can be
// tested. r/import.R does the real checking.

// A strptime format for date strings like the ones in the CSV, or ISO when
// nothing else fits. 03/04/2020 could be either day or month first; it is
// read day first (as in the Netherlands) unless some date only works month
// first, like 03/14/2020. The form shows the guess so it can be changed.
export function guessDateFormat(samples: string[]): string {
	const values = samples.map((s) => s.trim()).filter((s) => s !== "");
	if (values.length === 0) return "%Y-%m-%d";
	if (values.every((v) => /^\d{4}-\d{2}-\d{2}$/.test(v))) return "%Y-%m-%d";
	if (values.every((v) => /^\d{4}\/\d{2}\/\d{2}$/.test(v))) return "%Y/%m/%d";

	for (const separator of ["-", "/", "."]) {
		const parts = values.map((v) => v.split(separator));
		if (!parts.every((p) => p.length === 3 && p.every((x) => /^\d+$/.test(x)) && p[2]!.length === 4)) continue;
		const monthFirst = parts.some((p) => Number(p[1]) > 12);
		const s = separator;
		return monthFirst ? `%m${s}%d${s}%Y` : `%d${s}%m${s}%Y`;
	}
	return "%Y-%m-%d";
}

// "COVID-19, my town 2025" -> "covid_19_my_town_2025": the dataset id, which
// becomes the file name, so only a-z, 0-9 and _.
export function idFromName(name: string): string {
	return name
		.toLowerCase()
		// à -> a + accent; drop the accent.
		.normalize("NFKD")
		.replace(/[̀-ͯ]/g, "")
		.replace(/[^a-z0-9]+/g, "_")
		.replace(/^_+|_+$/g, "")
		.slice(0, 40);
}
