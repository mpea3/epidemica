// The agent-based model. Runs inside the Web Worker (worker.ts), never on the
// UI thread, so it can be tested on its own with `hutch run test`.
//
// See the README "Simulation model" section for the model in words.
import { Random } from "./random";
import { type Counts, type Params, type Settings, State, TICKS_PER_DAY, type World } from "./types";

// A stay in Exposed or Infectious (and a stretch of immunity) lasts the dial
// value times a factor drawn uniformly from this range. The average stay is
// the dial value, but not everyone recovers on the same day.
const STAY_MIN = 0.5;
const STAY_MAX = 1.5;

// Chance per tick that a walking agent picks a new direction. In between it
// walks in a straight line, which looks more like people than jitter does.
const TURN_CHANCE = 0.05;

// During a lockdown agents walk at this share of their normal speed, and the
// contacts that still happen pass the virus on with this share of the usual
// chance (fewer visits, shorter meetings, more distance).
const LOCKDOWN_MOVEMENT = 0.25;
const LOCKDOWN_CONTACT = 0.3;

// A symptomatic case that gets tested is isolated this many ticks after its
// symptoms start: waiting for the test and the result.
const TEST_DELAY_TICKS = TICKS_PER_DAY;

export class Engine {
	private tick = 0;
	// Everyone ever infected, the first cases included. Counted rather than
	// worked out from the states, because with waning immunity an agent can
	// be infected more than once.
	private infections = 0;
	private readonly n: number;
	private readonly random: Random;
	private readonly agents: World;

	// Direction each agent walks in, as a step of length 1.
	private readonly dirX: Float32Array;
	private readonly dirY: Float32Array;
	// Tick from which a tested case is isolated; -1 = not tested.
	private readonly isolateAt: Int32Array;

	// The contact grid, see buildGrid().
	private readonly cellsPerSide: number;
	private readonly cellSize: number;
	private readonly cellStart: Int32Array;
	private readonly cellNext: Int32Array;
	private readonly cellAgents: Int32Array;
	private readonly agentCell: Int32Array;

	constructor(
		private settings: Settings,
		private params: Params,
	) {
		const n = settings.agents;
		this.n = n;
		this.random = new Random(settings.seed);
		this.agents = {
			x: new Float32Array(n),
			y: new Float32Array(n),
			state: new Uint8Array(n), // all 0 = Susceptible
			timer: new Int32Array(n),
			asymptomatic: new Uint8Array(n),
		};
		this.dirX = new Float32Array(n);
		this.dirY = new Float32Array(n);
		this.isolateAt = new Int32Array(n).fill(-1);

		// Grid cells are at least one contact radius wide, so everyone within
		// reach of an agent is in its own cell or one of the 8 around it. With
		// fewer than 3 cells per side those 9 cells would overlap, so a world
		// that small uses a single cell.
		let cells = Math.floor(settings.worldSize / settings.contactRadius);
		if (cells < 3) cells = 1;
		this.cellsPerSide = cells;
		this.cellSize = settings.worldSize / cells;
		this.cellStart = new Int32Array(cells * cells + 1);
		this.cellNext = new Int32Array(cells * cells);
		this.cellAgents = new Int32Array(n);
		this.agentCell = new Int32Array(n);

		for (let i = 0; i < n; i++) {
			this.agents.x[i] = this.random.uniform(0, settings.worldSize);
			this.agents.y[i] = this.random.uniform(0, settings.worldSize);
			this.pickDirection(i);
		}

		// Shuffle the agent numbers, then vaccinate the first ones in that
		// order and infect the next ones. This gives exact numbers, which
		// matters in a care home of 80 people.
		const order = this.shuffledAgents();
		const vaccinated = Math.round(params.vaccinationCoverage * n);
		const infected = Math.min(settings.initialInfected, n - vaccinated);
		for (let k = 0; k < vaccinated; k++) {
			// Vaccinated agents start as Recovered: immune, and with waning
			// immunity they become susceptible again like everyone else.
			this.becomeRecovered(order[k]);
		}
		for (let k = vaccinated; k < vaccinated + infected; k++) {
			// The first cases skip Exposed and start out infectious.
			this.becomeExposed(order[k]);
			this.becomeInfectious(order[k]);
		}
	}

