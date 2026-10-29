// The TypeScript side of r/fit.R: what it prints, read into a Fit, and the
// numbers and sentences the History and Simulate tabs build from one.
// No DOM, so all of it can be tested on its own (fit.test.ts).
//
// fit.R prints snake_case with the simulator parameters nested under
// "params"; a Fit is flat camelCase. Unknown values reach us as null, and
// from older jsonlite settings as {} (NULL) or "NA"/"NaN", so every
// nullable field takes all four. The numbers the charts and the simulator
// rely on (R0, the growth line, every R(t) row) must be real numbers, or the
// whole fit is refused: a chart with a silently missing line is worse than
// an error that says why.
import { dateAfter, daysBetween } from "./compare";
import type { RResult } from "./rpc";

// One R(t) estimate, dated on the last day of its 7-day window, with its
// 95% credible interval.
export interface RtPoint {
	date: string;
	mean: number;
	lo: number;
	hi: number;
}

export interface Fit {
	outbreak: string;
	disease: string;
	r0: number;
	r0Ci: [number | null, number | null]; // null when a bound has no R0 (very negative growth)
	window: [string, string]; // the first and last day R0 was fitted on
	windowAuto: boolean; // true: the first wave, picked by fit.R, not by hand
	// log(expected cases per day) = growthIntercept + growthRate * t, with t
	// in days since window[0]. Per day for weekly data too: fit.R spreads
	// each week over its 7 days first.
	growthRate: number;
	growthRateCi: [number, number];
	growthIntercept: number;
	rt: RtPoint[];
	incubationDays: number | null;
	infectiousDays: number | null;
	serialIntervalMean: number;
	serialIntervalSd: number;
	sources: { serialInterval: string; incubation: string | null; infectious: string | null };
	note: string | null; // what to keep in mind about this fit, from fit.R
}

export type FitResult = { ok: true; fit: Fit } | { ok: false; error: string };

// A field that is wrong, for the "R did not return a fit" message.
class BadShape extends Error {}

function record(value: unknown, what: string): Record<string, unknown> {
	if (typeof value !== "object" || value === null || Array.isArray(value)) throw new BadShape(`${what} is not an object`);
	return value as Record<string, unknown>;
}

// How R says "not known": null, {} (an R NULL), or "NA"/"NaN" as text.
function unknown(value: unknown): boolean {
	if (value === null || value === undefined || value === "NA" || value === "NaN") return true;
	return typeof value === "object" && !Array.isArray(value) && Object.keys(value).length === 0;
}

function number(value: unknown, what: string): number {
	if (typeof value !== "number" || !Number.isFinite(value)) throw new BadShape(`${what} is not a number`);
	return value;
}

function maybeNumber(value: unknown, what: string): number | null {
	return unknown(value) ? null : number(value, what);
}

function text(value: unknown, what: string): string {
	if (typeof value !== "string") throw new BadShape(`${what} is not text`);
	return value;
}

function maybeText(value: unknown, what: string): string | null {
	return unknown(value) ? null : text(value, what);
}

function pair(value: unknown, what: string): [unknown, unknown] {
	if (!Array.isArray(value) || value.length !== 2) throw new BadShape(`${what} is not a pair`);
	return [value[0], value[1]];
}

function date(value: unknown, what: string): string {
	const s = text(value, what);
	if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(Date.parse(s))) throw new BadShape(`${what} is not a date`);
	return s;
}

function rtPoint(value: unknown, i: number): RtPoint {
	const row = record(value, `R(t) row ${i + 1}`);
	return {
		date: date(row["date"], `the date of R(t) row ${i + 1}`),
		mean: number(row["mean"], `the mean of R(t) row ${i + 1}`),
		lo: number(row["lo"], `the lower bound of R(t) row ${i + 1}`),
		hi: number(row["hi"], `the upper bound of R(t) row ${i + 1}`),
	};
}

