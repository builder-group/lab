import { createId, type TProject, type TProjectCommand, type TShot } from '@/modules/project';
import { SHOT_HOLD } from './shot-timing';

// Shot markers ease the follow camera to their distance after their time. The presets are shares of the rig's distance.

export const shotPresets: readonly { id: string; label: string; scale: number }[] = [
	{ id: 'wide', label: 'Wide', scale: 1.6 },
	{ id: 'normal', label: 'Normal', scale: 1 },
	{ id: 'pushIn', label: 'Push In', scale: 0.7 },
	{ id: 'closeUp', label: 'Close-Up', scale: 0.45 }
];

/** Share of the rig's distance a new shot stands at: Push In */
const NEW_SHOT_SCALE = 0.7;

/** Distance of a preset for a rig with the given base distance */
export function shotPresetDistance(scale: number, baseDistance: number): number {
	return round(baseDistance * scale);
}

/** The preset a shot stands at, or null when its distance is its own */
export function shotPresetOf(shot: Pick<TShot, 'distance'>, baseDistance: number): (typeof shotPresets)[number] | null {
	return shotPresets.find((preset) => shotPresetDistance(preset.scale, baseDistance) === shot.distance) ?? null;
}

/** Shots in time order, which the follow camera assumes */
export function sortShots(shots: TShot[]): TShot[] {
	return [...shots].sort((a, b) => a.time - b.time);
}

/** Adds a marker at the given time: a Push In that holds 2 s unless `options` say otherwise, and returns its id */
export function addShotCommands(project: TProject, time: number, id = createId('shot'), options: Partial<Pick<TShot, 'distance' | 'hold'>> = {}): { commands: TProjectCommand[]; shotId: string } {
	const camera = project.film.camera;
	const shot: TShot = { id, time: round(Math.max(0, time)), distance: round(options.distance ?? shotPresetDistance(NEW_SHOT_SCALE, camera.distance)), hold: options.hold ?? SHOT_HOLD };
	return { commands: shotsCommands(project, [...camera.shots, shot]), shotId: id };
}

/** Changes one marker */
export function updateShotCommands(project: TProject, shotId: string, patch: Partial<Omit<TShot, 'id'>>): TProjectCommand[] {
	const camera = project.film.camera;
	const shot = camera.shots.find((item) => item.id === shotId);
	if (shot == null) return [];
	const next: TShot = { ...shot, ...patch, ...(patch.time != null ? { time: round(Math.max(0, patch.time)) } : {}) };
	return shotsCommands(
		project,
		camera.shots.map((item) => (item.id === shotId ? next : item))
	);
}

export function removeShotsCommands(project: TProject, shotIds: string[]): TProjectCommand[] {
	const shots = project.film.camera.shots;
	const kept = shots.filter((shot) => !shotIds.includes(shot.id));
	return kept.length === shots.length ? [] : shotsCommands(project, kept);
}

function shotsCommands(project: TProject, shots: TShot[]): TProjectCommand[] {
	return [{ type: 'updateFilm', film: { camera: { ...project.film.camera, shots: sortShots(shots) } } }];
}

function round(value: number): number {
	return Math.round(value * 10000) / 10000;
}
