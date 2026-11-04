import { buildSceneDescription } from '@/modules/blender/scene-builder';
import type { TProject } from '@/modules/project';
import type { TSimulationResult } from '@/modules/simulation/types';
import { bakeFollowCamera, followCameraInput, type TCameraTrack } from './follow-camera';

/**
 * Follow camera of a simulated project at `fps`, built from the same scene description and Float32 motion files the
 * app sends to Blender, so the track matches the film's camera. Null without a rig camera or marble motion.
 */
export function followCameraTrack(
	project: TProject,
	result: TSimulationResult,
	fps: number
): TCameraTrack | null {
	const build = buildSceneDescription(project, result, { fps });
	return bakeFollowCamera(followCameraInput(build.description, build.motionFiles));
}

/** Tracks per run, keyed by the run's marble motion so a copy of a result with another revision shares them */
const tracks = new WeakMap<TSimulationResult['marbles'], Map<string, TCameraTrack | null>>();
/** Baked tracks kept per run, for a few camera edits checked against the same run */
const TRACKS_PER_RUN = 8;

/**
 * `followCameraTrack`, baked once per run and camera settings: about 20 ms for Jingle Bells at 30 fps, which the
 * problem model would otherwise pay on every read
 */
export function cachedFollowCameraTrack(
	project: TProject,
	result: TSimulationResult,
	fps: number
): TCameraTrack | null {
	const key = `${fps}:${JSON.stringify(project.design.camera)}:${project.frame.width}x${project.frame.height}:${result.duration}`;
	let byKey = tracks.get(result.marbles);
	if (byKey == null) {
		byKey = new Map();
		tracks.set(result.marbles, byKey);
	}
	const cached = byKey.get(key);
	if (cached !== undefined) return cached;
	const track = followCameraTrack(project, result, fps);
	if (byKey.size >= TRACKS_PER_RUN) byKey.delete(byKey.keys().next().value as string);
	byKey.set(key, track);
	return track;
}
