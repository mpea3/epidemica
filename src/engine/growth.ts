// The model's own early growth, worked out on paper instead of by running
// it. History fits R0 from how fast reported cases grew; these say how fast
// the simulator would grow with the same dials, so the two can be set side
// by side (the growth check under the Simulate chart).
//
// All of it holds for the fully mixed model early on, while nearly everyone
// is still susceptible, with testing and isolation left out. Agents walking
// in a world keep meeting the same neighbours and use them up, so a spatial
// run grows more slowly than this. Stays are rounded to whole hours in the
// engine; that is ignored here.
import { LOCKDOWN_CONTACT, STAY_MAX, STAY_MIN } from "./engine";
import type { Params } from "./types";

// A stay lasts the dial value times a factor V, uniform on STAY_MIN..STAY_MAX.
// E[V^k], the k-th moment of that factor.
function stayMoment(k: number): number {
	return (STAY_MAX ** (k + 1) - STAY_MIN ** (k + 1)) / ((k + 1) * (STAY_MAX - STAY_MIN));
}

// Average days from being infected to infecting someone else, for one
// infection the model passes on.
//
// That time is the incubation stay E, then a moment s inside the infectious
// stay I. Infectiousness is constant during the stay, so s is anywhere in
// 0..I with the same chance, on average I / 2. But a case that stays
// infectious twice as long also infects twice as many people, so long stays
// count more: the average of s is E[I^2] / (2 E[I]), not E[I] / 2.
//
// With V on 0.5..1.5, E[V] = 1 and E[V^2] = 13/12, which gives
// incubation + 13/24 of the infectious period.
export function generationTimeDays(incubationDays: number, infectiousDays: number): number {
	return incubationDays * stayMoment(1) + (infectiousDays * stayMoment(2)) / (2 * stayMoment(1));
}

// R on day 0 of a run: R0 cut by everything that already works then.
//
// - Masks cut every contact's chance.
// - A case without symptoms passes it on at asymptomaticInfectiousness times
//   the chance, and shareAsymptomatic of cases have none.
// - A lockdown from day 0 cuts the chance to LOCKDOWN_CONTACT.
// - Vaccinated agents start immune, so only the rest can be infected.
//
// Testing is left out: how much it removes depends on the delay against the
// infectious period, and the growth check says so instead. In a tiny, sparse
// world p is capped at 1, which would make this too high; no preset gets
// there.
export function startingR(p: Params): number {
	const symptoms = 1 - p.shareAsymptomatic * (1 - p.asymptomaticInfectiousness);
	const lockdown = p.lockdownDay !== null && p.lockdownDay <= 0 ? LOCKDOWN_CONTACT : 1;
	return p.r0 * (1 - p.masks) * symptoms * lockdown * (1 - p.vaccinationCoverage);
}

// Below this, the closed forms lose their digits to cancellation (e^-0.5z
// and e^-1.5z are almost equal), so the first terms of the Taylor series are
// used instead. Six terms leave an error far below 1e-15 there.
const SERIES_BELOW = 1e-3;
const SERIES_TERMS = 6;

// E[e^(-zV)]: how much a stay of the dial value times V discounts, when the
// dial value times the growth rate is z.
function stayDiscount(z: number): number {
	if (Math.abs(z) < SERIES_BELOW) {
		let sum = 0;
		let term = 1; // (-z)^k / k!
		for (let k = 0; k < SERIES_TERMS; k++) {
			sum += term * stayMoment(k);
			term *= -z / (k + 1);
		}
		return sum;
	}
	// e^(-min z) - e^(-max z), written with expm1 so it stays accurate.
	const difference = -Math.exp(-STAY_MIN * z) * Math.expm1(-(STAY_MAX - STAY_MIN) * z);
	return difference / ((STAY_MAX - STAY_MIN) * z);
}

// (1 - E[e^(-zV)]) / z: the infectious stay's part, see modelGrowthRate. It
// goes to E[V] = 1 as z goes to 0.
function infectiousDiscount(z: number): number {
	if (Math.abs(z) < SERIES_BELOW) {
		let sum = 0;
		let term = 1; // (-1)^(k+1) z^(k-1) / k!
		for (let k = 1; k <= SERIES_TERMS; k++) {
			term /= k;
			sum += term * stayMoment(k);
			term *= -z;
		}
		return sum;
	}
	return (1 - stayDiscount(z)) / z;
}

// The growth rate the fitted R and these periods would give: below this
// bracket the model halves in under 17 hours, above it it doubles in under
// 4, where the whole-hour stays matter more than this arithmetic does.
const LOWEST_RATE = -1;
const HIGHEST_RATE = 5;

// Growth rate r per day (cases grow as e^(rt); ln 2 / r is the doubling
// time) of the fully mixed model with starting R, solved from Euler-Lotka.
//
// While cases grow as e^(rt), the people infected tau days ago were e^(-r
// tau) times as many as those infected today. Every case today has an
// infector, so 1 = integral of e^(-r tau) x (rate at which one case infects
// others tau days after its own infection). In the model that rate is R / b
// while the case is infectious and 0 otherwise, with E = a V1 and I = b V2
// for independent stay factors V1 and V2, so
//
//   1 = R x E[e^(-rE)] x E[(1 - e^(-rI)) / (r b)]
//     = R x M(r, a) x (1 - M(r, b)) / (r b),
//   M(r, x) = E[e^(-r x V)] = (e^(-0.5 x r) - e^(-1.5 x r)) / (x r).
//
// The right side falls as r grows, so bisection finds the one root. R = 1
// gives r = 0 and R below 1 a negative r: the model shrinks.
export function modelGrowthRate(R: number, incubationDays: number, infectiousDays: number): number {
	// Nobody infects anyone: shrinking as fast as the bracket allows.
	if (R <= 0 || infectiousDays <= 0) return LOWEST_RATE;
	const residual = (r: number) =>
		R * stayDiscount(r * incubationDays) * infectiousDiscount(r * infectiousDays) - 1;

	let low = LOWEST_RATE;
	let high = HIGHEST_RATE;
	if (residual(low) <= 0) return low;
	if (residual(high) >= 0) return high;
	// 100 halvings of a 6-wide bracket is far below a double's precision.
	for (let i = 0; i < 100; i++) {
		const middle = (low + high) / 2;
		if (residual(middle) > 0) low = middle;
		else high = middle;
	}
	return (low + high) / 2;
}
