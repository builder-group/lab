import type { TDesign, TProject } from '@/modules/project';
import { createLoop } from '@/modules/simulation/loop';
import { getPieceDefinition } from '@/modules/simulation/pieces';
import type { TMarbleSample, TMarbleTrack, TSimulationResult } from '@/modules/simulation/types';
import {
	SCENE_DESCRIPTION_VERSION,
	type TSceneCamera,
	type TSceneDescentPoint,
	type TSceneDescription,
	type TSceneMarble,
	type TScenePiece
} from './scene-description';

export const MOTION_FOLDER = '.cache/motion';
export const SCENE_DESCRIPTION_PATH = '.cache/scene.json';
/** The loop ghost of a marble is the holder `<marble ID>~loop` */
export const LOOP_GHOST_SUFFIX = '~loop';
const DEFAULT_PIECE_COLOR = '#c8b89a';
const DEFAULT_MARBLE_COLOR = '#d0d4dc';

/**
 * Builds the `apply_scene` description and the binary motion files it references from a simulation result.
 * Marble records are [time, x, y, angle] and use the physics samples as they are; the worker resamples
 * them at `fps`.
 */
export function buildSceneDescription(
	project: TProject,
	result: TSimulationResult,
	options: { fps: number }
): TSceneBuild {
	const entities = new Map(project.entities.map((entity) => [entity.id, entity]));
	const laneColors = new Map(project.music.lanes.map((lane) => [lane.id, lane.color]));
	const motionFiles: TMotionFile[] = [];

	const marbleFor = (track: TMarbleTrack, id: string, samples: TMarbleSample[]): TSceneMarble => {
		const entity = entities.get(track.entityId);
		const motionPath = `${MOTION_FOLDER}/${id}.bin`;
		const bytes = encodeRecords(
			samples.map((sample) => [sample.time, sample.position.x, sample.position.y, sample.angle])
		);
		motionFiles.push({ path: motionPath, bytes });
		return {
			id,
			name: entity?.name ?? track.entityId,
			radius: track.radius,
			color: entity?.components.marble?.color ?? DEFAULT_MARBLE_COLOR,
			motionPath,
			sampleCount: samples.length
		};
	};
	const marbles: TSceneMarble[] = result.marbles.map((track) => marbleFor(track, track.entityId, track.samples));
	const loop = project.design.loop ? createLoop(project, result) : null;
	for (const ghost of loop?.ghosts ?? []) {
		const track = result.marbles.find((item) => item.entityId === ghost.marbleEntityId);
		if (track == null || !ghost.samples.length) continue;
		const marble = marbleFor(track, `${track.entityId}${LOOP_GHOST_SUFFIX}`, ghost.samples);
		marbles.push({ ...marble, name: `${marble.name} (loop)`, ghostOf: track.entityId });
	}

	const pieces: TScenePiece[] = result.pieces.map((piece) => {
		const entity = entities.get(piece.entityId);
		const laneId = entity?.components.hitLink?.laneId;
		let motionPath: string | null = null;
		let sampleCount = 0;
		if (piece.motion != null && piece.motion.length > 0) {
			motionPath = `${MOTION_FOLDER}/${piece.entityId}.bin`;
			sampleCount = piece.motion.length;
			motionFiles.push({
				path: motionPath,
				bytes: encodeRecords(piece.motion.map((sample) => [sample.time, sample.angle]))
			});
		}
		return {
			id: piece.entityId,
			name: entity?.name ?? piece.entityId,
			type: piece.type,
			params: { ...piece.params },
			position: { x: piece.position.x, y: piece.position.y },
			angle: piece.angle,
			wallOffset: getPieceDefinition(piece.type)?.wallOffset ?? 0,
			hitTimes: hitTimesFor(result, piece.entityId),
			motionPath,
			sampleCount,
			skin: entity?.components.skin ?? null,
			assetPath: skinAssetPath(entity?.components.skin?.assetId),
			reaction: entity?.components.reaction ?? null,
			color: (laneId != null ? laneColors.get(laneId) : undefined) ?? DEFAULT_PIECE_COLOR,
			path: piece.path?.map((point) => ({ x: point.x, y: point.y })) ?? null,
			paths: piece.paths?.map((wire) => wire.map((point) => ({ x: point.x, y: point.y }))) ?? null
		};
	});

	return {
		description: {
			version: SCENE_DESCRIPTION_VERSION,
			projectId: project.id,
			revision: project.revision,
			fps: options.fps,
			duration: loop?.end ?? result.duration,
			frame: { width: project.frame.width, height: project.frame.height },
			theme: project.design.theme,
			marbles,
			pieces,
			camera: { ...buildSceneCamera(project.design.camera), descent: descentCurve(result) },
			wallTexts: project.entities.flatMap((entity) => {
				const text = entity.components.wallText;
				const transform = entity.components.transform;
				if (text == null || transform == null) return [];
				return [{ id: entity.id, ...text, position: { ...transform.position }, angle: transform.angle }];
			}),
			loop: loop != null ? { start: loop.start, end: loop.end, blend: loop.blend } : null
		},
		motionFiles
	};
}

export function buildSceneCamera(camera: TDesign['camera']): TSceneCamera {
	return {
		mode: camera.mode,
		distance: camera.distance,
		pitch: camera.pitch,
		lead: camera.lead,
		smoothing: camera.smoothing,
		shots: camera.shots.map((shot) => ({ time: shot.time, kind: shot.kind, roll: shot.roll, distance: shot.distance })),
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

/** Package-relative `.blend` of a project library skin; built-in IDs with a colon such as `brass:gold` have none */
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
function hitTimesFor(result: TSimulationResult, entityId: string): number[] {
	return result.hits
		.flatMap((hit) => (hit.pieceEntityId === entityId && hit.actualTime != null ? [hit.actualTime] : []))
		.sort((a, b) => a - b);
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
