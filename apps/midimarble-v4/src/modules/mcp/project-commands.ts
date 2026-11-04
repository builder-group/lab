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
import { z } from 'zod';
import { applyProjectCommands, SComponents, SDesign, SEntity, SHit, SLane, SPhysics, SSource, STempo, type TEntity, type TProject, type TProjectCommand, type TVec2 } from '@/modules/project';
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
	/** False when the commands leave the project as it was, which makes no Undo step */
	isChange: boolean;
}

const SVec = z.strictObject({ x: z.number(), y: z.number() });
const SComponentName = z.enum(Object.keys(SComponents.shape) as [keyof typeof SComponents.shape, ...(keyof typeof SComponents.shape)[]]);

/** Each command's fields, strictly: a wrong shape is an error that names the field, never an empty Undo step */
const COMMAND_SHAPES: Record<string, { schema: z.ZodType; example: string }> = {
	setTitle: { schema: z.strictObject({ type: z.string(), title: z.string() }), example: "{ type: 'setTitle', title: 'Name' }" },
	setEnd: { schema: z.strictObject({ type: z.string(), end: z.number().positive() }), example: "{ type: 'setEnd', end: 32 }" },
	setFrame: { schema: z.strictObject({ type: z.string(), width: z.number().positive(), height: z.number().positive() }), example: "{ type: 'setFrame', width: 9, height: 16 }" },
	upsertSource: { schema: z.strictObject({ type: z.string(), source: SSource }), example: "{ type: 'upsertSource', source }" },
	removeSource: { schema: z.strictObject({ type: z.string(), sourceId: z.string() }), example: "{ type: 'removeSource', sourceId }" },
	upsertLane: { schema: z.strictObject({ type: z.string(), lane: SLane.partial({ hits: true }) }), example: "{ type: 'upsertLane', lane }" },
	removeLane: { schema: z.strictObject({ type: z.string(), laneId: z.string() }), example: "{ type: 'removeLane', laneId }" },
	upsertHits: { schema: z.strictObject({ type: z.string(), laneId: z.string(), hits: z.array(SHit) }), example: "{ type: 'upsertHits', laneId, hits: [{ id, time }] }" },
	removeHits: { schema: z.strictObject({ type: z.string(), laneId: z.string(), hitIds: z.array(z.string()) }), example: "{ type: 'removeHits', laneId, hitIds: [] }" },
	assignHits: { schema: z.strictObject({ type: z.string(), hitIds: z.array(z.string()), laneId: z.string() }), example: "{ type: 'assignHits', hitIds: [], laneId }" },
	setBackingInstrument: { schema: z.strictObject({ type: z.string(), instrument: z.number().int().nullable() }), example: "{ type: 'setBackingInstrument', instrument: 0 }" },
	upsertEntity: { schema: z.strictObject({ type: z.string(), entity: SEntity }), example: "{ type: 'upsertEntity', entity: { id, name, components } }" },
	removeEntities: { schema: z.strictObject({ type: z.string(), entityIds: z.array(z.string()) }), example: "{ type: 'removeEntities', entityIds: [] }" },
	setComponent: {
		schema: z
			.strictObject({ type: z.string(), entityId: z.string(), component: z.strictObject({ name: SComponentName, value: z.unknown() }) })
			.superRefine((command, context) => {
				const checked = (SComponents.shape[command.component.name] as z.ZodType).safeParse(command.component.value);
				if (checked.success && command.component.value != null) return;
				for (const issue of checked.success ? [{ path: [], message: 'is required' }] : checked.error.issues) context.addIssue({ code: 'custom', path: ['component', 'value', ...issue.path], message: issue.message });
			}),
		example: "{ type: 'setComponent', entityId, component: { name: 'release', value: { position: { x, y }, time } } }"
	},
	removeComponent: { schema: z.strictObject({ type: z.string(), entityId: z.string(), name: SComponentName }), example: "{ type: 'removeComponent', entityId, name }" },
	setDesign: { schema: z.strictObject({ type: z.string(), design: SDesign.partial() }), example: "{ type: 'setDesign', design: { theme: 'id' } }" },
	setPhysics: { schema: z.strictObject({ type: z.string(), physics: SPhysics }), example: "{ type: 'setPhysics', physics: { gravityScale: 0.5 } }" },
	setTempo: { schema: z.strictObject({ type: z.string(), tempo: STempo.nullable() }), example: "{ type: 'setTempo', tempo: { bpm: 120, beatsPerBar: 4 } }" },
	placePiece: {
		schema: z.strictObject({ type: z.string(), pieceType: z.string(), hit: z.strictObject({ laneId: z.string(), hitId: z.string() }).optional(), position: SVec.optional(), angle: z.number().optional(), params: z.record(z.string(), z.number()).optional(), name: z.string().optional(), path: z.array(SVec).optional() }),
		example: "{ type: 'placePiece', pieceType: 'platform', hit: { laneId, hitId }, angle }"
	},
	applySkin: { schema: z.strictObject({ type: z.string(), assetId: z.string(), pieceType: z.string().optional(), entityIds: z.array(z.string()).optional() }), example: "{ type: 'applySkin', assetId, pieceType }" },
	placeDecor: { schema: z.strictObject({ type: z.string(), source: z.string(), at: SVec }), example: "{ type: 'placeDecor', source: 'decor:snowfall', at: { x, y } }" },
	scatterDecor: { schema: z.strictObject({ type: z.string(), sources: z.array(z.string()).optional(), density: z.number().optional(), seed: z.number().optional() }), example: "{ type: 'scatterDecor', sources: [], density: 0.2 }" }
};

