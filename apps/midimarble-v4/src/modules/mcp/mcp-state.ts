import type { TBlenderObject } from '@/modules/scene';
import { preflightExport, problemSummary } from '@/modules/building';
import { resolveElementLook, resolveTheme, keyLightLayer, wallLayer } from '@/modules/scene';
import type { TEntity, TProject } from '@/modules/project';
import { DEFAULT_GRAVITY, marbleFilmColor, noteName, parseDecorKey, parseHitKey, parseLightKey, parseShotKey, toHitKey } from '@/modules/project';
import type { TSimulationResult } from '@/modules/simulation';
import { hasSong } from '@/modules/music';

// The compact words `get_state` and every edit's reply give an agent, built from the same problem model as the hit
// summary in the window.

const MAX_PROBLEMS = 20;
/** What each row of a marble's `hitList` holds; x and y are the hit's dot, null while the marble has not got there */
const HIT_COLUMNS = ['hitId', 'time', 'note', 'status', 'x', 'y'];
const MAX_PIECES = 200;

export interface THitReport {
	/** The hit summary as the window words it: "12 of 40 hits on time" */
	hits: string;
	/** False while the run is still updating */
	isCurrent: boolean;
	problems: { title: string; detail?: string; time?: number; hit?: string }[];
	/** What every hit plays through but the film shows badly, such as a long fall */
	tips?: string[];
}

export function hitReport(project: TProject, result: TSimulationResult | null, blenderObjects: readonly TBlenderObject[]): THitReport {
	const preflight = preflightExport(project, result, blenderObjects);
	const summary = problemSummary(preflight);
	const tips = preflight.issues.filter((issue) => issue.kind === 'fall').slice(0, MAX_PROBLEMS).map((issue) => issue.title);
	return {
		...(tips.length > 0 ? { tips } : {}),
		hits: summary.label,
		isCurrent: summary.state !== 'pending',
		problems: summary.problems.slice(0, MAX_PROBLEMS).map((issue) => ({
			title: issue.title,
			...(issue.detail != null ? { detail: issue.detail } : {}),
			...(issue.time != null ? { time: round(issue.time) } : {})
		}))
	};
}

