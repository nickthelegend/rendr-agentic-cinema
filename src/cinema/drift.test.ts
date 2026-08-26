// The arithmetic behind the drift number.
//
// This is the part of the consistency claim that has to survive being poked at,
// so the tests are about behaviour a sceptic would check: that identical frames
// score identical, that a small change stays small, that the median does not
// let one odd shot define the whole cut, and that the outlier rule adapts to a
// film's own spread rather than a constant somebody picked.

import { describe, expect, it } from "vitest";

import { dHash, distance, driftAcross, HASH_BITS, medianHash, reduce } from "./drift";

/** An RGBA buffer painted by a function of x and y. */
function frame(
	width: number,
	height: number,
	paint: (x: number, y: number) => [number, number, number],
): Uint8ClampedArray {
	const data = new Uint8ClampedArray(width * height * 4);
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			const [r, g, b] = paint(x, y);
			const at = (y * width + x) * 4;
			data[at] = r;
			data[at + 1] = g;
			data[at + 2] = b;
			data[at + 3] = 255;
		}
	}
	return data;
}

const hashOf = (data: Uint8ClampedArray, w: number, h: number) => dHash(reduce(data, w, h));

describe("dHash", () => {
	it("produces one bit per horizontal comparison", () => {
		expect(
			hashOf(
				frame(90, 80, (x) => [x * 2, x * 2, x * 2]),
				90,
				80,
			),
		).toHaveLength(HASH_BITS);
		expect(HASH_BITS).toBe(64);
	});

	it("gives identical frames identical hashes", () => {
		const gradient = () => frame(90, 80, (x, y) => [x + y, x, y]);
		expect(distance(hashOf(gradient(), 90, 80), hashOf(gradient(), 90, 80))).toBe(0);
	});

	it("gives an inverted gradient a very different hash", () => {
		const rising = hashOf(
			frame(90, 80, (x) => [x * 2, x * 2, x * 2]),
			90,
			80,
		);
		const falling = hashOf(
			frame(90, 80, (x) => [180 - x * 2, 180 - x * 2, 180 - x * 2]),
			90,
			80,
		);
		expect(distance(rising, falling)).toBeGreaterThan(50);
	});

	it("is not fooled by a flat mean into calling red and blue the same", () => {
		// A flat average would score these identical. Luma weights are the reason
		// they do not, and that is the difference between a hash that sees a
		// picture and one that sees a number.
		const red = reduce(
			frame(90, 80, (x) => [x * 2, 0, 0]),
			90,
			80,
		);
		const blue = reduce(
			frame(90, 80, (x) => [0, 0, x * 2]),
			90,
			80,
		);
		expect([...red.pixels]).not.toEqual([...blue.pixels]);
	});

	it("refuses a grid it cannot hash rather than hashing nonsense", () => {
		expect(() => dHash({ pixels: new Uint8Array(4), width: 2, height: 2 })).toThrow(/9×8/);
	});

	it("refuses an image smaller than the grid", () => {
		expect(() => reduce(new Uint8ClampedArray(4), 1, 1)).toThrow(/smaller/i);
	});
});

describe("medianHash", () => {
	it("takes the bit most of them agree on", () => {
		const a = [true, false, true];
		const b = [true, false, false];
		const c = [false, false, true];
		expect(medianHash([a, b, c])).toEqual([true, false, true]);
	});

	it("is empty for nothing", () => {
		expect(medianHash([])).toEqual([]);
	});
});

describe("driftAcross", () => {
	it("puts a consistent cut close to its own middle", () => {
		const same = Array.from({ length: 5 }, () =>
			hashOf(
				frame(90, 80, (x, y) => [x + y, x, y]),
				90,
				80,
			),
		);
		for (const shot of driftAcross(same)) {
			expect(shot.bits).toBe(0);
			expect(shot.closeness).toBe(1);
			expect(shot.outlier).toBe(false);
		}
	});

	it("names the shot that wandered", () => {
		const usual = () =>
			hashOf(
				frame(90, 80, (x) => [x * 2, x * 2, x * 2]),
				90,
				80,
			);
		const odd = hashOf(
			frame(90, 80, (x) => [180 - x * 2, 180 - x * 2, 180 - x * 2]),
			90,
			80,
		);
		const drift = driftAcross([usual(), usual(), odd, usual(), usual()]);
		expect(drift[2].outlier).toBe(true);
		expect(drift.filter((shot) => shot.outlier)).toHaveLength(1);
	});

	it("does not let one odd shot make every other shot an outlier", () => {
		// The reason the reference is a median rather than shot one: anchoring on
		// the first frame would make an unusual opening shot report the entire
		// rest of the film as drifted.
		const usual = () =>
			hashOf(
				frame(90, 80, (x) => [x * 2, x * 2, x * 2]),
				90,
				80,
			);
		const odd = hashOf(
			frame(90, 80, (x) => [180 - x * 2, 180 - x * 2, 180 - x * 2]),
			90,
			80,
		);
		const drift = driftAcross([odd, usual(), usual(), usual()]);
		expect(drift.slice(1).every((shot) => !shot.outlier)).toBe(true);
	});

	it("has nothing to say about an empty cut", () => {
		expect(driftAcross([])).toEqual([]);
	});

	it("calls no shot an outlier in a cut of one", () => {
		const only = hashOf(
			frame(90, 80, (x, y) => [x, y, 0]),
			90,
			80,
		);
		expect(driftAcross([only])[0].outlier).toBe(false);
	});
});

describe("distance", () => {
	it("refuses to compare hashes of different lengths", () => {
		expect(() => distance([true], [true, false])).toThrow(/different lengths/i);
	});
});
