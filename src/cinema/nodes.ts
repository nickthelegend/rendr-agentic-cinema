// The cinema graph: what the nodes are and what may connect to what.
//
// The graph is not decoration over a prompt chain. It exists because the hard
// problem in generated video is *consistency* — the same character across
// eleven shots — and consistency is a binding between things. A binding you can
// see and edit is a binding you can fix when it goes wrong.
//
// Nothing here calls a model. This is the shape; running it lives in run.ts.

/** Every kind of node the graph knows. */
export type CinemaNodeKind =
	// ── ingredients ──────────────────────────────────────────────────
	| "reference" // an uploaded image: a face, a location, a prop
	| "trait" // a written attribute — "nervous", "limps", "always in blue"
	| "look" // wardrobe and styling, kept separate so one cast can be redressed
	| "voice" // how this character sounds, for narration and dialogue
	// ── identity ─────────────────────────────────────────────────────
	| "character" // a locked identity: sheet, seed, canonical description
	| "world" // the place and its rules — era, palette, weather, lens
	// ── the middle ───────────────────────────────────────────────────
	| "beat" // one story moment, written or generated
	| "story" // the spine: beats in order, cast attached
	// ── output ───────────────────────────────────────────────────────
	| "scene" // one shot: characters present, camera, action
	| "timeline"; // where scenes land, and the only terminal node

export interface NodeSpec {
	kind: CinemaNodeKind;
	label: string;
	/** One line, shown on hover. Says what it is for, not what it is. */
	summary: string;
	/** Which kinds may feed this one. Empty means it takes no input. */
	accepts: CinemaNodeKind[];
	/** How many inputs it will take. null is unlimited. */
	maxInputs: number | null;
	/** False for terminal nodes. */
	hasOutput: boolean;
	/** Whether running this node costs a model call. Drives the cost estimate. */
	generative: boolean;
	group: "ingredient" | "identity" | "story" | "output";
}

export const NODE_SPECS: NodeSpec[] = [
	{
		kind: "reference",
		label: "Reference",
		summary: "An image to anchor a face, a place, or a prop. The strongest input there is.",
		accepts: [],
		maxInputs: 0,
		hasOutput: true,
		generative: false,
		group: "ingredient",
	},
	{
		kind: "trait",
		label: "Trait",
		summary: "One written attribute. Several small traits beat one long paragraph.",
		accepts: [],
		maxInputs: 0,
		hasOutput: true,
		generative: false,
		group: "ingredient",
	},
	{
		kind: "look",
		label: "Look",
		summary: "Wardrobe and styling, kept apart from identity so a cast can be redressed.",
		accepts: ["reference", "trait"],
		maxInputs: null,
		hasOutput: true,
		generative: false,
		group: "ingredient",
	},
	{
		kind: "voice",
		label: "Voice",
		summary: "How this character sounds. Feeds narration and dialogue, not the picture.",
		accepts: ["trait"],
		maxInputs: null,
		hasOutput: true,
		generative: false,
		group: "ingredient",
	},
	{
		kind: "character",
		label: "Character",
		summary:
			"A locked identity — a sheet of angles, a seed, a canonical description. Every scene referencing it gets the same face.",
		accepts: ["reference", "trait", "look", "voice"],
		maxInputs: null,
		hasOutput: true,
		generative: true,
		group: "identity",
	},
	{
		kind: "world",
		label: "World",
		summary: "Era, palette, weather, lens. The rules every scene inherits.",
		accepts: ["reference", "trait"],
		maxInputs: null,
		hasOutput: true,
		generative: true,
		group: "identity",
	},
	{
		kind: "beat",
		label: "Beat",
		summary: "One story moment. Write it, or let the story node propose it.",
		accepts: [],
		maxInputs: 0,
		hasOutput: true,
		generative: false,
		group: "story",
	},
	{
		kind: "story",
		label: "Story",
		summary:
			"The spine. Takes a cast and a world and produces ordered beats — or decomposes beats you wrote into scenes.",
		accepts: ["character", "world", "beat"],
		maxInputs: null,
		hasOutput: true,
		generative: true,
		group: "story",
	},
	{
		kind: "scene",
		label: "Scene",
		summary:
			"One shot. Carries which characters are present, so their sheets travel with the prompt.",
		accepts: ["story", "character", "world"],
		maxInputs: null,
		hasOutput: true,
		generative: true,
		group: "output",
	},
	{
		kind: "timeline",
		label: "Timeline",
		summary: "Where scenes land, in order, as clips you can actually cut.",
		accepts: ["scene"],
		maxInputs: null,
		hasOutput: false,
		generative: false,
		group: "output",
	},
];

export const nodeSpec = (kind: CinemaNodeKind): NodeSpec | undefined =>
	NODE_SPECS.find((spec) => spec.kind === kind);

