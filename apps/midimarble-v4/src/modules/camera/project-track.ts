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
