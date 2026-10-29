import { describe, expect, test } from "bun:test";
import { DEFAULT_PARAMS } from "../engine/presets";
import type { Params } from "../engine/types";
import type { Fit } from "../shared/fit";
import type { Outbreak } from "../shared/outbreak";
import {
	LOADED_KEYS,
	applyLoaded,
	deathsPerCase,
	depletionDay,
	describeLoad,
	describeOverlay,
	dialsFromFit,
	growthCheck,
	loadedFrom,
	restoreFrom,
} from "./fromhistory";

// The measles fit: R0 3.19 with a wide interval, the serial interval (10.4
// days) shorter than the incubation period (12.77).
function fit(changes: Partial<Fit> = {}): Fit {
	return {
		outbreak: "measles1861",
		disease: "Measles",
		r0: 3.193,
		r0Ci: [1.999, 5.071],
		window: ["1861-10-30", "1861-11-25"],
		windowAuto: false,
		growthRate: 0.1134,
		growthRateCi: [0.0672, 0.1595],
		growthIntercept: -1.2215,
		rt: [],
		incubationDays: 12.77,
		infectiousDays: 8,
		serialIntervalMean: 10.4,
		serialIntervalSd: 1.7,
		sources: { serialInterval: "parameters.R", incubation: "epiparameter", infectious: "parameters.R" },
		note: null,
		...changes,
	};
}

function outbreak(
	interval: Outbreak["interval"],
	dates: string[],
	cases: (number | null)[],
	deaths?: (number | null)[],
): Outbreak {
	return {
		id: "test",
		name: "Test outbreak",
		source: "",
		url: "",
		accessed: "",
		licence: "",
		interval,
		dates,
		columns: deaths ? { cases, deaths } : { cases },
	};
}

function params(changes: Partial<Params> = {}): Params {
	return { ...DEFAULT_PARAMS, ...changes };
}

describe("dialsFromFit", () => {
	test("snaps the values to their dials", () => {
		const { values, notes } = dialsFromFit(fit({ r0: 1.347 }));
		expect(values.r0).toBe(1.35);
		expect(values.incubationDays).toBe(12.8);
		expect(values.infectiousDays).toBe(8);
		expect(notes).toEqual([]);
	});

	test("asymptomatic infectiousness is 1", () => {
		expect(dialsFromFit(fit()).values.asymptomaticInfectiousness).toBe(1);
	});

	test("a period R has no value for is skipped with a note", () => {
		const { values, notes } = dialsFromFit(fit({ incubationDays: null }));
		expect("incubationDays" in values).toBe(false);
		expect(values.infectiousDays).toBe(8);
		expect(notes).toEqual(["incubation period not known; the dial is not changed."]);
	});

	test("a value outside its dial is clamped, with a note that says so", () => {
		const { values, notes } = dialsFromFit(fit({ r0: 25.3 }));
		expect(values.r0).toBe(20);
		expect(notes).toEqual(["the fitted R0 25.3 is above the dial's 20; set to 20."]);
		const low = dialsFromFit(fit({ infectiousDays: 0.5 }));
		expect(low.values.infectiousDays).toBe(1);
		expect(low.notes).toEqual(["the fitted infectious period 0.5 days is below the dial's 1 day; set to 1 day."]);
	});
});

describe("applyLoaded and restoreFrom", () => {
	test("applyLoaded touches only the loaded dials and leaves base alone", () => {
		const base = params({ masks: 0.3, fatality: 0.02, lockdownDay: 12, immunityDays: 90 });
		const copy = { ...base };
		const next = applyLoaded(base, dialsFromFit(fit()).values);
		expect(base).toEqual(copy);
		expect(next).not.toBe(base);
		expect(next.r0).toBe(3.19);
		expect(next.incubationDays).toBe(12.8);
		expect(next.infectiousDays).toBe(8);
		expect(next.asymptomaticInfectiousness).toBe(1);
		for (const key of Object.keys(base) as (keyof Params)[]) {
			if (!(LOADED_KEYS as readonly string[]).includes(key)) expect(next[key]).toBe(base[key]);
		}
	});

	test("applyLoaded keeps the dial of a value that was not loaded", () => {
		const next = applyLoaded(params(), dialsFromFit(fit({ incubationDays: null })).values);
		expect(next.incubationDays).toBe(DEFAULT_PARAMS.incubationDays);
	});

	test("restoreFrom brings back the loaded dials from the preset only", () => {
		const loaded = applyLoaded(params({ masks: 0.4, fatality: 0.05 }), dialsFromFit(fit()).values);
		const preset = params({ r0: 1.8, incubationDays: 2, infectiousDays: 5, asymptomaticInfectiousness: 0.6, masks: 0.1 });
		const next = restoreFrom(loaded, preset);
		expect(next.r0).toBe(1.8);
		expect(next.incubationDays).toBe(2);
		expect(next.infectiousDays).toBe(5);
		expect(next.asymptomaticInfectiousness).toBe(0.6);
		expect(next.masks).toBe(0.4);
		expect(next.fatality).toBe(0.05);
		expect(loaded.r0).toBe(3.19);
	});
});