/** How a node run turned out. Drives what the canvas draws. */
export type NodeStatus = "idle" | "queued" | "running" | "ready" | "failed" | "stale";

export interface CinemaNode {
	id: string;
	kind: CinemaNodeKind;
	x: number;
	y: number;
	/** What the user called it, if anything. */
	label?: string;
	/** The written half — a prompt, a trait, a beat. */
	text?: string;
	/** Per-kind settings: aspect, duration, camera, seed. */
	params: Record<string, unknown>;
	status: NodeStatus;
	/** What the last run produced. Cleared when an input changes. */
	output?: NodeOutput;
	/** Why the last run failed, in words a person can act on. */
	error?: string;
}

export interface NodeOutput {
	/** Media this node produced, as library asset ids. */
	assetIds?: string[];
	/** The character sheet as library asset ids, for showing in the UI. */
	sheetAssetIds?: string[];
	/**
	 * The sheet as bytes, which is what a scene actually attaches.
	 *
	 * Kept beside the asset ids rather than replacing them: the UI wants
	 * something it can put in an <img>, and the provider wants base64. Deriving
	 * one from the other on every scene render would mean a fetch per character
	 * per shot.
	 */
	sheet?: Array<{ base64: string; mimeType: string }>;
	/** Text this node produced — beats, a prompt, a description. */
	text?: string;
	/** Structured scenes, when a story decomposed. */
	scenes?: SceneSpec[];
	/** Locked so reruns reproduce. */
	seed?: number;
	/** Which model actually ran, for the ledger and for the receipt. */
	model?: string;
	/** Milliseconds the run took. */
	elapsedMs?: number;
}

/**
 * What a story decomposes into, and what a scene node renders from.
 *
 * Deliberately structured rather than a prose prompt. A single "write me some
 * scenes" call drops continuity — who is in frame, what time it is, what just
 * happened — because nothing forces it to carry those forward. Naming the
 * fields makes the omissions visible, and makes them checkable afterwards.
 */
export interface SceneSpec {
	id: string;
	/** Which beat this came from, so a story edit knows what to invalidate. */
	beatId?: string;
	/** Ordinal in the cut. */
	index: number;
	/** Character node ids present in frame. Their sheets travel with the prompt. */
	characterIds: string[];
	location: string;
	/** "night", "golden hour" — continuity checks read this. */
	timeOfDay: string;
	/** "wide", "close on her hands", "tracking behind". */
	camera: string;
	/** What happens. One action, not a paragraph. */
	action: string;
	/** Spoken line, if any. */
	dialogue?: string;
	durationSeconds: number;
}

export interface CinemaEdge {
	id: string;
	from: string;
	to: string;
}

export interface CinemaGraph {
	id: string;
	name: string;
	nodes: CinemaNode[];
	edges: CinemaEdge[];
	/** Auto mode: a story change re-decomposes and re-renders downstream. */
	auto: boolean;
}

/**
 * Why a connection is refused, or null when it is allowed.
 *
 * Refusing in words rather than silently dropping the wire: a graph editor
 * where a connection sometimes does not take is worse than one that says why.
 */
export function connectionError(graph: CinemaGraph, fromId: string, toId: string): string | null {
	if (fromId === toId) return "A node cannot feed itself.";
	const from = graph.nodes.find((node) => node.id === fromId);
	const to = graph.nodes.find((node) => node.id === toId);
	if (!from || !to) return "One of those nodes is gone.";

	const fromSpec = nodeSpec(from.kind);
	const toSpec = nodeSpec(to.kind);
	if (!fromSpec?.hasOutput) return `${fromSpec?.label} is terminal — nothing comes out of it.`;
	if (!toSpec) return "Unknown node.";
	if (toSpec.maxInputs === 0) return `${toSpec.label} takes no input.`;

	if (!toSpec.accepts.includes(from.kind)) {
		const wanted = toSpec.accepts.map((k) => nodeSpec(k)?.label ?? k).join(", ");
		return `${toSpec.label} takes ${wanted} — not ${fromSpec.label}.`;
	}

	if (graph.edges.some((edge) => edge.from === fromId && edge.to === toId)) {
		return "Already connected.";
	}
	const incoming = graph.edges.filter((edge) => edge.to === toId).length;
	if (toSpec.maxInputs !== null && incoming >= toSpec.maxInputs) {
		return `${toSpec.label} takes at most ${toSpec.maxInputs} input(s).`;
	}
	if (wouldCycle(graph, fromId, toId)) return "That would make a loop.";
	return null;
}

