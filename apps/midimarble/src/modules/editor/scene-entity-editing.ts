import type { TCameraSettings, TProject, TVec3 } from '../project';
import { evaluateLighting } from '../scene/scene-lighting';

export function getSceneEntityMovePatch(
	project: TProject,
	entity: 'camera' | 'lighting',
	position: TVec3,
	target: TVec3
): Partial<TProject> | null {
	if (!position.every(Number.isFinite) || !target.every(Number.isFinite)) return null;
	const offset: TVec3 = [position[0] - target[0], position[1] - target[1], position[2] - target[2]];
	if (!offset.every(Number.isFinite)) return null;
	if (entity === 'lighting') {
		if (project.scene?.keyframes?.length) return null;
		const scene = project.scene ?? { theme: 'studio', bloom: 1, ...evaluateLighting(undefined, 0) };
		return {
			scene: {
				...scene,
				...(scene.keyframes == null ? {} : { keyframes: [] }),
				keyPosition: offset.map((value) => clamp(value, -100, 100)) as TVec3
			}
		};
	}
	if (project.camera?.keyframes.length) return null;
	const camera: TCameraSettings = project.camera ?? {
		fov: 36,
		distance: 9.2,
		azimuth: 0.21,
		elevation: 0.24,
		lead: 0.42,
		keyframes: []
	};
	const distance = Math.hypot(...offset);
	return {
		camera: {
			...camera,
			keyframes: [],
			distance: clamp(distance, 3, 200),
			azimuth: distance > 0 ? Math.atan2(offset[0], offset[2]) : camera.azimuth,
			elevation: distance > 0
				? clamp(Math.atan2(offset[1], Math.hypot(offset[0], offset[2])), -1.55, 1.55)
				: camera.elevation
		}
	};
}

function clamp(value: number, min: number, max: number): number {
	return Math.max(min, Math.min(max, value));
}
