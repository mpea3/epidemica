import { describe, expect, test } from "bun:test";
import { guessDateFormat, idFromName } from "./importing";

describe("guessDateFormat", () => {
	test("ISO dates", () => {
		expect(guessDateFormat(["2020-03-01", "2020-03-02"])).toBe("%Y-%m-%d");
	});

	test("day first unless a date only works month first", () => {
		expect(guessDateFormat(["01-03-2020", "28-02-2020"])).toBe("%d-%m-%Y");
		expect(guessDateFormat(["03/04/2020"])).toBe("%d/%m/%Y");
		expect(guessDateFormat(["03/04/2020", "03/14/2020"])).toBe("%m/%d/%Y");
	});

	test("empty values are skipped and unknown shapes fall back to ISO", () => {
		expect(guessDateFormat(["", "05.01.2020"])).toBe("%d.%m.%Y");
		expect(guessDateFormat(["week 3"])).toBe("%Y-%m-%d");
		expect(guessDateFormat([])).toBe("%Y-%m-%d");
	});
});

describe("idFromName", () => {
	test("only a-z, 0-9 and _", () => {
		expect(idFromName("COVID-19, my town 2025")).toBe("covid_19_my_town_2025");
		expect(idFromName("  Grippe à Zürich ")).toBe("grippe_a_zurich");
	});
});
