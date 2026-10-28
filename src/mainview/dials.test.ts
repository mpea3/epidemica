import { describe, expect, test } from "bun:test";
import { DEFAULT_PARAMS, PRESET_IDS, preset } from "../engine/presets";
import { DIALS, formatDial } from "./dials";

const dial = (key: string) => DIALS.find((d) => d.key === key)!;

describe("dials", () => {
	test("one dial per engine parameter", () => {
		const keys: string[] = DIALS.map((d) => d.key).sort();
		expect(keys).toEqual(Object.keys(DEFAULT_PARAMS).sort());
	});

	test("every preset's values fit on their slider", () => {
		for (const id of PRESET_IDS) {
			const { params } = preset(id);
			for (const d of DIALS) {
				const value = params[d.key];
				if (value === null) {
					expect(d.nullable).toBeDefined();
					continue;
				}
				expect(value).toBeGreaterThanOrEqual(d.min);
				expect(value).toBeLessThanOrEqual(d.max);
				// On a step: an input type=range would round anything else.
				const steps = (value - d.min) / d.step;
				expect(Math.abs(steps - Math.round(steps))).toBeLessThan(1e-6);
			}
		}
	});

	test("switched-on values for nullable dials fit too", () => {
		for (const d of DIALS) {
			if (!d.nullable) continue;
			expect(d.nullable.onValue).toBeGreaterThanOrEqual(d.min);
			expect(d.nullable.onValue).toBeLessThanOrEqual(d.max);
		}
	});
});

describe("formatDial", () => {
	test("numbers, days and day numbers", () => {
		expect(formatDial(dial("r0"), 2.5)).toBe("2.5");
		expect(formatDial(dial("r0"), 3)).toBe("3");
		expect(formatDial(dial("incubationDays"), 5)).toBe("5 days");
		expect(formatDial(dial("incubationDays"), 1)).toBe("1 day");
		expect(formatDial(dial("infectiousDays"), 7.5)).toBe("7.5 days");
		expect(formatDial(dial("lockdownDay"), 30)).toBe("day 30");
	});

	test("shares as percentages, with a decimal where the step needs one", () => {
		expect(formatDial(dial("masks"), 0.3)).toBe("30%");
		expect(formatDial(dial("masks"), 0.07)).toBe("7%");
		expect(formatDial(dial("fatality"), 0.001)).toBe("0.1%");
		expect(formatDial(dial("fatality"), 0.2)).toBe("20%");
	});

	test("null is off", () => {
		expect(formatDial(dial("immunityDays"), null)).toBe("off");
		expect(formatDial(dial("lockdownDay"), null)).toBe("off");
	});
});
