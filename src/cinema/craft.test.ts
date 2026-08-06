// The shot vocabulary.
//
// Tested as string assembly, which is what it is. The value being pinned is
// that a prompt can be read back and explained: every clause came from a named
// choice, in a known order, and nothing appears that nobody asked for.

import { describe, expect, it } from "vitest";

import {
	COMPOSITIONS,
	CRAFT_OPTIONS,
	craftClauses,
	DEFAULT_NEGATIVE,
	LENSES,
	LIGHTING,
	lightingFromTime,
	negativeClause,
	SHOT_SIZES,
	STOCKS,
	sizeFromCamera,
} from "./craft";

describe("the preset tables", () => {
	it("offers every option it documents", () => {
		expect(CRAFT_OPTIONS.size).toEqual(Object.keys(SHOT_SIZES));
		expect(CRAFT_OPTIONS.lens).toEqual(Object.keys(LENSES));
		expect(CRAFT_OPTIONS.lighting).toEqual(Object.keys(LIGHTING));
		expect(CRAFT_OPTIONS.stock).toEqual(Object.keys(STOCKS));
		expect(CRAFT_OPTIONS.composition).toEqual(Object.keys(COMPOSITIONS));
	});

	it("describes every preset in words a model can use", () => {
		// A preset whose value is one word is a preset that does nothing — the
		// model already knows "close-up" and needs to be told what that means
		// for framing.
		for (const table of [SHOT_SIZES, LENSES, LIGHTING, STOCKS, COMPOSITIONS]) {
			for (const [key, phrase] of Object.entries(table)) {
				expect(phrase.split(/\s+/).length, `${key} is too terse`).toBeGreaterThan(3);
			}
		}
	});
});

describe("craftClauses", () => {
	it("adds nothing when nothing was chosen", () => {
		expect(craftClauses({})).toEqual([]);
	});

	it("keeps framing before optics before light", () => {
		// The order is load-bearing: models weight earlier tokens more, and each
		// of these constrains the ones after it.
		const clauses = craftClauses({
			stock: "portra",
			lighting: "noir",
			lens: "85mm",
			composition: "thirds",
			size: "close",
		});
		expect(clauses).toEqual([
			SHOT_SIZES.close,
			COMPOSITIONS.thirds,
			LENSES["85mm"],
			LIGHTING.noir,
			STOCKS.portra,
		]);
	});

	it("carries a palette as a named instruction", () => {
		const clauses = craftClauses({ palette: "rust, sea green, bone" });
		expect(clauses).toEqual(["Colour palette: rust, sea green, bone."]);
	});

	it("ignores a palette that is only whitespace", () => {
		expect(craftClauses({ palette: "   " })).toEqual([]);
	});

	describe("reference strength", () => {
		it("demands an exact match at the top of the range", () => {
			expect(craftClauses({ referenceStrength: 1 })[0]).toMatch(/exactly/);
		});

		it("asks only for recognisable in the middle", () => {
			expect(craftClauses({ referenceStrength: 0.6 })[0]).toMatch(/recognisably/);
		});

		it("treats a low value as a type reference, not a likeness", () => {
			expect(craftClauses({ referenceStrength: 0.1 })[0]).toMatch(/loosely|type/);
		});

		it("says something at zero rather than falling silent", () => {
			// Zero is a choice, not an absence. Dropping the clause would make it
			// indistinguishable from never setting the control.
			expect(craftClauses({ referenceStrength: 0 })).toHaveLength(1);
		});
	});
});

describe("negativeClause", () => {
	it("always forbids the artefacts that make a still unusable", () => {
		expect(negativeClause({})).toBe(DEFAULT_NEGATIVE);
		expect(DEFAULT_NEGATIVE).toMatch(/watermark/);
		expect(DEFAULT_NEGATIVE).toMatch(/border/);
	});

	it("appends what this shot also forbids", () => {
		expect(negativeClause({ negative: "no modern cars" })).toContain("no modern cars.");
	});

	it("does not double a full stop", () => {
		expect(negativeClause({ negative: "no rain." })).not.toContain("rain..");
	});
});

describe("sizeFromCamera", () => {
	it.each([
		["wide establishing, static", "establishing"],
		["close on their hands", "close"],
		["extreme close on the ring", "extreme"],
		["medium, slow push", "medium"],
		["over the shoulder, favouring her", "over-shoulder"],
		["a two-shot across the table", "two-shot"],
		["insert of the letter", "insert"],
		["aerial looking straight down", "aerial"],
	])("reads %s as %s", (camera, expected) => {
		expect(sizeFromCamera(camera)).toBe(expected);
	});

	it("prefers the more specific reading when both words appear", () => {
		// "extreme close" contains "close". Matching the looser one first would
		// silently downgrade every extreme close-up in the film.
		expect(sizeFromCamera("extreme close-up of an eye")).toBe("extreme");
		expect(sizeFromCamera("wide establishing shot")).toBe("establishing");
	});

	it("returns nothing rather than guessing", () => {
		expect(sizeFromCamera("the camera does something unusual")).toBeUndefined();
	});
});

describe("lightingFromTime", () => {
	it.each([
		["golden hour", "golden-hour"],
		["dusk", "golden-hour"],
		["night", "moonlight"],
		["overcast morning", "overcast"],
		["twilight", "blue-hour"],
	])("reads %s as %s", (time, expected) => {
		expect(lightingFromTime(time)).toBe(expected);
	});

	it("returns nothing for a time it cannot place", () => {
		expect(lightingFromTime("some time later")).toBeUndefined();
	});
});