/** The project in short. Hit keys in `openHits` work for `select` and `placePiece`. */
export function projectState(project: TProject, result: TSimulationResult | null, view: { path: string | null; workspace: string; selection: readonly TSelectedItem[]; playhead: number; isPlaying: boolean; agentFolder: string | null; packThemes?: { id: string; name: string; pack: string }[]; references: { images: number; text: string }; building?: unknown; lastBuild?: unknown; blenderObjects: readonly TBlenderObject[] }): Record<string, unknown> {
	const film = project.film;
	const theme = resolveTheme(film);
	const wall = wallLayer(film);
	const light = keyLightLayer(film);
	const resolved = new Map(result?.pieces.map((piece) => [piece.entityId, piece]) ?? []);
	const pieces = project.entities.filter((entity) => entity.components.piece != null);
	const countBy = (values: string[]): Record<string, number> => {
		const counts: Record<string, number> = {};
		for (const value of values) counts[value] = (counts[value] ?? 0) + 1;
		return counts;
	};
	const hits = result?.hits ?? [];
	return {
		project: { title: project.title, path: view.path, revision: project.revision, length: round(project.length), format: project.format },
		// Gravity: a share of Earth's gravity for every marble
		gravity: { value: project.gravity, default: DEFAULT_GRAVITY, range: [0.05, 2] },
		...(view.building != null ? { building: view.building } : {}),
		...(view.lastBuild != null ? { lastBuild: view.lastBuild } : {}),
		agentFolder: view.agentFolder,
		references: view.references,
		workspace: view.workspace,
		playhead: round(view.playhead),
		isPlaying: view.isPlaying,
		selection: view.selection,
		song: hasSong(project) ? { sources: project.music.sources.map((source) => ({ name: source.name, kind: source.kind, offset: source.offset })), backingNotes: project.music.backing.length, tempo: project.music.tempo ?? null } : null,
		marbles: project.music.lanes.map((lane) => {
			const marble = project.entities.find((entity) => entity.components.marble?.marbleId === lane.id);
			const own = hits.filter((hit) => hit.marbleId === lane.id);
			return {
				marbleId: lane.id,
				entityId: marble?.id ?? null,
				name: marble?.name ?? lane.name,
				labelColor: lane.color,
				filmColor: marbleFilmColor(project, lane.id),
				radius: marble?.components.marble?.radius ?? null,
				skin: marble != null ? (marble.components.skin?.assetId ?? resolveElementLook(film, 'marble', marble.components.skin).skin) : null,
				release: marble?.components.release?.position ?? null,
				hits: lane.hits.length,
				onTime: own.filter((hit) => hit.status === 'onTime').length,
				nextOpen: own.filter((hit) => hit.status === 'open').slice(0, 3).map((hit) => ({ hitId: hit.hitId, time: round(hit.targetTime), hasDot: hit.dot != null })),
				hitColumns: HIT_COLUMNS,
				hitList: lane.hits.map((hit) => {
					const run = own.find((item) => item.hitId === hit.id);
					return [hit.id, round(hit.time), hit.pitch != null ? noteName(hit.pitch) : null, run?.status ?? 'open', run?.dot != null ? round(run.dot.x) : null, run?.dot != null ? round(run.dot.y) : null];
				})
			};
		}),
		...hitReport(project, result, view.blenderObjects),
		layers: {
			pieceCounts: countBy(pieces.map((entity) => entity.components.piece?.type ?? 'piece')),
			pieces: pieces.slice(0, MAX_PIECES).map((entity) => {
				const pose = resolved.get(entity.id);
				return {
					id: entity.id,
					name: entity.name,
					type: entity.components.piece?.type,
					...(pose != null ? { x: round(pose.position.x), y: round(pose.position.y) } : {}),
					...(entity.components.hitLink != null ? { hitId: entity.components.hitLink.hitId, angle: round(entity.components.hitLink.angle) } : entity.components.transform != null ? { angle: round(entity.components.transform.angle) } : {}),
					params: entity.components.piece?.params ?? {}
				};
			}),
			...(pieces.length > MAX_PIECES ? { piecesLeftOut: pieces.length - MAX_PIECES } : {}),
			lights: film.lights.added.length,
			titles: project.entities.flatMap((entity) => {
				const text = entity.components.wallText;
				return text != null ? [{ id: entity.id, text: text.text, style: text.style ?? 'wall', ...(text.in != null ? { in: text.in } : {}), ...(text.out != null ? { out: text.out } : {}) }] : [];
			})
		},
		camera: film.camera,
		// What the film uses, and in `own` what this project changed on top of its theme
		wall: { color: wall.color, backgroundColor: wall.backgroundColor, kind: wall.kind, own: wall.own },
		lights: { key: { color: light.color, strength: light.strength, side: light.side, height: light.height, softness: light.softness, exposure: light.exposure, bloom: light.bloom }, own: film.lights ?? {} },
		theme: { id: theme.id, name: theme.name, base: theme.base, overrides: theme.overrides, parts: Object.fromEntries(Object.entries(theme.parts).map(([element, part]) => [element, part.skin])) },
		projectThemes: film.themes.map((item) => ({ id: item.id, name: item.name })),
		...(view.packThemes != null && view.packThemes.length > 0 ? { packThemes: view.packThemes } : {}),
		decor: { count: film.decor.length, sources: countBy(film.decor.map((item) => item.source)) },
		quality: film.quality
	};
}

/**
 * What's selected, resolved so an agent can act on it: what the person means by "this". `key` works in `args.select`.
 * Empty means the Scene: nothing in particular.
 */
