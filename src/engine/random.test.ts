import { describe, expect, test } from "bun:test";
import { Random } from "./random";

describe("random", () => {
	test("same seed gives the same numbers", () => {
		const a = new Random(42);
		const b = new Random(42);
		for (let i = 0; i < 1000; i++) expect(a.next()).toBe(b.next());
	});

	test("different seeds give different numbers", () => {
		expect(new Random(1).next()).not.toBe(new Random(2).next());
	});

	test("numbers are in [0, 1) and average about 0.5", () => {
		const r = new Random(7);
		let sum = 0;
		const n = 100_000;
		for (let i = 0; i < n; i++) {
			const v = r.next();
			expect(v >= 0 && v < 1).toBe(true);
			sum += v;
		}
		expect(sum / n).toBeCloseTo(0.5, 2);
	});
});
