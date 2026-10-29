// Load from history: setting the simulator's dials from an outbreak R has
// fitted, and the sentences that say what that does and does not mean. The
// Simulate tab (simulate.ts) does the loading and the drawing; everything
// here is plain data and text, with no DOM, so it can be tested on its own
// (fromhistory.test.ts).
//
// Only four dials are filled: R0 and the two periods, which the fit and the
// literature give, and asymptomatic infectiousness, which is set to 100% as
// an assumption (see dialsFromFit). The setting, fatality and interventions
// stay the user's.
import { generationTimeDays, modelGrowthRate, startingR } from "../engine/growth";
import type { Params } from "../engine/types";
import { align, daysBetween, type Aligned } from "../shared/compare";
import { doublingDays, doublingRange, type Fit } from "../shared/fit";
import type { Outbreak } from "../shared/outbreak";
import { dialFor, formatDial, snapToDial } from "./dials";

// The dials a loaded outbreak fills. Picking another setting or choosing
// "nothing" touches only these.
export const LOADED_KEYS = ["r0", "incubationDays", "infectiousDays", "asymptomaticInfectiousness"] as const;
export type LoadedKey = (typeof LOADED_KEYS)[number];

// Deaths and cases summed over the rows that report both.
export interface DeathsPerCase {
	deaths: number;
	cases: number;
	share: number; // deaths / cases, 0-1
}

// An outbreak loaded into the simulator, and what to show for it.
export interface Loaded {
	id: string;
	name: string;
	interval: "day" | "week";
	fit: Fit;
	values: Partial<Pick<Params, LoadedKey>>; // what the dials were set to
	notes: string[]; // sentences about the values: clamped, not known
	reported: Aligned; // cases per day, day 0 on the first day of the growth window
	deathsPerCase: DeathsPerCase | null; // information only, never put in a dial
	windowDays: number; // the growth window is days 0 to this one
	midOutbreak: boolean; // the data starts high: the series is cut from a larger outbreak
}

// How a note about a period R has no value for ends. describeLoad words
// those itself, with the number the dial stays at, so it skips these.
const NOT_CHANGED = "not known; the dial is not changed.";

// The dial values a fit gives, each snapped to where its slider would put it.
// A period R has no value for is left alone, and a value outside its dial is
// clamped; both come back as notes.
//
// Asymptomatic infectiousness is set to 1. The fitted R0 is the average over
// every infection, and the counts cannot tell cases with and without
// symptoms apart. The model's R0 is that of a case with symptoms (cases
// without are scaled by this dial), so 1 is the only value where the model's
// average R0 is the fitted one. Left at 0.5, flu would run at 1.15 instead of
// 1.35. The user can change it, and the growth check then shows the effect.
export function dialsFromFit(fit: Fit): { values: Loaded["values"]; notes: string[] } {
	const values: Loaded["values"] = {};
	const notes: string[] = [];
	const fill = (key: "r0" | "incubationDays" | "infectiousDays", raw: number | null) => {
		const dial = dialFor(key);
		if (raw === null) {
			notes.push(`${dial.label} ${NOT_CHANGED}`);
			return;
		}
		const snapped = snapToDial(dial, raw);
		values[key] = snapped.value;
		if (snapped.clamped) {
			const side = raw > dial.max ? "above" : "below";
			const limit = formatDial(dial, snapped.value);
			notes.push(`the fitted ${dial.label} ${formatDial(dial, raw)} is ${side} the dial's ${limit}; set to ${limit}.`);
		}
	};
	fill("r0", fit.r0);
	fill("incubationDays", fit.incubationDays);
	fill("infectiousDays", fit.infectiousDays);
	values.asymptomaticInfectiousness = 1;
	return { values, notes };
}

// base with the loaded values on top. A copy, and only the four dials a
// load fills: picking a setting while an outbreak is loaded must not put R0
// back to the preset's 2.5.
export function applyLoaded(base: Params, values: Loaded["values"]): Params {
	const next = { ...base };
	for (const key of LOADED_KEYS) {
		const value = values[key];
		if (value !== undefined) next[key] = value;
	}
	return next;
}

// params with the four loaded dials back at the preset's values, for
// choosing "nothing". Everything else stays as the user set it.
export function restoreFrom(params: Params, presetParams: Params): Params {
	const next = { ...params };
	for (const key of LOADED_KEYS) next[key] = presetParams[key];
	return next;
}

// Reported deaths per reported case, over the rows that have both counts
// (a column can start later than the other, or be missing). null when
// deaths were not reported (no row has both), or no case was counted on
// those rows. Deaths counted as 0 on every row are a share of 0, not
// "not reported": a source that counted no deaths did report them.
export function deathsPerCase(outbreak: Outbreak): DeathsPerCase | null {
	const casesColumn = outbreak.columns["cases"] ?? [];
	const deathsColumn = outbreak.columns["deaths"] ?? [];
	let cases = 0;
	let deaths = 0;
	outbreak.dates.forEach((_, i) => {
		const c = casesColumn[i];
		const d = deathsColumn[i];
		if (c == null || d == null) return;
		cases += c;
		deaths += d;
	});
	if (cases === 0) return null;
	return { deaths, cases, share: deaths / cases };
}

