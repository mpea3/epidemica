import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
	type Fit,
	describeFit,
	describeFitSources,
	doublingDays,
	doublingRange,
	explainRError,
	fitFromRun,
	growthCurve,
	growthLine,
	parseFit,
	rtByDay,
	rtColumns,
	rtTop,
} from "./fit";

// fit.R's output for flu1918 (run 2026-10-29) with R(t) cut to three rows.
function flu1918(): Record<string, unknown> {
	return {
		ok: true,
		outbreak: "flu1918",
		disease: "Influenza",
		r0: 1.347,
		r0_ci: [1.279, 1.418],
		r0_window: ["1918-09-01", "1918-10-10"],
		r0_window_auto: false,
		growth_rate: 0.1258,
		growth_rate_ci: [0.1027, 0.149],
		growth_intercept: 1.0895,
		rt: [
			{ date: "1918-09-08", mean: 1.39, lo: 1.006, hi: 1.835 },
			{ date: "1918-09-09", mean: 1.225, lo: 0.89, hi: 1.612 },
			{ date: "1918-09-10", mean: 1.352, lo: 1.013, hi: 1.74 },
		],
		params: { incubationDays: 1.46, infectiousDays: 4, serialIntervalMean: 2.51, serialIntervalSd: 1.55 },
		sources: {
			serialInterval: "Ghani et al. 2009, doi:10.1371/currents.RRN1130 (epiparameter, Influenza-A-H1N1Pdm)",
			incubation: "Lessler et al. 2009, doi:10.1056/NEJMoa0906089 (epiparameter, Influenza-A-H1N1)",
			infectious: "Carrat et al. 2008",
		},
		note: "part of Baltimore was already immune after the spring 1918 wave, so this is below the R0 of a population with no immunity (Fraser et al. 2011 estimate 1.77).",
	};
}

function fit(changes: Partial<Fit> = {}): Fit {
	const result = parseFit(flu1918());
	if (!result.ok) throw new Error(result.error);
	return { ...result.fit, ...changes };
}

function withParams(params: Record<string, unknown>): Record<string, unknown> {
	const data = flu1918();
	data["params"] = { ...(data["params"] as object), ...params };
	return data;
}

describe("parseFit", () => {
	test("takes a whole real fit.R output", () => {
		// Rscript r/fit.R --outbreak measles1861, saved as it printed it.
		const result = parseFit(JSON.parse(readFileSync("src/shared/testdata/fit-measles1861.json", "utf8")));
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.fit.r0).toBe(3.193);
		expect(result.fit.rt).toHaveLength(25);
		expect(result.fit.window).toEqual(["1861-10-30", "1861-11-30"]);
		expect(result.fit.sources.serialInterval).toContain("Hagelloch");
		expect(describeFit(result.fit, "day")[0]).toContain("R0 3.19 (95% confidence interval 2.00 to 5.07)");
	});

	test("reads fit.R's output into a flat Fit", () => {
		const result = parseFit(flu1918());
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.fit.r0).toBe(1.347);
		expect(result.fit.r0Ci).toEqual([1.279, 1.418]);
		expect(result.fit.window).toEqual(["1918-09-01", "1918-10-10"]);
		expect(result.fit.windowAuto).toBe(false);
		expect(result.fit.growthRateCi).toEqual([0.1027, 0.149]);
		expect(result.fit.growthIntercept).toBe(1.0895);
		expect(result.fit.rt).toHaveLength(3);
		expect(result.fit.incubationDays).toBe(1.46);
		expect(result.fit.serialIntervalSd).toBe(1.55);
		expect(result.fit.sources.infectious).toBe("Carrat et al. 2008");
		expect(result.fit.note).toContain("Baltimore");
	});

	test("{}, null and \"NA\" all mean not known", () => {
		for (const missing of [{}, null, "NA", "NaN"]) {
			const result = parseFit(withParams({ incubationDays: missing }));
			expect(result.ok).toBe(true);
			if (result.ok) expect(result.fit.incubationDays).toBeNull();
		}
		const data = flu1918();
		data["sources"] = { ...(data["sources"] as object), incubation: {} };
		data["note"] = null;
		const result = parseFit(data);
		expect(result.ok && result.fit.sources.incubation).toBeNull();
		expect(result.ok && result.fit.note).toBeNull();
	});

	test("a NaN R0 or an R(t) row that is not a number is refused", () => {
		const data = flu1918();
		data["r0"] = "NaN";
		expect(parseFit(data)).toEqual({ ok: false, error: "R did not return a fit: r0 is not a number" });
		const rows = flu1918();
		rows["rt"] = [{ date: "1918-09-08", mean: "1.39", lo: 1, hi: 2 }];
		const result = parseFit(rows);
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error).toBe("R did not return a fit: the mean of R(t) row 1 is not a number");
	});

	test("the new fields are required", () => {
		const data = flu1918();
		delete data["growth_intercept"];
		expect(parseFit(data)).toEqual({ ok: false, error: "R did not return a fit: growth_intercept is not a number" });
		const old = flu1918();
		delete old["growth_rate_ci"];
		expect(parseFit(old).ok).toBe(false);
	});

	test("a null R0 bound is kept", () => {
		const data = flu1918();
		data["r0_ci"] = [null, 1.418];
		const result = parseFit(data);
		expect(result.ok && result.fit.r0Ci).toEqual([null, 1.418]);
	});

	test("R's own refusal passes through", () => {
		expect(parseFit({ ok: false, outbreak: "x", error: "no serial interval" })).toEqual({
			ok: false,
			error: "no serial interval",
		});
		expect(parseFit("not json")).toEqual({ ok: false, error: "R did not return a fit: the reply is not an object" });
	});
});

