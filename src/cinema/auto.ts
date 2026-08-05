// Auto mode, and the guard it is useless without.
//
// The premise: editing a story re-derives and re-renders everything downstream
// without being asked. `descendants()` already computes exactly that set, so
// the feature is small. The reason it is in its own file is the guard.
//
// Fully automatic plus a paid image model means every keystroke in a story node
// can trigger paid renders. Three things stand between a typo and a bill:
//
//   a debounce, so a half-typed sentence never triggers a pass
//   a ceiling read from the ledger, so a long session cannot run away
//   a confirmation above a threshold, so a big pass is a decision
//
// All three are decided here, as one pure function over numbers, because a
// spend guard tangled into a React effect is a spend guard nobody can test.

/** How long a node must sit unedited before auto mode acts on it. */
export const AUTO_DEBOUNCE_MS = 2000;

/**
 * Renders in one automatic pass before it asks first.
 *
 * Four is one character plus a small scene set — the size of pass that follows
 * an ordinary edit. Past that it is a re-render of the film, which is a
 * decision rather than a consequence of typing.
 */
export const CONFIRM_ABOVE = 4;

/** Calls per film before auto mode stops on its own. Manual runs still work. */
export const DEFAULT_CALL_CEILING = 60;

export interface AutoDecision {
	/** Whether to start a run now. */
	run: boolean;
	/** Whether to ask the human first. */
	confirm: boolean;
	/** Why it is not running, for the UI to show. Absent when it is. */
	blocked?: string;
}

export interface AutoInput {
	/** Whether the film has auto mode on at all. */
	auto: boolean;
	/** Generative nodes that would run. */
	pending: number;
	/** Calls already spent on this film, from the ledger. */
	spent: number;
	/** Ceiling for this film. */
	ceiling?: number;
	/** True while a run is in flight. */
	busy: boolean;
}

/**
 * Whether an automatic pass should start.
 *
 * Deliberately total: every branch returns a decision rather than throwing or
 * returning undefined, because the caller is an effect and an effect that has
 * to interpret a null is where a guard quietly stops guarding.
 */
export function decideAuto(input: AutoInput): AutoDecision {
	if (!input.auto) return { run: false, confirm: false };
	if (input.busy) return { run: false, confirm: false };
	if (input.pending <= 0) return { run: false, confirm: false };

	const ceiling = input.ceiling ?? DEFAULT_CALL_CEILING;

	// Checked against what the pass *would* reach, not what has already been
	// spent. A ceiling that only notices after the fact is a receipt, not a
	// limit.
	if (input.spent + input.pending > ceiling) {
		return {
			run: false,
			confirm: false,
			blocked:
				`Auto mode stopped: this film has used ${input.spent} of its ${ceiling} ` +
				`model calls, and this pass needs ${input.pending} more. Render by hand, ` +
				`or raise the ceiling.`,
		};
	}

	return { run: true, confirm: input.pending > CONFIRM_ABOVE };
}

/** The question to put to the human when a pass is large enough to ask about. */
export function confirmMessage(pending: number, spent: number): string {
	return (
		`Auto mode wants to render ${pending} node${pending === 1 ? "" : "s"}. ` +
		`This film has made ${spent} model call${spent === 1 ? "" : "s"} so far. Go ahead?`
	);
}
