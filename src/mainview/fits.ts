// The fits R has made this session, shared by the History and Simulate
// tabs (index.ts makes one cache and hands it to both). No DOM, so it can be
// tested with a fake runner (fits.test.ts).
//
// A fit asked for while one for the same outbreak is still running gets the
// same promise, so pressing fit in History and loading into Simulate start
// one Rscript between them, and a double click never starts two.
//
// Only successes are kept. A failure can be R or one of its packages not
// being installed yet, which the user may fix while the app runs, so the
// next try asks R again. Nothing is kept on disk: a fit depends on fit.R,
// parameters.R, the epiparameter version and the data, and a stale file
// would quietly show an old estimate. Outbreak ids are unique (import.R
// refuses one that exists), so the id is a safe key; a built-in dataset
// refetched while the app runs keeps its old fit until the app restarts.
import { type Fit, type FitResult, explainRError, fitFromRun } from "../shared/fit";
import type { RResult } from "../shared/rpc";

export interface FitCache {
	// The fit for an outbreak, from R or from earlier this session. name is
	// the outbreak's name, for the error message. Never rejects: a failure is
	// { ok: false } with text ready to show.
	get(id: string, name: string): Promise<FitResult>;
	// The fit if one has already succeeded, for drawing it at once.
	peek(id: string): Fit | undefined;
	// Called with the outbreak's id whenever a fit succeeds, whichever tab
	// asked for it, so the other tab can show it too.
	onFitted(listener: (id: string) => void): void;
}

// run asks R to fit one outbreak: runR with fit.R --outbreak <id>.
//
// Fits of different outbreaks run one after the other, never side by side
// ("fit both" in compare mode asks for two). Each fit is short, two at once
// only compete for the same CPU, and once, while several Rscripts ran at
// the same time during development, one returned another incubation period
// for flu; it never happened again, but one at a time rules it out.
export function fitCache(run: (id: string) => Promise<RResult>): FitCache {
	const requests = new Map<string, Promise<FitResult>>();
	const settled = new Map<string, Fit>();
	const listeners: ((id: string) => void)[] = [];
	// The last fit started; the next one waits for it.
	let queue: Promise<unknown> = Promise.resolve();

	return {
		get(id, name) {
			const known = requests.get(id);
			if (known) return known;
			const turn = queue.then(() => run(id));
			queue = turn.catch(() => undefined);
			const request = turn
				.then((result) => fitFromRun(result, name))
				.catch((err: unknown): FitResult => ({
					ok: false,
					error: explainRError(err instanceof Error ? err.message : String(err)),
				}))
				.then((result) => {
					if (result.ok) {
						settled.set(id, result.fit);
						// Outside this promise, so a listener that throws cannot turn
						// a fit into a rejection.
						for (const listener of listeners) queueMicrotask(() => listener(id));
					} else {
						requests.delete(id);
					}
					return result;
				});
			requests.set(id, request);
			return request;
		},
		peek(id) {
			return settled.get(id);
		},
		onFitted(listener) {
			listeners.push(listener);
		},
	};
}
