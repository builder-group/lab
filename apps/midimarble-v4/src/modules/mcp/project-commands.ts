import { Err, Ok, type TResult } from 'tuple-result';
import { createFreePiece } from '@/modules/compose/attach-edit';
import { pieceForHit } from '@/modules/compose/step-loop';
import { addDecorCommands, assetDecorSource, builtInSource, $blenderObjects } from '@/modules/design/decor';
import { decorItem } from '@/modules/design/decor-catalog';
import { DEFAULT_SCATTER_DENSITY, scatterDecorCommands } from '@/modules/design/decor-scatter';
import { readScatterChoice } from '@/modules/design/decor-actions';
import { skinCommands } from '@/modules/design/design-commands';
import { filmCamera } from '@/modules/design/film-camera';
import type { TLibraryItem } from '@/modules/library';
import { applyProjectCommands, type TEntity, type TProject, type TProjectCommand, type TVec2 } from '@/modules/project';
import { getPieceDefinition, type TSimulationResult } from '@/modules/simulation';

// `project.execute` takes the project's own commands plus a few that say what an agent means, so it needs not know a
// piece's every field. Each expands here into project commands, against the project as the earlier ones left it.

export type TAgentCommand =
	| TProjectCommand
	| {
			type: 'placePiece';
			pieceType: string;
			/** Tied to a hit, as a click on its dot ties a platform */
			hit?: { laneId: string; hitId: string };
			/** A free piece at this wall point */
			position?: TVec2;
			/** Surface angle in radians; the app picks one for a hit without it */
			angle?: number;
			params?: Record<string, number>;
			name?: string;
			/** A rail's or tunnel's points on the wall */
			path?: TVec2[];
	  }
	/** A library item as the skin of a piece type or of pieces */
	| { type: 'applySkin'; assetId: string; pieceType?: string; entityIds?: string[] }
	/** A decoration at a wall point: `source` is a built-in `decor:` id or `assets/<id>/asset.blend` */
	| { type: 'placeDecor'; source: string; at: TVec2 }
	/** Scatter Decor: fills the free wall the camera sees and replaces what it placed before */
	| { type: 'scatterDecor'; sources?: string[]; density?: number; seed?: number };

export interface TExpandedCommands {
	commands: TProjectCommand[];
	/** Pieces made by `placePiece`, which the window then selects */
	createdIds: string[];
	/** What the edit did when it can be said in a word, for its Undo step: "Place Platform" */
	summary: string | null;
}

const PROJECT_COMMAND_TYPES = new Set<string>(['setTitle', 'setEnd', 'setFrame', 'upsertSource', 'removeSource', 'upsertLane', 'removeLane', 'upsertHits', 'removeHits', 'assignHits', 'setBackingInstrument', 'upsertEntity', 'removeEntities', 'setComponent', 'removeComponent', 'setDesign', 'setPhysics', 'setTempo']);

export function expandCommands(project: TProject, result: TSimulationResult | null, items: readonly TLibraryItem[], input: readonly TAgentCommand[]): TResult<TExpandedCommands, Error> {
	const commands: TProjectCommand[] = [];
	const createdIds: string[] = [];
	let running = project;
	for (const command of input) {
		const [isExpandedOk, expandedErr, expanded] = expandOne(running, result, items, command);
		if (!isExpandedOk) return Err(expandedErr);
		const [isAppliedOk, appliedErr, applied] = applyProjectCommands(running, expanded.commands);
		if (!isAppliedOk) return Err(appliedErr);
		running = applied;
		commands.push(...expanded.commands);
		if (expanded.entity != null) createdIds.push(expanded.entity.id);
	}
	return Ok({ commands, createdIds, summary: summaryOf(input) });
}

