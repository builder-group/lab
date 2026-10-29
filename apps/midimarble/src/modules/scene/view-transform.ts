import * as THREE from 'three';
import type { TSceneStyle } from '../project';

export function getViewTransformToneMapping(
	viewTransform?: TSceneStyle['viewTransform']
): THREE.ToneMapping {
	if (viewTransform === 'agx') return THREE.AgXToneMapping;
	if (viewTransform === 'neutral') return THREE.NeutralToneMapping;
	return THREE.ACESFilmicToneMapping;
}
