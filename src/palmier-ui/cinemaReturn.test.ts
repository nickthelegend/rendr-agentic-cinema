// Which film you come back to.
//
// The bug this pins: leaving a film for the timeline used to be a one-way door
// with a menu item that reopened `cinemaGraphs[0]`. That is the right film
// exactly until you own a second one, and then it silently opens the wrong
// graph — no error, no warning, just someone else's story on your canvas.

import { describe, expect, it } from "vitest";
import { rememberedFilm } from "./state";

describe("rememberedFilm", () => {
	it("remembers the film you left when you leave one", () => {
		expect(rememberedFilm(null, "film-b", "film-a")).toBe("film-b");
	});

	it("keeps the earlier memory when you leave with no film open", () => {
		// Closing something that was already closed must not erase where you were.
		expect(rememberedFilm(null, null, "film-a")).toBe("film-a");
	});

	it("leaves the memory alone when you enter a film", () => {
		// You are in film-b now; the way back still points at film-a.
		expect(rememberedFilm("film-b", null, "film-a")).toBe("film-a");
	});

	it("has nothing to remember before you have opened anything", () => {
		expect(rememberedFilm(null, null, null)).toBeNull();
	});

	it("does not confuse entering a film with returning to it", () => {
		// The regression in miniature: entering film-b while film-a is open must
		// not make film-b the thing you go "back" to.
		expect(rememberedFilm("film-b", "film-a", null)).toBeNull();
	});
});
