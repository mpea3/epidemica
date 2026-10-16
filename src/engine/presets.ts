// Setting presets: a starting point for the Simulate dashboard. A setting
// fixes the population (size, density, movement) and, through fatality, its
// age mix; the virus dials start at the same defaults everywhere.
//
// Density does not change R0: p = R0 / (c x D) already scales the chance per
// contact by how many contacts there are. What density and movement change
// is how fast the virus gets around and how evenly it reaches everyone.
//
// Agents have no age yet (see the Roadmap, "Age groups"), so an old or young
// population shows up as a higher or lower fatality.
import type { Params, Settings } from "./types";

export type PresetId = "city" | "village" | "school" | "careHome" | "festival";

export interface Preset {
	label: string;
	settings: Settings;
	params: Params;
}

// A COVID-like virus with no interventions switched on.
export const DEFAULT_PARAMS: Params = {
	r0: 2.5,
	incubationDays: 5,
	infectiousDays: 7,
	shareAsymptomatic: 0.3,
	asymptomaticInfectiousness: 0.5,
	selfIsolation: 0.5,
	fatality: 0.01,
	immunityDays: null,
	masks: 0,
	vaccinationCoverage: 0,
	lockdownDay: null,
	testing: 0,
};

const PRESETS: Record<PresetId, Preset> = {
	// 5,000 people, 0.5 per square unit, lots of movement.
	city: {
		label: "City",
		settings: { agents: 5000, worldSize: 100, contactRadius: 1, speed: 0.3, initialInfected: 5, seed: 1, fullyMixed: false },
		params: DEFAULT_PARAMS,
	},
	// 500 people spread out (0.08 per square unit), moving slowly.
	village: {
		label: "Village",
		settings: { agents: 500, worldSize: 80, contactRadius: 1, speed: 0.15, initialInfected: 2, seed: 1, fullyMixed: false },
		params: DEFAULT_PARAMS,
	},
	// 1,000 mostly young people, dense and on the move all day. Children
	// more often have no symptoms and very rarely die.
	school: {
		label: "School",
		settings: { agents: 1000, worldSize: 35, contactRadius: 1, speed: 0.4, initialInfected: 2, seed: 1, fullyMixed: false },
		params: { ...DEFAULT_PARAMS, shareAsymptomatic: 0.5, fatality: 0.001 },
	},
	// 80 old people in a small space who hardly move. High fatality.
	careHome: {
		label: "Care home",
		settings: { agents: 80, worldSize: 12, contactRadius: 1, speed: 0.08, initialInfected: 1, seed: 1, fullyMixed: false },
		params: { ...DEFAULT_PARAMS, shareAsymptomatic: 0.2, fatality: 0.2 },
	},
	// 3,000 people packed in (almost 2 per square unit), always moving, and
	// nobody arrives or leaves: a festival or a cruise ship.
	festival: {
		label: "Festival / cruise ship",
		settings: { agents: 3000, worldSize: 40, contactRadius: 1, speed: 0.5, initialInfected: 5, seed: 1, fullyMixed: false },
		params: { ...DEFAULT_PARAMS, fatality: 0.005 },
	},
};

export const PRESET_IDS = Object.keys(PRESETS) as PresetId[];

// A fresh copy of a preset, so changing the dials never changes the preset.
export function preset(id: PresetId): Preset {
	const p = PRESETS[id];
	return { label: p.label, settings: { ...p.settings }, params: { ...p.params } };
}