describe("deathsPerCase", () => {
	test("deaths over cases", () => {
		const o = outbreak("day", ["2020-01-01", "2020-01-02"], [100, 88], [4, 8]);
		expect(deathsPerCase(o)).toEqual({ deaths: 12, cases: 188, share: 12 / 188 });
	});

	test("only rows with both counts", () => {
		const o = outbreak("day", ["2020-01-01", "2020-01-02", "2020-01-03"], [100, 50, 38], [null, 4, 8]);
		expect(deathsPerCase(o)).toEqual({ deaths: 12, cases: 88, share: 12 / 88 });
	});

	test("null when deaths were not reported, or no case was counted", () => {
		expect(deathsPerCase(outbreak("day", ["2020-01-01", "2020-01-02"], [5, 9]))).toBeNull();
		expect(deathsPerCase(outbreak("day", ["2020-01-01", "2020-01-02"], [5, 9], [null, null]))).toBeNull();
		expect(deathsPerCase(outbreak("day", ["2020-01-01"], [0], [0]))).toBeNull();
	});

	test("deaths counted as 0 are reported, as a share of 0", () => {
		const o = outbreak("day", ["2020-01-01", "2020-01-02"], [5, 9], [0, 0]);
		expect(deathsPerCase(o)).toEqual({ deaths: 0, cases: 14, share: 0 });
	});
});

describe("loadedFrom", () => {
	const dates = ["2020-01-01", "2020-01-02", "2020-01-03", "2020-01-04", "2020-01-05"];

	test("day 0 is the start of the growth window and earlier rows are dropped", () => {
		const o = outbreak("day", dates, [1, 2, 4, 8, 16]);
		const loaded = loadedFrom(o, fit({ window: ["2020-01-03", "2020-01-05"] }));
		expect(loaded.reported).toEqual({ start: "2020-01-03", days: [0, 1, 2], values: [4, 8, 16] });
		expect(loaded.windowDays).toBe(2);
		expect(loaded.id).toBe("test");
		expect(loaded.name).toBe("Test outbreak");
		expect(loaded.interval).toBe("day");
		expect(loaded.values.r0).toBe(3.19);
		expect(loaded.notes).toEqual([]);
	});

	test("weekly counts are divided by 7", () => {
		const o = outbreak("week", ["2020-01-05", "2020-01-12"], [70, 140]);
		const loaded = loadedFrom(o, fit({ window: ["2020-01-01", "2020-02-01"] }));
		expect(loaded.reported.values).toEqual([10, 20]);
		expect(loaded.reported.days).toEqual([4, 11]);
		expect(loaded.interval).toBe("week");
	});

	test("a series that opens at 50 or more per day starts mid-outbreak", () => {
		const low = loadedFrom(outbreak("day", dates, [3, 5, 9, 12, 20]), fit({ window: ["2020-01-01", "2020-01-05"] }));
		const high = loadedFrom(outbreak("day", dates, [50, 60, 90, 120, 200]), fit({ window: ["2020-01-01", "2020-01-05"] }));
		expect(low.midOutbreak).toBe(false);
		expect(high.midOutbreak).toBe(true);
	});

	test("keeps the reported deaths per case for display", () => {
		const o = outbreak("day", dates, [10, 10, 10, 10, 10], [0, 1, 0, 1, 0]);
		expect(loadedFrom(o, fit()).deathsPerCase).toEqual({ deaths: 2, cases: 50, share: 2 / 50 });
	});

	test("yearly data cannot be loaded", () => {
		expect(() => loadedFrom(outbreak("year", ["1980-01-01"], [5]), fit())).toThrow();
	});
});

