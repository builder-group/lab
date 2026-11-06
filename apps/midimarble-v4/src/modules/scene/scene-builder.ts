import { type TFilm, type TPiece, type TProject, type TThemeParts, tieOf } from '@/modules/project';
import { PLAIN_PIECE_COLOR } from './draft-look';
import { pieceLabelColor } from './label-colors';
import { baseThemeOf, defaultTitleColor, resolveElementLook, sceneThemeOverrides, sceneThemeParts } from './project-themes';
import { skinElement } from './skin-catalog';
import { sceneDecor } from './decor';
import { sceneLayers } from './scene-layers';
import { shotHold } from './shot-timing';
import { getPieceDefinition, pathDepth, bowlCatch, BOWL_TYPE } from '@/modules/simulation';
import { lastPlayingMarbles } from '@/modules/music';
import type { TMarbleSample, TMarbleTrack, TSimulationResult } from '@/modules/simulation';
import { CONTACT_MERGE, SCENE_DESCRIPTION_VERSION, type TSceneCamera, type TSceneDescentPoint, type TSceneDescription, type TSceneMarble, type TScenePiece, type TSceneThemeOverrides } from './scene-description';

export const MOTION_FOLDER = '.cache/motion';
export const SCENE_DESCRIPTION_PATH = '.cache/scene.json';
const DEFAULT_PIECE_COLOR = '#c8b89a';

/**
 * Builds the `apply_scene` description and the binary motion files it references from a simulation result.
 * Marble records are [time, x, y, angle] and use the physics samples as they are; the worker resamples
 * them at `fps`.
 */
/** Seconds a marble stays in the camera's group after its last note, so the strike and its rebound read */
export const MARBLE_ACTIVE_TAIL = 0.6;

/**
 * A marble whose marble has finished falls away from the others; once it no longer plays, the camera keeps the
 * marbles that still do. The marble that plays last stays framed to the end.
 */
function markActiveUntil(project: TProject, result: TSimulationResult, marbles: TSceneMarble[]): void {
	const lastNote = new Map(project.marbles.map((marble) => [marble.id, marble.hits.reduce((max, hit) => Math.max(max, hit.time), -Infinity)]));
	const lasts = result.marbles.map((track) => lastNote.get(track.marbleId) ?? -Infinity);
	const latest = Math.max(...lasts);
	result.marbles.forEach((track, index) => {
		const last = lasts[index] ?? -Infinity;
		const marble = marbles.find((item) => item.id === track.marbleId);
		if (marble != null && Number.isFinite(last) && last < latest - 1e-6) marble.activeUntil = Math.round((last + MARBLE_ACTIVE_TAIL) * 1e4) / 1e4;
	});
}

/** Sorted note times of a marble, rounded like `activeUntil`, which the follow camera reads to find the leading marble */
function noteTimes(project: TProject, marbleId: string): number[] {
	const marble = project.marbles.find((item) => item.id === marbleId);
	return (marble?.hits ?? []).map((hit) => Math.round(hit.time * 1e4) / 1e4).sort((a, b) => a - b);
}

