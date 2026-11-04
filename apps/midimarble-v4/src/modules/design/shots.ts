import { createId, type TProject, type TProjectCommand, type TShot } from '@/modules/project';

// Shot markers ease the follow camera to their distance and roll after their time. `kind` names a
// distance preset relative to the rig's base distance; the user may fine-tune distance and roll after.

export type TShotKind = TShot['kind'];

export const shotKinds: readonly { kind: TShotKind; label: string; scale: number }[] = [
	{ kind: 'wide', label: 'Wide', scale: 1.6 },
	{ kind: 'follow', label: 'Follow', scale: 1 },
	{ kind: 'pushIn', label: 'Push In', scale: 0.7 },
	{ kind: 'closeUp', label: 'Close-Up', scale: 0.45 }
];

export function shotKindLabel(kind: TShotKind): string {
	return shotKinds.find((item) => item.kind === kind)?.label ?? kind;
}

/** Distance of a kind's preset for a rig with the given base distance */
export function shotPresetDistance(kind: TShotKind, baseDistance: number): number {
	const scale = shotKinds.find((item) => item.kind === kind)?.scale ?? 1;
	return round(baseDistance * scale);
}

/** Shots in time order, which the follow camera assumes */
export function sortShots(shots: TShot[]): TShot[] {
	return [...shots].sort((a, b) => a.time - b.time);
}

/** Adds a marker at the given time, a Push In unless `options` say otherwise, and returns its id */
export function addShotCommands(project: TProject, time: number, id = createId('shot'), options: Partial<Pick<TShot, 'kind' | 'roll' | 'distance' | 'length'>> = {}): { commands: TProjectCommand[]; shotId: string } {
	const camera = project.design.camera;
	const kind = options.kind ?? 'pushIn';
	const shot: TShot = { id, time: round(Math.max(0, time)), kind, roll: options.roll ?? 0, distance: round(options.distance ?? shotPresetDistance(kind, camera.distance)), ...(options.length != null ? { length: options.length } : {}) };
	return { commands: shotsCommands(project, [...camera.shots, shot]), shotId: id };
}

/**
 * Adds a Wide shot at `time` that holds `length` seconds, at the kind's preset distance unless `distance` is given,
 * and returns the project with it for a what-if run of the camera
 */
export function addWideShotCommands(
	project: TProject,
	time: number,
	length: number,
	distance?: number,
	id = createId('shot')
): { commands: TProjectCommand[]; shotId: string; project: TProject } {
	const camera = project.design.camera;
	const shot: TShot = { id, time: round(Math.max(0, time)), kind: 'wide', roll: 0, distance: round(distance ?? shotPresetDistance('wide', camera.distance)), length: round(length) };
	const next = { ...camera, shots: sortShots([...camera.shots, shot]) };
	return { commands: shotsCommands(project, next.shots), shotId: id, project: { ...project, design: { ...project.design, camera: next } } };
}

/** Changes one marker; a new kind applies its preset distance and resets the roll unless the patch sets them */
export function updateShotCommands(project: TProject, shotId: string, patch: Partial<Omit<TShot, 'id'>>): TProjectCommand[] {
	const camera = project.design.camera;
	const shot = camera.shots.find((item) => item.id === shotId);
	if (shot == null) return [];
	const preset = patch.kind != null && patch.kind !== shot.kind ? { distance: shotPresetDistance(patch.kind, camera.distance), roll: 0 } : {};
	const next: TShot = { ...shot, ...preset, ...patch, ...(patch.time != null ? { time: round(Math.max(0, patch.time)) } : {}) };
	return shotsCommands(
		project,
		camera.shots.map((item) => (item.id === shotId ? next : item))
	);
}

export function removeShotsCommands(project: TProject, shotIds: string[]): TProjectCommand[] {
	const shots = project.design.camera.shots;
	const kept = shots.filter((shot) => !shotIds.includes(shot.id));
	return kept.length === shots.length ? [] : shotsCommands(project, kept);
}

function shotsCommands(project: TProject, shots: TShot[]): TProjectCommand[] {
	return [{ type: 'setDesign', design: { camera: { ...project.design.camera, shots: sortShots(shots) } } }];
}

function round(value: number): number {
	return Math.round(value * 10000) / 10000;
}
