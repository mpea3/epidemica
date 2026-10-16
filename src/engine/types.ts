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

// All agents, one entry per agent in each array (agent i is x[i], y[i],
// state[i], ...). Typed arrays instead of an array of objects: they are
// compact, fast to loop over, and the worker can hand copies to the UI
// without converting them.
export interface World {
	x: Float32Array; // position, 0 to worldSize
	y: Float32Array;
	state: Uint8Array; // a State value
	// Ticks left in Exposed, Infectious or (with waning immunity) Recovered.
	timer: Int32Array;
	// 1 = never shows symptoms; set when the agent becomes Exposed.
	asymptomatic: Uint8Array;
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
	// Ignore positions: every infectious agent can meet every other agent.
	// This is the textbook SIR assumption, used to check the model against
	// the final-size formula. The agents still walk so there is something to
	// draw.
	fullyMixed: boolean;
}
