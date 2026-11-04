import { verticalFov, type TCameraTrack } from '@/modules/camera';
import type { TDecor, TGarland, TSnowfall } from '@/modules/project';
import { decorItem } from './decor-catalog';

// Snowfall and Garland belong to the frame: they hang from the film camera, as `decor_effects.py` builds them. This file
// holds their settings and the numbers the Draft Preview draws its stand-in from. Same layer, same time, same picture.

export const SNOWFALL_DEFAULTS: TSnowfall = { density: 0.5, size: 1, speed: 1, color: '#fff1d6' };
export const GARLAND_DEFAULTS: TGarland = { side: 'both', spacing: 0.14 };

/** A new layer's own settings */
export function effectDefaults(source: string): Pick<TDecor, 'snowfall' | 'garland'> {
	const effect = decorItem(source)?.effect;
	if (effect === 'snowfall') return { snowfall: { ...SNOWFALL_DEFAULTS } };
	if (effect === 'garland') return { garland: { ...GARLAND_DEFAULTS } };
	return {};
}

export function snowfallOf(decor: Pick<TDecor, 'snowfall'>): TSnowfall {
	return decor.snowfall ?? SNOWFALL_DEFAULTS;
}

export function garlandOf(decor: Pick<TDecor, 'garland'>): TGarland {
	return decor.garland ?? GARLAND_DEFAULTS;
}

// MARK: - Snowfall

/** Flakes at Density 0 and 1, as in `SNOW_COUNT` */
const FLAKES = [30, 360] as const;
/** Share of the flakes, diameter in frame widths, fall in frame heights per second and alpha of far, middle and near flakes */
const DEPTHS = [
	[0.62, 0.012, 0.075, 0.95],
	[0.3, 0.02, 0.115, 0.8],
	[0.08, 0.044, 0.19, 0.38]
] as const;

export interface TFlake {
	u: number;
	v: number;
	/** Frame heights per second, before Speed */
	fall: number;
	/** Frame widths per second, before Speed */
	drift: number;
	swayAmount: number;
	/** Radians per second, the sway's phase */
	swayRate: number;
	phase: number;
	/** Diameter in frame widths, before Size */
	diameter: number;
	alpha: number;
}

function hashOf(text: string): number {
	let hash = 2166136261;
	for (let index = 0; index < text.length; index++) hash = Math.imul(hash ^ text.charCodeAt(index), 16777619);
	return hash >>> 0;
}

function seeded(seed: number): () => number {
	let state = seed;
	return () => {
		state = (state + 0x6d2b79f5) | 0;
		let mix = Math.imul(state ^ (state >>> 15), 1 | state);
		mix = (mix + Math.imul(mix ^ (mix >>> 7), 61 | mix)) ^ mix;
		return ((mix ^ (mix >>> 14)) >>> 0) / 4294967296;
	};
}

/** The flakes of a layer: seeded by its ID, so the same layer always has the same snow */
export function snowFlakes(id: string, density: number): TFlake[] {
	const random = seeded(hashOf(id));
	const count = Math.round(FLAKES[0] + (FLAKES[1] - FLAKES[0]) * density);
	const flakes: TFlake[] = [];
	for (let index = 0; index < count; index++) {
		const share = (index + 0.5) / count;
		const depth = (share < DEPTHS[0][0] ? DEPTHS[0] : share < DEPTHS[0][0] + DEPTHS[1][0] ? DEPTHS[1] : DEPTHS[2]) as readonly [number, number, number, number];
		flakes.push({
			u: random(),
			v: random(),
			fall: depth[2] * (0.85 + random() * 0.3),
			drift: 0.002 + random() * 0.007,
			swayAmount: 0.006 + random() * 0.014,
			swayRate: (0.15 + random() * 0.25) * Math.PI * 2,
			phase: random() * Math.PI * 2,
			diameter: depth[1] * (0.75 + random() * 0.5),
			alpha: depth[3] * (0.8 + random() * 0.2)
		});
	}
	return flakes;
}