export function buildSceneDescription(
	project: TProject,
	result: TSimulationResult,
	options: { fps: number }
): TSceneBuild {
	const pieces = new Map(project.track.pieces.map((piece) => [piece.id, piece]));
	const motionFiles: TMotionFile[] = [];

	const marbleFor = (track: TMarbleTrack, id: string, samples: TMarbleSample[]): TSceneMarble => {
		const marble = project.marbles.find((item) => item.id === track.marbleId);
		const motionPath = `${MOTION_FOLDER}/${id}.bin`;
		const bytes = encodeRecords(
			samples.map((sample) => [sample.time, sample.position.x, sample.position.y, sample.angle])
		);
		motionFiles.push({ path: motionPath, bytes });
		return {
			id,
			name: marble?.name ?? track.marbleId,
			radius: track.radius,
			pathDepth: pathDepth(result.pieces, track.radius),
			color: marble?.labelColor ?? DEFAULT_PIECE_COLOR,
			...(marble?.skin != null ? { skin: marble.skin } : {}),
			...(skinAssetPath(marble?.skin?.assetId) != null ? { assetPath: skinAssetPath(marble?.skin?.assetId) } : {}),
			motionPath,
			sampleCount: samples.length
		};
	};
	const marbles: TSceneMarble[] = result.marbles.map((track) => ({
		...marbleFor(track, track.marbleId, track.samples),
		hitTimes: noteTimes(project, track.marbleId)
	}));
	markActiveUntil(project, result, marbles);

	const resolvedPieces: TScenePiece[] = result.pieces.map((item) => {
		const piece = pieces.get(item.pieceId);
		const marbleId = tieOf(piece)?.marbleId;
		let motionPath: string | null = null;
		let sampleCount = 0;
		if (item.motion != null && item.motion.length > 0) {
			motionPath = `${MOTION_FOLDER}/${item.pieceId}.bin`;
			sampleCount = item.motion.length;
			motionFiles.push({
				path: motionPath,
				bytes: encodeRecords(item.motion.map((sample) => [sample.time, sample.angle]))
			});
		}
		return {
			id: item.pieceId,
			name: piece?.name ?? item.pieceId,
			type: item.type,
			params: { ...item.params },
			position: { x: item.position.x, y: item.position.y },
			angle: item.angle,
			wallOffset: getPieceDefinition(item.type)?.wallOffset ?? 0,
			hitTimes: hitTimesFor(result, item.pieceId),
			contactTimes: contactTimesFor(result, item.pieceId),
			musical: getPieceDefinition(item.type)?.musical === true,
			motionPath,
			sampleCount,
			skin: piece?.skin != null ? piece.skin : null,
			assetPath: skinAssetPath(piece?.skin?.assetId),
			// The skin None wears the label color, the only skin that does
			color:
				piece != null && resolveElementLook(project.film, skinElement(item.type), piece.skin).skin.endsWith(':none') ? (pieceLabelColor(project, piece) ?? PLAIN_PIECE_COLOR)
				: (project.marbles.find((marble) => marble.id === marbleId)?.labelColor ?? DEFAULT_PIECE_COLOR),
			...notePitchOf(project, piece),
			path: item.path?.map((point) => ({ x: point.x, y: point.y })) ?? null,
			paths: item.paths?.map((wire) => wire.map((point) => ({ x: point.x, y: point.y }))) ?? null
		};
	});

	return {
		description: {
			version: SCENE_DESCRIPTION_VERSION,
			projectId: project.id,
			revision: project.revision,
			fps: options.fps,
			duration: result.duration,
			frame: { width: project.format.width, height: project.format.height },
			theme: baseThemeOf(project.film),
			...themeOverridesOf(project),
			...themePartsOf(project),
			...sceneLayers(project.film),
			...sceneDecor(project.film),
			marbles,
			pieces: resolvedPieces,
			camera: {
				...buildSceneCamera(project.film.camera),
				descent: descentCurve(result),
				holdAfter: lastStruckTime(result),
				holdBowl: heldBowls(project, result)
			},
			wallTexts: project.film.titles.map(({ name: _name, labelColor: _labelColor, position, angle, ...text }) => ({ ...text, color: text.color ?? defaultTitleColor(project.film), position: { ...position }, angle }))
		},
		motionFiles
	};
}

/**
 * Time of the run's last struck hit: the camera holds on it to the end of the film rather than following the marble
 * down the empty wall. Null when no hit is struck.
 */
export function lastStruckTime(result: TSimulationResult): number | null {
	let last = -Infinity;
	for (const hit of result.hits) if (hit.actualTime != null) last = Math.max(last, hit.actualTime);
	return Number.isFinite(last) ? Math.round(last * 1e4) / 1e4 : null;
}

/**
 * Mouths of the Bowls that catch a marble playing last after the run's last hit, which the camera's held ending
 * frames with that hit; null without any. A Bowl that misses its marble is left out, so the frame stays on the
 * last pieces, and so is one whose catch comes before the hold, which the camera saw while it still followed.
 */
export function heldBowls(project: TProject, result: TSimulationResult): { x: number; y: number }[] | null {
	const marbles = new Set(lastPlayingMarbles(project));
	const hold = lastStruckTime(result);
	if (hold == null) return null;
	const points = project.track.pieces.flatMap((piece) => {
		const marbleId = tieOf(piece)?.marbleId;
		if (piece.type !== BOWL_TYPE || marbleId == null || !marbles.has(marbleId)) return [];
		const resolvedPiece = result.pieces.find((item) => item.pieceId === piece.id);
		const caught = bowlCatch(result, piece.id);
		if (resolvedPiece == null || caught.status !== 'caught' || (caught.enterTime ?? -Infinity) < hold) return [];
		return [{ x: Math.round(resolvedPiece.position.x * 1e5) / 1e5, y: Math.round(resolvedPiece.position.y * 1e5) / 1e5 }];
	});
	return points.length ? points : null;
}

