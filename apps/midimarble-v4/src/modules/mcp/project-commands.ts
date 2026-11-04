import { Err, Ok, type TResult } from 'tuple-result';
import { createFreePiece } from '@/modules/compose/attach-edit';
import { pieceForHit } from '@/modules/compose/step-loop';
import { addDecorCommands, assetDecorSource, builtInSource, $blenderObjects } from '@/modules/design/decor';
import { decorItem } from '@/modules/design/decor-catalog';
import { DEFAULT_SCATTER_DENSITY, scatterDecorCommands } from '@/modules/design/decor-scatter';
import { readScatterChoice } from '@/modules/design/decor-actions';
import { fixedColorCommands, skinCommands, skinTargetIds } from '@/modules/design/design-commands';
import { packThemeCommands } from '@/modules/design/packs';
import { isBuiltInTheme, projectThemes } from '@/modules/design/project-themes';
import { catalogSkin, catalogSkins, elementLabel, entitySkinElement, SKIN_ELEMENTS, skinElement, type TSkinElement } from '@/modules/design/skin-catalog';
import { filmCamera } from '@/modules/design/film-camera';
import type { TLibraryItem } from '@/modules/library';
import { z } from 'zod';
import { applyProjectCommands, SComponents, SDesign, SEntity, SHit, SLane, SPhysics, SSource, STempo, type TEntity, type TProject, type TProjectCommand, type TProjectTheme, type TVec2 } from '@/modules/project';
import { canonicalSkinId } from '@/modules/project/skin-ids';
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
	/** What the edit does beyond what it says, for the reply */
	notices: string[];
}

const SVec = z.strictObject({ x: z.number(), y: z.number() });
const SComponentName = z.enum(Object.keys(SComponents.shape) as [keyof typeof SComponents.shape, ...(keyof typeof SComponents.shape)[]]);

const DESIGN_EXAMPLE_LINE = "{ type: 'setDesign', design: { theme: 'brass' } }";

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
		example: "{ type: 'setComponent', entityId, component: { name: 'release', value: { position: { x, y }, time } } }, with name one of marble, release, piece, transform, hitLink, path, skin, reaction or wallText"
	},
	removeComponent: { schema: z.strictObject({ type: z.string(), entityId: z.string(), name: SComponentName }), example: "{ type: 'removeComponent', entityId, name }" },
	setDesign: { schema: z.strictObject({ type: z.string(), design: SDesign.partial() }), example: DESIGN_EXAMPLE_LINE },
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

/** What `setDesign` takes, field by field: an error shows the field that went wrong, not the same line every time */
const DESIGN_EXAMPLES: Record<string, string> = {
	theme: "{ type: 'setDesign', design: { theme: 'brass' } }, with pegboard, brass, neon or an id from get_state.themes",
	wall: "{ type: 'setDesign', design: { wall: { color: '#f6e3b8', backgroundColor: '#fff2d2', kind: 'plain' } } }, with kind plain, plaster, pegboard or grid",
	lights: "{ type: 'setDesign', design: { lights: { key: { color: '#ffd08a', strength: 4, side: 0.4, height: 0.3, softness: 0.2, exposure: 0, bloom: 0.2 } } } }; lights has key and added, a film has one Key Light",
	camera: "{ type: 'setDesign', design: { camera: { distance: 0.7, pitch: 1.15, lead: 0.15, smoothing: 0.6, sway: 0, mode: 'rig' } } }; name only what changes. A shot looks like { id, time, kind: 'wide', roll: 0, distance: 1.1 }, with kind wide, follow, pushIn or closeUp",
	renderPreset: "{ type: 'setDesign', design: { renderPreset: 'balanced' } }, with draft, fast (Standard), balanced (High) or best",
	loop: "{ type: 'setDesign', design: { loop: true } }",
	decor: 'Decor is easier with placeDecor and scatterDecor',
	themes: "A stored theme looks like { id, name, base: 'brass', overrides: { wallColor } }"
};