describe("depletionDay", () => {
	test("the first day the infections so far reach 10% of the agents", () => {
		const days = [0, 1, 2, 3, 4];
		expect(depletionDay(days, [5, 10, 20, 40, 80], 1000)).toBe(4); // 5, 15, 35, 75, 155 against 100
		expect(depletionDay(days, [5, 10, 20, 40, 80], 1000, 0.05)).toBe(3);
		expect(depletionDay(days, [100, 0, 0, 0, 0], 1000)).toBe(0);
		expect(depletionDay(days, [5, 10, 20, 40, 80], 1000, 0.5)).toBeNull();
		expect(depletionDay([], [], 1000)).toBeNull();
	});
});

// The measles loaded into the default city, the dials the app would show.
function loadedParams(changes: Partial<Params> = {}): Params {
	return { ...applyLoaded(DEFAULT_PARAMS, dialsFromFit(fit()).values), ...changes };
}

describe("describeLoad", () => {
	test("says what was filled, what it assumed and what it left alone", () => {
		const o = outbreak("day", ["2020-01-01", "2020-01-02"], [100, 88], [4, 8]);
		const loaded = loadedFrom(o, fit());
		const text = describeLoad(loaded, loadedParams());
		const [first, second] = text.split("\n");
		expect(first).toBe(
			"loaded Test outbreak, fitted by R: R0 3.19 (95% confidence interval 2.00 to 5.07), incubation period 12.8 days, infectious period 8 days. " +
				"asymptomatic infectiousness set to 100%, so the model's average R0 is the fitted one (the data cannot tell cases with and without symptoms apart).",
		);
		expect(second).toBe(
			"the setting, fatality and interventions are yours. reported deaths per reported case were 6.4% (12 of 188), " +
				"but the fatality dial is the share of all infections that die, and reported cases miss the mild ones, so it stays at 1%.",
		);
	});

	test("deaths that were not reported", () => {
		const loaded = loadedFrom(outbreak("day", ["2020-01-01"], [5]), fit());
		expect(describeLoad(loaded, loadedParams()).split("\n")[1]).toBe(
			"the setting, fatality and interventions are yours. deaths were not reported, so fatality stays at 1%.",
		);
	});

	test("deaths that were reported as none", () => {
		const loaded = loadedFrom(outbreak("day", ["2020-01-01", "2020-01-02"], [1500, 1700], [0, 0]), fit());
		expect(describeLoad(loaded, loadedParams()).split("\n")[1]).toBe(
			"the setting, fatality and interventions are yours. no deaths were reported among the 3,200 cases, so fatality stays at 1%.",
		);
	});

	test("a period R does not know says where the dial stays", () => {
		const loaded = loadedFrom(outbreak("day", ["2020-01-01"], [5]), fit({ incubationDays: null }));
		const text = describeLoad(loaded, applyLoaded(DEFAULT_PARAMS, loaded.values));
		expect(text).not.toContain("incubation period 5");
		expect(text).toContain("incubation period not known; the dial stays at 5 days.");
		expect(text.match(/not known/g)).toHaveLength(1);
	});

	test("a clamped value says so", () => {
		const loaded = loadedFrom(outbreak("day", ["2020-01-01"], [5]), fit({ r0: 25.3, r0Ci: [null, null] }));
		const text = describeLoad(loaded, applyLoaded(DEFAULT_PARAMS, loaded.values));
		expect(text).toContain("the fitted R0 25.3 is above the dial's 20; set to 20.");
		expect(text).toContain("(no confidence interval)");
	});

	test("small shares keep two decimals", () => {
		const o = outbreak("day", ["2020-01-01"], [1000000], [2700]);
		expect(describeLoad(loadedFrom(o, fit()), loadedParams())).toContain("were 0.27% (2,700 of 1,000,000)");
	});
});

