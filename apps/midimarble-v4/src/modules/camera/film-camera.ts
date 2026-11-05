import { buildSceneDescription, type TSceneBuild, renderFps } from '@/modules/scene';
import { bakeFollowCamera, followCameraInput, verticalFov, type TCameraPose, type TCameraTrack } from './follow-camera';
import type { TProject, TProjectCommand } from '@/modules/project';
import type { TSimulationResult } from '@/modules/simulation';

/**
 * Scene description and follow camera of a run, the way Blender builds the film camera. A manual camera lives in
 * Blender, which the app cannot see, so the draft follows the automatic camera instead (`isManual`).
 */
export interface TFilmCamera {
	build: TSceneBuild;
	track: TCameraTrack | null;
	isManual: boolean;
}

export interface TCameraAngles {
	/** Turn in radians */
	side: number;
	/** Tilt in radians */
	pitch: number;
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

export function cameraCommands(project: TProject, patch: Partial<TProject['design']['camera']>): TProjectCommand[] {
	return [{ type: 'setDesign', design: { camera: { ...project.design.camera, ...patch } } }];
}
