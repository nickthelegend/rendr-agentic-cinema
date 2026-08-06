// The vocabulary of a shot.
//
// Everything here exists because "a prompt box" is the wrong interface for
// cinematography. A director does not type "make it cinematic"; they say 85mm,
// low key, golden hour, over the shoulder. Those words are a small, closed
// vocabulary with real meaning, and putting them in the app rather than in the
// user's head is most of the difference between a toy and a tool.
//
// It is all pure string assembly on purpose. Prompt construction is where a
// generative app quietly rots — every feature adds a clause, nobody can tell
// which clause did what, and the whole thing becomes folklore. Composed here,
// in order, from named pieces, the prompt for any shot can be read back and
// explained.

/** How much of the subject is in frame. The first decision in any shot. */
export const SHOT_SIZES = {
	establishing: "wide establishing shot, the location dominant, figures small",
	wide: "wide shot, full figure in the frame with headroom",
	medium: "medium shot, from the waist up",
	"medium-close": "medium close-up, from the chest up",
	close: "close-up, the face filling the frame",
	extreme: "extreme close-up, a single detail filling the frame",
	"over-shoulder": "over-the-shoulder shot, the near figure soft in the foreground",
	"two-shot": "two-shot, both figures in frame at equal weight",
	insert: "insert shot, a detail of an object, no faces",
	aerial: "high aerial shot looking down, the ground far below",
} as const;
export type ShotSize = keyof typeof SHOT_SIZES;

/**
 * Focal length, and what it does to a face.
 *
 * The depth-of-field clause travels with the lens rather than being a separate
 * control, because they are not independent — asking for a wide lens and a
 * blurred background is asking for something that does not exist, and a model
 * given both will pick one.
 */
export const LENSES = {
	"18mm": "shot on an 18mm lens, wide angle, deep focus, slight edge distortion",
	"35mm": "shot on a 35mm lens, natural perspective, moderate depth of field",
	"50mm": "shot on a 50mm lens, the way the eye sees it, gentle background falloff",
	"85mm": "shot on an 85mm portrait lens, compressed, the background well out of focus",
	"135mm": "shot on a 135mm telephoto, heavily compressed, the background reduced to shape",
	macro: "shot on a macro lens, extremely shallow focus, the subject millimetres deep",
	anamorphic: "anamorphic, oval bokeh, horizontal flares, 2.39:1 feel",
} as const;
export type Lens = keyof typeof LENSES;

/** Where the light comes from and what it says. */
export const LIGHTING = {
	"golden-hour": "golden hour, low warm sun, long shadows, haze in the air",
	"blue-hour": "blue hour, the sky still bright, everything cool and even",
	noir: "low-key noir lighting, one hard source, deep black shadows, slatted light",
	overcast: "flat overcast daylight, soft and shadowless, colours muted",
	practical: "lit only by practical lamps in the scene, warm pools, dark between them",
	"high-key": "high-key lighting, bright and even, almost no shadow",
	"low-key": "low-key lighting, mostly shadow, a thin rim separating figure from ground",
	firelight: "lit by firelight, flickering warm, falling off fast",
	fluorescent: "overhead fluorescent, green-tinged, unflattering, institutional",
	moonlight: "moonlight, cool and dim, deep blue shadow, hard edges",
} as const;
export type Lighting = keyof typeof LIGHTING;

/**
 * Stock, which is really a colour and grain contract.
 *
 * Kept separate from lighting because they compose: Portra at golden hour and
 * Portra under fluorescents are different pictures, and a single "look" preset
 * would have to enumerate the product of both lists.
 */
export const STOCKS = {
	digital: "clean modern digital capture, neutral colour",
	portra: "Kodak Portra 400, warm skin, soft contrast, fine grain",
	ektachrome: "Ektachrome slide film, saturated, cool blues, high contrast",
	"tri-x": "Kodak Tri-X black and white, coarse grain, deep blacks",
	vision3: "Kodak Vision3 500T, cinema negative, tungsten balance, gentle highlight rolloff",
	"16mm": "shot on 16mm, heavy grain, slight gate weave, soft edges",
	polaroid: "Polaroid, washed highlights, cyan shift, soft focus, white border feel",
} as const;
export type Stock = keyof typeof STOCKS;

/** How the frame is arranged. */
export const COMPOSITIONS = {
	thirds: "composed on the rule of thirds, the subject off-centre",
	centred: "symmetrically composed, the subject dead centre",
	"negative-space": "the subject small against large negative space",
	"leading-lines": "strong leading lines drawing the eye to the subject",
	frame: "the subject framed by something in the foreground",
	dutch: "dutch angle, the horizon tilted",
	"low-angle": "low angle, the camera below eye line looking up",
	"high-angle": "high angle, the camera above looking down",
} as const;
export type Composition = keyof typeof COMPOSITIONS;

