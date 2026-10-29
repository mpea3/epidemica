import { describe, expect, test } from "bun:test";
import { align, comparable, dateAfter, daysBetween, firstCase, mergeDays } from "./compare";
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

	test("the date a number of days after another, across months and leap days", () => {
		expect(dateAfter("1861-10-30", 0)).toBe("1861-10-30");
		expect(dateAfter("1861-10-30", 26)).toBe("1861-11-25");
		expect(dateAfter("2020-02-28", 1)).toBe("2020-02-29");
		expect(dateAfter("2020-02-28", 2)).toBe("2020-03-01");
		expect(dateAfter("1900-02-28", 1)).toBe("1900-03-01");
		expect(daysBetween("1918-09-01", dateAfter("1918-09-01", 400))).toBe(400);
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

	test("align from a start after the first case drops the rows before it", () => {
		const o = outbreak("day", ["2020-01-01", "2020-01-02", "2020-01-03", "2020-01-04"], [1, 2, 4, 8]);
		expect(align(o, "cases", "2020-01-03")).toEqual({ start: "2020-01-03", days: [0, 1], values: [4, 8] });
	});

	test("align from a start before the first row counts from that start", () => {
		const o = outbreak("week", ["2014-09-07", "2014-09-14"], [70, 14]);
		expect(align(o, "cases", "2014-09-01")).toEqual({ start: "2014-09-01", days: [6, 13], values: [10, 2] });
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

	test("merge with one series keeps its days and values", () => {
		const [days, a, ...rest] = mergeDays({ days: [0, 7], values: [10, null] });
		expect(days).toEqual([0, 7]);
		expect(a[0]).toBe(10);
		expect(a[1]).toBeNull();
		expect(rest).toHaveLength(0);
	});

	test("merge with three series shares one day column", () => {
		const merged = mergeDays(
			{ days: [0, 1], values: [1, 2] },
			{ days: [1, 3], values: [5, null] },
			{ days: [2], values: [9] },
		);
		expect(merged).toHaveLength(4);
		const [days, a, b, c] = merged;
		expect(days).toEqual([0, 1, 2, 3]);
		expect([a[0], a[1], b[1], c[2]]).toEqual([1, 2, 5, 9]);
		expect(a[2]).toBeUndefined();
		expect(a[3]).toBeUndefined();
		expect(b[0]).toBeUndefined();
		expect(b[3]).toBeNull();
		expect(c[0]).toBeUndefined();
		expect(c[1]).toBeUndefined();
		expect(c[3]).toBeUndefined();
	});
});
