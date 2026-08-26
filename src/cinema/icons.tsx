// Line icons for the cinema shell.
//
// Inline rather than a package: the shell needs about twenty glyphs at one
// weight, and a dependency for that is a megabyte to render 20 paths. All of
// them share a stroke geometry — 1.6 at 24, rounded caps — so the toolbar reads
// as one set rather than as icons gathered from three places.

type P = { size?: number };
const svg = (size: number) => ({
	width: size,
	height: size,
	viewBox: "0 0 24 24",
	fill: "none",
	stroke: "currentColor",
	strokeWidth: 1.6,
	strokeLinecap: "round" as const,
	strokeLinejoin: "round" as const,
	"aria-hidden": true,
});

export const IconPanel = ({ size = 16 }: P) => (
	<svg {...svg(size)}>
		<rect x="3" y="4" width="18" height="16" rx="2" />
		<path d="M9 4v16" />
	</svg>
);
export const IconChevron = ({ size = 14 }: P) => (
	<svg {...svg(size)}>
		<path d="m6 9 6 6 6-6" />
	</svg>
);
export const IconBack = ({ size = 16 }: P) => (
	<svg {...svg(size)}>
		<path d="m15 18-6-6 6-6" />
	</svg>
);
export const IconForward = ({ size = 16 }: P) => (
	<svg {...svg(size)}>
		<path d="m9 18 6-6-6-6" />
	</svg>
);
export const IconClapper = ({ size = 16 }: P) => (
	<svg {...svg(size)}>
		<path d="M3 10h18v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
		<path d="m3.5 10 2.6-4.3 3.7-.6M9.5 9.4l2.6-4.3 3.7-.6M15.5 8.8l2.6-4.3 2.6-.4" />
	</svg>
);
export const IconTimelineView = ({ size = 16 }: P) => (
	<svg {...svg(size)}>
		<rect x="3" y="5" width="18" height="14" rx="2" />
		<path d="M3 10h18M9 10v9M15 10v9" />
	</svg>
);
export const IconShare = ({ size = 16 }: P) => (
	<svg {...svg(size)}>
		<circle cx="18" cy="5" r="2.4" />
		<circle cx="6" cy="12" r="2.4" />
		<circle cx="18" cy="19" r="2.4" />
		<path d="m8.2 10.8 7.6-4.4M8.2 13.2l7.6 4.4" />
	</svg>
);
export const IconBox = ({ size = 16 }: P) => (
	<svg {...svg(size)}>
		<path d="M21 8v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V8M2 4h20v4H2zM10 12h4" />
	</svg>
);
export const IconBolt = ({ size = 14 }: P) => (
	<svg {...svg(size)} fill="currentColor" stroke="none">
		<path d="M13.5 2 4 13.2h6L9.8 22 19 10.6h-6z" />
	</svg>
);
export const IconCrown = ({ size = 16 }: P) => (
	<svg {...svg(size)}>
		<path d="M3 7.5 6.8 12 12 5l5.2 7L21 7.5V17a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z" />
	</svg>
);
export const IconChecklist = ({ size = 16 }: P) => (
	<svg {...svg(size)}>
		<path d="m3 6 1.8 1.8L8 4.6M3 15l1.8 1.8L8 13.6M11 6.5h10M11 15.5h10" />
	</svg>
);
export const IconUser = ({ size = 16 }: P) => (
	<svg {...svg(size)}>
		<circle cx="12" cy="8" r="3.4" />
		<path d="M4.5 20a7.5 7.5 0 0 1 15 0" />
	</svg>
);
/* A cone and two arcs. Speech leaving the film, rather than a mouth or a
   microphone — what this control does is make the *cut* audible, not record
   anybody. */
export const IconSpeaker = ({ size = 16 }: P) => (
	<svg {...svg(size)}>
		<path d="M4 9.5h3L11.5 6v12L7 14.5H4z" />
		<path d="M15 9.4a4 4 0 0 1 0 5.2M17.8 7a7.5 7.5 0 0 1 0 10" />
	</svg>
);
/* Two links of a chain. Distinct from IconShare's outward arrow next to it —
   these sit side by side and had to be tellable apart at 15px. */
