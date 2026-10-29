import { describe, expect, test } from "bun:test";
import { DEFAULT_PARAMS, PRESET_IDS, preset } from "../engine/presets";
import { DIALS, type Dial, dialFor, formatDial, snapToDial } from "./dials";

// On a step: an input type=range would round anything else.
function expectOnStep(d: Dial, value: number) {
	const steps = (value - d.min) / d.step;
	expect(Math.abs(steps - Math.round(steps))).toBeLessThan(1e-6);
}

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
				expectOnStep(d, value);
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

describe("dialFor", () => {
	test("finds the dial for a parameter", () => {
		expect(dialFor("r0").label).toBe("R0");
		expect(dialFor("infectiousDays").step).toBe(0.1);
	});
});

describe("snapToDial", () => {
	test("rounds to the step without float noise", () => {
		expect(snapToDial(dialFor("r0"), 1.347)).toEqual({ value: 1.35, clamped: false });
		expect(snapToDial(dialFor("incubationDays"), 12.77)).toEqual({ value: 12.8, clamped: false });
		expect(snapToDial(dialFor("incubationDays"), 0.3)).toEqual({ value: 0.3, clamped: false });
		expect(snapToDial(dialFor("masks"), 0.57)).toEqual({ value: 0.57, clamped: false });
	});

	test("clamps to the range and says so", () => {
		expect(snapToDial(dialFor("r0"), 25.3)).toEqual({ value: 20, clamped: true });
		expect(snapToDial(dialFor("r0"), 0.2)).toEqual({ value: 0.5, clamped: true });
		expect(snapToDial(dialFor("infectiousDays"), 40)).toEqual({ value: 40, clamped: false });
	});

	// What fit.R gave for the bundled outbreaks: R0, then the published
	// incubation and infectious periods.
	test("the measured fits land on step and in range", () => {
		const fits = {
			r0: [1.347, 3.193, 1.358, 1.189, 1.281, 2.544],
			incubationDays: [1.46, 12.77, 10.3, 10.3, 5.73, 5.6],
			infectiousDays: [4, 8, 5.6, 5.6, 21, 7],
		} as const;
		for (const [key, values] of Object.entries(fits)) {
			const d = dialFor(key as keyof typeof fits);
			for (const raw of values) {
				const { value, clamped } = snapToDial(d, raw);
				expect(clamped).toBe(false);
				expect(value).toBeGreaterThanOrEqual(d.min);
				expect(value).toBeLessThanOrEqual(d.max);
				expectOnStep(d, value);
				expect(Math.abs(value - raw)).toBeLessThanOrEqual(d.step / 2 + 1e-9);
				// No float noise: the number prints as the slider shows it.
				expect(String(value)).toBe(formatDial(d, value).replace(/ days?$/, ""));
			}
		}
	});
});

describe("formatDial", () => {
	test("numbers, days and day numbers", () => {
		expect(formatDial(dialFor("r0"), 2.5)).toBe("2.5");
		expect(formatDial(dialFor("r0"), 3)).toBe("3");
		expect(formatDial(dialFor("r0"), 1.35)).toBe("1.35");
		expect(formatDial(dialFor("incubationDays"), 5)).toBe("5 days");
		expect(formatDial(dialFor("incubationDays"), 1)).toBe("1 day");
		expect(formatDial(dialFor("infectiousDays"), 7.5)).toBe("7.5 days");
		expect(formatDial(dialFor("incubationDays"), 12.8)).toBe("12.8 days");
		expect(formatDial(dialFor("incubationDays"), 1.04)).toBe("1 day");
		expect(formatDial(dialFor("lockdownDay"), 30)).toBe("day 30");
	});

	test("shares as percentages, with a decimal where the step needs one", () => {
		expect(formatDial(dialFor("masks"), 0.3)).toBe("30%");
		expect(formatDial(dialFor("masks"), 0.07)).toBe("7%");
		expect(formatDial(dialFor("fatality"), 0.001)).toBe("0.1%");
		expect(formatDial(dialFor("fatality"), 0.2)).toBe("20%");
	});

	test("null is off", () => {
		expect(formatDial(dialFor("immunityDays"), null)).toBe("off");
		expect(formatDial(dialFor("lockdownDay"), null)).toBe("off");
	});
});