function wouldCycle(graph: CinemaGraph, fromId: string, toId: string): boolean {
	// Walking forward from the destination: reaching the source means the new
	// wire closes a ring.
	const seen = new Set<string>();
	const queue = [toId];
	while (queue.length) {
		const at = queue.pop();
		if (!at) continue;
		if (at === fromId) return true;
		if (seen.has(at)) continue;
		seen.add(at);
		for (const edge of graph.edges) if (edge.from === at) queue.push(edge.to);
	}
	return false;
}

/**
 * Everything upstream of a node, nearest first.
 *
 * This is how a scene collects the character sheets it has to pass as image
 * context — the binding the whole graph exists to make explicit.
 */
export function ancestors(graph: CinemaGraph, nodeId: string): CinemaNode[] {
	const out: CinemaNode[] = [];
	const seen = new Set<string>([nodeId]);
	let frontier = [nodeId];
	while (frontier.length) {
		const next: string[] = [];
		for (const at of frontier) {
			for (const edge of graph.edges) {
				if (edge.to !== at || seen.has(edge.from)) continue;
				seen.add(edge.from);
				const node = graph.nodes.find((entry) => entry.id === edge.from);
				if (node) {
					out.push(node);
					next.push(node.id);
				}
			}
		}
		frontier = next;
	}
	return out;
}

/** Direct inputs of one node, in the order they were wired. */
export function inputsOf(graph: CinemaGraph, nodeId: string): CinemaNode[] {
	return graph.edges
		.filter((edge) => edge.to === nodeId)
		.map((edge) => graph.nodes.find((node) => node.id === edge.from))
		.filter((node): node is CinemaNode => Boolean(node));
}

/**
 * Run order, or null when the graph has a loop.
 *
 * Kahn's algorithm. Nodes with no remaining unmet input come first, so a
 * character is always locked before a scene that references it runs.
 */
export function runOrder(graph: CinemaGraph): CinemaNode[] | null {
	const pending = new Map(graph.nodes.map((node) => [node.id, inputsOf(graph, node.id).length]));
	const ready = graph.nodes.filter((node) => (pending.get(node.id) ?? 0) === 0);
	const out: CinemaNode[] = [];
	const queue = [...ready];
	while (queue.length) {
		const node = queue.shift();
		if (!node) continue;
		out.push(node);
		for (const edge of graph.edges) {
			if (edge.from !== node.id) continue;
			const left = (pending.get(edge.to) ?? 0) - 1;
			pending.set(edge.to, left);
			if (left === 0) {
				const next = graph.nodes.find((entry) => entry.id === edge.to);
				if (next) queue.push(next);
			}
		}
	}
	return out.length === graph.nodes.length ? out : null;
}

/**
 * Everything downstream of a node, which is what an edit invalidates.
 *
 * Changing a character's look does not just make that character stale — every
 * scene it appears in is now wrong too. Marking them rather than silently
 * leaving old renders is the difference between a graph you trust and one you
 * have to re-run wholesale to be sure.
 */
export function descendants(graph: CinemaGraph, nodeId: string): string[] {
	const out: string[] = [];
	const seen = new Set<string>([nodeId]);
	let frontier = [nodeId];
	while (frontier.length) {
		const next: string[] = [];
		for (const at of frontier) {
			for (const edge of graph.edges) {
				if (edge.from !== at || seen.has(edge.to)) continue;
				seen.add(edge.to);
				out.push(edge.to);
				next.push(edge.to);
			}
		}
		frontier = next;
	}
	return out;
}

/** What stops this graph running, said before it runs rather than after. */
export function graphIssues(graph: CinemaGraph): Array<{ nodeId?: string; message: string }> {
	const issues: Array<{ nodeId?: string; message: string }> = [];
	if (graph.nodes.length === 0) {
		return [{ message: "Empty graph. Start with a Character or a Beat." }];
	}
	if (!runOrder(graph)) {
		issues.push({ message: "There is a loop in the graph." });
		return issues;
	}
	if (!graph.nodes.some((node) => node.kind === "timeline")) {
		issues.push({ message: "No Timeline node, so nothing would reach the editor." });
	}
	for (const node of graph.nodes) {
		const spec = nodeSpec(node.kind);
		if (!spec) continue;
		const incoming = inputsOf(graph, node.id).length;
		if (spec.maxInputs !== 0 && incoming === 0 && node.kind !== "beat") {
			issues.push({ nodeId: node.id, message: `${spec.label} has no input.` });
		}
		if (spec.hasOutput && !graph.edges.some((edge) => edge.from === node.id)) {
			issues.push({ nodeId: node.id, message: `${spec.label} feeds nothing.` });
		}
		if (
			node.kind === "scene" &&
			!ancestors(graph, node.id).some((a) => a.kind === "character")
		) {
			// Not fatal — a landscape needs no cast — but almost always a mistake.
			issues.push({
				nodeId: node.id,
				message: "Scene has no Character upstream, so nobody is in it.",
			});
		}
	}
	return issues;
}