	// One tick = one simulated hour: move agents, advance timers, then let
	// infectious agents infect their contacts.
	step(): void {
		this.move();
		this.advanceTimers();
		this.spread();
		this.tick++;
	}

	// Picked up on the next tick. vaccinationCoverage only counts at the start
	// of a run, so changing it needs a reset.
	setParam<K extends keyof Params>(key: K, value: Params[K]): void {
		this.params[key] = value;
	}

	counts(): Counts {
		const counts: Counts = [0, 0, 0, 0, 0];
		for (let i = 0; i < this.n; i++) counts[this.agents.state[i]]++;
		return counts;
	}

	// True when nobody is Exposed or Infectious.
	done(): boolean {
		const state = this.agents.state;
		for (let i = 0; i < this.n; i++) {
			if (state[i] === State.Exposed || state[i] === State.Infectious) return false;
		}
		return true;
	}

	currentTick(): number {
		return this.tick;
	}

	infectionsSoFar(): number {
		return this.infections;
	}

	// The agents' typed arrays themselves, not copies: read them, do not
	// change them.
	world(): Readonly<World> {
		return this.agents;
	}

	worldSettings(): Readonly<Settings> {
		return this.settings;
	}

	// The chance one infectious agent infects one susceptible contact in one
	// tick, before masks, lockdown and so on: p = R0 / (c x D).
	//
	// c is the expected number of contacts per tick: the other N - 1 agents
	// times the share of the world that lies inside the contact radius (or
	// all of them when fully mixed). D is the infectious period in ticks. An
	// infectious agent then makes p x c x D = R0 infections on average in a
	// fully susceptible population, whatever the setting: density and
	// movement change how fast it spreads, not what R0 means.
	chancePerContact(): number {
		const { agents, worldSize, contactRadius, fullyMixed } = this.settings;
		const area = worldSize * worldSize;
		const contacts = fullyMixed ? agents - 1 : ((agents - 1) * Math.PI * contactRadius * contactRadius) / area;
		const infectiousTicks = this.params.infectiousDays * TICKS_PER_DAY;
		if (contacts <= 0 || infectiousTicks <= 0) return 0;
		// Very small, sparse worlds can push p above 1; a chance cannot be.
		return Math.min(1, this.params.r0 / (contacts * infectiousTicks));
	}

	// --- Movement -----------------------------------------------------------

	private move(): void {
		const { x, y, state, asymptomatic } = this.agents;
		const size = this.settings.worldSize;
		let speed = this.settings.speed;
		if (this.lockdownActive()) speed *= LOCKDOWN_MOVEMENT;
		const symptomaticSpeed = speed * (1 - this.params.selfIsolation);

		for (let i = 0; i < this.n; i++) {
			if (state[i] === State.Dead || this.isIsolated(i)) continue;
			const symptomatic = state[i] === State.Infectious && asymptomatic[i] === 0;
			const distance = symptomatic ? symptomaticSpeed : speed;
			if (this.random.chance(TURN_CHANCE)) this.pickDirection(i);
			x[i] = wrap(x[i] + this.dirX[i] * distance, size);
			y[i] = wrap(y[i] + this.dirY[i] * distance, size);
		}
	}

	private pickDirection(i: number): void {
		const angle = this.random.uniform(0, 2 * Math.PI);
		this.dirX[i] = Math.cos(angle);
		this.dirY[i] = Math.sin(angle);
	}

	// --- Disease states -------------------------------------------------------

	// Count down each agent's timer and move it on when the timer runs out.
	private advanceTimers(): void {
		const { state, timer } = this.agents;
		const waning = this.params.immunityDays !== null;

		for (let i = 0; i < this.n; i++) {
			if (state[i] === State.Exposed) {
				timer[i]--;
				if (timer[i] <= 0) this.becomeInfectious(i);
			} else if (state[i] === State.Infectious) {
				timer[i]--;
				if (timer[i] <= 0) this.endInfection(i);
			} else if (state[i] === State.Recovered && waning) {
				if (timer[i] < 0) {
					// Recovered while immunity was lifelong, and waning immunity
					// has since been switched on: start the clock now.
					timer[i] = this.immunityTicks();
				} else {
					timer[i]--;
					if (timer[i] <= 0) this.becomeSusceptible(i);
				}
			}
		}
	}