function fract(value: number): number {
	return value - Math.floor(value);
}

/** A flake's place in the frame at `time`, 0..1 from the top left. It wraps at the edges. */
export function flakeAt(flake: TFlake, time: number, speed: number): { u: number; v: number } {
	return {
		u: fract(flake.u + flake.drift * speed * time + flake.swayAmount * Math.sin(flake.swayRate * time + flake.phase)),
		v: fract(flake.v + flake.fall * speed * time)
	};
}

// MARK: - Garland

const scrolls = new WeakMap<TCameraTrack, Float64Array>();

/**
 * How far the wall has passed through the frame at each frame of the track, in frame heights; positive is up. A Garland
 * scrolls by this, so it seems to hang on the wall while it stays at the frame's edges. `garland_scroll` in
 * decor_effects.py computes the film's.
 */
export function garlandScroll(track: TCameraTrack, aspect: number): Float64Array {
	const cached = scrolls.get(track);
	if (cached != null) return cached;
	const heights = new Float64Array(track.frameCount);
	const tangent = Math.tan((verticalFov(track.lens, aspect) * Math.PI) / 360);
	for (let frame = 1; frame < track.frameCount; frame++) {
		const [w, x, y, z] = [track.rotation[frame * 4] ?? 1, track.rotation[frame * 4 + 1] ?? 0, track.rotation[frame * 4 + 2] ?? 0, track.rotation[frame * 4 + 3] ?? 0];
		// The camera's local +y and -z in Blender's world
		const up = [2 * (x * y - w * z), 1 - 2 * (x * x + z * z), 2 * (y * z + w * x)] as const;
		const forwardY = 2 * (w * x - y * z);
		const delta = [0, 1, 2].map((axis) => (track.position[frame * 3 + axis] ?? 0) - (track.position[(frame - 1) * 3 + axis] ?? 0)) as [number, number, number];
		const step = delta[0] * up[0] + delta[1] * up[1] + delta[2] * up[2];
		const distance = Math.abs(track.position[frame * 3 + 1] ?? 1) / Math.max(Math.abs(forwardY), 0.2);
		heights[frame] = (heights[frame - 1] ?? 0) - step / (2 * Math.max(distance, 1e-3) * tangent);
	}
	scrolls.set(track, heights);
	return heights;
}

/** Scroll at a time, between frames */
export function garlandScrollAt(track: TCameraTrack, aspect: number, time: number): number {
	const heights = garlandScroll(track, aspect);
	const frame = Math.max(0, Math.min(track.frameCount - 1, time * track.fps));
	const index = Math.min(Math.floor(frame), Math.max(0, track.frameCount - 2));
	const [a, b] = [heights[index] ?? 0, heights[Math.min(index + 1, track.frameCount - 1)] ?? 0];
	return a + (b - a) * (frame - index);
}

export const GARLAND_PERIOD = 8;

export interface TSprig {
	/** Share of the frame's height from its top */
	v: number;
	bauble: 'red' | 'gold' | null;
	hasFlake: boolean;
}

/** The sprigs of a Garland in the frame at a scroll, top to bottom. The same pattern repeats every `GARLAND_PERIOD` sprigs. */
export function garlandSprigs(spacing: number, scroll: number): TSprig[] {
	const step = Math.max(0.04, spacing);
	const sprigs: TSprig[] = [];
	const first = Math.floor(-0.5 / step - scroll / step) - 1;
	const last = Math.ceil(0.5 / step - scroll / step) + 1;
	for (let cell = first; cell <= last; cell++) {
		const index = ((cell % GARLAND_PERIOD) + GARLAND_PERIOD) % GARLAND_PERIOD;
		sprigs.push({ v: 0.5 - (cell * step + scroll), bauble: index % 3 === 0 ? (index % 2 === 0 ? 'red' : 'gold') : null, hasFlake: index % 4 === 1 });
	}
	return sprigs.sort((a, b) => a.v - b.v);
}