/**
 * What never to allow into the frame.
 *
 * A default rather than an empty string. These four artefacts are the ones that
 * make a generated still unusable as a *shot* — text and watermarks cannot be
 * graded out, borders fight the timeline's own framing, and extra fingers are
 * the failure everyone recognises instantly.
 */
export const DEFAULT_NEGATIVE =
	"No text, no watermark, no signature, no border or letterboxing, no extra fingers or limbs, no distorted hands.";

export interface ShotCraft {
	size?: ShotSize;
	lens?: Lens;
	lighting?: Lighting;
	stock?: Stock;
	composition?: Composition;
	/** Film-wide colour discipline, so shots cut together. */
	palette?: string;
	/** Extra things to keep out, appended to the default. */
	negative?: string;
	/**
	 * How hard to hold the reference, 0–1.
	 *
	 * Phrased rather than numeric because the image API takes a prompt, not a
	 * weight. The wording is the only lever there is, so it is at least an
	 * honest one.
	 */
	referenceStrength?: number;
}

/** Every craft key that has a preset table, for building menus without drift. */
export const CRAFT_OPTIONS = {
	size: Object.keys(SHOT_SIZES) as ShotSize[],
	lens: Object.keys(LENSES) as Lens[],
	lighting: Object.keys(LIGHTING) as Lighting[],
	stock: Object.keys(STOCKS) as Stock[],
	composition: Object.keys(COMPOSITIONS) as Composition[],
};

function referenceClause(strength: number): string {
	if (strength >= 0.85) {
		return "The person must match the attached reference exactly: same face, same bone structure, same hair.";
	}
	if (strength >= 0.5) return "Keep the person recognisably the same as the attached reference.";
	return "Use the attached reference loosely, as a guide to type rather than likeness.";
}

/**
 * The craft clauses for a shot, in the order they should be read.
 *
 * Ordered deliberately: framing, then optics, then light, then stock, then
 * palette. That is roughly the order a decision constrains the ones after it,
 * and models weight earlier tokens more, so the ordering is doing real work
 * rather than being tidy.
 */
export function craftClauses(craft: ShotCraft): string[] {
	const out: string[] = [];
	if (craft.size) out.push(SHOT_SIZES[craft.size]);
	if (craft.composition) out.push(COMPOSITIONS[craft.composition]);
	if (craft.lens) out.push(LENSES[craft.lens]);
	if (craft.lighting) out.push(LIGHTING[craft.lighting]);
	if (craft.stock) out.push(STOCKS[craft.stock]);
	if (craft.palette?.trim()) out.push(`Colour palette: ${craft.palette.trim()}.`);
	if (craft.referenceStrength !== undefined) {
		out.push(referenceClause(craft.referenceStrength));
	}
	return out;
}

/** The negative clause, default plus whatever else this shot forbids. */
export function negativeClause(craft: ShotCraft): string {
	const extra = craft.negative?.trim();
	return extra
		? `${DEFAULT_NEGATIVE} ${extra.endsWith(".") ? extra : `${extra}.`}`
		: DEFAULT_NEGATIVE;
}

/**
 * Reads a shot size out of prose the model wrote.
 *
 * Decomposition returns camera directions as free text ("close on her hands"),
 * because forcing an enum on the model produces worse writing and more
 * refusals. Mapping after the fact gets the craft clauses without constraining
 * the prose — and when nothing matches, nothing is added, which is the right
 * failure.
 */
export function sizeFromCamera(camera: string): ShotSize | undefined {
	const text = camera.toLowerCase();
	if (/establish/.test(text)) return "establishing";
	if (/aerial|drone|bird/.test(text)) return "aerial";
	if (/extreme close|macro|detail of/.test(text)) return "extreme";
	if (/over the shoulder|over-the-shoulder|ots\b/.test(text)) return "over-shoulder";
	if (/two-shot|two shot/.test(text)) return "two-shot";
	if (/insert/.test(text)) return "insert";
	if (/close/.test(text)) return "close";
	if (/medium|mid\b/.test(text)) return "medium";
	if (/wide|long shot/.test(text)) return "wide";
	return undefined;
}

/** Reads a lighting preset out of a time-of-day string. */
export function lightingFromTime(timeOfDay: string): Lighting | undefined {
	const text = timeOfDay.toLowerCase();
	if (/golden|sunset|sunrise|dusk|dawn/.test(text)) return "golden-hour";
	if (/blue hour|twilight/.test(text)) return "blue-hour";
	// \b on "late": without it "some time later" reads as night, and an
	// unspecified time silently becomes a moonlit one across the whole film.
	if (/night|midnight|late\b/.test(text)) return "moonlight";
	if (/overcast|grey|gray|rain|storm/.test(text)) return "overcast";
	if (/noon|midday|afternoon|day/.test(text)) return "high-key";
	return undefined;
}