function expandOne(project: TProject, result: TSimulationResult | null, items: readonly TLibraryItem[], command: TAgentCommand): TResult<{ commands: TProjectCommand[]; entity?: TEntity }, Error> {
	switch (command.type) {
		case 'placePiece': {
			const [isPieceOk, pieceErr, entity] = placedPiece(project, result, command);
			return isPieceOk ? Ok({ commands: [{ type: 'upsertEntity', entity }], entity }) : Err(pieceErr);
		}
		case 'applySkin': {
			const target = command.entityIds != null ? { kind: 'entities' as const, entityIds: command.entityIds } : command.pieceType != null ? { kind: 'pieceType' as const, pieceType: command.pieceType } : null;
			if (target == null) return Err(new Error('applySkin needs a pieceType or entityIds'));
			if (command.assetId.includes(':') || items.some((item) => item.id === command.assetId)) {
				const commands = skinCommands(project, target, command.assetId);
				return commands.length > 0 ? Ok({ commands }) : Err(new Error(`No pieces match that target, so ${command.assetId} has nothing to dress`));
			}
			return Err(new Error(`${command.assetId} isn't in this project's library. Add it with add_asset first.`));
		}
		case 'placeDecor': {
			const source = decorSource(items, command.source);
			if (source == null) return Err(new Error(`${command.source} isn't a Decor item of this project`));
			return Ok({ commands: addDecorCommands(project, source, command.at).commands });
		}
		case 'scatterDecor': {
			if (result == null || result.revision !== project.revision) return Err(new Error('The run is still updating. Try Scatter Decor again in a moment.'));
			const track = filmCamera(project, result).track;
			if (track == null) return Err(new Error('The run has no camera path yet, so Decor has no wall to fill'));
			const sources = (command.sources ?? readScatterChoice()).flatMap((source: string) => decorSource(items, source) ?? []);
			if (sources.length === 0) return Err(new Error('Scatter Decor needs at least one Decor source'));
			const { commands } = scatterDecorCommands(project, result, track, { items: sources, density: command.density ?? DEFAULT_SCATTER_DENSITY, seed: command.seed ?? 1, blenderObjects: $blenderObjects.get() });
			return Ok({ commands });
		}
		default:
			if (!PROJECT_COMMAND_TYPES.has(command.type)) return Err(new Error(`Unknown project command: ${String((command as { type: unknown }).type)}`));
			return Ok({ commands: [command] });
	}
}

function placedPiece(project: TProject, result: TSimulationResult | null, command: Extract<TAgentCommand, { type: 'placePiece' }>): TResult<TEntity, Error> {
	const definition = getPieceDefinition(command.pieceType);
	if (definition == null) return Err(new Error(`There is no piece called ${command.pieceType}`));
	let entity: TEntity;
	if (command.hit != null) {
		const hit = command.hit;
		const target = result?.hits.find((item) => item.laneId === hit.laneId && item.hitId === hit.hitId);
		if (target?.dot == null) return Err(new Error(`Hit ${hit.hitId} has no dot yet. Place the hits before it first.`));
		entity = pieceForHit(project, target, command.pieceType);
	} else if (command.position != null) {
		entity = createFreePiece(command.pieceType, { position: command.position, angle: command.angle ?? 0 }, project.entities, command.path != null ? { points: command.path } : undefined);
	} else {
		return Err(new Error('placePiece needs a hit or a position'));
	}
	const { piece, hitLink, transform } = entity.components;
	if (command.params != null && piece != null) piece.params = { ...piece.params, ...command.params };
	if (command.angle != null && hitLink != null) hitLink.angle = command.angle;
	if (command.angle != null && hitLink == null && transform != null) transform.angle = command.angle;
	if (command.path != null && command.hit != null) entity.components.path = { points: command.path };
	if (command.name != null) entity.name = command.name;
	return Ok(entity);
}

function decorSource(items: readonly TLibraryItem[], source: string): ReturnType<typeof builtInSource> | null {
	if (decorItem(source) != null) return builtInSource(source);
	const id = /^assets\/(.+)\/asset\.blend$/.exec(source)?.[1] ?? source;
	const item = items.find((candidate) => candidate.id === id);
	return item?.manifest != null ? assetDecorSource(item.id, item.manifest.label, item.manifest.fittedParams) : null;
}

function summaryOf(input: readonly TAgentCommand[]): string | null {
	const [first] = input;
	if (first == null) return null;
	const isSame = input.every((command) => command.type === first.type);
	if (!isSame) return null;
	const count = input.length > 1 ? ` (${input.length})` : '';
	switch (first.type) {
		case 'placePiece':
			return `Place ${getPieceDefinition(first.pieceType)?.label ?? 'Piece'}${count}`;
		case 'applySkin':
			return `Apply Skin${count}`;
		case 'placeDecor':
			return `Place Decor${count}`;
		case 'scatterDecor':
			return 'Scatter Decor';
		default:
			return null;
	}
}
