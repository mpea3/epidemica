import { describe, expect, test } from "bun:test";
import { Engine } from "./engine";
import type { Params, Settings } from "./types";

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

describe("engine", () => {
	test("step advances one tick", () => {
		const e = new Engine(settings, { ...params });
		e.step();
		expect(e.currentTick()).toBe(1);
	});

	test("SIR final size reference", () => {
		expect(finalSize(2.5)).toBeCloseTo(0.893, 3);
	});

	// The acceptance check from the README: 20 seeded, fully mixed runs of
	// 5,000 agents, mean attack rate within 5% of finalSize(r0).
	test.todo("attack rate matches the SIR final size", () => {});
});
