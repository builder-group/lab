import { Err, Ok, type TResult } from 'tuple-result';
import { createFreePiece, flattenCommands, moveSongCommands, patternLockWords, patternOfPiece } from '@/modules/building';
import { pieceForHit } from '@/modules/track';
import { addDecorCommands, assetDecorSource, builtInSource, type TBlenderObject, decorItem, packThemeCommands, isBuiltInTheme, themeCommands, catalogSkin, catalogSkins, elementLabel, skinElementOf, SKIN_ELEMENTS, skinElement, type TSkinElement } from '@/modules/scene';
import { DEFAULT_SCATTER_DENSITY, scatterDecorCommands, readScatterChoice, skinCommands } from '@/modules/film';
import { filmCamera } from '@/modules/camera';
import type { TLibraryItem } from '@/modules/scene';
import { z } from 'zod';
import { applyProjectCommands, patched, PROJECT_COMMAND_EXAMPLES, SProjectCommand, type TMarble, type TPackOrigin, type TPackTheme, type TPiece, type TProject, type TProjectCommand, type TSkin, type TTitle } from '@/modules/project';
import { getPieceDefinition, RAIL_LAYOUTS, railLayoutInfo, type TSimulationResult } from '@/modules/simulation';

// `project.execute` takes the project's own commands plus a few that say what an agent means, so it needs not know a
// piece's every field. Each expands here into project commands, against the project as the earlier ones left it.

const SVec = z.strictObject({ x: z.number(), y: z.number() });

const SPlacePiece = z.strictObject({
	type: z.literal('placePiece'),
	pieceType: z.string(),
	/** Tied to a hit, as a click on its dot ties a platform */
	hit: z.strictObject({ marbleId: z.string(), hitId: z.string() }).optional(),
	/** A free piece at this wall point */
	position: SVec.optional(),
	/** Surface angle in radians; the app picks one for a hit without it */
	angle: z.number().optional(),
	params: z.record(z.string(), z.number()).optional(),
	name: z.string().optional(),
	/** A rail's or tunnel's points on the wall */
	path: z.array(SVec).optional(),
	/** A Rail's further paths, in the same coordinates as `path` */
	paths: z.array(z.array(SVec)).optional(),
	/** How a Rail gets its paths: `path` (drawn, the default), `curve`, `c`, `chain` or `switchback`, shaped by `params` such as `turns`, `width` and `drop` */
	layout: z.enum(RAIL_LAYOUTS).optional()
});
/** A library item as the skin of a piece type, or of pieces and marbles by ID */
const SApplySkin = z.strictObject({ type: z.literal('applySkin'), assetId: z.string(), pieceType: z.string().optional(), ids: z.array(z.string()).optional() });
/** A decoration at a wall point: `source` is a built-in `decor:` id or `assets/<id>/asset.blend` */
const SPlaceDecor = z.strictObject({ type: z.literal('placeDecor'), source: z.string(), at: SVec });
/** Scatter Decor: fills the free wall the camera sees and replaces what it placed before */
const SScatterDecor = z.strictObject({ type: z.literal('scatterDecor'), sources: z.array(z.string()).optional(), density: z.number().optional(), seed: z.number().optional() });
/** Wears a theme by its ID: a built-in one or an added Pack's, as the Theme picker does */
const SApplyTheme = z.strictObject({ type: z.literal('applyTheme'), theme: z.string() });
/** Flatten a live Pattern: its pieces stay as they are, to edit one by one, and the Pattern is gone */
const SFlattenPattern = z.strictObject({ type: z.literal('flattenPattern'), groupId: z.string() });

const SAgentCommand = z.discriminatedUnion('type', [...SProjectCommand.options, SPlacePiece, SApplySkin, SApplyTheme, SPlaceDecor, SScatterDecor, SFlattenPattern]);

export type TAgentCommand = z.infer<typeof SAgentCommand>;

/** What each command looks like: an error shows it to an agent, and the guides list every one */
export const AGENT_COMMAND_EXAMPLES: Record<TAgentCommand['type'], string> = {
	...PROJECT_COMMAND_EXAMPLES,
	placePiece: "{ type: 'placePiece', pieceType: 'platform', hit: { marbleId, hitId }, angle }",
	applySkin: "{ type: 'applySkin', assetId, pieceType }",
	applyTheme: "{ type: 'applyTheme', theme: 'brass' }",
	placeDecor: "{ type: 'placeDecor', source: 'decor:snowfall', at: { x, y } }",
	scatterDecor: "{ type: 'scatterDecor', sources: [], density: 0.2 }",
	flattenPattern: "{ type: 'flattenPattern', groupId: 'group-h1' }"
};

