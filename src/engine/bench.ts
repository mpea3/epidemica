// How long one tick takes, at 5,000 and 50,000 agents.
//
// Run with: hutch test ./src/engine/bench.ts
//
// (Through the test runner on purpose: `hutch src/engine/bench.ts` runs
// scripts in a mode where every use of an imported enum such as State is
// about 100 times slower, which makes the engine look far slower than it is.
// The worker bundle the app runs is one file and does not have this problem.
// The file is not called *.test.ts, so `hutch run test` skips it.)
//
// Both runs use the city density (0.5 agents per square unit), with 1% of
// agents infected at the start so the contact pass has work to do. At 60
// frames a second with one tick per frame, a tick has 16 ms; at 10 days a
// second (240 ticks a second) it has about 4 ms.
import { Engine } from "./engine";
import { DEFAULT_PARAMS } from "./presets";

function bench(agents: number, ticks: number): void {
	const worldSize = Math.sqrt(agents / 0.5);
	const engine = new Engine(
		{
			agents,
			worldSize,
			contactRadius: 1,
			speed: 0.3,
			initialInfected: agents / 100,
			seed: 1,
			fullyMixed: false,
		},
		{ ...DEFAULT_PARAMS, incubationDays: 2, infectiousDays: 5 },
	);
	// Warm up, so the JIT compiler has optimised the hot loops.
	for (let t = 0; t < 100; t++) engine.step();

	const start = performance.now();
	for (let t = 0; t < ticks; t++) engine.step();
	const msPerTick = (performance.now() - start) / ticks;

	const [s, e, i, r, d] = engine.counts();
	console.log(
		`${agents.toLocaleString("en")} agents: ${msPerTick.toFixed(3)} ms per tick ` +
			`(${Math.floor(1000 / msPerTick)} ticks/s), counts at the end S ${s} E ${e} I ${i} R ${r} D ${d}`,
	);
}

bench(5_000, 2000);
bench(50_000, 500);
