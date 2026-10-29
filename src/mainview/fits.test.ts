import { describe, expect, test } from "bun:test";
import type { RResult } from "../shared/rpc";
import { fitCache } from "./fits";

// Enough of fit.R's output for parseFit.
const FIT = {
	ok: true,
	outbreak: "flu1918",
	disease: "Influenza",
	r0: 1.347,
	r0_ci: [1.279, 1.418],
	r0_window: ["1918-09-01", "1918-10-10"],
	r0_window_auto: false,
	growth_rate: 0.1258,
	growth_rate_ci: [0.1027, 0.149],
	growth_intercept: 1.0895,
	rt: [],
	params: { incubationDays: 1.46, infectiousDays: 4, serialIntervalMean: 2.51, serialIntervalSd: 1.55 },
	sources: { serialInterval: "Ghani et al. 2009", incubation: null, infectious: null },
	note: null,
};

// A runner whose replies the test hands out one at a time, counting calls.
function fakeRunner() {
	const pending: ((result: RResult) => void)[] = [];
	const failures: ((err: Error) => void)[] = [];
	let calls = 0;
	const run = (_id: string) =>
		new Promise<RResult>((resolve, reject) => {
			calls++;
			pending.push(resolve);
			failures.push(reject);
		});
	return {
		run,
		calls: () => calls,
		reply: (result: RResult) => {
			failures.shift();
			pending.shift()!(result);
		},
		reject: (err: Error) => {
			pending.shift();
			failures.shift()!(err);
		},
	};
}

// Fits wait their turn in a queue, so R is asked a moment after get().
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("fit cache", () => {
	test("two gets at once make one call to R", async () => {
		const runner = fakeRunner();
		const fits = fitCache(runner.run);
		const a = fits.get("flu1918", "Flu");
		const b = fits.get("flu1918", "Flu");
		await settle();
		expect(runner.calls()).toBe(1);
		runner.reply({ ok: true, data: FIT });
		const [first, second] = await Promise.all([a, b]);
		expect(first.ok && first.fit.r0).toBe(1.347);
		expect(second).toBe(first);
		// And after it is done, still no second call.
		await fits.get("flu1918", "Flu");
		expect(runner.calls()).toBe(1);
	});

	test("peek is empty while R runs and set after a success", async () => {
		const runner = fakeRunner();
		const fits = fitCache(runner.run);
		const request = fits.get("flu1918", "Flu");
		await settle();
		expect(fits.peek("flu1918")).toBeUndefined();
		runner.reply({ ok: true, data: FIT });
		await request;
		expect(fits.peek("flu1918")?.r0).toBe(1.347);
		expect(fits.peek("measles1861")).toBeUndefined();
	});

	test("R's refusal is not kept", async () => {
		const runner = fakeRunner();
		const fits = fitCache(runner.run);
		const request = fits.get("mine", "My import");
		await settle();
		runner.reply({ ok: true, data: { ok: false, error: "no serial interval" } });
		expect(await request).toEqual({ ok: false, error: "R could not fit My import: no serial interval" });
		expect(fits.peek("mine")).toBeUndefined();
		fits.get("mine", "My import");
		await settle();
		expect(runner.calls()).toBe(2);
	});

	test("Rscript failing to run is not kept", async () => {
		const runner = fakeRunner();
		const fits = fitCache(runner.run);
		const request = fits.get("flu1918", "Flu");
		await settle();
		runner.reply({ ok: false, error: "spawn Rscript ENOENT" });
		const result = await request;
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error).toStartWith("Rscript was not found");
		fits.get("flu1918", "Flu");
		await settle();
		expect(runner.calls()).toBe(2);
	});

	test("a rejected request becomes an error and is not kept", async () => {
		const runner = fakeRunner();
		const fits = fitCache(runner.run);
		const request = fits.get("flu1918", "Flu");
		await settle();
		runner.reject(new Error("RPC request timed out"));
		expect(await request).toEqual({ ok: false, error: "RPC request timed out" });
		expect(fits.peek("flu1918")).toBeUndefined();
		const retry = fits.get("flu1918", "Flu");
		await settle();
		expect(runner.calls()).toBe(2);
		runner.reply({ ok: true, data: FIT });
		expect((await retry).ok).toBe(true);
	});

	test("listeners hear of each fit that succeeds, not of failures", async () => {
		const runner = fakeRunner();
		const fits = fitCache(runner.run);
		const heard: string[] = [];
		fits.onFitted((id) => heard.push(id));
		const failed = fits.get("mine", "My import");
		await settle();
		runner.reply({ ok: true, data: { ok: false, error: "no serial interval" } });
		await failed;
		const flu = fits.get("flu1918", "Flu");
		await settle();
		runner.reply({ ok: true, data: FIT });
		await flu;
		await settle();
		expect(heard).toEqual(["flu1918"]);
	});

	test("two outbreaks are fitted one after the other", async () => {
		const runner = fakeRunner();
		const fits = fitCache(runner.run);
		const flu = fits.get("flu1918", "Flu");
		const measles = fits.get("measles1861", "Measles");
		await settle();
		// The second waits for the first, even when the first fails.
		expect(runner.calls()).toBe(1);
		runner.reply({ ok: false, error: "spawn Rscript ENOENT" });
		await flu;
		await settle();
		expect(runner.calls()).toBe(2);
		runner.reply({ ok: true, data: { ...FIT, outbreak: "measles1861" } });
		expect((await measles).ok).toBe(true);
	});
});
