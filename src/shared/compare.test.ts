import { describe, expect, test } from "bun:test";
import { align, comparable, daysBetween, firstCase, mergeDays } from "./compare";
import type { Outbreak } from "./outbreak";

function outbreak(interval: Outbreak["interval"], dates: string[], cases: (number | null)[]): Outbreak {
	return {
		id: "test",
		name: "test",
		source: "",
		url: "",
		accessed: "",
		licence: "",
		interval,
		dates,
		columns: { cases, deaths: cases.map(() => null) },
	};
}

describe("compare", () => {
	test("days between calendar dates, across centuries and leap days", () => {
		expect(daysBetween("1861-10-30", "1861-11-01")).toBe(2);
		expect(daysBetween("2020-02-28", "2020-03-01")).toBe(2);
		expect(daysBetween("1918-09-01", "1918-09-01")).toBe(0);
	});

	test("day 0 is the first row with cases", () => {
		const o = outbreak("day", ["2020-01-01", "2020-01-02", "2020-01-03"], [null, 0, 4]);
		expect(firstCase(o)).toBe("2020-01-03");
		expect(firstCase(outbreak("day", ["2020-01-01"], [0]))).toBe("2020-01-01");
	});

	test("align drops the rows before day 0 and keeps zero and missing apart", () => {
		const o = outbreak("day", ["2020-01-01", "2020-01-02", "2020-01-03", "2020-01-04"], [0, 3, 0, null]);
		o.columns["deaths"] = [0, 0, 0, 1];
		expect(align(o, "cases")).toEqual({ start: "2020-01-02", days: [0, 1, 2], values: [3, 0, null] });
	});

	test("rows after the last case or death count are dropped", () => {
		const o = outbreak("day", ["2020-01-01", "2020-01-02", "2020-01-03"], [1, 2, null]);
		expect(align(o, "cases").days).toEqual([0, 1]);
	});

	test("weekly counts become per day", () => {
		const o = outbreak("week", ["2014-09-07", "2014-09-14"], [70, 14]);
		expect(align(o, "cases")).toEqual({ start: "2014-09-07", days: [0, 7], values: [10, 2] });
	});

	test("a missing column is all null", () => {
		const o = outbreak("day", ["2020-01-01", "2020-01-02"], [1, 2]);
		expect(align(o, "wastewater").values).toEqual([null, null]);
	});

	test("yearly outbreaks are not comparable", () => {
		expect(comparable({ interval: "year" })).toBe(false);
		expect(comparable({ interval: "week" })).toBe(true);
		expect(() => align(outbreak("year", ["1980-01-01"], [1]), "cases")).toThrow();
	});

	test("merge shares one day column: undefined where a series has no row", () => {
		const daily = { start: "", days: [0, 1, 2], values: [1, null, 3] };
		const weekly = { start: "", days: [0, 7], values: [10, 20] };
		const [days, a, b] = mergeDays(daily, weekly);
		expect(days).toEqual([0, 1, 2, 7]);
		// toEqual treats undefined and null alike; check each one exactly.
		expect(a[1]).toBeNull();
		expect(a[3]).toBeUndefined();
		expect(b[1]).toBeUndefined();
		expect(b[2]).toBeUndefined();
		expect([a[0], a[2], b[0], b[3]]).toEqual([1, 3, 10, 20]);
	});
});