	private becomeSusceptible(i: number): void {
		this.agents.state[i] = State.Susceptible;
		this.agents.timer[i] = 0;
	}

	private becomeExposed(i: number): void {
		this.infections++;
		this.agents.state[i] = State.Exposed;
		this.agents.timer[i] = this.stay(this.params.incubationDays);
		this.agents.asymptomatic[i] = this.random.chance(this.params.shareAsymptomatic) ? 1 : 0;
	}

	private becomeInfectious(i: number): void {
		this.agents.state[i] = State.Infectious;
		this.agents.timer[i] = this.stay(this.params.infectiousDays);
		// Only cases with symptoms go for a test.
		const tested = this.agents.asymptomatic[i] === 0 && this.random.chance(this.params.testing);
		this.isolateAt[i] = tested ? this.tick + TEST_DELAY_TICKS : -1;
	}

	private endInfection(i: number): void {
		if (this.random.chance(this.params.fatality)) {
			this.agents.state[i] = State.Dead;
			this.agents.timer[i] = 0;
		} else {
			this.becomeRecovered(i);
		}
	}

	private becomeRecovered(i: number): void {
		this.agents.state[i] = State.Recovered;
		this.agents.timer[i] = this.immunityTicks();
	}

	// Ticks of immunity for one agent, or -1 when immunity is lifelong.
	private immunityTicks(): number {
		if (this.params.immunityDays === null) return -1;
		return this.stay(this.params.immunityDays);
	}

	// Length of one stay, in ticks, drawn around the dial value in days.
	private stay(days: number): number {
		const factor = this.random.uniform(STAY_MIN, STAY_MAX);
		return Math.max(1, Math.round(days * TICKS_PER_DAY * factor));
	}

	private lockdownActive(): boolean {
		const lockdownDay = this.params.lockdownDay;
		return lockdownDay !== null && this.tick / TICKS_PER_DAY >= lockdownDay;
	}

	// A tested case, once its result is in, stays home: it neither moves nor
	// meets anyone until it recovers.
	private isIsolated(i: number): boolean {
		const from = this.isolateAt[i];
		return this.agents.state[i] === State.Infectious && from >= 0 && this.tick >= from;
	}

	// --- Infection --------------------------------------------------------------

	private spread(): void {
		const p = this.chancePerContact();
		if (p === 0) return;
		if (this.settings.fullyMixed) this.spreadFullyMixed(p);
		else this.spreadByContact(p);
	}

	// The chance that infectious agent i infects one susceptible contact this
	// tick: p scaled down by masks, missing symptoms, lockdown and isolation.
	private infectionChance(i: number, p: number): number {
		if (this.isIsolated(i)) return 0;
		let chance = p * (1 - this.params.masks);
		if (this.agents.asymptomatic[i] === 1) chance *= this.params.asymptomaticInfectiousness;
		if (this.lockdownActive()) chance *= LOCKDOWN_CONTACT;
		return chance;
	}

	// Fully mixed: every infectious agent is a contact of every other agent.
	// A susceptible agent stays healthy only if it escapes every infectious
	// agent, so its chance of escaping this tick is the product of
	// (1 - chance) over all infectious agents. That product is the same for
	// every susceptible agent, so it is worked out once per tick. This takes
	// N steps instead of the N x N of checking every pair.
	private spreadFullyMixed(p: number): void {
		const state = this.agents.state;
		let escape = 1;
		for (let j = 0; j < this.n; j++) {
			if (state[j] === State.Infectious) escape *= 1 - this.infectionChance(j, p);
		}
		if (escape === 1) return;

		const infect = 1 - escape;
		for (let i = 0; i < this.n; i++) {
			if (state[i] === State.Susceptible && this.random.chance(infect)) this.becomeExposed(i);
		}
	}

