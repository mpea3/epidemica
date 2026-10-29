import { describe, expect, test } from "bun:test";
import { Engine } from "./engine";
import { generationTimeDays, modelGrowthRate, startingR } from "./growth";
import { DEFAULT_PARAMS } from "./presets";
import { type Params, TICKS_PER_DAY } from "./types";

// The fitted values R returns for two of the built-in outbreaks.
const FLU = { r0: 1.347, incubationDays: 1.46, infectiousDays: 4 };
const EBOLA_SL = { r0: 1.358, incubationDays: 10.3, infectiousDays: 5.6 };

// The engine's stays, by the midpoint rule: stay factors u (incubation) and
// v (infectious) on 0.5..1.5, and w, how far into the infectious stay an
// infection happens, on 0..1. A case with factor v makes R x v infections,
// spread evenly over its stay. Returns the average of f(tau) over all the
// infections, tau being days from the infector's own infection.
function overInfections(a: number, b: number, f: (tau: number) => number, steps = 120): number {
	let total = 0;
	let weight = 0;
	for (let i = 0; i < steps; i++) {
		const u = 0.5 + (i + 0.5) / steps;
		for (let j = 0; j < steps; j++) {
			const v = 0.5 + (j + 0.5) / steps;
			for (let k = 0; k < steps; k++) {
				const w = (k + 0.5) / steps;
				total += v * f(a * u + b * v * w);
				weight += v;
			}
		}
	}
	return total / weight;
}

// The Euler-Lotka equation as the design writes it, to check the root.
function m(r: number, x: number): number {
	return (Math.exp(-0.5 * x * r) - Math.exp(-1.5 * x * r)) / (x * r);
}

function residual(R: number, a: number, b: number, r: number): number {
	return (R * m(r, a) * (1 - m(r, b))) / (r * b) - 1;
}

describe("generation time", () => {
	test("incubation + 13/24 of the infectious period", () => {
		expect(generationTimeDays(5, 7)).toBeCloseTo(5 + 91 / 24, 12);
		expect(generationTimeDays(0, 24)).toBeCloseTo(13, 12);
	});

	test("agrees with integrating over the engine's stays", () => {
		const integrated = overInfections(5, 7, (tau) => tau);
		expect(integrated).toBeCloseTo(generationTimeDays(5, 7), 3);
	});
});

describe("starting R", () => {
	test("the defaults: a case without symptoms counts half", () => {
		// 2.5 x (1 - 0.3 x (1 - 0.5))
		expect(startingR(DEFAULT_PARAMS)).toBeCloseTo(2.125, 12);
	});

	test("masks, a lockdown from day 0 and vaccination cut it", () => {
		const base: Params = { ...DEFAULT_PARAMS, shareAsymptomatic: 0 };
		expect(startingR(base)).toBeCloseTo(2.5, 12);
		expect(startingR({ ...base, masks: 0.4 })).toBeCloseTo(1.5, 12);
		expect(startingR({ ...base, lockdownDay: 0 })).toBeCloseTo(0.75, 12);
		expect(startingR({ ...base, vaccinationCoverage: 0.6 })).toBeCloseTo(1, 12);
	});

	test("a later lockdown and testing do not count", () => {
		expect(startingR({ ...DEFAULT_PARAMS, lockdownDay: 20 })).toBe(startingR(DEFAULT_PARAMS));
		expect(startingR({ ...DEFAULT_PARAMS, testing: 0.8 })).toBe(startingR(DEFAULT_PARAMS));
	});
});

describe("model growth rate", () => {
	test("R = 1 does not grow, R below 1 shrinks", () => {
		expect(modelGrowthRate(1, 5, 7)).toBeCloseTo(0, 12);
		expect(modelGrowthRate(0.8, 5, 7)).toBeLessThan(0);
		expect(modelGrowthRate(2.5, 5, 7)).toBeGreaterThan(0);
	});

	test("solves the Euler-Lotka equation", () => {
		for (const [R, a, b] of [
			[2.5, 5, 7],
			[0.8, 5, 7],
			[1.347, 1.46, 4],
			[3.193, 12.77, 8],
			[20, 0.5, 1],
		]) {
			const r = modelGrowthRate(R, a, b);
			expect(Math.abs(residual(R, a, b, r))).toBeLessThan(1e-9);
		}
	});

	test("agrees with integrating over the engine's stays", () => {
		// Each infection's own infector was e^(-r tau) times as common: on
		// average that discount times R is 1 when r is the growth rate.
		const { r0, incubationDays, infectiousDays } = FLU;
		const r = modelGrowthRate(r0, incubationDays, infectiousDays);
		const integrated = r0 * overInfections(incubationDays, infectiousDays, (tau) => Math.exp(-r * tau));
		expect(integrated).toBeCloseTo(1, 4);
	});

	test("the fitted flu and Ebola values", () => {
		const flu = modelGrowthRate(FLU.r0, FLU.incubationDays, FLU.infectiousDays);
		const ebola = modelGrowthRate(EBOLA_SL.r0, EBOLA_SL.incubationDays, EBOLA_SL.infectiousDays);
		expect(Math.LN2 / flu).toBeCloseTo(8.2, 1);
		expect(Math.LN2 / ebola).toBeCloseTo(29.9, 1);
	});

	// The check that the arithmetic is the engine's: 10 seeded, fully mixed
	// runs, each fitted with a straight line through the log of its daily
	// infections from day 10 (the 50 first cases start out infectious and
	// need a couple of generations to settle) to day 30. 50,000 agents keep
	// the share infected under 5% by then; with 20,000 it reaches 10% and
	// running out of people already bends the line down by 7%.
	test("the engine grows at that rate", () => {
		const agents = 50_000;
		const runs = 10;
		const expected = modelGrowthRate(1.5, 3, 4);
		let total = 0;
		for (let seed = 1; seed <= runs; seed++) {
			const e = new Engine(
				{ agents, worldSize: 100, contactRadius: 1, speed: 0.2, initialInfected: 50, seed, fullyMixed: true },
				{
					...DEFAULT_PARAMS,
					r0: 1.5,
					incubationDays: 3,
					infectiousDays: 4,
					asymptomaticInfectiousness: 1,
					fatality: 0,
				},
			);
			const days: number[] = [];
			const logs: number[] = [];
			for (let day = 0; day <= 30; day++) {
				const before = e.infectionsSoFar();
				for (let t = 0; t < TICKS_PER_DAY; t++) e.step();
				const infections = e.infectionsSoFar() - before;
				if (day >= 10 && infections > 0) {
					days.push(day);
					logs.push(Math.log(infections));
				}
			}
			expect(e.infectionsSoFar() / agents).toBeLessThan(0.05);
			total += slope(days, logs);
		}
		const mean = total / runs;
		console.log(`growth rate: engine ${mean.toFixed(4)} per day, Euler-Lotka ${expected.toFixed(4)}`);
		expect(Math.abs(mean - expected) / expected).toBeLessThan(0.1);
	}, 60_000);
});

// Least-squares slope of y against x.
function slope(x: number[], y: number[]): number {
	const mx = x.reduce((a, b) => a + b, 0) / x.length;
	const my = y.reduce((a, b) => a + b, 0) / y.length;
	let sxy = 0;
	let sxx = 0;
	for (let i = 0; i < x.length; i++) {
		sxy += (x[i] - mx) * (y[i] - my);
		sxx += (x[i] - mx) ** 2;
	}
	return sxy / sxx;
}
