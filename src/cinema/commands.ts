// What ⌘K can do, as data.
//
// Kept apart from the palette that shows it so the list can be tested, and so
// the same commands could be driven by an agent later without going through a
// keyboard. Each entry is a verb with a plain name — no icons, no submenus:
// the palette's whole value is that typing three letters beats hunting a
// toolbar, and anything that slows the typing defeats it.

export interface Command {
	id: string;
	/** What a person would type looking for it. */
	name: string;
	/** Where it lives, shown greyed beside the name. */
	group: string;
	/** Extra words that should match, never shown. */
	keywords?: string;
	run: () => void;
	/** Absent when the command cannot run right now, with the reason. */
	unavailable?: string;
}

/**
 * Ranks commands against what has been typed.
 *
 * Subsequence rather than substring — "nsc" should find "New Short film" — but
 * scored so that a prefix beats a scatter, because otherwise every query
 * matches everything and the ordering is what makes it usable.
 */
export function rank(commands: Command[], query: string): Command[] {
	const needle = query.trim().toLowerCase();
	if (!needle) return commands;

	const scored: Array<{ command: Command; score: number }> = [];
	for (const command of commands) {
		const hay = `${command.name} ${command.group} ${command.keywords ?? ""}`.toLowerCase();
		const name = command.name.toLowerCase();

		let score = 0;
		if (name.startsWith(needle)) score = 1000;
		else if (name.includes(needle)) score = 700;
		else if (hay.includes(needle)) score = 400;
		else {
			// Subsequence: every character in order, anywhere.
			let at = 0;
			for (const character of needle) {
				at = hay.indexOf(character, at);
				if (at === -1) break;
				at += 1;
			}
			if (at === -1) continue;
			score = 100;
		}
		// Shorter names win ties: "Render" should beat "Render and place".
		scored.push({ command, score: score - command.name.length });
	}

	return scored
		.sort((a, b) => b.score - a.score || a.command.name.localeCompare(b.command.name))
		.map((entry) => entry.command);
}