function designExample(issues: readonly { path: PropertyKey[] }[]): string {
	const field = issues.map((issue) => issue.path[1]).find((name) => typeof name === 'string' && name in DESIGN_EXAMPLES);
	return typeof field === 'string' ? (DESIGN_EXAMPLES[field] ?? '') : `design takes ${Object.keys(DESIGN_EXAMPLES).join(', ')}. The film-look guide lists their fields`;
}

/** A library's words as a sentence's: its first letter low, and names such as wallText as they are */
function issueWords(message: string): string {
	return `${message.charAt(0).toLowerCase()}${message.slice(1)}`;
}

/** Why a command's fields don't fit, in words that show the shape it takes; null when they fit */
export function commandProblem(command: { type: string }): string | null {
	const shape = COMMAND_SHAPES[command.type];
	if (shape == null) return `There is no project command called ${command.type}. They are: ${Object.keys(COMMAND_SHAPES).join(', ')}.`;
	const checked = shape.schema.safeParse(command);
	if (checked.success) return null;
	const issues = checked.error.issues.map((issue) => {
		const where = issue.path.join('.');
		if (issue.code === 'unrecognized_keys') return `${where !== '' ? `${where} has ` : ''}unknown ${issue.keys.length === 1 ? 'field' : 'fields'} ${issue.keys.join(', ')}`;
		return `${where !== '' ? `${where}: ` : ''}${issueWords(issue.message)}`;
	});
	const example = command.type === 'setDesign' ? designExample(checked.error.issues) : `It looks like ${shape.example}`;
	return `${command.type} doesn't fit: ${issues.join('; ')}. ${example}.`;
}

/**
 * What an agent means by a part of a value: `setDesign` changes only the named fields of the camera, wall and lights, and
 * `setComponent` only those of a marble, title or skin, so nothing has to be read back first or guessed, like a radius.
 */
function withCurrentValues(project: TProject, command: TAgentCommand): TAgentCommand {
	if (command.type === 'setDesign') {
		const { design } = project;
		const patch = command.design as Record<string, unknown>;
		const merged = { ...patch };
		if (isObject(patch['camera'])) merged['camera'] = { ...design.camera, ...patch['camera'] };
		if (isObject(patch['wall'])) merged['wall'] = { ...design.wall, ...patch['wall'] };
		if (isObject(patch['lights'])) {
			const key = patch['lights']['key'];
			merged['lights'] = { ...design.lights, ...patch['lights'], ...(isObject(key) ? { key: { ...design.lights?.key, ...key } } : {}) };
		}
		return { ...command, design: merged } as TAgentCommand;
	}
	if (command.type !== 'setComponent' || !isObject(command.component)) return command;
	const { name, value } = command.component as { name?: unknown; value?: unknown };
	if (!isObject(value) || (name !== 'marble' && name !== 'wallText' && name !== 'skin')) return command;
	const entity = project.entities.find((item) => item.id === command.entityId);
	const current = entity?.components[name];
	return { ...command, component: { name, value: { ...(name === 'skin' ? { link: 'linked' } : {}), ...current, ...value } } } as TAgentCommand;
}

function isObject(value: unknown): value is Record<string, unknown> {
	return value != null && typeof value === 'object' && !Array.isArray(value);
}

/** Every built-in skin's id, by element, as `list_commands` gives them; theme-only ones such as `marble:contrast` too */
export function builtInSkinIds(): Record<TSkinElement, string[]> {
	return Object.fromEntries(SKIN_ELEMENTS.map((element) => [element, catalogSkins(element).map((skin) => skin.id)])) as Record<TSkinElement, string[]>;
}