// fit.R's JSON to a Fit. {ok:false,error} from R passes through as it is,
// so the caller can say whose error it was (fitFromRun).
export function parseFit(data: unknown): FitResult {
	try {
		const o = record(data, "the reply");
		if (o["ok"] === false) return { ok: false, error: typeof o["error"] === "string" ? o["error"] : "no reason given" };
		if (o["ok"] !== true) throw new BadShape("ok is not true or false");
		const params = record(o["params"], "params");
		const sources = record(o["sources"], "sources");
		const [lo, hi] = pair(o["r0_ci"], "r0_ci");
		const [from, to] = pair(o["r0_window"], "r0_window");
		const [rateLo, rateHi] = pair(o["growth_rate_ci"], "growth_rate_ci");
		if (typeof o["r0_window_auto"] !== "boolean") throw new BadShape("r0_window_auto is not true or false");
		if (!Array.isArray(o["rt"])) throw new BadShape("rt is not a list");
		const fit: Fit = {
			outbreak: text(o["outbreak"], "outbreak"),
			disease: text(o["disease"], "disease"),
			r0: number(o["r0"], "r0"),
			r0Ci: [maybeNumber(lo, "the low end of r0_ci"), maybeNumber(hi, "the high end of r0_ci")],
			window: [date(from, "the start of r0_window"), date(to, "the end of r0_window")],
			windowAuto: o["r0_window_auto"],
			growthRate: number(o["growth_rate"], "growth_rate"),
			growthRateCi: [number(rateLo, "the low end of growth_rate_ci"), number(rateHi, "the high end of growth_rate_ci")],
			growthIntercept: number(o["growth_intercept"], "growth_intercept"),
			rt: o["rt"].map(rtPoint),
			incubationDays: maybeNumber(params["incubationDays"], "incubationDays"),
			infectiousDays: maybeNumber(params["infectiousDays"], "infectiousDays"),
			serialIntervalMean: number(params["serialIntervalMean"], "serialIntervalMean"),
			serialIntervalSd: number(params["serialIntervalSd"], "serialIntervalSd"),
			sources: {
				serialInterval: text(sources["serialInterval"], "the serial interval source"),
				incubation: maybeText(sources["incubation"], "the incubation source"),
				infectious: maybeText(sources["infectious"], "the infectious period source"),
			},
			note: maybeText(o["note"], "note"),
		};
		if (fit.window[1] < fit.window[0]) throw new BadShape("r0_window ends before it starts");
		return { ok: true, fit };
	} catch (err) {
		if (err instanceof BadShape) return { ok: false, error: `R did not return a fit: ${err.message}` };
		throw err;
	}
}

// What runR returned for `fit.R --outbreak <id>`, as a FitResult whose error
// is ready to show: Rscript failing to run is explained, and R's own
// refusal names the outbreak.
export function fitFromRun(result: RResult, name: string): FitResult {
	if (!result.ok) return { ok: false, error: explainRError(result.error) };
	const data = result.data as { ok?: unknown; error?: unknown } | null;
	if (typeof data === "object" && data !== null && data.ok === false) {
		const error = typeof data.error === "string" ? data.error : "no reason given";
		return { ok: false, error: `R could not fit ${name}: ${explainRError(error)}` };
	}
	return parseFit(data);
}