/** Why a command's fields don't fit, in words that show the shape it takes; null when they fit */
export function commandProblem(command: { type: string }): string | null {
	const shape = COMMAND_SHAPES[command.type];
	if (shape == null) return `There is no project command called ${command.type}. They are: ${Object.keys(COMMAND_SHAPES).join(', ')}.`;
	const checked = shape.schema.safeParse(command);
	if (checked.success) return null;
	const issues = checked.error.issues.map((issue) => {
		const where = issue.path.join('.');
		if (issue.code === 'unrecognized_keys') return `${where !== '' ? `${where} has ` : ''}unknown ${issue.keys.length === 1 ? 'field' : 'fields'} ${issue.keys.join(', ')}`;
		return `${where !== '' ? `${where}: ` : ''}${issue.message.toLowerCase()}`;
	});
	return `${command.type} doesn't fit: ${issues.join('; ')}. It looks like ${shape.example}.`;
}

/** A marble's start is its release, and its transform is never read, so moving one that way would look done and do nothing */
function misleadingComponent(project: TProject, command: TAgentCommand): string | null {
	if (command.type !== 'setComponent' || command.component.name !== 'transform') return null;
	const entity = project.entities.find((item) => item.id === command.entityId);
	if (entity?.components.marble == null) return null;
	return "A marble starts at its release, not a transform. Use { type: 'setComponent', entityId, component: { name: 'release', value: { position: { x, y }, time } } }.";
}

export function expandCommands(project: TProject, result: TSimulationResult | null, items: readonly TLibraryItem[], input: readonly TAgentCommand[]): TResult<TExpandedCommands, Error> {
	const commands: TProjectCommand[] = [];
	const createdIds: string[] = [];
	let running = project;
	for (const command of input) {
		const problem = commandProblem(command) ?? misleadingComponent(running, command);
		if (problem != null) return Err(new Error(problem));
		const [isExpandedOk, expandedErr, expanded] = expandOne(running, result, items, command);
		if (!isExpandedOk) return Err(expandedErr);
		const [isAppliedOk, appliedErr, applied] = applyProjectCommands(running, expanded.commands);
		if (!isAppliedOk) return Err(appliedErr);
		running = applied;
		commands.push(...expanded.commands);
		if (expanded.entity != null) createdIds.push(expanded.entity.id);
	}
	return Ok({ commands, createdIds, summary: summaryOf(input), isChange: JSON.stringify({ ...running, revision: 0 }) !== JSON.stringify({ ...project, revision: 0 }) });
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