/** Why a skin can't dress an element, or null: an unknown built-in id, another element's, or something not in the library */
function skinProblem(assetId: string, element: TSkinElement, items: readonly TLibraryItem[]): string | null {
	const label = elementLabel(element);
	if (assetId.includes(':')) {
		const id = canonicalSkinId(assetId);
		const skin = catalogSkin(id);
		if (skin == null) return `There is no skin called ${assetId}. ${label} skins are ${catalogSkins(element).map((item) => item.id).join(', ')}; list_commands lists them all.`;
		if (skin.element !== element) return `${assetId} is a ${elementLabel(skin.element)} skin, so it can't dress a ${label}. ${label} skins are ${catalogSkins(element).map((item) => item.id).join(', ')}.`;
		return null;
	}
	const item = items.find((candidate) => candidate.id === assetId);
	if (item == null) return `${assetId} isn't in this project's library. Add it with add_asset first; list_commands lists what is there.`;
	if (item.manifest?.role !== 'skin') return `${assetId} isn't a skin. It's Decor: place it with placeDecor.`;
	const fit = item.manifest.pieceType;
	if (fit != null ? fit !== element : element === 'marble') return `${item.manifest.label} is a ${fit != null ? fit : 'piece'} skin, so it can't dress a ${label}.`;
	return null;
}

const KNOWN_FONT = /\.(ttf|otf|ttc)$/i;
const BUILT_IN_FONT = 'Bfont Regular';
const MARBLE_RADIUS = { min: 0.004, max: 0.04 };

function titleProblem(text: NonNullable<TEntity['components']['wallText']>): string | null {
	if (text.font === BUILT_IN_FONT || KNOWN_FONT.test(text.font)) return null;
	return `${text.font} isn't a font a title can use, and it would show in the built-in one. Use '${BUILT_IN_FONT}' or a .ttf or .otf file in the project, such as assets/fonts/name.ttf.`;
}

