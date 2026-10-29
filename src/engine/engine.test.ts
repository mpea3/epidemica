// The engine's tests; its early growth rate is checked in growth.test.ts.
// Run each test file on its own (hutch run test does): the Cottontail test
// runner runs nothing, and still passes, when it is given more than one.
import { describe, expect, test } from "bun:test";
import { Engine } from "./engine";
import { PRESET_IDS, preset } from "./presets";
import { Random } from "./random";
import { type Counts, type Params, type Settings, State, TICKS_PER_DAY } from "./types";

const settings: Settings = {
	agents: 5000,
	worldSize: 100,
	contactRadius: 1,
	speed: 0.2,
	initialInfected: 5,
	seed: 1,
	fullyMixed: false,
};

const params: Params = {
	r0: 2.5,
	incubationDays: 5,
	infectiousDays: 7,
	shareAsymptomatic: 0,
	asymptomaticInfectiousness: 1,
	selfIsolation: 0,
	fatality: 0.01,
	immunityDays: null,
	masks: 0,
	vaccinationCoverage: 0,
	lockdownDay: null,
	testing: 0,
};

// Share of a fully mixed population an SIR epidemic infects: z = 1 - exp(-R0 z).
export function finalSize(r0: number): number {
	let z = 1;
	for (let i = 0; i < 1000; i++) z = 1 - Math.exp(-r0 * z);
	return z;
}

const sum = (counts: Counts) => counts.reduce((a, b) => a + b, 0);

// Run until nobody is Exposed or Infectious (or maxDays have passed).
function runToEnd(engine: Engine, maxDays = 2000): Engine {
	while (!engine.done() && engine.currentTick() < maxDays * TICKS_PER_DAY) engine.step();
	return engine;
}

describe("random", () => {
	test("same seed gives the same numbers", () => {
		const a = new Random(42);
		const b = new Random(42);
		for (let i = 0; i < 1000; i++) expect(a.next()).toBe(b.next());
	});

	test("different seeds give different numbers", () => {
		expect(new Random(1).next()).not.toBe(new Random(2).next());
	});

	test("numbers are in [0, 1) and average about 0.5", () => {
		const random = new Random(7);
		const n = 100_000;
		let total = 0;
		let outside = 0;
		for (let i = 0; i < n; i++) {
			const v = random.next();
			if (v < 0 || v >= 1) outside++;
			total += v;
		}
		expect(outside).toBe(0);
		expect(total / n).toBeCloseTo(0.5, 2);
	});
});

