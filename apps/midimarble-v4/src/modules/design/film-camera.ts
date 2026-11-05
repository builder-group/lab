import * as THREE from 'three';
import { buildSceneDescription, type TSceneBuild } from '@/modules/blender/scene-builder';
import { bakeFollowCamera, followCameraInput, verticalFov, type TCameraPose, type TCameraTrack } from '@/modules/camera';
import type { TProject, TVec2 } from '@/modules/project';
import type { TSimulationResult } from '@/modules/simulation';
import type { TCameraAngles } from './camera-orbit';
import { renderFps } from './DesignCx';

/**
 * Scene description and follow camera of a run, the way Blender builds the film camera. A manual camera lives in
 * Blender, which the app cannot see, so the draft follows the automatic camera instead (`isManual`).
 */
export interface TFilmCamera {
	build: TSceneBuild;
	track: TCameraTrack | null;
	isManual: boolean;
}

export function filmCamera(project: TProject, result: TSimulationResult): TFilmCamera {
	const build = buildSceneDescription(project, result, { fps: renderFps(project) });
	const isManual = build.description.camera?.mode === 'manual';
	const description = isManual && build.description.camera != null ? { ...build.description, camera: { ...build.description.camera, mode: 'rig' as const } } : build.description;
	return { build, track: bakeFollowCamera(followCameraInput(description, build.motionFiles)), isManual };
}

/** The same run through other angles, for a drag on the preview: the scene stays, only the camera bakes again */
export function filmCameraAt(film: TFilmCamera, angles: TCameraAngles): TFilmCamera {
	const { description, motionFiles } = film.build;
	const camera = description.camera != null ? { ...description.camera, ...angles } : undefined;
	return { ...film, track: bakeFollowCamera(followCameraInput({ ...description, ...(camera != null ? { camera } : {}) }, motionFiles)) };
}

/**
 * Wall point under a point of the film frame, in 0..1 image coordinates, seen through the film camera's pose.
 * Null when the ray misses the wall.
 */
/** The film's camera for the current project and run, computed once per edit, and turned while `orbit` is set */
export class FilmCameraCache {
	private camera: { key: string; value: TFilmCamera } | null = null;
	private orbited: { key: string; value: TFilmCamera } | null = null;

	/** What the last `at` was computed from, before any orbit */
	get base(): TFilmCamera | null {
		return this.camera?.value ?? null;
	}

	at(project: TProject, result: TSimulationResult, orbit: TCameraAngles | null): TFilmCamera {
		// The result changes with every edit; the description also carries skins, colors and theme options
		const key = `${result.revision}:${project.revision}`;
		if (this.camera?.key !== key) this.camera = { key, value: filmCamera(project, result) };
		if (orbit == null) return this.camera.value;
		const orbitKey = `${key}:${orbit.side}:${orbit.pitch}`;
		if (this.orbited?.key !== orbitKey) this.orbited = { key: orbitKey, value: filmCameraAt(this.camera.value, orbit) };
		return this.orbited.value;
	}
}

export function imageToWall(pose: TCameraPose, aspect: number, u: number, v: number): TVec2 | null {
	const halfHeight = Math.tan((verticalFov(pose.lens, aspect) * Math.PI) / 360);
	const halfWidth = halfHeight * aspect;
	// Blender camera space: x right, y up, looking along -z
	const ray = new THREE.Vector3((u * 2 - 1) * halfWidth, (1 - v * 2) * halfHeight, -1);
	const [w, x, y, z] = pose.rotation;
	ray.applyQuaternion(new THREE.Quaternion(x, y, z, w));
	const [px, py, pz] = pose.position;
	// The wall surface is Blender's y = 0, the camera stands in front of it at negative y
	if (Math.abs(ray.y) < 1e-9) return null;
	const reach = -py / ray.y;
	if (reach <= 0) return null;
	return { x: px + ray.x * reach, y: pz + ray.z * reach };
}