describe("fitFromRun", () => {
	test("says whose error it was", () => {
		expect(fitFromRun({ ok: false, error: "spawn Rscript ENOENT" }, "Flu")).toEqual({
			ok: false,
			error: explainRError("ENOENT"),
		});
		expect(fitFromRun({ ok: true, data: { ok: false, error: "no serial interval for Foo" } }, "My import")).toEqual({
			ok: false,
			error: "R could not fit My import: no serial interval for Foo",
		});
		expect(fitFromRun({ ok: true, data: { ok: true } }, "Flu")).toEqual({
			ok: false,
			error: "R did not return a fit: params is not an object",
		});
		expect(fitFromRun({ ok: true, data: flu1918() }, "Flu").ok).toBe(true);
	});
});

describe("explainRError", () => {
	test("the errors people can fix", () => {
		expect(explainRError("Error: spawn Rscript ENOENT")).toStartWith("Rscript was not found: install R 4.5");
		expect(explainRError("Executable not found in $PATH: \"Rscript\"")).toStartWith("Rscript was not found");
		expect(explainRError("Error in library(EpiEstim) : there is no package called ‘EpiEstim’")).toBe(
			"R is missing the package EpiEstim: run Rscript r/install.R",
		);
		expect(explainRError("timeout: R took longer than 2 minutes and was stopped")).toBe(
			"R took longer than 2 minutes and was stopped",
		);
		expect(explainRError("something else")).toBe("something else");
	});
});

describe("growth", () => {
	test("doubling time is ln 2 over the growth rate", () => {
		expect(doublingDays(0.1258)).toBeCloseTo(5.51, 2);
		expect(doublingDays(0)).toBeNull();
		expect(doublingDays(-0.1)).toBeNull();
	});

	test("the doubling range flips the interval, and has none without growth", () => {
		const range = doublingRange([0.1027, 0.149])!;
		expect(range[0]).toBeCloseTo(Math.LN2 / 0.149, 9);
		expect(range[1]).toBeCloseTo(Math.LN2 / 0.1027, 9);
		expect(doublingRange([0, 0.1])).toBeNull();
		expect(doublingRange([-0.02, 0.1])).toBeNull();
	});

	test("the daily growth curve is the fitted line inside the window only", () => {
		const f = fit({ window: ["2020-01-02", "2020-01-04"], growthIntercept: 1, growthRate: 0.5 });
		const curve = growthCurve(f, ["2020-01-01", "2020-01-02", "2020-01-04", "2020-01-05"], "day");
		expect(curve[0]).toBeNull();
		expect(curve[1]).toBeCloseTo(Math.E, 9);
		expect(curve[2]).toBeCloseTo(Math.exp(2), 9);
		expect(curve[3]).toBeNull();
	});

	test("a weekly row sums its 7 days, and a week half in the window is skipped", () => {
		const f = fit({ window: ["2014-09-01", "2014-09-21"], growthIntercept: 0, growthRate: 0.1 });
		// 09-07 covers days 0-6, 09-14 days 7-13; 09-03 starts before the
		// window and 09-28 ends after it.
		const curve = growthCurve(f, ["2014-09-03", "2014-09-07", "2014-09-14", "2014-09-28"], "week");
		let week2 = 0;
		for (let t = 7; t <= 13; t++) week2 += Math.exp(0.1 * t);
		expect(curve[0]).toBeNull();
		expect(curve[1]).not.toBeNull();
		expect(curve[2]).toBeCloseTo(week2, 9);
		expect(curve[3]).toBeNull();
	});

	test("the growth line has one value per day of the window", () => {
		const line = growthLine(fit());
		// 1 September to 10 October 1918 is 39 days on from the start.
		expect(line.days).toHaveLength(40);
		expect(line.values).toHaveLength(40);
		expect(line.days[39]).toBe(39);
		expect(line.values[0]).toBeCloseTo(Math.exp(1.0895), 9);
	});
});

