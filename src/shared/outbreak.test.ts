import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { type OutbreakFile, toColumns } from "./outbreak";

describe("toColumns", () => {
	test("keeps every value next to its date", () => {
		const outbreak = toColumns({
			id: "test",
			name: "Test",
			source: "",
			url: "",
			accessed: "",
			licence: "",
			interval: "day",
			series: [
				{ date: "2020-01-01", cases: 1, deaths: null },
				{ date: "2020-01-02", cases: 4, deaths: 2 },
			],
		});
		expect(outbreak.dates).toEqual(["2020-01-01", "2020-01-02"]);
		expect(outbreak.columns).toEqual({ cases: [1, 4], deaths: [null, 2] });
		expect("series" in outbreak).toBe(false);
	});

	test("a column missing from a row becomes null", () => {
		const outbreak = toColumns({
			id: "test",
			name: "Test",
			source: "",
			url: "",
			accessed: "",
			licence: "",
			interval: "day",
			series: [
				{ date: "2020-01-01", cases: 1, deaths: 0 },
				{ date: "2020-01-02", cases: 4 },
			],
		});
		expect(outbreak.columns["deaths"]).toEqual([0, null]);
	});

	test("every dataset in data/ converts with columns as long as its dates", () => {
		for (const id of ["covid_nl", "ebola_sl2014", "ebola_westafrica", "flu1918", "measles1861", "measles_world", "mpox"]) {
			const file: OutbreakFile = JSON.parse(readFileSync(`data/${id}.json`, "utf8"));
			const outbreak = toColumns(file);
			expect(outbreak.dates.length).toBeGreaterThan(0);
			expect(outbreak.columns["cases"]).toBeDefined();
			for (const column of Object.values(outbreak.columns)) {
				expect(column.length).toBe(outbreak.dates.length);
			}
		}
	});
});