describe("engine", () => {
	test("step advances one tick", () => {
		const e = new Engine(settings, { ...params });
		e.step();
		expect(e.currentTick()).toBe(1);
	});

	test("SIR final size reference", () => {
		expect(finalSize(2.5)).toBeCloseTo(0.893, 3);
	});

	test("starts with the right number infected and vaccinated", () => {
		const e = new Engine(settings, { ...params, vaccinationCoverage: 0.3 });
		const counts = e.counts();
		expect(counts[State.Infectious]).toBe(5);
		expect(counts[State.Recovered]).toBe(1500);
		expect(counts[State.Susceptible]).toBe(3495);
	});

	test("p = R0 / (c x D)", () => {
		const e = new Engine(settings, { ...params });
		const contacts = (4999 * Math.PI * 1 * 1) / (100 * 100);
		expect(e.chancePerContact()).toBeCloseTo(2.5 / (contacts * 7 * 24), 10);
		const mixed = new Engine({ ...settings, fullyMixed: true }, { ...params });
		expect(mixed.chancePerContact()).toBeCloseTo(2.5 / (4999 * 7 * 24), 10);
	});

	test("counts always sum to N, agents stay in the world", () => {
		// Switch on every dial so every state change gets exercised.
		const busy: Params = {
			...params,
			r0: 4,
			incubationDays: 1,
			infectiousDays: 3,
			shareAsymptomatic: 0.3,
			asymptomaticInfectiousness: 0.5,
			selfIsolation: 0.5,
			fatality: 0.05,
			immunityDays: 10,
			masks: 0.2,
			vaccinationCoverage: 0.1,
			lockdownDay: 20,
			testing: 0.5,
		};
		const e = new Engine({ ...settings, agents: 2000, worldSize: 50, speed: 0.5 }, busy);
		const seen = new Set<State>();
		for (let t = 0; t < 60 * TICKS_PER_DAY; t++) {
			e.step();
			const counts = e.counts();
			expect(sum(counts)).toBe(2000);
			counts.forEach((c, s) => c > 0 && seen.add(s));
		}
		expect(seen.size).toBe(5);
		const { x, y } = e.world();
		expect(x.every((v) => v >= 0 && v <= 50)).toBe(true);
		expect(y.every((v) => v >= 0 && v <= 50)).toBe(true);
	});

	test("the same seed gives the same run", () => {
		const a = new Engine({ ...settings, seed: 9 }, { ...params });
		const b = new Engine({ ...settings, seed: 9 }, { ...params });
		const c = new Engine({ ...settings, seed: 10 }, { ...params });
		let differs = false;
		for (let t = 0; t < 30 * TICKS_PER_DAY; t++) {
			a.step();
			b.step();
			c.step();
			expect(b.counts()).toEqual(a.counts());
			if (c.counts().join() !== a.counts().join()) differs = true;
		}
		expect(b.world().x).toEqual(a.world().x);
		expect(differs).toBe(true);
	});

	test("a run ends when nobody is Exposed or Infectious", () => {
		const e = runToEnd(new Engine({ ...settings, agents: 500 }, { ...params, infectiousDays: 2 }));
		const counts = e.counts();
		expect(e.done()).toBe(true);
		expect(counts[State.Exposed] + counts[State.Infectious]).toBe(0);
	});

	test("infections are counted, the first cases included", () => {
		const e = new Engine({ ...settings, agents: 1000 }, { ...params });
		expect(e.infectionsSoFar()).toBe(5);
		runToEnd(e);
		// Lifelong immunity: nobody is infected twice, so everyone who left
		// Susceptible was infected exactly once.
		expect(e.infectionsSoFar()).toBe(1000 - e.counts()[State.Susceptible]);
	});

	test("every preset runs", () => {
		for (const id of PRESET_IDS) {
			const { settings: s, params: p } = preset(id);
			const e = new Engine(s, p);
			for (let t = 0; t < 5 * TICKS_PER_DAY; t++) e.step();
			expect(sum(e.counts())).toBe(s.agents);
			// preset() hands out copies, so changing a dial leaves the preset alone.
			e.setParam("r0", 99);
			expect(preset(id).params.r0).not.toBe(99);
		}
	});

	// The acceptance check from the README: 20 seeded, fully mixed runs of
	// 5,000 agents, mean attack rate within 5% of finalSize(r0). The final
	// size does not depend on how long people stay ill, so short stays keep
	// the test fast.
	for (const r0 of [1.8, 2.5, 4]) {
		test(`attack rate matches the SIR final size at R0 ${r0}`, () => {
			const runs = 20;
			let total = 0;
			for (let seed = 1; seed <= runs; seed++) {
				const e = new Engine(
					{ ...settings, seed, fullyMixed: true },
					{ ...params, r0, incubationDays: 1, infectiousDays: 2, fatality: 0 },
				);
				runToEnd(e);
				const counts = e.counts();
				// Everyone who is no longer Susceptible was infected at some point.
				total += 1 - counts[State.Susceptible] / settings.agents;
			}
			const mean = total / runs;
			const expected = finalSize(r0);
			console.log(`R0 ${r0}: mean attack rate ${mean.toFixed(4)}, SIR final size ${expected.toFixed(4)}`);
			expect(Math.abs(mean - expected) / expected).toBeLessThan(0.05);
		}, 60_000);
	}
});