describe("R(t) columns", () => {
	const point = (date: string, mean: number) => ({ date, mean, lo: mean - 0.1, hi: mean + 0.1 });

	test("the union keeps the weekly dates and adds every R(t) day", () => {
		const weekly = ["2014-09-07", "2014-09-14", "2014-09-21"];
		const cols = rtColumns(weekly, [point("2014-09-12", 1.5), point("2014-09-15", 1.2)]);
		expect(cols.dates).toEqual([
			"2014-09-07",
			"2014-09-12",
			"2014-09-13",
			"2014-09-14",
			"2014-09-15",
			"2014-09-21",
		]);
		expect(cols.mean).toEqual([null, 1.5, null, null, 1.2, null]);
		expect(cols.lo[1]).toBeCloseTo(1.4, 9);
		expect(cols.hi[4]).toBeCloseTo(1.3, 9);
		for (const column of [cols.mean, cols.lo, cols.hi]) expect(column).toHaveLength(cols.dates.length);
	});

	test("a 3-day gap in R(t) stays null", () => {
		const cols = rtColumns([], [point("2020-03-01", 2), point("2020-03-05", 1)]);
		expect(cols.dates).toHaveLength(5);
		expect(cols.mean).toEqual([2, null, null, null, 1]);
	});

	test("by day since the first case, every day of the span", () => {
		const byDay = rtByDay([point("2020-03-03", 2), point("2020-03-05", 1)], "2020-03-01");
		expect(byDay.days).toEqual([2, 3, 4]);
		expect(byDay.mean).toEqual([2, null, 1]);
		expect(byDay.lo).toHaveLength(3);
		expect(rtByDay([], "2020-03-01").days).toEqual([]);
	});

	test("the axis top", () => {
		expect(rtTop([])).toBe(2);
		expect(rtTop([null, null])).toBe(2);
		expect(rtTop([0.8, 1.2])).toBe(2);
		expect(rtTop([2.351, null])).toBe(3);
		expect(rtTop([5])).toBe(6);
	});
});

describe("describeFit", () => {
	test("flu1918, picked by hand", () => {
		const lines = describeFit(fit(), "day");
		expect(lines[0]).toBe(
			"R0 1.35 (95% confidence interval 1.28 to 1.42), from the growth window 1918-09-01 to 1918-10-10 " +
				"(picked by hand, shaded): cases doubled every 5.5 days (4.7 to 6.7).",
		);
		expect(lines[1]).toBe(
			"the interval covers the noise in the counts only. it takes the serial interval, 2.51 days (SD 1.55), " +
				"as known; a longer serial interval would give a higher R0 from the same growth.",
		);
		expect(lines[2]).toContain("Baltimore");
		expect(lines[3]).toBe(
			"R(t) below: EpiEstim over 7-day windows, each dated on its last day, with a 95% credible interval. " +
				"windows with fewer than 12 cases, or ending within one serial interval of the first case, are left out.",
		);
		expect(lines[4]).toBe("for the simulator: incubation period 1.46 days, infectious period 4 days.");
	});

	test("an automatic window reads as rough", () => {
		const lines = describeFit(fit({ windowAuto: true, note: null }), "day");
		expect(lines[0]).toContain(
			"from the first wave, 1918-09-01 to 1918-10-10 (picked automatically, so read it as rough): ",
		);
		expect(lines).toHaveLength(4);
	});

	test("no growth", () => {
		expect(describeFit(fit({ growthRateCi: [-0.01, 0.05] }), "day")[0]).toEndWith(
			"(picked by hand, shaded): the interval includes no growth.",
		);
		const shrinking = describeFit(fit({ growthRate: -0.05, growthRateCi: [-0.08, -0.02] }), "day");
		expect(shrinking[0]).toEndWith(": cases were not growing in this window.");
		expect(shrinking[1]).toContain("a lower R0 from the same decline");
	});

	test("a missing R0 bound", () => {
		expect(describeFit(fit({ r0Ci: [null, 1.42] }), "day")[0]).toStartWith(
			"R0 1.35 (95% confidence interval up to 1.42),",
		);
	});

	test("periods that are not known", () => {
		const lines = describeFit(fit({ incubationDays: null, infectiousDays: null }), "day");
		expect(lines[lines.length - 1]).toBe(
			"for the simulator: incubation period not known, infectious period not known.",
		);
	});

	test("weekly counts", () => {
		const lines = describeFit(fit(), "week");
		expect(lines[3]).toEndWith(
			" are left out. weekly counts are spread evenly over their 7 days, so R(t) cannot see changes within a week.",
		);
	});

	test("sources", () => {
		expect(describeFitSources(fit())).toBe(
			"fit: serial interval Ghani et al. 2009, doi:10.1371/currents.RRN1130 (epiparameter, Influenza-A-H1N1Pdm); " +
				"incubation period Lessler et al. 2009, doi:10.1056/NEJMoa0906089 (epiparameter, Influenza-A-H1N1); " +
				"infectious period Carrat et al. 2008. R(t): EpiEstim (Cori et al. 2013). R0: Wallinga and Lipsitch 2007.",
		);
		const unknown = fit({ sources: { serialInterval: "X", incubation: null, infectious: null } });
		expect(describeFitSources(unknown)).toStartWith(
			"fit: serial interval X; incubation period not known; infectious period not known.",
		);
	});
});
