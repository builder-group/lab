import { problemSummary, type TExportPreflight } from '@/modules/building';
import { resolveElementLook, resolveTheme, keyLightLayer, wallLayer } from '@/modules/scene';
import type { TPiece, TProject } from '@/modules/project';
import { DEFAULT_GRAVITY, marbleFilmColor, noteName, parseDecorKey, parseHitKey, parseLightKey, parseShotKey, toHitKey, backingOf, tempoOf, tieOf } from '@/modules/project';
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

export function hitReport(preflight: TExportPreflight): THitReport {
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
export function projectState(project: TProject, result: TSimulationResult | null, view: { path: string | null; workspace: string; selection: readonly TSelectedItem[]; playhead: number; isPlaying: boolean; agentFolder: string | null; packThemes?: { id: string; name: string; pack: string }[]; references: { images: number; text: string }; building?: unknown; lastBuild?: unknown; problems: TExportPreflight }): Record<string, unknown> {
	const film = project.film;
	const theme = resolveTheme(film);
	const wall = wallLayer(film);
	const light = keyLightLayer(film);
	const resolved = new Map(result?.pieces.map((piece) => [piece.pieceId, piece]) ?? []);
	const pieces = project.track.pieces;
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
		song: hasSong(project) ? { songs: project.songs.filter((song) => song.path != null).map((song) => ({ id: song.id, name: song.name, kind: song.kind, start: song.start })), backingNotes: backingOf(project).length, tempo: tempoOf(project) ?? null } : null,
		marbles: project.marbles.map((marble) => {
			const own = hits.filter((hit) => hit.marbleId === marble.id);
			return {
				marbleId: marble.id,
				name: marble.name,
				labelColor: marble.labelColor,
				filmColor: marbleFilmColor(project, marble.id),
				radius: marble.radius,
				skin: marble.skin?.assetId ?? resolveElementLook(film, 'marble', marble.skin).skin,
				start: marble.start.position,
				hits: marble.hits.length,
				onTime: own.filter((hit) => hit.status === 'onTime').length,
				nextOpen: own.filter((hit) => hit.status === 'open').slice(0, 3).map((hit) => ({ hitId: hit.hitId, time: round(hit.targetTime), hasDot: hit.dot != null })),
				hitColumns: HIT_COLUMNS,
				hitList: marble.hits.map((hit) => {
					const run = own.find((item) => item.hitId === hit.id);
					return [hit.id, round(hit.time), hit.pitch != null ? noteName(hit.pitch) : null, run?.status ?? 'open', run?.dot != null ? round(run.dot.x) : null, run?.dot != null ? round(run.dot.y) : null];
				})
			};
		}),
		...hitReport(view.problems),
		layers: {
			pieceCounts: countBy(pieces.map((piece) => piece.type ?? 'piece')),
			pieces: pieces.slice(0, MAX_PIECES).map((piece) => {
				const pose = resolved.get(piece.id);
				return {
					id: piece.id,
					name: piece.name,
					type: piece.type,
					...(pose != null ? { x: round(pose.position.x), y: round(pose.position.y) } : {}),
					...(tieOf(piece) != null ? { hitId: tieOf(piece)?.hitId } : {}),
					angle: round(piece.angle),
					params: piece.params ?? {}
				};
			}),
			...(pieces.length > MAX_PIECES ? { piecesLeftOut: pieces.length - MAX_PIECES } : {}),
			lights: film.lights.added.length,
			titles: film.titles.map((title) => ({ id: title.id, text: title.text, style: title.style ?? 'wall', ...(title.in != null ? { in: title.in } : {}), ...(title.out != null ? { out: title.out } : {}) }))
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
		const piece = project.track.pieces.find((item) => item.id === key);
		if (piece != null) {
			const pose = pieceInForm(result, piece);
			const link = tieOf(piece) ?? result?.hits.find((item) => item.pieceId === piece.id);
			const played = link != null ? resolveHit(project, result, toHitKey(link.marbleId, link.hitId), link.marbleId, link.hitId) : null;
			return { kind: 'piece', key, ...pose, params: piece.params ?? {}, hit: played != null ? { key: played.key, marbleId: played.marbleId, hitId: played.hitId, marble: played.marble, time: played.time, note: played.note, status: played.status } : null };
		}
		const marble = project.marbles.find((item) => item.id === key);
		if (marble != null) {
			const { id: marbleId, radius } = marble;
			const hits = result?.hits.filter((item) => item.marbleId === marbleId) ?? [];
			return { kind: 'marble', key, id: marbleId, marbleId, name: marble.name, labelColor: marble.labelColor, filmColor: marbleFilmColor(project, marbleId), radius, hits: marble.hits.length, onTime: hits.filter((item) => item.status === 'onTime').length };
		}
		const title = project.film.titles.find((item) => item.id === key);
		if (title != null) return { kind: 'title', key, id: title.id, text: title.text };
		const lightId = parseLightKey(key);
		if (lightId != null) return { kind: 'light', key, id: lightId };
		const decorId = parseDecorKey(key);
		if (decorId != null) {
			const decor = project.film.decor.find((item) => item.id === decorId);
			return { kind: 'decor', key, id: decorId, ...(decor != null ? { source: decor.source, x: round(decor.position.x), y: round(decor.position.y) } : {}) };
		}
		const shotId = parseShotKey(key);
		if (shotId != null) return { kind: 'shot', key, id: shotId };
		return { kind: 'layer', key };
	});
}

function resolveHit(project: TProject, result: TSimulationResult | null, key: string, marbleId: string, hitId: string): TSelectedHit {
	const marble = project.marbles.find((item) => item.id === marbleId);
	const hit = marble?.hits.find((item) => item.id === hitId);
	const run = result?.hits.find((item) => item.marbleId === marbleId && item.hitId === hitId);
	const platform = project.track.pieces.find((piece) => piece.id === run?.pieceId || (tieOf(piece)?.marbleId === marbleId && tieOf(piece)?.hitId === hitId));
	return {
		kind: 'hit',
		key,
		marbleId,
		hitId,
		marble: marble?.name ?? null,
		time: round(hit?.time ?? run?.targetTime ?? 0),
		note: hit?.pitch != null ? noteName(hit.pitch) : null,
		status: run?.status ?? 'open',
		dot: run?.dot != null ? { x: round(run.dot.x), y: round(run.dot.y) } : null,
		platform: platform != null ? pieceInForm(result, platform) : null
	};
}

/** A piece's id, name, place, angle in radians and length, each only when it has one */
function pieceInForm(result: TSimulationResult | null, piece: TPiece): TSelectedPiece {
	const position = result?.pieces.find((item) => item.pieceId === piece.id)?.position;
	const { angle } = piece;
	const length = piece.params['length'];
	return {
		id: piece.id,
		name: piece.name ?? null,
		type: piece.type,
		...(position != null ? { x: round(position.x), y: round(position.y) } : {}),
		angle: round(angle),
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
