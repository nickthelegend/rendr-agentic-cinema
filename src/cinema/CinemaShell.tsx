// The cinema shell: a full-bleed canvas with floating chrome.
//
// Presentational on purpose. Every action arrives as a prop so the panel keeps
// owning the run, the ledger and the graph — this file decides only what the
// thing looks like and where a control sits.
//
// The one rule it holds to: no dead chrome. Every slot in the reference layout
// is filled with something this app can actually do, because a toolbar of
// buttons that do nothing is the most expensive kind of polish — it looks
// finished and teaches the user that controls here are decorative.

import type { ReactNode } from "react";

import {
	IconAgent,
	IconBack,
	IconBolt,
	IconBook,
	IconBox,
	IconChecklist,
	IconCheckSquare,
	IconChevron,
	IconClapper,
	IconCursor,
	IconEyeOff,
	IconFace,
	IconFolder,
	IconForward,
	IconFrame,
	IconGrid,
	IconGridDots,
	IconHand,
	IconHistory,
	IconKeyboard,
	IconLayers,
	IconMap,
	IconPanel,
	IconPeople,
	IconPlus,
	IconScript,
	IconShare,
	IconSparkle,
	IconTimelineView,
	IconUpload,
	IconUser,
	IconWand,
	IconWave,
} from "./icons";
import type { CinemaNodeKind } from "./nodes";

export interface ShellAction {
	label: string;
	icon: ReactNode;
	onClick?: () => void;
	disabled?: boolean;
	active?: boolean;
}

export interface CinemaShellProps {
	filmName: string;
	/** Which pane the canvas area is showing. */
	view: "canvas" | "timeline";
	onView: (view: "canvas" | "timeline") => void;
	/** True when the graph has nothing on it, which swaps in the empty state. */
	empty: boolean;
	onCreate: (kind: CinemaNodeKind) => void;
	onTemplates: () => void;
	onUpload: () => void;

	running: boolean;
	pending: number;
	costUsd?: number;
	onRender: () => void;

	/** Model calls left before the spend guard stops auto mode. */
	callsLeft: number;
	auto: boolean;
	onAuto: () => void;
	problems: number;
	notes: number;

	canUndo: boolean;
	onUndo: () => void;
	onTidy: () => void;
	onShotList: () => void;
	onToTimeline: () => void;
	placeable: number;
	onTestConnection: () => void;
	onExport: () => void;
	onAssets: () => void;
	/** Whether the minimap is showing. Off by default: it is a navigation aid
	 *  for a graph too big to see, and most films are not. */
	showMap: boolean;
	onToggleMap: () => void;
	/** Which pointer tool the canvas is in. */
	tool: "select" | "pan";
	onTool: (tool: "select" | "pan") => void;
	onSelectAll: () => void;
	showThumbs: boolean;
	onToggleThumbs: () => void;
	showGrid: boolean;
	onToggleGrid: () => void;
	showNotes: boolean;
	onToggleNotes: () => void;
	/** Names the cast and the voice each will be read in. */
	onCast: () => void;
	onAddNode: () => void;
	onAgent: () => void;
	onShortcuts: () => void;
	onHistory: () => void;
	language: string;
	onLanguage: () => void;

	/** The app's own menus, rendered inside this bar so there is only one. */
	menu?: ReactNode;
	/** The React Flow canvas, or whatever is filling the stage. */
	children: ReactNode;
	/** The inspector, docked right. */
	aside?: ReactNode;
}

/**
 * The four ways into a film.
 *
 * Mapped to node kinds this app really has rather than to the categories a
 * different tool happens to use. The character card is the strongest of them —
 * a locked face across every shot is the thing the whole graph exists for.
 */
const STARTERS: Array<{
	kind: CinemaNodeKind;
	tint: string;
	icon: ReactNode;
	title: string;
	sub: string;
}> = [
	{
		kind: "story",
		tint: "#5b6cff",
		icon: <IconScript />,
		title: "Story script generation",
		sub: "Start storyboarding from a premise",
	},
	{
		kind: "character",
		tint: "#1fb8a6",
		icon: <IconFace />,
		title: "Character three-view",
		sub: "Generate front, side and back",
	},
	{
		kind: "scene",
		tint: "#e0952b",
		icon: <IconFrame />,
		title: "First-frame image",
		sub: "Drive the shot a scene opens on",
	},
	{
		kind: "world",
		tint: "#e0556a",
		icon: <IconWave />,
		title: "World and palette",
		sub: "Drive the light every shot shares",
	},
];

