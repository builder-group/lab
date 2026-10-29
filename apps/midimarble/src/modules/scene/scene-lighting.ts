import * as THREE from 'three';
import type { TLightingKeyframe, TLightingState, TSceneStyle } from '../project';

export type { TLightingState } from '../project';

/** Uses absolute time so scrubbing and offline rendering produce the same lighting. */
export function evaluateLighting(style: TSceneStyle | undefined, time: number): TLightingState {
	const base: TLightingState = {
		background: style?.background ?? '#bbc2b7',
		keyColor: style?.keyColor ?? '#fff8ed',
		fillColor: style?.fillColor ?? '#edf2ff',
		exposure: style?.exposure ?? 0.95,
		keyPosition: style?.keyPosition ?? (style?.theme === 'wall' ? [14, 5, 3] : [-9, 13, 16]),
		keyIntensity: style?.keyIntensity ?? (style?.theme === 'wall' ? 6 : 2.1),
		fillIntensity: style?.fillIntensity ?? (style?.theme === 'wall' ? 1 : 0),
		environmentIntensity: style?.environmentIntensity ?? (style?.theme === 'wall' ? 0.7 : 0.55)
	};
	let a: TLightingKeyframe | undefined;
	let b: TLightingKeyframe | undefined;
	for (const key of style?.keyframes ?? []) {
		// The last authored key wins when two keys share a timestamp.
		if (key.time <= time) {
			if (a == null || key.time >= a.time) a = key;
		} else if (b == null || key.time <= b.time) b = key;
	}
	if (a == null) return base;
	if (b == null)
		return {
			background: a.background,
			keyColor: a.keyColor,
			fillColor: a.fillColor,
			exposure: a.exposure,
			keyPosition: a.keyPosition ?? base.keyPosition,
			keyIntensity: a.keyIntensity ?? base.keyIntensity,
			fillIntensity: a.fillIntensity ?? base.fillIntensity,
			environmentIntensity: a.environmentIntensity ?? base.environmentIntensity
		};
	const alpha = THREE.MathUtils.smoothstep(time, a.time, b.time);
	const positionA = a.keyPosition ?? base.keyPosition;
	const positionB = b.keyPosition ?? base.keyPosition;
	return {
		background: interpolateColor(a.background, b.background, alpha),
		keyColor: interpolateColor(a.keyColor, b.keyColor, alpha),
		fillColor: interpolateColor(a.fillColor, b.fillColor, alpha),
		exposure: THREE.MathUtils.lerp(a.exposure, b.exposure, alpha),
		keyIntensity: THREE.MathUtils.lerp(
			a.keyIntensity ?? base.keyIntensity,
			b.keyIntensity ?? base.keyIntensity,
			alpha
		),
		fillIntensity: THREE.MathUtils.lerp(
			a.fillIntensity ?? base.fillIntensity,
			b.fillIntensity ?? base.fillIntensity,
			alpha
		),
		environmentIntensity: THREE.MathUtils.lerp(
			a.environmentIntensity ?? base.environmentIntensity,
			b.environmentIntensity ?? base.environmentIntensity,
			alpha
		),
		keyPosition: [
			THREE.MathUtils.lerp(positionA[0], positionB[0], alpha),
			THREE.MathUtils.lerp(positionA[1], positionB[1], alpha),
			THREE.MathUtils.lerp(positionA[2], positionB[2], alpha)
		]
	};
}

function interpolateColor(a: string, b: string, alpha: number): string {
	return `#${new THREE.Color(a).lerp(new THREE.Color(b), alpha).getHexString()}`;
}
