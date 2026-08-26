// The cinema graph canvas.
//
// React Flow handles pan, zoom, wiring and hit-testing; everything about what
// a node *means* stays in nodes.ts. The canvas is a view — it refuses a
// connection by asking connectionError, never by knowing the rules itself.
//
// The one thing this file insists on: a refused wire says why. A node editor
// where a connection sometimes does not take, and does not explain, is worse
// than one that refuses loudly.

import {
	addEdge,
	Background,
	BackgroundVariant,
	type Connection,
	Controls,
	type Edge,
	Handle,
	MiniMap,
	type Node,
	type NodeProps,
	Position,
	ReactFlow,
	ReactFlowProvider,
	useEdgesState,
	useNodesState,
	useReactFlow,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useCallback, useEffect, useMemo, useState } from "react";

import {
	type CinemaGraph,
	type CinemaNode,
	type CinemaNodeKind,
	connectionError,
	graphIssues,
	NODE_SPECS,
	type NodeStatus,
	nodeSpec,
} from "./nodes";

/**
 * Colour per group, so the graph reads as four bands at a glance: what goes in,
 * who is in it, what happens, what comes out.
 */
const GROUP_TINT: Record<string, string> = {
	ingredient: "#5B8DEF",
	identity: "#E8A33D",
	story: "#B57BEE",
	output: "#3FC79A",
};

/** What each status looks like. Failure is loud; stale is not an error. */
const STATUS_TINT: Record<NodeStatus, string> = {
	idle: "transparent",
	queued: "#5B8DEF",
	running: "#E8A33D",
	ready: "#3FC79A",
	failed: "#F2555A",
	stale: "#8A93A6",
};

type CinemaNodeData = {
	node: CinemaNode;
	issue?: string;
	onOpen: (id: string) => void;
};

/**
 * One node.
 *
 * Deliberately shows its output inline — a character's sheet, a scene's first
 * frame. The whole argument for a graph over a form is that you can see what
 * each step produced without opening it, so a wrong face is caught at a glance
 * rather than at export.
 */
function CinemaNodeCard({ data, selected }: NodeProps & { data: CinemaNodeData }) {
	const { node, issue, onOpen } = data;
	const spec = nodeSpec(node.kind);
	const tint = GROUP_TINT[spec?.group ?? "ingredient"];
	// The bytes, not an asset id. sheetAssetIds is for media that has been
	// imported into the library, which happens at timeline-commit time — long
	// after the node has something to show. Reading it here meant a node
	// finished, went green, and displayed nothing, which is the one thing the
	// inline preview exists to prevent.
	const sheet = node.output?.sheet?.[0];
	const thumb = sheet ? `data:${sheet.mimeType};base64,${sheet.base64}` : undefined;

	return (
		<div
			className="cin-node"
			// A name a screen reader and a test can both find. Without it the
			// canvas is a page of anonymous groups.
			aria-label={`${spec?.label} node${node.label ? `: ${node.label}` : ""} — ${node.status}`}
			data-selected={selected || undefined}
			data-status={node.status}
			style={{ "--tint": tint, "--status": STATUS_TINT[node.status] } as React.CSSProperties}
			onDoubleClick={() => onOpen(node.id)}
			title={issue ?? spec?.summary}
		>
			{spec?.maxInputs !== 0 ? (
				<Handle type="target" position={Position.Left} className="cin-port" />
			) : null}

			<header className="cin-node__head">
				<span className="cin-node__kind">{spec?.label}</span>
				{node.status !== "idle" ? (
					<span className="cin-node__status" data-status={node.status}>
						{node.status}
					</span>
				) : null}
			</header>

			<div className="cin-node__body">
				{thumb ? (
					<img className="cin-node__thumb" src={thumb} alt="" draggable={false} />
				) : null}
				<p className="cin-node__label">
					{node.label ?? node.text?.slice(0, 90) ?? <em>empty</em>}
				</p>
			</div>

			{issue ? <p className="cin-node__issue">{issue}</p> : null}
			{node.error ? <p className="cin-node__error">{node.error}</p> : null}

			{spec?.hasOutput ? (
				<Handle type="source" position={Position.Right} className="cin-port" />
			) : null}
		</div>
	);
}

const NODE_TYPES = { cinema: CinemaNodeCard as never };

export interface CinemaCanvasProps {
	graph: CinemaGraph;
	onChange: (next: CinemaGraph) => void;
	/** null clears the selection, which is how the inspector gets back to
	 *  its overview. */
	onOpenNode: (nodeId: string | null) => void;
	/** Shown as a toast — refusals go here rather than being swallowed. */
	onNotice: (message: string, tone?: "error" | "info") => void;
}

export function CinemaCanvas(props: CinemaCanvasProps) {
	return (
		<ReactFlowProvider>
			<Canvas {...props} />
		</ReactFlowProvider>
	);
}