function Tool({ label, icon, onClick, disabled, active }: ShellAction) {
	return (
		<button
			type="button"
			className="cshell__tool"
			data-active={active || undefined}
			title={label}
			aria-label={label}
			aria-pressed={active}
			disabled={disabled}
			onClick={onClick}
		>
			{icon}
		</button>
	);
}

export function CinemaShell(props: CinemaShellProps) {
	const {
		filmName,
		view,
		onView,
		empty,
		onCreate,
		running,
		pending,
		costUsd,
		onRender,
		callsLeft,
		auto,
		onAuto,
		problems,
		notes,
		canUndo,
		onUndo,
		placeable,
		children,
		aside,
	} = props;

	return (
		<div
			className="cshell"
			data-map={props.showMap || undefined}
			data-thumbs={props.showThumbs ? undefined : "off"}
			data-grid={props.showGrid ? undefined : "off"}
			data-notes={props.showNotes ? undefined : "off"}
		>
			<header className="cshell__bar">
				<div className="cshell__cluster">
					<span className="cshell__mark" aria-hidden>
						<IconPanel />
					</span>
					{/* One bar, not two. The editor's own title strip is hidden while
					    a film is open, so if the menus are not rendered here they are
					    not rendered anywhere — which is exactly what happened: File,
					    Export Film and Import Film were all unreachable from inside a
					    film. */}
					{props.menu}
					<span className="cshell__rule" />
					<button
						type="button"
						className="cshell__glyph"
						title="Undo (⌘Z)"
						aria-label="Undo"
						disabled={!canUndo}
						onClick={onUndo}
					>
						<IconBack />
					</button>
					<button type="button" className="cshell__glyph" aria-label="Forward" disabled>
						<IconForward />
					</button>

					<h1 className="cshell__title">{filmName}</h1>

					<button type="button" className="cshell__pillbtn" onClick={props.onTemplates}>
						{view === "canvas" ? "Canvas" : "Timeline"}
						<IconChevron size={13} />
					</button>

					<div className="cshell__seg" role="group" aria-label="View">
						<button
							type="button"
							data-on={view === "canvas" || undefined}
							title="Canvas"
							aria-label="Canvas"
							aria-pressed={view === "canvas"}
							onClick={() => onView("canvas")}
						>
							<IconClapper />
						</button>
						<button
							type="button"
							data-on={view === "timeline" || undefined}
							title="Timeline"
							aria-label="Timeline"
							aria-pressed={view === "timeline"}
							onClick={() => onView("timeline")}
						>
							<IconTimelineView />
						</button>
					</div>
				</div>

				<div className="cshell__cluster cshell__cluster--end">
					<button type="button" className="cshell__ghost" onClick={props.onLanguage}>
						<span className="cshell__lang">文A</span>
						{props.language}
					</button>
					<button
						type="button"
						className="cshell__glyph"
						title="Export this film"
						aria-label="Export this film"
						onClick={props.onExport}
					>
						<IconShare />
					</button>
					<button
						type="button"
						className="cshell__ghost"
						onClick={props.onTestConnection}
					>
						<IconBox />
						Connection
					</button>
					{/* Real budget, not a decorative number: what the spend guard has
					    left before it stops auto mode on this film. */}
					<span
						className="cshell__credits"
						title="Model calls left on this film before auto mode stops."
					>
						<IconBolt />
						<b>{callsLeft.toLocaleString()}</b>
					</span>
					<button
						type="button"
						className="cshell__ghost"
						data-on={auto || undefined}
						onClick={onAuto}
					>
						<IconChecklist />
						{auto ? "Auto on" : "Auto off"}
					</button>
					<button
						type="button"
						className="cshell__glyph"
						title={
							problems
								? `${problems} problem(s) to fix`
								: notes
									? `${notes} note(s) on the cut`
									: "Nothing to fix"
						}
						aria-label="Notes"
						onClick={props.onToggleNotes}
					>
						<IconChecklist />
						{problems + notes > 0 ? (
							<i className="cshell__dot" data-stop={problems > 0 || undefined} />
						) : null}
					</button>
					<button
						type="button"
						className="cshell__glyph cshell__glyph--boxed"
						aria-label="Cast"
					>
						<IconUser />
					</button>
					<button type="button" className="cshell__agent" onClick={props.onAgent}>
						<IconAgent />
						Agent
					</button>
				</div>
			</header>

			<div className="cshell__stage">
				<div className="cshell__canvas">{children}</div>

				<div className="cshell__peers" title="Nobody else is in this film">
					<IconPeople />0
				</div>

				{empty ? (
					<div className="cshell__empty">
						<div className="cshell__badge">
							<IconSparkle />
						</div>
						<h2>Double-click the canvas to generate nodes freely</h2>
						<p>Double-click any empty area to pick the card type to generate</p>

						<div className="cshell__starters">
							{STARTERS.map((starter) => (
								<button
									key={starter.kind}
									type="button"
									className="cshell__starter"
									onClick={() => onCreate(starter.kind)}
								>
									<span
										className="cshell__starter-icon"
										style={{ "--tint": starter.tint } as React.CSSProperties}
									>
										{starter.icon}
									</span>
									<span className="cshell__starter-text">
										<b>{starter.title}</b>
										<em>{starter.sub}</em>
									</span>
								</button>
							))}
						</div>

						<div className="cshell__empty-actions">
							<button
								type="button"
								className="cshell__ghost"
								onClick={props.onTemplates}
							>
								<IconBook />
								Template library
							</button>
							<button
								type="button"
								className="cshell__ghost"
								onClick={props.onUpload}
							>
								<IconUpload />
								Upload reference
							</button>
						</div>
					</div>
				) : null}

				{aside ? <div className="cshell__aside">{aside}</div> : null}

				<div className="cshell__dock">
					<div className="cshell__pill">
						<button type="button" className="cshell__assets" onClick={props.onAssets}>
							<IconFolder />
							Assets
						</button>
						<Tool
							label="Select every node"
							icon={<IconCheckSquare />}
							onClick={props.onSelectAll}
						/>
						<Tool label="Tidy the graph" icon={<IconGrid />} onClick={props.onTidy} />
						<Tool
							label="Minimap"
							icon={<IconMap />}
							active={props.showMap}
							onClick={props.onToggleMap}
						/>
						<Tool
							label={props.showThumbs ? "Hide previews" : "Show previews"}
							icon={<IconEyeOff />}
							active={!props.showThumbs}
							onClick={props.onToggleThumbs}
						/>
						<Tool
							label={props.showGrid ? "Hide the grid" : "Show the grid"}
							icon={<IconGridDots />}
							active={props.showGrid}
							onClick={props.onToggleGrid}
						/>
						<span className="cshell__zoom">100%</span>
					</div>

					<div className="cshell__pill">
						<Tool label="Add a node" icon={<IconPlus />} onClick={props.onAddNode} />
						<Tool
							label="Select"
							icon={<IconCursor />}
							active={props.tool === "select"}
							onClick={() => props.onTool("select")}
						/>
						<Tool
							label="Pan"
							icon={<IconHand />}
							active={props.tool === "pan"}
							onClick={() => props.onTool("pan")}
						/>
						<span className="cshell__pill-rule" />
						<Tool
							label={pending ? `Render ${pending}` : "Everything is up to date"}
							icon={<IconWand />}
							disabled={running || pending === 0}
							onClick={onRender}
						/>
						<Tool label="Shot list" icon={<IconFolder />} onClick={props.onShotList} />
						<Tool label="Cast and voices" icon={<IconUser />} onClick={props.onCast} />
						<Tool label="History" icon={<IconHistory />} onClick={props.onHistory} />
						<Tool
							label="Shortcuts"
							icon={<IconKeyboard />}
							onClick={props.onShortcuts}
						/>
						<Tool
							label={
								placeable
									? `Put ${placeable} scene(s) on the timeline`
									: "Nothing rendered yet"
							}
							icon={<IconLayers />}
							disabled={placeable === 0}
							onClick={props.onToTimeline}
						/>
					</div>
				</div>

				{/* The one control that spends money says how much before it is
				    pressed, so it sits apart from the tool pills rather than
				    becoming the tenth icon in a row. */}
				<button
					type="button"
					className="cshell__render"
					disabled={running || pending === 0}
					onClick={onRender}
				>
					<IconWand size={15} />
					{running
						? "Rendering…"
						: pending
							? `Render ${pending} · ~$${(costUsd ?? 0).toFixed(2)}`
							: "Up to date"}
				</button>
			</div>
		</div>
	);
}
