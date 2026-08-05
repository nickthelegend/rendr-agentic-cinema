// The auto-mode spend guard.
//
// Tested harder than the feature it guards, on purpose. Auto mode being wrong
// means a re-render; the guard being wrong means a bill, and the failure is
// silent until it arrives.

import { describe, expect, it } from "vitest";

import { type AutoInput, CONFIRM_ABOVE, DEFAULT_CALL_CEILING, decideAuto } from "./auto";

const input = (over: Partial<AutoInput> = {}): AutoInput => ({
	auto: true,
	pending: 2,
	spent: 0,
	busy: false,
	...over,
});

describe("decideAuto", () => {
	it("does nothing when auto is off", () => {
		expect(decideAuto(input({ auto: false }))).toEqual({ run: false, confirm: false });
	});

	it("does nothing when a run is already in flight", () => {
		// Without this, a slow render plus a fast edit starts a second pass over
		// nodes the first one is still writing.
		expect(decideAuto(input({ busy: true })).run).toBe(false);
	});

	it("does nothing when there is nothing stale", () => {
		expect(decideAuto(input({ pending: 0 })).run).toBe(false);
	});

	it("runs a small pass without asking", () => {
		expect(decideAuto(input({ pending: CONFIRM_ABOVE }))).toEqual({
			run: true,
			confirm: false,
		});
	});

	it("asks before a pass big enough to be a decision", () => {
		const decision = decideAuto(input({ pending: CONFIRM_ABOVE + 1 }));
		expect(decision.run).toBe(true);
		expect(decision.confirm).toBe(true);
	});

	describe("the ceiling", () => {
		it("counts what the pass would reach, not what is already spent", () => {
			// A ceiling that only notices after the fact is a receipt, not a limit.
			// Spent is under it; spent + pending is not.
			const decision = decideAuto(input({ spent: DEFAULT_CALL_CEILING - 1, pending: 5 }));
			expect(decision.run).toBe(false);
			expect(decision.blocked).toMatch(/model calls/);
		});

		it("allows a pass that lands exactly on the ceiling", () => {
			expect(decideAuto(input({ spent: DEFAULT_CALL_CEILING - 2, pending: 2 })).run).toBe(
				true,
			);
		});

		it("refuses the call that would cross it", () => {
			expect(decideAuto(input({ spent: DEFAULT_CALL_CEILING - 2, pending: 3 })).run).toBe(
				false,
			);
		});

		it("honours a lower ceiling from config", () => {
			const decision = decideAuto(input({ ceiling: 3, spent: 2, pending: 2 }));
			expect(decision.run).toBe(false);
			expect(decision.blocked).toContain("3");
		});

		it("says how to get unstuck rather than only refusing", () => {
			const decision = decideAuto(input({ ceiling: 1, spent: 1, pending: 1 }));
			expect(decision.blocked).toMatch(/by hand|raise the ceiling/i);
		});
	});

	it("never both runs and reports a block", () => {
		// The caller reads `blocked` first and returns. A decision that carried
		// both would spend money and print a refusal.
		for (const spent of [0, 10, 59, 60, 100]) {
			for (const pending of [0, 1, 5, 40]) {
				const decision = decideAuto(input({ spent, pending }));
				expect(decision.run && decision.blocked !== undefined).toBe(false);
			}
		}
	});
});