/** An added Pack's theme with its items in the project, ready to wear */
export interface TReadyPackTheme {
	theme: TPackTheme;
	origin: TPackOrigin;
}

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

/** What `updateFilm` takes, field by field: an error shows the field that went wrong, not the same line every time */
const FILM_EXAMPLES: Record<string, string> = {
	theme: "To wear a theme use { type: 'applyTheme', theme: 'brass' }. updateFilm's theme changes the one worn: { type: 'updateFilm', film: { theme: { base: 'brass', parts: { platform: { skin: 'platform:copper' } }, glowColor: '#00ff88' } } }",
	wall: "{ type: 'updateFilm', film: { wall: { color: '#f6e3b8', backgroundColor: '#fff2d2', kind: 'plain' } } }, with kind plain, plaster, pegboard, grid or none, the plain Pegboard wall in wall.labelColor, the color it has in Track",
	lights: "{ type: 'updateFilm', film: { lights: { key: { color: '#ffd08a', strength: 4, side: 0.4, height: 0.3, softness: 0.2, exposure: 0, bloom: 0.2 } } } }; lights has key and added, a film has one Key Light",
	camera: "{ type: 'updateFilm', film: { camera: { distance: 0.48, tilt: 0.54, turn: 1.57, sway: 0, auto: true } } }; name only what changes. A shot looks like { id, time, distance: 1.1, hold: 2 }",
	quality: "{ type: 'updateFilm', film: { quality: 'final' } }, with draft or final",
	decor: 'Decor is easier with placeDecor and scatterDecor'
};

function filmExample(issues: readonly { path: PropertyKey[] }[]): string {
	const field = issues.map((issue) => issue.path[1]).find((name) => typeof name === 'string' && name in FILM_EXAMPLES);
	return typeof field === 'string' ? (FILM_EXAMPLES[field] ?? '') : `film takes ${Object.keys(FILM_EXAMPLES).join(', ')}. The film-look guide lists their fields`;
}

/** A library's words as a sentence's: its first letter low, and names such as wallText as they are */
function issueWords(message: string): string {
	return `${message.charAt(0).toLowerCase()}${message.slice(1)}`;
}

/** Why a command's fields don't fit, in words that show the shape it takes; null when they fit */
export function commandProblem(command: { type: string }): string | null {
	const shape = SAgentCommand.options.find((option) => option.shape.type.value === command.type);
	if (shape == null) return `There is no project command called ${command.type}. They are: ${Object.keys(AGENT_COMMAND_EXAMPLES).join(', ')}.`;
	const checked = shape.safeParse(command);
	if (checked.success) return null;
	const issues = checked.error.issues.map((issue) => {
		const where = issue.path.join('.');
		if (issue.code === 'unrecognized_keys') return `${where !== '' ? `${where} has ` : ''}unknown ${issue.keys.length === 1 ? 'field' : 'fields'} ${issue.keys.join(', ')}`;
		return `${where !== '' ? `${where}: ` : ''}${issueWords(issue.message)}`;
	});
	const example = command.type === 'updateFilm' ? filmExample(checked.error.issues) : `It looks like ${AGENT_COMMAND_EXAMPLES[command.type as TAgentCommand['type']]}`;
	return `${command.type} doesn't fit: ${issues.join('; ')}. ${example}.`;
}

/**
 * What an agent means by a part of a value: `updateFilm` changes only the named fields of the camera, wall and lights, and an
 * update only those of a skin or a marble's start, so nothing has to be read back first or guessed.
 */
function withCurrentValues(project: TProject, command: TAgentCommand): TAgentCommand {
	if (command.type === 'updateFilm') {
		const { film } = project;
		const patch = command.film as Record<string, unknown>;
		const merged = { ...patch };
		if (isObject(patch['theme'])) merged['theme'] = { ...film.theme, ...patch['theme'] };
		if (isObject(patch['camera'])) merged['camera'] = { ...film.camera, ...patch['camera'] };
		if (isObject(patch['wall'])) merged['wall'] = { ...film.wall, ...patch['wall'] };
		if (isObject(patch['lights'])) {
			const key = patch['lights']['key'];
			merged['lights'] = { ...film.lights, ...patch['lights'], ...(isObject(key) ? { key: { ...film.lights.key, ...key } } : {}) };
		}
		return { ...command, film: merged } as TAgentCommand;
	}
	if (command.type === 'updatePiece' && isObject(command.patch)) {
		const current = project.track.pieces.find((item) => item.id === command.pieceId);
		return withCurrentSkin(command, current?.skin);
	}
	if (command.type === 'updateMarble' && isObject(command.patch)) {
		const current = project.marbles.find((item) => item.id === command.marbleId);
		const next = withCurrentSkin(command, current?.skin);
		const start = (next.patch as Record<string, unknown>)['start'];
		return isObject(start) && current != null ? ({ ...next, patch: { ...next.patch, start: { ...current.start, ...start } } } as TAgentCommand) : next;
	}
	return command;
}

