import type { TProject } from '@/modules/project';
import { getPieceDefinition } from '@/modules/simulation/pieces';
import type { TSimulationResult } from '@/modules/simulation/types';
import { SCENE_DESCRIPTION_VERSION, type TSceneDescription, type TSceneMarble, type TScenePiece } from './scene-description';

export const MOTION_FOLDER = '.cache/motion';
export const SCENE_DESCRIPTION_PATH = '.cache/scene.json';
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

	const marbles: TSceneMarble[] = result.marbles.map((track) => {
		const entity = entities.get(track.entityId);
		const motionPath = `${MOTION_FOLDER}/${track.entityId}.bin`;
		const bytes = encodeRecords(
			track.samples.map((sample) => [sample.time, sample.position.x, sample.position.y, sample.angle])
		);
		motionFiles.push({ path: motionPath, bytes });
		return {
			id: track.entityId,
			name: entity?.name ?? track.entityId,
			radius: track.radius,
			color: entity?.components.marble?.color ?? DEFAULT_MARBLE_COLOR,
			motionPath,
			sampleCount: track.samples.length
		};
	});

	const pieces: TScenePiece[] = result.pieces.map((piece) => {
		const entity = entities.get(piece.entityId);
		const laneId = entity?.components.hitLink?.laneId;
		return {
			id: piece.entityId,
			name: entity?.name ?? piece.entityId,
			type: piece.type,
			params: { ...piece.params },
			position: { x: piece.position.x, y: piece.position.y },
			angle: piece.angle,
			wallOffset: getPieceDefinition(piece.type)?.wallOffset ?? 0,
			hitTimes: hitTimesFor(result, piece.entityId),
			motionPath: null,
			sampleCount: 0,
			skin: entity?.components.skin ?? null,
			color: (laneId != null ? laneColors.get(laneId) : undefined) ?? DEFAULT_PIECE_COLOR
		};
	});

	return {
		description: {
			version: SCENE_DESCRIPTION_VERSION,
			projectId: project.id,
			revision: project.revision,
			fps: options.fps,
			duration: result.duration,
			frame: { width: project.frame.width, height: project.frame.height },
			theme: project.design.theme,
			marbles,
			pieces
		},
		motionFiles
	};
}

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
