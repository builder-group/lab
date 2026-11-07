import type { TDecor, TSnowfall } from '@/modules/project';
import { decorItem } from './decor-catalog';

// Particles belong to the frame: they hang from the film camera, as `decor_effects.py` builds them. This file
// holds their settings and the numbers the Draft Preview draws its stand-in from. Same layer, same time, same picture.

export const SNOWFALL_DEFAULTS: TSnowfall = { density: 0.5, size: 1, speed: 1, color: '#fff1d6' };

/** A new layer's own settings */
export function effectDefaults(source: string): Pick<TDecor, 'snowfall'> {
	return decorItem(source)?.effect === 'snowfall' ? { snowfall: { ...SNOWFALL_DEFAULTS } } : {};
}

export function snowfallOf(decor: Pick<TDecor, 'snowfall'>): TSnowfall {
	return decor.snowfall ?? SNOWFALL_DEFAULTS;
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
