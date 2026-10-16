// Shapes shared by the engine, the worker and the dashboard. See the README
// "Simulation model" section for what each dial means.

// Where an agent is in the disease. Waning immunity sends Recovered back to
// Susceptible.
export enum State {
	Susceptible,
	Exposed,
	Infectious,
	Recovered,
	Dead,
}

export const NUM_STATES = 5;

// One tick is one simulated hour.
export const TICKS_PER_DAY = 24;

export interface Agent {
	x: number;
	y: number;
	state: State;
	// Ticks left in Exposed or Infectious.
	timer: number;
	// Never shows symptoms; set when the agent becomes Exposed.
	asymptomatic: boolean;
}

// Number of agents in each state, indexed by State.
export type Counts = [number, number, number, number, number];

// The dials. They can change while a run is going.
export interface Params {
	r0: number;
	incubationDays: number;
	infectiousDays: number;
	shareAsymptomatic: number; // 0-1
	asymptomaticInfectiousness: number; // 0-1, relative to a symptomatic case
	selfIsolation: number; // 0-1, cut in movement once symptomatic
	fatality: number; // 0-1, share of cases that die
	immunityDays: number | null; // null = lifelong
	masks: number; // 0-1, cut in chance per contact
	vaccinationCoverage: number; // 0-1, share who start immune
	lockdownDay: number | null; // null = never
	testing: number; // 0-1, share of symptomatic cases isolated
}

// Fixed for a run; changing these means a reset. A setting preset fills them.
export interface Settings {
	agents: number;
	worldSize: number;
	contactRadius: number;
	speed: number; // distance an agent walks per tick
	initialInfected: number;
	seed: number;
}
