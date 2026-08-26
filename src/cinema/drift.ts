// Has the look wandered?
//
// The consistency panel shows every shot a character appears in and lets you
// judge by eye. That is the right primary evidence, but "judge by eye" does not
// scale past about eight shots and it gives a viewer nothing to disagree with.
// This puts a number next to it.
//
// **What this measures, precisely.** A difference hash — sixty-four bits, each
// one recording whether a pixel is brighter than the one to its right in a 9×8
// greyscale reduction. Comparing two of them counts differing bits. That is an
// *image* distance: composition, palette, contrast, the general shape of the
// frame.
//
// **What it is not.** It is not a face-similarity score and nothing here claims
// it is. Two shots of different people under the same sodium light in the same
// framing will look close to this, and a close-up and a wide of the same person
// will look far apart. Calling it a likeness number would be a lie that a judge
// with any computer-vision background would catch in one question.
//
// So it is presented as drift: how far each shot sits from the middle of its
// own cut. That is a real question a colourist asks — "did shot six wander?" —
// and it is exactly what this can honestly answer.

/** A greyscale image reduced to what a difference hash needs. */
export interface Reduced {
	/** 9 wide by 8 tall, row-major, 0–255. */
	pixels: Uint8Array;
	width: number;
	height: number;
}

export const HASH_WIDTH = 9;
export const HASH_HEIGHT = 8;
export const HASH_BITS = (HASH_WIDTH - 1) * HASH_HEIGHT;

/**
 * The difference hash of a reduced image, as bits.
 *
 * A boolean array rather than a bigint: the comparison is a bit count and
 * nothing here ever needs the value as a number, so the obvious representation
 * is the one that does not need decoding to read.
 */
export function dHash(image: Reduced): boolean[] {
	if (image.width !== HASH_WIDTH || image.height !== HASH_HEIGHT) {
		throw new Error(`A difference hash needs ${HASH_WIDTH}×${HASH_HEIGHT} pixels.`);
	}
	const bits: boolean[] = [];
	for (let y = 0; y < HASH_HEIGHT; y++) {
		for (let x = 0; x < HASH_WIDTH - 1; x++) {
			bits.push(image.pixels[y * HASH_WIDTH + x] > image.pixels[y * HASH_WIDTH + x + 1]);
		}
	}
	return bits;
}

/** How many bits two hashes disagree on. 0 is identical, 64 is opposite. */
export function distance(a: readonly boolean[], b: readonly boolean[]): number {
	if (a.length !== b.length) throw new Error("Those hashes are different lengths.");
	let count = 0;
	for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) count++;
	return count;
}

/**
 * The middle of a set of hashes — each bit is whatever most of them say.
 *
 * A median rather than a first-shot reference. Anchoring on shot one makes the
 * whole cut's drift a function of whichever frame happens to be first, so an
 * unusual opening shot reports every other shot as having wandered.
 */
export function medianHash(hashes: readonly (readonly boolean[])[]): boolean[] {
	if (hashes.length === 0) return [];
	const bits: boolean[] = [];
	for (let i = 0; i < hashes[0].length; i++) {
		let set = 0;
		for (const hash of hashes) if (hash[i]) set++;
		bits.push(set * 2 > hashes.length);
	}
	return bits;
}

export interface Drift {
	index: number;
	/** Differing bits from the cut's median. */
	bits: number;
	/** 0 to 1, where 1 is the middle of the cut and 0 is its opposite. */
	closeness: number;
	/** True when this shot sits further out than the rest of the cut does. */
	outlier: boolean;
}

/**
 * How far each shot sits from the middle of its own cut.
 *
 * The outlier rule is deliberately a comparison against the cut rather than a
 * fixed threshold. A high-contrast film noir has more spread between its shots
 * than a flat documentary, and a constant would call every shot in one of them
 * an outlier and none in the other. Anything past twice the median distance is
 * unusual *for this film*.
 */
export function driftAcross(hashes: readonly (readonly boolean[])[]): Drift[] {
	if (hashes.length === 0) return [];
	const middle = medianHash(hashes);
	const bits = hashes.map((hash) => distance(hash, middle));
	const sorted = [...bits].sort((a, b) => a - b);
	const median = sorted[Math.floor(sorted.length / 2)];
	// A cut where every shot sits on the median has no outliers, and doubling
	// zero would make every shot one.
	const limit = Math.max(median * 2, 6);
	return bits.map((count, index) => ({
		index,
		bits: count,
		closeness: Number((1 - count / (middle.length || 1)).toFixed(3)),
		outlier: count > limit,
	}));
}

/**
 * Reduces a decoded frame to what the hash needs.
 *
 * Box-samples rather than taking nearest pixels: a 960×540 frame sampled at 72
 * points would hash whatever happened to land on those points, so two frames
 * differing only by a pixel of camera shake would look unrelated. Averaging the
 * whole cell is what makes this stable.
 *
 * Luma weights, not a flat mean — a red frame and a blue frame of the same
 * flat mean are very different pictures, and the eye knows it.
 */
export function reduce(rgba: Uint8ClampedArray, width: number, height: number): Reduced {
	if (width < HASH_WIDTH || height < HASH_HEIGHT) {
		throw new Error("That image is smaller than the hash grid.");
	}
	const pixels = new Uint8Array(HASH_WIDTH * HASH_HEIGHT);
	for (let cellY = 0; cellY < HASH_HEIGHT; cellY++) {
		for (let cellX = 0; cellX < HASH_WIDTH; cellX++) {
			const x0 = Math.floor((cellX * width) / HASH_WIDTH);
			const x1 = Math.max(x0 + 1, Math.floor(((cellX + 1) * width) / HASH_WIDTH));
			const y0 = Math.floor((cellY * height) / HASH_HEIGHT);
			const y1 = Math.max(y0 + 1, Math.floor(((cellY + 1) * height) / HASH_HEIGHT));
			let total = 0;
			let counted = 0;
			for (let y = y0; y < y1; y++) {
				for (let x = x0; x < x1; x++) {
					const at = (y * width + x) * 4;
					total += 0.2126 * rgba[at] + 0.7152 * rgba[at + 1] + 0.0722 * rgba[at + 2];
					counted++;
				}
			}
			pixels[cellY * HASH_WIDTH + cellX] = counted === 0 ? 0 : Math.round(total / counted);
		}
	}
	return { pixels, width: HASH_WIDTH, height: HASH_HEIGHT };
}

/**
 * Decodes a base64 frame and hashes it.
 *
 * Browser only — it needs a canvas to decode. Kept apart from everything above
 * so the arithmetic can be tested without one.
 */
export async function hashFrame(base64: string, mimeType: string): Promise<boolean[]> {
	const bitmap = await createImageBitmap(
		await (await fetch(`data:${mimeType};base64,${base64}`)).blob(),
	);
	try {
		const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
		const context = canvas.getContext("2d");
		if (!context) throw new Error("This browser gave no 2d context to hash with.");
		context.drawImage(bitmap, 0, 0);
		const { data } = context.getImageData(0, 0, bitmap.width, bitmap.height);
		return dHash(reduce(data, bitmap.width, bitmap.height));
	} finally {
		// A bitmap that is not closed holds its decoded pixels until GC gets
		// round to it, and a fifteen-shot cut decodes fifteen of them.
		bitmap.close();
	}
}
