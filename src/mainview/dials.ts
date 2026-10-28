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

export const DIALS: Dial[] = [
	{ key: "r0", group: "spread", label: "R0", min: 0.5, max: 20, step: 0.1, unit: "number" },
	{ key: "incubationDays", group: "spread", label: "incubation period", min: 0, max: 21, step: 0.5, unit: "days" },
	{ key: "infectiousDays", group: "spread", label: "infectious period", min: 1, max: 40, step: 0.5, unit: "days" },
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

// Enough decimals to show one step: a step of 0.5 needs 1, a step of 10
// needs none. Trailing zeros go, so 5.0 days is "5 days".
function round(value: number, step: number): string {
	const decimals = Math.max(0, Math.ceil(-Math.log10(step) - 1e-9));
	return String(Number(value.toFixed(decimals)));
}

// "2.5", "5 days", "day 30", "30%", "0.1%" or "off".
export function formatDial(dial: Dial, value: number | null): string {
	if (value === null) return "off";
	switch (dial.unit) {
		case "number":
			return round(value, dial.step);
		case "days":
			return `${round(value, dial.step)} ${value === 1 ? "day" : "days"}`;
		case "day":
			return `day ${round(value, dial.step)}`;
		case "share":
			return `${round(value * 100, dial.step * 100)}%`;
	}
}