function Canvas({ graph, onChange, onOpenNode, onNotice }: CinemaCanvasProps) {
	const flow = useReactFlow();
	const issues = useMemo(() => graphIssues(graph), [graph]);
	const issueFor = useCallback(
		(id: string) => issues.find((entry) => entry.nodeId === id)?.message,
		[issues],
	);

	const toFlowNodes = useCallback(
		(): Node[] =>
			graph.nodes.map((node) => ({
				id: node.id,
				type: "cinema",
				position: { x: node.x, y: node.y },
				data: { node, issue: issueFor(node.id), onOpen: onOpenNode },
			})),
		[graph.nodes, issueFor, onOpenNode],
	);

	const [nodes, setNodes, onNodesChange] = useNodesState(toFlowNodes());
	const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(
		graph.edges.map((edge) => ({
			id: edge.id,
			source: edge.from,
			target: edge.to,
			animated: true,
		})),
	);
	const [dropKind, setDropKind] = useState<CinemaNodeKind | null>(null);
	/**
	 * Where a double-click asked for a node.
	 *
	 * The empty state tells people to double-click the canvas, so the canvas has
	 * to answer. Copy that promises a gesture the app does not implement is
	 * worse than no copy — it teaches that the instructions here are decorative.
	 */
	const [picker, setPicker] = useState<{ sx: number; sy: number; fx: number; fy: number } | null>(
		null,
	);

	/**
	 * Pull React Flow back in line when the graph changed from outside.
	 *
	 * React Flow owns its node list once mounted, which is right while dragging
	 * and wrong for anything else. Undo proved it: the graph stepped back, the
	 * button behaved, and the canvas carried on showing the node that had just
	 * been removed — a change that appears to do nothing is worse than a button
	 * that refuses.
	 *
	 * Keyed on the ids and their status rather than the objects, so a drag
	 * (positions only) does not fight the pointer by resyncing mid-gesture.
	 */
	const signature = graph.nodes
		.map((node) => `${node.id}:${node.status}:${node.output ? 1 : 0}`)
		.join("|");
	const edgeSignature = graph.edges.map((edge) => edge.id).join("|");
	// biome-ignore lint/correctness/useExhaustiveDependencies: keyed on the
	// signatures deliberately — depending on graph.nodes would resync on every
	// drag frame.
	useEffect(() => {
		setNodes((current) =>
			graph.nodes.map((node) => {
				const live = current.find((entry) => entry.id === node.id);
				return {
					id: node.id,
					type: "cinema",
					// Keep the live position when the node survived, so an undo of
					// a text edit does not also snap a node someone just moved.
					position: live?.position ?? { x: node.x, y: node.y },
					selected: live?.selected,
					data: { node, issue: issueFor(node.id), onOpen: onOpenNode },
				};
			}),
		);
	}, [signature, issueFor, onOpenNode, setNodes]);

	// biome-ignore lint/correctness/useExhaustiveDependencies: same reason.
	useEffect(() => {
		setEdges(
			graph.edges.map((edge) => ({
				id: edge.id,
				source: edge.from,
				target: edge.to,
				animated: true,
			})),
		);
	}, [edgeSignature, setEdges]);

	// React Flow owns positions while dragging; the graph is told once the drag
	// settles, so a commit does not fight the pointer.
	const commitPositions = useCallback(() => {
		onChange({
			...graph,
			nodes: graph.nodes.map((node) => {
				const live = nodes.find((entry) => entry.id === node.id);
				return live
					? { ...node, x: Math.round(live.position.x), y: Math.round(live.position.y) }
					: node;
			}),
		});
	}, [graph, nodes, onChange]);

	const onConnect = useCallback(
		(connection: Connection) => {
			if (!connection.source || !connection.target) return;
			// The rules live in nodes.ts. The canvas only relays the refusal.
			const why = connectionError(graph, connection.source, connection.target);
			if (why) {
				onNotice(why, "error");
				return;
			}
			const id = `e-${connection.source}-${connection.target}`;
			setEdges((current) => addEdge({ ...connection, id, animated: true }, current));
			onChange({
				...graph,
				edges: [...graph.edges, { id, from: connection.source, to: connection.target }],
			});
		},
		[graph, onChange, onNotice, setEdges],
	);

	const addNode = useCallback(
		(kind: CinemaNodeKind, at?: { x: number; y: number }) => {
			const count = graph.nodes.length;
			const node: CinemaNode = {
				id: `n-${kind}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
				kind,
				x: at?.x ?? 80 + (count % 4) * 240,
				y: at?.y ?? 80 + Math.floor(count / 4) * 170,
				params: {},
				status: "idle",
			};
			const next = { ...graph, nodes: [...graph.nodes, node] };
			onChange(next);
			setNodes((current) => [
				...current,
				{
					id: node.id,
					type: "cinema",
					position: { x: node.x, y: node.y },
					data: { node, issue: undefined, onOpen: onOpenNode },
				},
			]);
		},
		[graph, onChange, onOpenNode, setNodes],
	);

	const removeSelected = useCallback(() => {
		const doomed = new Set(nodes.filter((node) => node.selected).map((node) => node.id));
		if (doomed.size === 0) return;
		onChange({
			...graph,
			nodes: graph.nodes.filter((node) => !doomed.has(node.id)),
			// Edges to a node that no longer exists would draw to nowhere.
			edges: graph.edges.filter((edge) => !doomed.has(edge.from) && !doomed.has(edge.to)),
		});
		setNodes((current) => current.filter((node) => !doomed.has(node.id)));
		setEdges((current) =>
			current.filter((edge) => !doomed.has(edge.source) && !doomed.has(edge.target)),
		);
	}, [graph, nodes, onChange, setEdges, setNodes]);

	const groups = useMemo(() => ["ingredient", "identity", "story", "output"] as const, []);

	return (
		<div
			className="cin"
			// The wrapper, not <ReactFlow>: React Flow does not forward arbitrary
			// DOM props to its root, so a handler passed to it silently never
			// fires — which is how the empty state ended up promising a gesture
			// that did nothing.
			onDoubleClick={(event) => {
				// Only the empty pane. A double-click on a node opens it.
				const target = event.target as HTMLElement;
				if (!target.classList.contains("react-flow__pane")) return;
				const box = event.currentTarget.getBoundingClientRect();
				const at = flow.screenToFlowPosition({ x: event.clientX, y: event.clientY });
				setPicker({
					sx: event.clientX - box.left,
					sy: event.clientY - box.top,
					fx: at.x,
					fy: at.y,
				});
			}}
		>
			{picker ? (
				<div
					className="cin__picker"
					style={{ left: picker.sx, top: picker.sy }}
					role="menu"
					aria-label="Add a node here"
				>
					{NODE_SPECS.map((spec) => (
						<button
							key={spec.kind}
							type="button"
							role="menuitem"
							style={{ "--tint": GROUP_TINT[spec.group] } as React.CSSProperties}
							onClick={() => {
								addNode(spec.kind, { x: picker.fx, y: picker.fy });
								setPicker(null);
							}}
						>
							{spec.label}
							{spec.generative ? <span className="cin__spark">◆</span> : null}
						</button>
					))}
				</div>
			) : null}

			<aside className="cin__palette">
				{groups.map((group) => (
					<section key={group} className="cin__group">
						<h3 className="cin__group-name" style={{ color: GROUP_TINT[group] }}>
							{group}
						</h3>
						<div className="cin__group-items">
							{NODE_SPECS.filter((spec) => spec.group === group).map((spec) => (
								<button
									key={spec.kind}
									type="button"
									className="cin__add"
									title={spec.summary}
									draggable
									onDragStart={() => setDropKind(spec.kind)}
									onClick={() => addNode(spec.kind)}
									style={{ "--tint": GROUP_TINT[group] } as React.CSSProperties}
								>
									{spec.label}
									{spec.generative ? <span className="cin__spark">◆</span> : null}
								</button>
							))}
						</div>
					</section>
				))}
			</aside>

			<div
				className="cin__canvas"
				onDragOver={(event) => event.preventDefault()}
				onDrop={(event) => {
					if (!dropKind) return;
					const box = event.currentTarget.getBoundingClientRect();
					addNode(dropKind, {
						x: event.clientX - box.left - 90,
						y: event.clientY - box.top - 40,
					});
					setDropKind(null);
				}}
			>
				<ReactFlow
					nodes={nodes}
					edges={edges}
					nodeTypes={NODE_TYPES}
					onNodesChange={onNodesChange}
					onEdgesChange={onEdgesChange}
					onNodeDragStop={commitPositions}
					// A single click opens the node. Double-click was the only way
					// in at first, which meant the inspector sat on "nothing
					// selected" through an entire render while the obvious gesture
					// did nothing — React Flow spends the double-click on zooming
					// the pane, so it never even reached the card underneath.
					onNodeClick={(_event, clicked) => onOpenNode(clicked.id)}
					// Clicking the empty canvas deselects. Without it there was no
					// way back to the empty inspector once anything was picked,
					// which quietly made the whole overview it shows — the prompt
					// leaderboard and the running spend — unreachable.
					onPaneClick={() => {
						onOpenNode(null);
						setPicker(null);
					}}
					onConnect={onConnect}
					onEdgesDelete={(gone) =>
						onChange({
							...graph,
							edges: graph.edges.filter(
								(edge) => !gone.some((entry) => entry.id === edge.id),
							),
						})
					}
					onKeyDown={(event) => {
						if (event.key === "Backspace" || event.key === "Delete") removeSelected();
					}}
					fitView
					// Double-click belongs to "add a node here", which is what the
					// empty state tells people to do. Left on, d3-zoom swallows the
					// event to zoom the pane and the gesture never reaches React at
					// all — the handler looked wired and could not fire.
					zoomOnDoubleClick={false}
					proOptions={{ hideAttribution: false }}
					defaultEdgeOptions={{ animated: true }}
				>
					<Background variant={BackgroundVariant.Dots} gap={22} size={1} />
					<Controls showInteractive={false} />
					<MiniMap pannable zoomable className="cin__map" />
				</ReactFlow>
			</div>

			{issues.length > 0 ? (
				<footer className="cin__issues">
					{issues.slice(0, 4).map((issue) => (
						<span key={issue.message} className="cin__issue">
							{issue.message}
						</span>
					))}
				</footer>
			) : null}
		</div>
	);
}