// The R errors people can do something about, in words that say what.
// Anything else is shown as R wrote it; the caller logs the raw text.
export function explainRError(message: string): string {
	if (/ENOENT|Executable not found|posix_spawn/.test(message)) {
		return "Rscript was not found: install R 4.5 or newer (see getting started in the README). the charts work without it.";
	}
	const missing = message.match(/there is no package called [‘'"]([\w.]+)[’'"]/);
	if (missing) return `R is missing the package ${missing[1]}: run Rscript r/install.R`;
	if (message.startsWith("timeout:")) return message.slice("timeout:".length).trim();
	return message;
}

// How many days cases take to double at growth rate r per day. Shrinking
// or flat cases never double.
export function doublingDays(rate: number): number | null {
	return rate > 0 ? Math.LN2 / rate : null;
}

// The doubling time for each end of the growth-rate interval: the faster
// growth gives the shorter time. null when the interval includes no growth.
export function doublingRange(ci: [number, number]): [number, number] | null {
	const [lo, hi] = ci;
	if (lo <= 0) return null;
	return [Math.LN2 / hi, Math.LN2 / lo];
}

// The fitted cases on day t of the growth window.
function fitted(fit: Fit, t: number): number {
	return Math.exp(fit.growthIntercept + fit.growthRate * t);
}

// The fitted growth on the outbreak's own rows, for the cases panel: null
// outside the growth window. A weekly row counts the 7 days ending on its
// date, so it gets the sum of those 7 fitted days, and only when all 7 are
// inside the window (a week half in it would show half a week of growth).
export function growthCurve(fit: Fit, dates: string[], interval: "day" | "week"): (number | null)[] {
	const last = daysBetween(fit.window[0], fit.window[1]);
	const inside = (t: number) => t >= 0 && t <= last;
	return dates.map((d) => {
		const t = daysBetween(fit.window[0], d);
		if (interval === "day") return inside(t) ? fitted(fit, t) : null;
		if (!inside(t - 6) || !inside(t)) return null;
		let sum = 0;
		for (let k = t - 6; k <= t; k++) sum += fitted(fit, k);
		return sum;
	});
}

// The fitted growth per day over the window, day 0 being its first day,
// for the Simulate panel.
export function growthLine(fit: Fit): { days: number[]; values: number[] } {
	const last = daysBetween(fit.window[0], fit.window[1]);
	const days = Array.from({ length: last + 1 }, (_, d) => d);
	return { days, values: days.map((d) => fitted(fit, d)) };
}

// Every calendar day from the first R(t) date to the last.
function rtSpan(rt: RtPoint[]): string[] {
	if (rt.length === 0) return [];
	const first = rt[0].date;
	const length = daysBetween(first, rt[rt.length - 1].date) + 1;
	return Array.from({ length }, (_, d) => dateAfter(first, d));
}

// R(t) by date, on the given dates.
function rtOn(dates: string[], rt: RtPoint[]) {
	const byDate = new Map(rt.map((p) => [p.date, p]));
	return {
		mean: dates.map((d) => byDate.get(d)?.mean ?? null),
		lo: dates.map((d) => byDate.get(d)?.lo ?? null),
		hi: dates.map((d) => byDate.get(d)?.hi ?? null),
	};
}

// The x column for the R(t) panel under an outbreak's counts: the counted
// dates (so the x range matches the panels above, weekly ones too) and every
// day of the R(t) span (so the daily R(t) is not thinned to weekly). A day
// in the span without an estimate is null, and uPlot leaves a gap there.
export function rtColumns(
	dates: string[],
	rt: RtPoint[],
): { dates: string[]; mean: (number | null)[]; lo: (number | null)[]; hi: (number | null)[] } {
	const all = [...new Set([...dates, ...rtSpan(rt)])].sort();
	return { dates: all, ...rtOn(all, rt) };
}

// R(t) by day since start (an outbreak's first case), for the comparison
// chart: every day of the span, null where a window was left out.
export function rtByDay(
	rt: RtPoint[],
	start: string,
): { days: number[]; mean: (number | null)[]; lo: (number | null)[]; hi: (number | null)[] } {
	const span = rtSpan(rt);
	return { days: span.map((d) => daysBetween(start, d)), ...rtOn(span, rt) };
}

// The top of the R(t) axis: room above the highest mean, and never below 2,
// so R = 1 sits at most halfway up. The bands may poke out above; the legend
// still shows their numbers.
export function rtTop(means: (number | null)[]): number {
	const values = means.filter((m): m is number => m !== null);
	if (values.length === 0) return 2;
	return Math.max(2, Math.ceil(1.2 * Math.max(...values)));
}

function days(value: number): string {
	return value.toFixed(1);
}

// "(95% confidence interval 1.28 to 1.42)", or what is left of it when a
// bound has no R0.
function r0Interval([lo, hi]: Fit["r0Ci"]): string {
	if (lo !== null && hi !== null) return `(95% confidence interval ${lo.toFixed(2)} to ${hi.toFixed(2)})`;
	if (hi !== null) return `(95% confidence interval up to ${hi.toFixed(2)})`;
	if (lo !== null) return `(95% confidence interval from ${lo.toFixed(2)})`;
	return "(no confidence interval)";
}

function period(label: string, value: number | null): string {
	return value === null ? `${label} not known` : `${label} ${value} days`;
}

// The lines of #fit-summary for one fitted outbreak: what R0 is and where
// it came from, how far to trust it, the fit's own note, what R(t) is, and
// what the simulator would get.
export function describeFit(fit: Fit, interval: "day" | "week"): string[] {
	const [from, to] = fit.window;
	const where = fit.windowAuto
		? `from the first wave, ${from} to ${to} (picked automatically, so read it as rough)`
		: `from the growth window ${from} to ${to} (picked by hand, shaded)`;
	let growth: string;
	const doubling = doublingDays(fit.growthRate);
	const range = doublingRange(fit.growthRateCi);
	if (doubling === null) growth = "cases were not growing in this window.";
	else if (range === null) growth = "the interval includes no growth.";
	else growth = `cases doubled every ${days(doubling)} days (${days(range[0])} to ${days(range[1])}).`;

	// With shrinking cases a longer serial interval gives a lower R0, not a
	// higher one, so the sentence turns round.
	const longer = fit.growthRate > 0 ? "a higher R0 from the same growth" : "a lower R0 from the same decline";
	const lines = [
		`R0 ${fit.r0.toFixed(2)} ${r0Interval(fit.r0Ci)}, ${where}: ${growth}`,
		`the interval covers the noise in the counts only. it takes the serial interval, ${fit.serialIntervalMean} days (SD ${fit.serialIntervalSd}), as known; a longer serial interval would give ${longer}.`,
	];
	if (fit.note) lines.push(fit.note);
	let rt =
		"R(t) below: EpiEstim over 7-day windows, each dated on its last day, with a 95% credible interval. " +
		"windows with fewer than 12 cases, or ending within one serial interval of the first case, are left out.";
	if (interval === "week") rt += " weekly counts are spread evenly over their 7 days, so R(t) cannot see changes within a week.";
	lines.push(rt);
	lines.push(
		`for the simulator: ${period("incubation period", fit.incubationDays)}, ${period("infectious period", fit.infectiousDays)}.`,
	);
	return lines;
}

// Where the fit's numbers come from, a line of its own under the outbreak's
// source.
export function describeFitSources(fit: Fit): string {
	const { serialInterval, incubation, infectious } = fit.sources;
	return (
		`fit: serial interval ${serialInterval}; incubation period ${incubation ?? "not known"}; ` +
		`infectious period ${infectious ?? "not known"}. R(t): EpiEstim (Cori et al. 2013). R0: Wallinga and Lipsitch 2007.`
	);
}