// The data from which the grey line "starts high" instead of at a few cases.
const MID_OUTBREAK_PER_DAY = 50;

// An outbreak and its fit as the simulator loads them. Day 0 is the first
// day R0 was fitted on, which is where the growth the two curves can be
// compared on starts.
export function loadedFrom(outbreak: Outbreak, fit: Fit): Loaded {
	if (outbreak.interval === "year") throw new Error(`${outbreak.id} counts per year and cannot be loaded`);
	const { values, notes } = dialsFromFit(fit);
	const reported = align(outbreak, "cases", fit.window[0]);
	const first = reported.values.find((v) => v !== null) ?? 0;
	return {
		id: outbreak.id,
		name: outbreak.name,
		interval: outbreak.interval,
		fit,
		values,
		notes,
		reported,
		deathsPerCase: deathsPerCase(outbreak),
		windowDays: daysBetween(fit.window[0], fit.window[1]),
		midOutbreak: first >= MID_OUTBREAK_PER_DAY,
	};
}

// The first day on which the infections so far reach share of the agents
// (days and newInfections are the simulated per-day series), the point after
// which running out of people bends the curve. null if it never does.
export function depletionDay(days: number[], newInfections: number[], agents: number, share = 0.1): number | null {
	let total = 0;
	for (let i = 0; i < days.length; i++) {
		total += newInfections[i] ?? 0;
		if (total >= share * agents) return days[i];
	}
	return null;
}

function count(value: number): string {
	return value.toLocaleString("en-GB");
}

// "6.4%", and two decimals below 1% ("0.28%") so a small share is not 0.
function percent(share: number): string {
	const value = share * 100;
	return `${value < 1 ? value.toFixed(2) : value.toFixed(1)}%`;
}

function interval([lo, hi]: Fit["r0Ci"]): string {
	if (lo !== null && hi !== null) return `(95% confidence interval ${lo.toFixed(2)} to ${hi.toFixed(2)})`;
	if (hi !== null) return `(95% confidence interval up to ${hi.toFixed(2)})`;
	if (lo !== null) return `(95% confidence interval from ${lo.toFixed(2)})`;
	return "(no confidence interval)";
}

// What loading did, under the setting picker, in two lines: the dials it
// filled and why asymptomatic infectiousness is 100%, then what it left
// alone. params are the dials after loading.
export function describeLoad(loaded: Loaded, params: Params): string {
	const { fit, values } = loaded;
	const parts = [`R0 ${fit.r0.toFixed(2)} ${interval(fit.r0Ci)}`];
	if (values.incubationDays !== undefined) {
		parts.push(`incubation period ${formatDial(dialFor("incubationDays"), values.incubationDays)}`);
	}
	if (values.infectiousDays !== undefined) {
		parts.push(`infectious period ${formatDial(dialFor("infectiousDays"), values.infectiousDays)}`);
	}
	let first =
		`loaded ${loaded.name}, fitted by R: ${parts.join(", ")}. ` +
		"asymptomatic infectiousness set to 100%, so the model's average R0 is the fitted one " +
		"(the data cannot tell cases with and without symptoms apart).";

	// A period R has no value for: the dial stays where it was, so say where.
	for (const key of ["incubationDays", "infectiousDays"] as const) {
		if (values[key] === undefined) {
			const dial = dialFor(key);
			first += ` ${dial.label} not known; the dial stays at ${formatDial(dial, params[key])}.`;
		}
	}
	// The other notes are about values that were set (clamped).
	for (const note of loaded.notes) {
		if (!note.endsWith(NOT_CHANGED)) first += ` ${note}`;
	}

	const fatality = formatDial(dialFor("fatality"), params.fatality);
	const deaths = loaded.deathsPerCase;
	const second =
		"the setting, fatality and interventions are yours. " +
		(!deaths
			? `deaths were not reported, so fatality stays at ${fatality}.`
			: deaths.deaths === 0
				? `no deaths were reported among the ${count(deaths.cases)} cases, so fatality stays at ${fatality}.`
				: `reported deaths per reported case were ${percent(deaths.share)} (${count(deaths.deaths)} of ${count(deaths.cases)}), ` +
					"but the fatality dial is the share of all infections that die, " +
					`and reported cases miss the mild ones, so it stays at ${fatality}.`);
	return `${first}\n${second}`;
}

// Which of the starting R's cuts are on, for "R 2.71 is R0 3.19 cut by ...".
function cuts(p: Params): string[] {
	const list: string[] = [];
	if (p.masks > 0) list.push("masks");
	if (p.shareAsymptomatic * (1 - p.asymptomaticInfectiousness) > 0) list.push("cases without symptoms");
	if (p.vaccinationCoverage > 0) list.push("vaccination");
	if (p.lockdownDay !== null && p.lockdownDay <= 0) list.push("lockdown");
	return list;
}

