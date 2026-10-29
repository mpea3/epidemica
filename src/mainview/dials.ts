// The Simulate dials: one slider per engine parameter, grouped as in the
// README "Dials" table. Only data and formatting live here, no DOM, so the
// table can be tested on its own (dials.test.ts); simulate.ts builds the
// inputs from it.
import type { Params } from "../engine/types";

export type DialGroup = "spread" | "symptoms" | "outcome" | "interventions";

export const DIAL_GROUPS: DialGroup[] = ["spread", "symptoms", "outcome", "interventions"];

// How a value is shown next to its slider: a plain number (R0), a length in
// days, a day number, or a share from 0-1 shown as a percentage.
export type DialUnit = "number" | "days" | "day" | "share";

export interface Dial {
	key: keyof Params;
	group: DialGroup;
	label: string;
	min: number;
	max: number;
	step: number;
	unit: DialUnit;
	// The value can be null, shown as "off" (lifelong immunity, no lockdown).
	// onValue is where the slider starts when it is switched on.
	nullable?: { onValue: number };
	// The engine only reads it when a run starts (see Engine.setParam).
	needsReset?: boolean;
}

// R0 and the two periods have fine steps so a value fitted in History fits
// on them: near R = 1, rounding 1.347 to 1.3 would cut R - 1 by about 15%.
export const DIALS: Dial[] = [
	{ key: "r0", group: "spread", label: "R0", min: 0.5, max: 20, step: 0.01, unit: "number" },
	{ key: "incubationDays", group: "spread", label: "incubation period", min: 0, max: 21, step: 0.1, unit: "days" },
	{ key: "infectiousDays", group: "spread", label: "infectious period", min: 1, max: 40, step: 0.1, unit: "days" },
	{ key: "shareAsymptomatic", group: "symptoms", label: "share asymptomatic", min: 0, max: 1, step: 0.01, unit: "share" },
	{
		key: "asymptomaticInfectiousness",
		group: "symptoms",
		label: "asymptomatic infectiousness",
		min: 0,
		max: 1,
		step: 0.01,
		unit: "share",
	},
	{ key: "selfIsolation", group: "symptoms", label: "self-isolation", min: 0, max: 1, step: 0.01, unit: "share" },
	// Finer steps: the care home's 20% and the school's 0.1% both need to fit.
	{ key: "fatality", group: "outcome", label: "fatality", min: 0, max: 0.5, step: 0.001, unit: "share" },
	{
		key: "immunityDays",
		group: "outcome",
		label: "waning immunity",
		min: 30,
		max: 1000,
		step: 10,
		unit: "days",
		nullable: { onValue: 180 },
	},
	{ key: "masks", group: "interventions", label: "masks", min: 0, max: 1, step: 0.01, unit: "share" },
	{
		key: "vaccinationCoverage",
		group: "interventions",
		label: "vaccination coverage",
		min: 0,
		max: 1,
		step: 0.01,
		unit: "share",
		needsReset: true,
	},
	{
		key: "lockdownDay",
		group: "interventions",
		label: "lockdown",
		min: 0,
		max: 365,
		step: 1,
		unit: "day",
		nullable: { onValue: 30 },
	},
	{ key: "testing", group: "interventions", label: "testing and isolation", min: 0, max: 1, step: 0.01, unit: "share" },
];

export function dialFor(key: keyof Params): Dial {
	const dial = DIALS.find((d) => d.key === key);
	if (!dial) throw new Error(`no dial for ${key}`);
	return dial;
}

// Enough decimals to show one step: a step of 0.5 needs 1, a step of 10
// needs none.
function decimals(step: number): number {
	return Math.max(0, Math.ceil(-Math.log10(step) - 1e-9));
}

// Trailing zeros go, so 5.0 days is "5 days".
function round(value: number, step: number): string {
	return String(Number(value.toFixed(decimals(step))));
}

// Puts a value from outside the sliders (a fit from History) where its slider
// would: inside min..max and on a step. min + k * step leaves float noise
// (3 * 0.1 is 0.30000000000000004), so it is rounded to the step's
// decimals as well. clamped says whether the value was outside the range.
export function snapToDial(dial: Dial, value: number): { value: number; clamped: boolean } {
	const clamped = value < dial.min || value > dial.max;
	const inRange = Math.min(dial.max, Math.max(dial.min, value));
	const onStep = dial.min + Math.round((inRange - dial.min) / dial.step) * dial.step;
	const clean = Number(Math.min(dial.max, onStep).toFixed(decimals(dial.step)));
	return { value: clean, clamped };
}

// "2.5", "5 days", "day 30", "30%", "0.1%" or "off".
export function formatDial(dial: Dial, value: number | null): string {
	if (value === null) return "off";
	switch (dial.unit) {
		case "number":
			return round(value, dial.step);
		case "days": {
			const text = round(value, dial.step);
			return `${text} ${text === "1" ? "day" : "days"}`;
		}
		case "day":
			return `day ${round(value, dial.step)}`;
		case "share":
			return `${round(value * 100, dial.step * 100)}%`;
	}
}