	// Spatial: an infectious agent meets the susceptible agents inside its
	// contact radius. The grid means it only has to look at 9 cells instead of
	// the whole population.
	private spreadByContact(p: number): void {
		this.buildGrid();
		const { x, y, state } = this.agents;
		const { cellStart, cellAgents, cellsPerSide } = this;
		const size = this.settings.worldSize;
		const radiusSquared = this.settings.contactRadius * this.settings.contactRadius;
		const reach = cellsPerSide >= 3 ? 1 : 0;

		for (let j = 0; j < this.n; j++) {
			if (state[j] !== State.Infectious) continue;
			const chance = this.infectionChance(j, p);
			if (chance <= 0) continue;
			const cellX = this.cellOf(x[j]);
			const cellY = this.cellOf(y[j]);

			for (let dy = -reach; dy <= reach; dy++) {
				for (let dx = -reach; dx <= reach; dx++) {
					// The world wraps, so the grid does too.
					const cx = (cellX + dx + cellsPerSide) % cellsPerSide;
					const cy = (cellY + dy + cellsPerSide) % cellsPerSide;
					const cell = cy * cellsPerSide + cx;

					for (let k = cellStart[cell]; k < cellStart[cell + 1]; k++) {
						const i = cellAgents[k];
						// Skip agents someone else already infected this tick.
						if (state[i] !== State.Susceptible) continue;
						const ddx = wrappedDistance(x[i], x[j], size);
						const ddy = wrappedDistance(y[i], y[j], size);
						if (ddx * ddx + ddy * ddy > radiusSquared) continue;
						if (this.random.chance(chance)) this.becomeExposed(i);
					}
				}
			}
		}
	}

	// Sort the susceptible agents into grid cells. Only they can be infected,
	// so they are the only ones an infectious agent has to look for.
	//
	// This is a counting sort: count the agents in each cell, turn the counts
	// into start positions, then put each agent in its cell's next free slot.
	// Afterwards the agents in cell c are
	// cellAgents[cellStart[c]] up to (not including) cellAgents[cellStart[c + 1]].
	private buildGrid(): void {
		const { x, y, state } = this.agents;
		const { cellStart, cellNext, cellAgents, agentCell, cellsPerSide } = this;
		const cellCount = cellsPerSide * cellsPerSide;

		cellStart.fill(0);
		for (let i = 0; i < this.n; i++) {
			if (state[i] !== State.Susceptible) continue;
			const cell = this.cellOf(y[i]) * cellsPerSide + this.cellOf(x[i]);
			agentCell[i] = cell;
			cellStart[cell + 1]++;
		}
		for (let c = 0; c < cellCount; c++) cellStart[c + 1] += cellStart[c];

		cellNext.set(cellStart.subarray(0, cellCount));
		for (let i = 0; i < this.n; i++) {
			if (state[i] !== State.Susceptible) continue;
			const cell = agentCell[i];
			cellAgents[cellNext[cell]] = i;
			cellNext[cell]++;
		}
	}

	// Grid column (or row) of a coordinate. The min() guards against a
	// coordinate that rounded up to exactly worldSize.
	private cellOf(coordinate: number): number {
		return Math.min(this.cellsPerSide - 1, Math.floor(coordinate / this.cellSize));
	}

	// Fisher-Yates shuffle of 0 .. N-1.
	private shuffledAgents(): Int32Array {
		const order = new Int32Array(this.n);
		for (let i = 0; i < this.n; i++) order[i] = i;
		for (let i = this.n - 1; i > 0; i--) {
			const j = this.random.int(i + 1);
			const swap = order[i];
			order[i] = order[j];
			order[j] = swap;
		}
		return order;
	}
}

// Keep a coordinate inside [0, size) after a step: walking off one edge
// brings you back on the opposite edge. Steps are always shorter than the
// world, so one correction is enough.
function wrap(value: number, size: number): number {
	if (value >= size) return value - size;
	if (value < 0) return value + size;
	return value;
}

// Distance from b to a along one axis on a world that wraps: never more than
// half the world, because going the other way round is shorter.
function wrappedDistance(a: number, b: number, size: number): number {
	let d = a - b;
	if (d > size / 2) d -= size;
	else if (d < -size / 2) d += size;
	return d;
}