// What the follow camera always uses: how far ahead it looks in seconds, and how smoothly it moves from 0 to 1
const CAMERA_LEAD = 0.15;
const CAMERA_SMOOTHING = 0.6;

export function buildSceneCamera(camera: TFilm['camera']): TSceneCamera {
	return {
		mode: camera.auto ? 'rig' : 'manual',
		distance: camera.distance,
		pitch: camera.tilt,
		lead: CAMERA_LEAD,
		smoothing: CAMERA_SMOOTHING,
		...(camera.turn != null ? { side: camera.turn } : {}),
		sway: camera.sway,
		shots: camera.shots.map((shot) => ({
			time: shot.time,
			distance: shot.distance,
			length: shotHold(shot)
		})),
		focusMarbleId: camera.focusMarbleId ?? null
	};
}

/**
 * Shared descent pace of a multi-marble run, when the simulation reports one as `descent: {time, y}[]`. The field is
 * optional on the result, so older results and single-marble runs give null.
 */
export function descentCurve(result: TSimulationResult): TSceneDescentPoint[] | null {
	const descent: unknown = (result as { descent?: unknown }).descent;
	if (!Array.isArray(descent)) return null;
	const points = descent.flatMap((point: unknown) => {
		if (point == null || typeof point !== 'object') return [];
		const { time, y } = point as { time?: unknown; y?: unknown };
		return typeof time === 'number' && typeof y === 'number' && Number.isFinite(time) && Number.isFinite(y)
			? [{ time, y }]
			: [];
	});
	return points.length >= 2 ? points : null;
}

/** Package-relative `.blend` of a project library skin; built-in IDs with a colon such as `platform:gold` have none */
export function skinAssetPath(assetId: string | undefined): string | null {
	if (assetId == null || !assetId.length || assetId.includes(':')) return null;
	return `${PROJECT_ASSETS_FOLDER}/${assetId}/asset.blend`;
}

export const PROJECT_ASSETS_FOLDER = 'assets';

export interface TSceneBuild {
	description: TSceneDescription;
	motionFiles: TMotionFile[];
}

export interface TMotionFile {
	/** Package-relative path */
	path: string;
	bytes: Uint8Array;
}

/** Times the marble actually touched the piece for each linked hit, sorted. Hits without a contact are left out. */
function hitTimesFor(result: TSimulationResult, pieceId: string): number[] {
	return result.hits
		.flatMap((hit) => (hit.pieceId === pieceId && hit.actualTime != null ? [hit.actualTime] : []))
		.sort((a, b) => a - b);
}

/**
 * Times any marble starts touching the piece, sorted. A rolling marble starts contact again and again, so starts
 * within `CONTACT_MERGE` of the previous kept one are dropped.
 */
function contactTimesFor(result: TSimulationResult, pieceId: string): number[] {
	const times = result.contacts
		.flatMap((contact) => (contact.kind === 'piece' && contact.otherId === pieceId ? [contact.time] : []))
		.sort((a, b) => a - b);
	const merged: number[] = [];
	for (const time of times) {
		const last = merged[merged.length - 1];
		if (last == null || time - last >= CONTACT_MERGE) merged.push(time);
	}
	return merged;
}

/** Packs fixed-width records into little-endian Float32 bytes */
export function encodeRecords(records: number[][]): Uint8Array {
	const width = records[0]?.length ?? 0;
	const bytes = new Uint8Array(records.length * width * 4);
	const view = new DataView(bytes.buffer);
	let offset = 0;
	for (const record of records) {
		for (const value of record) {
			view.setFloat32(offset, value, true);
			offset += 4;
		}
	}
	return bytes;
}

/** The pitch of the note a platform plays; a piece that follows or stands free plays none */
function notePitchOf(project: TProject, piece: TPiece | undefined): { notePitch?: number } {
	const link = tieOf(piece);
	if (link == null || link.kind === 'follows' || getPieceDefinition(piece?.type ?? '')?.musical !== true) return {};
	const pitch = project.marbles.find((marble) => marble.id === link.marbleId)?.hits.find((hit) => hit.id === link.hitId)?.pitch;
	return pitch == null ? {} : { notePitch: pitch };
}

function themeOverridesOf(project: TProject): { themeOverrides?: TSceneThemeOverrides } {
	const overrides = sceneThemeOverrides(project.film);
	return overrides != null ? { themeOverrides: overrides } : {};
}

function themePartsOf(project: TProject): { themeParts?: TThemeParts } {
	const parts = sceneThemeParts(project.film);
	return parts != null ? { themeParts: parts } : {};
}