export const IconLink = ({ size = 15 }: P) => (
	<svg {...svg(size)}>
		<path d="M10 13.5a4 4 0 0 0 5.7.4l3-2.8a4 4 0 0 0-5.5-5.8l-1.7 1.6" />
		<path d="M14 10.5a4 4 0 0 0-5.7-.4l-3 2.8a4 4 0 0 0 5.5 5.8l1.7-1.6" />
	</svg>
);
export const IconAgent = ({ size = 15 }: P) => (
	<svg {...svg(size)}>
		<rect x="3.5" y="7.5" width="17" height="12" rx="3" />
		<path d="M12 7.5V4M8.5 13h.01M15.5 13h.01" />
	</svg>
);
export const IconPeople = ({ size = 14 }: P) => (
	<svg {...svg(size)}>
		<circle cx="9" cy="8" r="3" />
		<path d="M3 19a6 6 0 0 1 12 0M16 5.5a3 3 0 0 1 0 5.8M17.5 19a5.6 5.6 0 0 0-1.6-4" />
	</svg>
);
export const IconSparkle = ({ size = 22 }: P) => (
	<svg {...svg(size)}>
		<path d="M12 3v18M3 12h18M6.2 6.2l11.6 11.6M17.8 6.2 6.2 17.8" />
	</svg>
);
export const IconScript = ({ size = 18 }: P) => (
	<svg {...svg(size)}>
		<path d="M5 3h11l3 3v15H5z" />
		<path d="M8.5 8.5h7M8.5 12h7M8.5 15.5h4" />
	</svg>
);
export const IconFace = ({ size = 18 }: P) => (
	<svg {...svg(size)}>
		<circle cx="12" cy="9" r="3.6" />
		<path d="M5 20a7 7 0 0 1 14 0" />
	</svg>
);
export const IconFrame = ({ size = 18 }: P) => (
	<svg {...svg(size)}>
		<rect x="3" y="5" width="18" height="14" rx="2" />
		<path d="M3 9h18M7 5v4M13 5v4M19 5v4" />
	</svg>
);
export const IconWave = ({ size = 18 }: P) => (
	<svg {...svg(size)}>
		<path d="M4 10v4M8 6v12M12 3v18M16 7v10M20 10v4" />
	</svg>
);
export const IconBook = ({ size = 15 }: P) => (
	<svg {...svg(size)}>
		<path d="M4 4.5A1.5 1.5 0 0 1 5.5 3H11v18H5.5A1.5 1.5 0 0 1 4 19.5zM20 4.5A1.5 1.5 0 0 0 18.5 3H13v18h5.5a1.5 1.5 0 0 0 1.5-1.5z" />
	</svg>
);
export const IconUpload = ({ size = 15 }: P) => (
	<svg {...svg(size)}>
		<path d="M12 16V4M8 8l4-4 4 4M4 17v2a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-2" />
	</svg>
);
export const IconFolder = ({ size = 16 }: P) => (
	<svg {...svg(size)}>
		<path d="M3 7a1 1 0 0 1 1-1h5l2 2.5h9a1 1 0 0 1 1 1V18a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z" />
	</svg>
);
export const IconCheckSquare = ({ size = 16 }: P) => (
	<svg {...svg(size)}>
		<rect x="3.5" y="3.5" width="17" height="17" rx="3" />
		<path d="m8 12 2.6 2.6L16.5 9" />
	</svg>
);
export const IconGrid = ({ size = 16 }: P) => (
	<svg {...svg(size)}>
		<rect x="3.5" y="3.5" width="7" height="7" rx="1.6" />
		<rect x="13.5" y="3.5" width="7" height="7" rx="1.6" />
		<rect x="3.5" y="13.5" width="7" height="7" rx="1.6" />
		<rect x="13.5" y="13.5" width="7" height="7" rx="1.6" />
	</svg>
);
export const IconMap = ({ size = 16 }: P) => (
	<svg {...svg(size)}>
		<path d="m3 6 6-2.5 6 2.5 6-2.5v15L15 21 9 18.5 3 21z" />
		<path d="M9 3.5v15M15 6v15" />
	</svg>
);
export const IconEyeOff = ({ size = 16 }: P) => (
	<svg {...svg(size)}>
		<path d="M3 3l18 18M10.6 6.3A9 9 0 0 1 21.5 12a15 15 0 0 1-3 3.6M6.2 7.9A15 15 0 0 0 2.5 12a9.4 9.4 0 0 0 12.4 4.4" />
		<path d="M9.9 10a3 3 0 0 0 4.1 4.1" />
	</svg>
);
export const IconGridDots = ({ size = 16 }: P) => (
	<svg {...svg(size)}>
		<path d="M3 8.5h18M3 15.5h18M8.5 3v18M15.5 3v18" />
	</svg>
);
export const IconPlus = ({ size = 17 }: P) => (
	<svg {...svg(size)}>
		<path d="M12 5v14M5 12h14" />
	</svg>
);
export const IconCursor = ({ size = 16 }: P) => (
	<svg {...svg(size)} fill="currentColor" stroke="currentColor" strokeWidth={1.2}>
		<path d="M5.5 3.2 19 11.4l-5.9 1.3-2.4 5.6z" />
	</svg>
);
export const IconHand = ({ size = 16 }: P) => (
	<svg {...svg(size)}>
		<path d="M8 11V5.6a1.6 1.6 0 0 1 3.2 0V11m0-.6V4.4a1.6 1.6 0 0 1 3.2 0V11m0-.4V6.2a1.6 1.6 0 1 1 3.2 0V14a6 6 0 0 1-6 6h-1a5 5 0 0 1-4.3-2.5L4.8 15A1.6 1.6 0 0 1 7.4 13L8 14" />
	</svg>
);
export const IconWand = ({ size = 16 }: P) => (
	<svg {...svg(size)}>
		<path d="m4 20 11-11M14.5 4.2l.7 1.9 1.9.7-1.9.7-.7 1.9-.7-1.9-1.9-.7 1.9-.7zM19.4 11l.5 1.3 1.3.5-1.3.5-.5 1.3-.5-1.3-1.3-.5 1.3-.5z" />
	</svg>
);
export const IconHistory = ({ size = 16 }: P) => (
	<svg {...svg(size)}>
		<path d="M3.2 10.5A9 9 0 1 1 5 15.5" />
		<path d="M3 5v5.5h5.5M12 7.5V12l3 1.8" />
	</svg>
);
export const IconKeyboard = ({ size = 16 }: P) => (
	<svg {...svg(size)}>
		<rect x="2.5" y="6" width="19" height="12" rx="2" />
		<path d="M6 9.5h.01M9.5 9.5h.01M13 9.5h.01M16.5 9.5h.01M6 13h.01M18 13h.01M9.5 13h5" />
	</svg>
);
export const IconLayers = ({ size = 16 }: P) => (
	<svg {...svg(size)}>
		<path d="m12 3 9 5-9 5-9-5z" />
		<path d="m3.5 12.5 8.5 4.7 8.5-4.7" />
	</svg>
);