function withCurrentSkin<GCommand extends { patch: object }>(command: GCommand, current: TSkin | undefined): GCommand {
	const skin = (command.patch as Record<string, unknown>)['skin'];
	return isObject(skin) ? { ...command, patch: { ...command.patch, skin: { ...current, ...skin } } } : command;
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
		const id = assetId;
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

function titleProblem(text: TTitle): string | null {
	if (text.font === BUILT_IN_FONT || KNOWN_FONT.test(text.font)) return null;
	return `${text.font} isn't a font a title can use, and it would show in the built-in one. Use '${BUILT_IN_FONT}' or a .ttf or .otf file in the project, such as assets/fonts/name.ttf.`;
}

function pieceProblem(items: readonly TLibraryItem[], piece: TPiece): string | null {
	return piece.skin?.assetId != null ? skinProblem(piece.skin.assetId, skinElement(piece.type), items) : null;
}

function marbleProblem(items: readonly TLibraryItem[], marble: Pick<TMarble, 'radius' | 'skin'>): string | null {
	const problem = marble.skin?.assetId != null ? skinProblem(marble.skin.assetId, 'marble', items) : null;
	if (problem != null) return problem;
	if (marble.radius < MARBLE_RADIUS.min || marble.radius > MARBLE_RADIUS.max) return `A marble's radius is in meters, from ${MARBLE_RADIUS.min} to ${MARBLE_RADIUS.max}; ${marble.radius} is outside that. get_state.marbles[].radius has the current one.`;
	return null;
}

/** How a piece stands and plays: a live Pattern owns all of it. A Skin and its Depth are only how it looks */
function physicalOf(piece: TPiece): string {
	const { depth: _depth, ...params } = piece.params;
	return JSON.stringify([piece.place, piece.angle, piece.path, piece.type, piece.layout, params]);
}

/** The same answer a person gets dragging a piece of a live Pattern, naming the command that frees it */
function livePatternProblem(project: TProject, pieceId: string, next: TPiece | null): string | null {
	const group = patternOfPiece(project, pieceId);
	const piece = project.track.pieces.find((item) => item.id === pieceId);
	if (group == null || piece == null || (next != null && physicalOf(next) === physicalOf(piece))) return null;
	return `${patternLockWords(group)} { type: 'flattenPattern', groupId: '${group.id}' } does, or applyPattern fits it again.`;
}

const NOTHING_THERE = 'get_state lists them: marbles[].marbleId, layers.pieces[].id, layers.titles[].id.';

/** Why a command that fits its shape still can't run on this project: an id or value it names isn't there */
function valueProblem(project: TProject, items: readonly TLibraryItem[], packThemes: readonly TReadyPackTheme[], command: TAgentCommand): string | null {
	const missingMarble = (marbleId: string): string | null => (marbleId === 'backing' || project.marbles.some((marble) => marble.id === marbleId) ? null : `There is no marble ${marbleId}. get_state.marbles[].marbleId lists them.`);
	const missingPiece = (pieceId: string): string | null => (project.track.pieces.some((piece) => piece.id === pieceId) ? null : `There is nothing called ${pieceId}. ${NOTHING_THERE}`);
	switch (command.type) {
		case 'updatePiece': {
			const piece = project.track.pieces.find((item) => item.id === command.pieceId);
			if (piece == null) return missingPiece(command.pieceId);
			const next = patched(piece, command.patch);
			return livePatternProblem(project, piece.id, next) ?? pieceProblem(items, next);
		}
		case 'addPiece':
			return livePatternProblem(project, command.piece.id, command.piece) ?? pieceProblem(items, command.piece);
		case 'removePieces': {
			const missing = command.pieceIds.map(missingPiece).find((problem) => problem != null);
			if (missing != null) return missing;
			// A whole Pattern goes at once, like deleting its Group; one piece of it doesn't
			const partOf = command.pieceIds.find((id) => patternOfPiece(project, id)?.pieceIds.some((piece) => !command.pieceIds.includes(piece)) === true);
			return partOf != null ? livePatternProblem(project, partOf, null) : null;
		}
		case 'addMarble':
			return marbleProblem(items, command.marble);
		case 'updateMarble': {
			const marble = project.marbles.find((item) => item.id === command.marbleId);
			if (marble == null) return missingMarble(command.marbleId);
			return marbleProblem(items, patched(marble, command.patch));
		}
		case 'flattenPattern':
			return project.track.groups.some((group) => group.id === command.groupId) === true ? null : `There is no Group ${command.groupId}. get_state lists them.`;
		case 'updateSong':
		case 'moveSong':
		case 'removeSong':
			return project.songs.some((song) => song.id === command.songId) ? null : `There is no song ${command.songId}. get_state.song.songs lists them.`;
		case 'removeMarble':
		case 'upsertHits':
		case 'assignHits':
			return missingMarble(command.marbleId);
		case 'removeHits': {
			const marble = missingMarble(command.marbleId);
			if (marble != null) return marble;
			const owner = project.marbles.find((item) => item.id === command.marbleId);
			const missing = owner == null ? undefined : command.hitIds.find((id) => !owner.hits.some((hit) => hit.id === id));
			return missing != null ? `There is no hit ${missing} on that marble. get_state.marbles[].hitList lists them.` : null;
		}
		case 'updateFilm':
			return filmProblem(project, items, command.film);
		case 'applyTheme': {
			if (isBuiltInTheme(command.theme) || packThemes.some((item) => item.theme.id === command.theme)) return null;
			return `There is no theme ${command.theme}. Themes are ${['pegboard', 'brass', 'neon', ...packThemes.map((item) => item.theme.id)].join(', ')}.`;
		}
		case 'applySkin': {
			if (command.pieceType != null && command.pieceType !== 'marble' && getPieceDefinition(command.pieceType) == null) return `There is no piece type ${command.pieceType}. Use one from ${SKIN_ELEMENTS.join(', ')}.`;
			const skinned = [...project.marbles, ...project.track.pieces];
			for (const id of command.ids ?? []) {
				if (skinned.some((item) => item.id === id)) continue;
				const title = project.film.titles.find((item) => item.id === id);
				return title != null ? `${title.name ?? id} is neither a piece nor a marble, so it wears no skin.` : `There is nothing called ${id}. ${NOTHING_THERE}`;
			}
			const targets = skinned.filter((item) => command.ids?.includes(item.id) ?? ('type' in item ? item.type : 'marble') === command.pieceType);
			for (const item of targets) {
				const problem = skinProblem(command.assetId, skinElementOf(item), items);
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

function filmProblem(project: TProject, items: readonly TLibraryItem[], film: Partial<TProject['film']>): string | null {
	if (film.theme != null) {
		if (!isBuiltInTheme(film.theme.base)) return `A theme's base is pegboard, brass or neon, not ${film.theme.base}.`;
		for (const [element, part] of Object.entries(film.theme.parts ?? {})) {
			const problem = part.skin != null ? skinProblem(part.skin, element as TSkinElement, items) : null;
			if (problem != null) return problem;
		}
	}
	for (const title of film.titles ?? []) {
		const problem = titleProblem(title);
		if (problem != null) return problem;
	}
	const focus = film.camera?.focusMarbleId;
	if (focus != null && !project.marbles.some((marble) => marble.id === focus)) return `There is no marble ${focus}. get_state.marbles[].marbleId lists them.`;
	return null;
}

export function expandCommands(project: TProject, result: TSimulationResult | null, items: readonly TLibraryItem[], input: readonly TAgentCommand[], packThemes: readonly TReadyPackTheme[] = [], blenderObjects: readonly TBlenderObject[] = []): TResult<TExpandedCommands, Error> {
	const commands: TProjectCommand[] = [];
	const createdIds: string[] = [];
	const notices: string[] = [];
	let running = project;
	for (const given of input) {
		const command = withCurrentValues(running, given);
		const problem = commandProblem(command) ?? valueProblem(running, items, packThemes, command);
		if (problem != null) return Err(new Error(problem));
		const [isExpandedOk, expandedErr, expanded] = expandOne(running, result, items, packThemes, blenderObjects, command);
		if (!isExpandedOk) return Err(expandedErr);
		const [isAppliedOk, appliedErr, applied] = applyProjectCommands(running, expanded.commands);
		if (!isAppliedOk) return Err(appliedErr);
		if (changesRadius(running, command)) notices.push('A marble\'s radius changes the run, so hits can move. Read hits in this reply; 0.012 is the usual radius, and Undo takes it back.');
		running = applied;
		commands.push(...expanded.commands);
		if (expanded.piece != null) createdIds.push(expanded.piece.id);
	}
	return Ok({ commands, createdIds, summary: summaryOf(input), isChange: JSON.stringify({ ...running, revision: 0 }) !== JSON.stringify({ ...project, revision: 0 }), notices });
}

function changesRadius(project: TProject, command: TAgentCommand): boolean {
	if (command.type !== 'updateMarble' || command.patch.radius == null) return false;
	return project.marbles.find((marble) => marble.id === command.marbleId)?.radius !== command.patch.radius;
}

function expandOne(project: TProject, result: TSimulationResult | null, items: readonly TLibraryItem[], packThemes: readonly TReadyPackTheme[], blenderObjects: readonly TBlenderObject[], command: TAgentCommand): TResult<{ commands: TProjectCommand[]; piece?: TPiece }, Error> {
	switch (command.type) {
		case 'moveSong':
			return Ok({ commands: moveSongCommands(project, result, command.songId, command.start) });
		case 'flattenPattern': {
			const group = project.track.groups.find((item) => item.id === command.groupId);
			return group != null ? Ok({ commands: flattenCommands(group) }) : Err(new Error(`There is no Group ${command.groupId}. get_state lists them.`));
		}
		case 'placePiece': {
			const [isPieceOk, pieceErr, piece] = placedPiece(project, result, command);
			return isPieceOk ? Ok({ commands: [{ type: 'addPiece', piece }], piece }) : Err(pieceErr);
		}
		case 'applySkin': {
			const target = command.ids != null ? { kind: 'pieces' as const, entityIds: command.ids } : command.pieceType != null ? { kind: 'pieceType' as const, pieceType: command.pieceType } : null;
			if (target == null) return Err(new Error('applySkin needs a pieceType or ids'));
			const commands = skinCommands(project, target, command.assetId);
			return commands.length > 0 ? Ok({ commands }) : Err(new Error(`Nothing is a ${command.pieceType ?? 'target'} in this project yet, so ${command.assetId} has nothing to dress.`));
		}
		case 'applyTheme': {
			const ready = packThemes.find((item) => item.theme.id === command.theme);
			return Ok({ commands: ready != null ? packThemeCommands(project, ready.theme, ready.origin) : themeCommands(project, command.theme) });
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
			const { commands } = scatterDecorCommands(project, result, track, { items: sources, density: command.density ?? DEFAULT_SCATTER_DENSITY, seed: command.seed ?? 1, blenderObjects });
			return Ok({ commands });
		}
		default:
			return Ok({ commands: [command] });
	}
}

function placedPiece(project: TProject, result: TSimulationResult | null, command: Extract<TAgentCommand, { type: 'placePiece' }>): TResult<TPiece, Error> {
	const definition = getPieceDefinition(command.pieceType);
	if (definition == null) return Err(new Error(`There is no piece called ${command.pieceType}`));
	let piece: TPiece;
	if (command.hit != null) {
		const hit = command.hit;
		const target = result?.hits.find((item) => item.marbleId === hit.marbleId && item.hitId === hit.hitId);
		if (target?.dot == null) return Err(new Error(`Hit ${hit.hitId} has no dot yet. Place the hits before it first.`));
		piece = pieceForHit(project, target, command.pieceType);
	} else if (command.position != null) {
		piece = createFreePiece(command.pieceType, { position: command.position, angle: command.angle ?? 0 }, project.track.pieces, command.path != null ? { points: command.path } : undefined);
	} else {
		return Err(new Error('placePiece needs a hit or a position'));
	}
	if (command.params != null) piece.params = { ...piece.params, ...command.params };
	if (command.angle != null) piece.angle = command.angle;
	if (command.path != null && command.hit != null) piece.path = { points: command.path };
	if (command.paths != null && piece.path != null) piece.path = { ...piece.path, paths: command.paths };
	if (command.layout != null && piece.type === 'rail') {
		piece.layout = command.layout;
		piece.params = { ...piece.params, ...railLayoutInfo[command.layout].defaults, ...command.params };
	}
	if (command.name != null) piece.name = command.name;
	return Ok(piece);
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
		case 'flattenPattern':
			return 'Flatten Pattern';
		case 'placePiece':
			return `Place ${getPieceDefinition(first.pieceType)?.label ?? 'Piece'}${count}`;
		case 'applySkin':
			return `Apply Skin${count}`;
		case 'applyTheme':
			return 'Change Theme';
		case 'placeDecor':
			return `Place Decor${count}`;
		case 'scatterDecor':
			return 'Scatter Decor';
		default:
			return null;
	}
}
