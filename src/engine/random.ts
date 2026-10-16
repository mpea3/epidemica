// Seeded random numbers, so the same seed always gives the same run. That
// makes runs repeatable for the tests and lets a user share a scenario.
//
// Math.random() cannot be seeded, so this is mulberry32, a small and well
// known generator (Tommy Ettinger, public domain). It keeps 32 bits of state
// and is more than random enough for a simulation, but it is not suitable for
// anything security related.
export class Random {
	private state: number;

	constructor(seed: number) {
		// >>> 0 turns any number into an unsigned 32 bit integer.
		this.state = seed >>> 0;
	}

	// A number in [0, 1), like Math.random().
	next(): number {
		// The constants and shifts are the published mulberry32 recipe: each
		// call adds a fixed step to the state, then scrambles the bits.
		this.state = (this.state + 0x6d2b79f5) >>> 0;
		let t = this.state;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	}

	// A number in [min, max).
	uniform(min: number, max: number): number {
		return min + (max - min) * this.next();
	}

	// A whole number in [0, n).
	int(n: number): number {
		return Math.floor(this.next() * n);
	}

	// True with probability p.
	chance(p: number): boolean {
		return this.next() < p;
	}
}
