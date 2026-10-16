// The agent-based model. Runs inside the Web Worker (worker.ts), never on the
// UI thread, so it can be tested on its own with `hutch run test`.
import type { Agent, Counts, Params, Settings } from "./types";

export class Engine {
	private tick = 0;
	private agents: Agent[] = [];

	constructor(
		private settings: Settings,
		private params: Params,
	) {
		// TODO: place settings.agents agents at random (seeded) positions,
		// vaccinate params.vaccinationCoverage of them, infect
		// settings.initialInfected.
	}

	// One tick = one simulated hour: move agents, find contacts, infect,
	// advance timers.
	step(): void {
		// TODO
		this.tick++;
	}

	// Picked up on the next tick.
	setParam<K extends keyof Params>(key: K, value: Params[K]): void {
		this.params[key] = value;
	}

	counts(): Counts {
		// TODO: count agents per state
		return [this.agents.length, 0, 0, 0, 0];
	}

	// True when nobody is Exposed or Infectious.
	done(): boolean {
		// TODO
		return false;
	}

	currentTick(): number {
		return this.tick;
	}

	world(): readonly Agent[] {
		return this.agents;
	}

	worldSettings(): Readonly<Settings> {
		return this.settings;
	}
}