function joined(list: string[]): string {
	if (list.length < 2) return list.join("");
	return `${list.slice(0, -1).join(", ")} and ${list[list.length - 1]}`;
}

// A model that grows slower than this has no doubling time worth quoting.
const NO_GROWTH = 1e-9;

// How much shorter than the incubation period the serial interval has to be
// before the check names spread before symptoms as a reason. Both are
// estimates, and often from different studies: mpox's 5.6 against 5.73
// days says nothing, COVID-19's 4.7 against 5.6 and measles' 10.4 against
// 12.8 do.
const BEFORE_SYMPTOMS_DAYS = 0.5;

// The growth under the Simulate chart: how fast the reported cases grew
// against how fast the model would grow with the current dials, fully mixed
// and early on, and why the two can differ. It is redrawn on every dial
// change. There is deliberately no button that makes them match: a mismatch
// is the finding (mpox and COVID-19 grow faster than this model can with
// their published periods).
export function growthCheck(fit: Fit, params: Params): string {
	const doubling = doublingDays(fit.growthRate);
	const range = doublingRange(fit.growthRateCi);
	let text: string;
	if (doubling === null) text = "growth: reported cases were not growing in the growth window.";
	else if (range === null) {
		text = `growth: reported cases doubled every ${doubling.toFixed(1)} days in the growth window (the interval includes no growth).`;
	} else {
		text =
			`growth: reported cases doubled every ${doubling.toFixed(1)} days ` +
			`(${range[0].toFixed(1)} to ${range[1].toFixed(1)}) in the growth window.`;
	}

	const R = startingR(params);
	const generation = generationTimeDays(params.incubationDays, params.infectiousDays);
	text +=
		` with these dials the model starts at R ${R.toFixed(2)} and one generation takes ${generation.toFixed(1)} days on average ` +
		`(incubation + 13/24 of the infectious period), against the ${fit.serialIntervalMean}-day serial interval R0 was fitted with`;
	if (R < 1) {
		text += `. with these dials R is ${R.toFixed(2)}, below 1, so the model shrinks.`;
	} else {
		const rate = modelGrowthRate(R, params.incubationDays, params.infectiousDays);
		const model = rate > NO_GROWTH ? doublingDays(rate) : null;
		text +=
			model === null
				? ", so even fully mixed it would not grow."
				: `, so even fully mixed it would double about every ${model.toFixed(1)} days. agents walking in a world are slower still.`;
	}

	if (fit.serialIntervalMean < params.incubationDays - BEFORE_SYMPTOMS_DAYS) {
		text +=
			" the serial interval is shorter than the incubation period: people passed it on before symptoms " +
			"(or the two were measured to different symptoms). in the model nobody is infectious before the incubation period ends.";
	}
	// The infectious period's part of a generation (13/24 of it) longer than
	// the whole serial interval: mpox's 21 days, where cases in the model stay
	// infectious at the same rate to the end while real ones pass it on early.
	const infectiousPart = (13 / 24) * params.infectiousDays;
	if (infectiousPart > fit.serialIntervalMean) {
		text +=
			` the infectious period alone adds ${infectiousPart.toFixed(1)} days to a generation, more than the whole serial interval: ` +
			"in the model a case passes it on at the same rate until the infectious period ends, while real cases mostly passed it on early.";
	}
	if (Math.abs(R - params.r0) > 0.02 * params.r0) {
		text += ` R ${R.toFixed(2)} is R0 ${params.r0.toFixed(2)} cut by ${joined(cuts(params))}.`;
	}
	if (R >= 1 && R < 1.15) {
		text += " with R this close to 1 many runs die out by chance in the first days; try another seed.";
	}
	if (params.testing > 0) {
		text += " testing and isolation are left out of this figure, so the model is slower still.";
	}
	return text;
}

// The note under the Simulate chart while an outbreak is loaded: what the
// grey and purple lines are, and what can and cannot be read from them.
export function describeOverlay(loaded: Loaded, setting: { agents: number }): string {
	let text =
		`grey: cases reported in ${loaded.name}, per day, with day 0 on ${loaded.fit.window[0]}, ` +
		"the start of the growth window R0 was fitted on (shaded). " +
		"purple dashed: the growth R fitted there. log scale (linear below 0.1 a day, to show days of 0). " +
		`the simulation has ${count(setting.agents)} people and the real outbreak a population the data does not give, ` +
		"so compare how steeply the lines rise inside the window, not how high they are. " +
		"simulated counts are infections; reported counts are cases at first symptoms or report, which come later. " +
		"after the window, and after the 10% line, the curves are shaped by different things " +
		"(behaviour, interventions, testing, running out of people) and are expected to part. " +
		"a simulation is not a prediction.";
	if (loaded.interval === "week") text += " weekly counts are shown per day.";
	if (loaded.midOutbreak) text += " the data starts mid-outbreak, so the grey line starts high.";
	return text;
}