export function resolveSelection(project: TProject, result: TSimulationResult | null, selection: readonly string[]): TSelectedItem[] {
	return selection.map((key) => {
		const hit = parseHitKey(key);
		if (hit != null) return resolveHit(project, result, key, hit.marbleId, hit.hitId);
		const entity = project.entities.find((item) => item.id === key);
		if (entity?.components.piece != null) {
			const pose = pieceInForm(result, entity);
			const link = entity.components.hitLink ?? result?.hits.find((item) => item.pieceEntityId === entity.id);
			const played = link != null ? resolveHit(project, result, toHitKey(link.marbleId, link.hitId), link.marbleId, link.hitId) : null;
			return { kind: 'piece', key, ...pose, params: entity.components.piece.params ?? {}, hit: played != null ? { key: played.key, marbleId: played.marbleId, hitId: played.hitId, marble: played.marble, time: played.time, note: played.note, status: played.status } : null };
		}
		if (entity?.components.marble != null) {
			const { marbleId, radius } = entity.components.marble;
			const hits = result?.hits.filter((item) => item.marbleId === marbleId) ?? [];
			return { kind: 'marble', key, id: entity.id, marbleId, name: entity.name ?? null, labelColor: project.music.lanes.find((lane) => lane.id === marbleId)?.color ?? null, filmColor: marbleFilmColor(project, marbleId), radius, hits: project.music.lanes.find((lane) => lane.id === marbleId)?.hits.length ?? 0, onTime: hits.filter((item) => item.status === 'onTime').length };
		}
		if (entity?.components.wallText != null) return { kind: 'title', key, id: entity.id, text: entity.components.wallText.text };
		const lightId = parseLightKey(key);
		if (lightId != null) return { kind: 'light', key, id: lightId };
		const decorId = parseDecorKey(key);
		if (decorId != null) {
			const decor = project.film.decor.find((item) => item.id === decorId);
			return { kind: 'decor', key, id: decorId, ...(decor != null ? { source: decor.source, x: round(decor.position.x), y: round(decor.position.y) } : {}) };
		}
		const shotId = parseShotKey(key);
		if (shotId != null) return { kind: 'shot', key, id: shotId };
		return { kind: 'layer', key, ...(entity != null ? { id: entity.id, name: entity.name ?? null } : {}) };
	});
}

function resolveHit(project: TProject, result: TSimulationResult | null, key: string, marbleId: string, hitId: string): TSelectedHit {
	const lane = project.music.lanes.find((item) => item.id === marbleId);
	const hit = lane?.hits.find((item) => item.id === hitId);
	const run = result?.hits.find((item) => item.marbleId === marbleId && item.hitId === hitId);
	const marble = project.entities.find((entity) => entity.components.marble?.marbleId === marbleId);
	const platform = project.entities.find((entity) => entity.id === run?.pieceEntityId || (entity.components.hitLink?.marbleId === marbleId && entity.components.hitLink.hitId === hitId));
	return {
		kind: 'hit',
		key,
		marbleId,
		hitId,
		marble: marble?.name ?? lane?.name ?? null,
		time: round(hit?.time ?? run?.targetTime ?? 0),
		note: hit?.pitch != null ? noteName(hit.pitch) : null,
		status: run?.status ?? 'open',
		dot: run?.dot != null ? { x: round(run.dot.x), y: round(run.dot.y) } : null,
		platform: platform?.components.piece != null ? pieceInForm(result, platform) : null
	};
}

/** A piece's id, name, place, angle in radians and length, each only when it has one */
function pieceInForm(result: TSimulationResult | null, entity: TEntity): TSelectedPiece {
	const position = result?.pieces.find((piece) => piece.entityId === entity.id)?.position;
	const angle = entity.components.hitLink?.angle ?? entity.components.transform?.angle;
	const length = entity.components.piece?.params?.['length'];
	return {
		id: entity.id,
		name: entity.name ?? null,
		type: entity.components.piece?.type ?? null,
		...(position != null ? { x: round(position.x), y: round(position.y) } : {}),
		...(angle != null ? { angle: round(angle) } : {}),
		...(length != null ? { length: round(length) } : {})
	};
}

interface TSelectedPiece {
	id: string;
	name: string | null;
	type: string | null;
	x?: number;
	y?: number;
	angle?: number;
	length?: number;
}

interface TSelectedHit {
	kind: 'hit';
	key: string;
	marbleId: string;
	hitId: string;
	marble: string | null;
	time: number;
	note: string | null;
	status: string;
	dot: { x: number; y: number } | null;
	platform: TSelectedPiece | null;
}

export type TSelectedItem = TSelectedHit | ({ kind: string; key: string } & Record<string, unknown>);

function round(value: number): number {
	return Math.round(value * 1000) / 1000;
}