function entityProblem(project: TProject, items: readonly TLibraryItem[], entity: TEntity): string | null {
	const { skin, wallText, marble } = entity.components;
	const element = entitySkinElement(entity);
	if (skin?.assetId != null && element != null) {
		const problem = skinProblem(skin.assetId, element, items);
		if (problem != null) return problem;
	}
	if (wallText != null) {
		const problem = titleProblem(wallText);
		if (problem != null) return problem;
	}
	if (marble != null) {
		if (marble.radius < MARBLE_RADIUS.min || marble.radius > MARBLE_RADIUS.max) return `A marble's radius is in metres, from ${MARBLE_RADIUS.min} to ${MARBLE_RADIUS.max}; ${marble.radius} is outside that. get_state.marbles[].radius has the current one.`;
		if (!/^#[0-9a-fA-F]{6}$/.test(marble.color)) return `A marble's color is like #ff1a2e; ${marble.color} isn't.`;
		if (!project.music.lanes.some((lane) => lane.id === marble.laneId)) return `There is no lane ${marble.laneId}. get_state.marbles[].laneId lists them.`;
	}
	return null;
}

const NO_ENTITY = 'get_state lists them: marbles[].entityId, layers.pieces[].id, layers.titles[].id.';

/** Why a command that fits its shape still can't run on this project: an id or value it names isn't there */
function valueProblem(project: TProject, items: readonly TLibraryItem[], packThemes: readonly TProjectTheme[], command: TAgentCommand): string | null {
	const missingLane = (laneId: string): string | null => (laneId === 'backing' || project.music.lanes.some((lane) => lane.id === laneId) ? null : `There is no lane ${laneId}. get_state.marbles[].laneId lists them.`);
	const missingEntity = (entityId: string): string | null => (project.entities.some((entity) => entity.id === entityId) ? null : `There is nothing called ${entityId}. ${NO_ENTITY}`);
	switch (command.type) {
		case 'setComponent': {
			const entity = project.entities.find((item) => item.id === command.entityId);
			if (entity == null) return missingEntity(command.entityId);
			return entityProblem(project, items, { ...entity, components: { ...entity.components, [command.component.name]: command.component.value } });
		}
		case 'removeComponent': {
			const entity = project.entities.find((item) => item.id === command.entityId);
			if (entity == null) return missingEntity(command.entityId);
			return entity.components[command.name] == null ? `${entity.name ?? entity.id} has no ${command.name}.` : null;
		}
		case 'upsertEntity':
			return entityProblem(project, items, command.entity);
		case 'removeEntities':
			return command.entityIds.map(missingEntity).find((problem) => problem != null) ?? null;
		case 'removeSource':
			return project.music.sources.some((source) => source.id === command.sourceId) ? null : `There is no source ${command.sourceId}. get_state.song.sources lists them.`;
		case 'removeLane':
		case 'upsertHits':
		case 'assignHits':
			return missingLane(command.laneId);
		case 'removeHits': {
			const lane = missingLane(command.laneId);
			if (lane != null) return lane;
			const owner = project.music.lanes.find((item) => item.id === command.laneId);
			const missing = owner == null ? undefined : command.hitIds.find((id) => !owner.hits.some((hit) => hit.id === id));
			return missing != null ? `There is no hit ${missing} on that lane. get_state.marbles[].hitList lists them.` : null;
		}
		case 'setDesign':
			return designProblem(project, items, packThemes, command.design);
		case 'applySkin': {
			if (command.pieceType != null && command.pieceType !== 'marble' && getPieceDefinition(command.pieceType) == null) return `There is no piece type ${command.pieceType}. Use one from ${SKIN_ELEMENTS.join(', ')}.`;
			for (const id of command.entityIds ?? []) {
				const entity = project.entities.find((item) => item.id === id);
				if (entity == null) return missingEntity(id);
				if (entitySkinElement(entity) == null) return `${entity.name ?? id} is neither a piece nor a marble, so it wears no skin.`;
			}
			const targets = project.entities.filter((entity) => command.entityIds?.includes(entity.id) ?? (entity.components.piece?.type ?? (entity.components.marble != null ? 'marble' : null)) === command.pieceType);
			for (const entity of targets) {
				const element = entitySkinElement(entity);
				const problem = element != null ? skinProblem(command.assetId, element, items) : null;
				if (problem != null) return problem;
			}
			// With nothing of that type yet, the skin itself can still be wrong
			if (targets.length === 0 && command.pieceType != null) return skinProblem(command.assetId, skinElement(command.pieceType), items);
			return null;
		}
		default:
			return null;
	}
}

function designProblem(project: TProject, items: readonly TLibraryItem[], packThemes: readonly TProjectTheme[], design: Partial<TProject['design']>): string | null {
	const themes = design.themes ?? project.design.themes ?? [];
	if (design.theme != null && !isBuiltInTheme(design.theme) && !themes.some((theme) => theme.id === design.theme) && !packThemes.some((theme) => theme.id === design.theme)) {
		const known = ['pegboard', 'brass', 'neon', ...themes.map((theme) => theme.id), ...packThemes.map((theme) => theme.id)];
		return `There is no theme ${design.theme}. Themes are ${known.join(', ')}.`;
	}
	for (const theme of design.themes ?? []) {
		if (!isBuiltInTheme(theme.base)) return `${theme.name}'s base is pegboard, brass or neon, not ${theme.base}.`;
		for (const [element, part] of Object.entries(theme.parts ?? {})) {
			const problem = part.skin != null ? skinProblem(part.skin, element as TSkinElement, items) : null;
			if (problem != null) return problem;
		}
	}
	const focus = design.camera?.focusMarbleId;
	if (focus != null && !project.entities.some((entity) => entity.id === focus && entity.components.marble != null)) return `There is no marble ${focus}. get_state.marbles[].entityId lists them.`;
	return null;
}

/** A marble's start is its release, and its transform is never read, so moving one that way would look done and do nothing */
function misleadingComponent(project: TProject, command: TAgentCommand): string | null {
	if (command.type !== 'setComponent' || command.component.name !== 'transform') return null;
	const entity = project.entities.find((item) => item.id === command.entityId);
	if (entity?.components.marble == null) return null;
	return "A marble starts at its release, not a transform. Use { type: 'setComponent', entityId, component: { name: 'release', value: { position: { x, y }, time } } }.";
}

export function expandCommands(project: TProject, result: TSimulationResult | null, items: readonly TLibraryItem[], input: readonly TAgentCommand[], packThemes: readonly TProjectTheme[] = []): TResult<TExpandedCommands, Error> {
	const commands: TProjectCommand[] = [];
	const createdIds: string[] = [];
	const notices: string[] = [];
	let running = project;
	for (const given of input) {
		const command = withCurrentValues(running, given);
		const problem = commandProblem(command) ?? misleadingComponent(running, command) ?? valueProblem(running, items, packThemes, command);
		if (problem != null) return Err(new Error(problem));
		const [isExpandedOk, expandedErr, expanded] = expandOne(running, result, items, packThemes, command);
		if (!isExpandedOk) return Err(expandedErr);
		const [isAppliedOk, appliedErr, applied] = applyProjectCommands(running, expanded.commands);
		if (!isAppliedOk) return Err(appliedErr);
		if (changesRadius(running, command)) notices.push('A marble\'s radius changes the run, so hits can move. Read hits in this reply; 0.012 is the usual radius, and Undo takes it back.');
		running = applied;
		commands.push(...expanded.commands);
		if (expanded.entity != null) createdIds.push(expanded.entity.id);
	}
	return Ok({ commands, createdIds, summary: summaryOf(input), isChange: JSON.stringify({ ...running, revision: 0 }) !== JSON.stringify({ ...project, revision: 0 }), notices });
}

function changesRadius(project: TProject, command: TAgentCommand): boolean {
	if (command.type !== 'setComponent' || command.component.name !== 'marble') return false;
	const radius = project.entities.find((entity) => entity.id === command.entityId)?.components.marble?.radius;
	return radius !== command.component.value.radius;
}

function expandOne(project: TProject, result: TSimulationResult | null, items: readonly TLibraryItem[], packThemes: readonly TProjectTheme[], command: TAgentCommand): TResult<{ commands: TProjectCommand[]; entity?: TEntity }, Error> {
	switch (command.type) {
		case 'placePiece': {
			const [isPieceOk, pieceErr, entity] = placedPiece(project, result, command);
			return isPieceOk ? Ok({ commands: [{ type: 'upsertEntity', entity }], entity }) : Err(pieceErr);
		}
		case 'applySkin': {
			const target = command.entityIds != null ? { kind: 'entities' as const, entityIds: command.entityIds } : command.pieceType != null ? { kind: 'pieceType' as const, pieceType: command.pieceType } : null;
			if (target == null) return Err(new Error('applySkin needs a pieceType or entityIds'));
			const fixedColor = items.find((item) => item.id === command.assetId)?.manifest?.color ?? catalogSkin(command.assetId)?.color ?? undefined;
			const commands = [...skinCommands(project, target, command.assetId.includes(':') ? canonicalSkinId(command.assetId) : command.assetId), ...fixedColorCommands(project, skinTargetIds(project, target), fixedColor)];
			return commands.length > 0 ? Ok({ commands }) : Err(new Error(`Nothing is a ${command.pieceType ?? 'target'} in this project yet, so ${command.assetId} has nothing to dress.`));
		}
		case 'setDesign': {
			const theme = packThemes.find((item) => item.id === command.design.theme);
			if (theme == null || projectThemes(project.design).some((item) => item.id === theme.id)) return Ok({ commands: [command] });
			// A Pack's theme joins the project when it is applied, as the Theme picker does it
			const { theme: _theme, ...rest } = command.design;
			const added = packThemeCommands(project, theme);
			return Ok({ commands: Object.keys(rest).length > 0 ? [{ type: 'setDesign', design: rest }, ...added] : added });
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