describe("growthCheck", () => {
	// Measles with the dials the load sets: nothing cuts R.
	const measles = () => loadedParams({ shareAsymptomatic: 0 });

	test("compares the reported doubling with the model's", () => {
		const text = growthCheck(fit(), measles());
		expect(text).toContain("growth: reported cases doubled every 6.1 days (4.3 to 10.3) in the growth window.");
		expect(text).toContain("the model starts at R 3.19 and one generation takes 17.1 days on average");
		expect(text).toContain("(incubation + 13/24 of the infectious period), against the 10.4-day serial interval R0 was fitted with");
		expect(text).toMatch(/so even fully mixed it would double about every 9\.\d days\. agents walking in a world are slower still\./);
		expect(text).not.toContain("cut by");
	});

	test("names the spread before symptoms when the serial interval is shorter than the incubation period", () => {
		expect(growthCheck(fit(), measles())).toContain("the serial interval is shorter than the incubation period");
		// COVID-19's real numbers: 4.7 against 5.6 days.
		const covid = fit({ serialIntervalMean: 4.7, incubationDays: 5.6 });
		const covidParams = loadedParams({ shareAsymptomatic: 0, incubationDays: 5.6, infectiousDays: 7 });
		expect(growthCheck(covid, covidParams)).toContain("the serial interval is shorter than the incubation period");
		const longer = fit({ serialIntervalMean: 14.2 });
		expect(growthCheck(longer, measles())).not.toContain("shorter than the incubation period");
	});

	test("a gap of a few hours is not taken as spread before symptoms", () => {
		// Mpox: 5.6 against 5.7 days. What slows it in the model is its 21-day
		// infectious period, which the check names instead.
		const mpox = fit({ serialIntervalMean: 5.6, incubationDays: 5.73 });
		const text = growthCheck(mpox, loadedParams({ incubationDays: 5.7, infectiousDays: 21 }));
		expect(text).not.toContain("shorter than the incubation period");
		expect(text).toContain("the infectious period alone adds 11.4 days to a generation, more than the whole serial interval");
		expect(growthCheck(fit(), measles())).not.toContain("the infectious period alone");
	});

	test("says which cuts take R below R0", () => {
		const text = growthCheck(fit(), loadedParams({ shareAsymptomatic: 0.3, asymptomaticInfectiousness: 0.5, masks: 0.1 }));
		// 3.19 x 0.9 x 0.85
		expect(text).toContain("R 2.44 is R0 3.19 cut by masks and cases without symptoms.");
		const lockdown = growthCheck(fit(), loadedParams({ shareAsymptomatic: 0, lockdownDay: 0, vaccinationCoverage: 0.5 }));
		expect(lockdown).toContain("cut by vaccination and lockdown.");
	});

	test("warns that runs die out when R is just above 1", () => {
		const text = growthCheck(fit({ r0: 1.1 }), loadedParams({ r0: 1.1, shareAsymptomatic: 0 }));
		expect(text).toContain("with R this close to 1 many runs die out by chance in the first days; try another seed.");
		expect(growthCheck(fit(), measles())).not.toContain("die out");
	});

	test("says the model shrinks below 1, instead of giving a doubling time", () => {
		const text = growthCheck(fit(), loadedParams({ shareAsymptomatic: 0, r0: 0.9 }));
		expect(text).toContain("with these dials R is 0.90, below 1, so the model shrinks.");
		expect(text).not.toContain("would double");
		expect(text).not.toContain("die out");
	});

	test("exactly 1 does not grow either", () => {
		const text = growthCheck(fit(), loadedParams({ shareAsymptomatic: 0, r0: 1 }));
		expect(text).toContain("it would not grow.");
		expect(text).toContain("die out");
	});

	test("leaves testing out and says so", () => {
		expect(growthCheck(fit(), loadedParams({ testing: 0.5 }))).toContain(
			"testing and isolation are left out of this figure, so the model is slower still.",
		);
		expect(growthCheck(fit(), measles())).not.toContain("testing");
	});

	test("reported cases that were not growing", () => {
		const text = growthCheck(fit({ growthRate: -0.02, growthRateCi: [-0.04, 0] }), measles());
		expect(text.startsWith("growth: reported cases were not growing in the growth window.")).toBe(true);
		expect(text).not.toContain("doubled");
	});

	test("an interval with no growth in it", () => {
		const text = growthCheck(fit({ growthRateCi: [-0.01, 0.2] }), measles());
		expect(text).toContain("doubled every 6.1 days in the growth window (the interval includes no growth).");
	});
});

describe("describeOverlay", () => {
	const loaded = loadedFrom(outbreak("day", ["2020-01-01", "2020-01-02"], [5, 9]), fit({ window: ["2020-01-01", "2020-01-02"] }));

	test("says what is drawn, and that it is not a prediction", () => {
		const text = describeOverlay(loaded, { agents: 5000 });
		expect(text).toContain("grey: cases reported in Test outbreak, per day, with day 0 on 2020-01-01");
		expect(text).toContain("the simulation has 5,000 people");
		expect(text).toContain("a simulation is not a prediction.");
		expect(text).not.toContain("weekly");
		expect(text).not.toContain("mid-outbreak");
	});

	test("weekly data and a series that starts high", () => {
		const weekly = { ...loaded, interval: "week" as const, midOutbreak: true };
		const text = describeOverlay(weekly, { agents: 500 });
		expect(text).toContain("the simulation has 500 people");
		expect(text).toContain(" weekly counts are shown per day.");
		expect(text).toContain(" the data starts mid-outbreak, so the grey line starts high.");
	});
});
