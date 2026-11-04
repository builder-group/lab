import { preflightExport, problemSummary } from '@/modules/design/export-preflight';
import { resolveElementLook, resolveTheme } from '@/modules/design/project-themes';
import { keyLightLayer, wallLayer } from '@/modules/design/scene-layers';
import type { TProject } from '@/modules/project';
import { DEFAULT_GRAVITY_SCALE } from '@/modules/project';
import { noteName } from '@/modules/studio/format';
import type { TSimulationResult } from '@/modules/simulation';
import { hasSongLayer } from '@/modules/studio/song-layer';

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
}

export function hitReport(project: TProject, result: TSimulationResult | null): THitReport {
	const preflight = preflightExport(project, result);
	const summary = problemSummary(preflight);
	return {
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
export function projectState(project: TProject, result: TSimulationResult | null, view: { path: string | null; workspace: string; selection: readonly string[]; playhead: number; isPlaying: boolean; agentFolder: string | null; packThemes?: { id: string; name: string; pack: string }[]; references: { images: number; text: string }; building?: unknown; lastBuild?: unknown }): Record<string, unknown> {
	const design = project.design;
	const theme = resolveTheme(design);
	const wall = wallLayer(design);
	const light = keyLightLayer(design);
	const resolved = new Map(result?.pieces.map((piece) => [piece.entityId, piece]) ?? []);
	const pieces = project.entities.filter((entity) => entity.components.piece != null);
	const countBy = (values: string[]): Record<string, number> => {
		const counts: Record<string, number> = {};
		for (const value of values) counts[value] = (counts[value] ?? 0) + 1;
		return counts;
	};
	const hits = result?.hits ?? [];
	return {
		project: { title: project.title, path: view.path, revision: project.revision, length: round(project.end), frame: project.frame },
		// Marble Speed: a share of Earth's gravity for every marble
		physics: { gravityScale: project.physics.gravityScale, default: DEFAULT_GRAVITY_SCALE, range: [0.05, 2] },
		...(view.building != null ? { building: view.building } : {}),
		...(view.lastBuild != null ? { lastBuild: view.lastBuild } : {}),
		agentFolder: view.agentFolder,
		references: view.references,
		workspace: view.workspace,
		playhead: round(view.playhead),
		isPlaying: view.isPlaying,
		selection: view.selection,
		song: hasSongLayer(project) ? { sources: project.music.sources.map((source) => ({ name: source.name, kind: source.kind, offset: source.offset })), backingNotes: project.music.backing.length, tempo: project.music.tempo ?? null } : null,
		marbles: project.music.lanes.map((lane) => {
			const marble = project.entities.find((entity) => entity.components.marble?.laneId === lane.id);
			const own = hits.filter((hit) => hit.laneId === lane.id);
			return {
				laneId: lane.id,
				entityId: marble?.id ?? null,
				name: marble?.name ?? lane.name,
				color: marble?.components.marble?.color ?? lane.color,
				radius: marble?.components.marble?.radius ?? null,
				skin: marble != null ? (marble.components.skin?.assetId ?? resolveElementLook(design, 'marble', marble.components.skin).skin) : null,
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
		...hitReport(project, result),
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
			lights: design.lights?.added?.length ?? 0,
			titles: project.entities.flatMap((entity) => {
				const text = entity.components.wallText;
				return text != null ? [{ id: entity.id, text: text.text, style: text.style ?? 'wall', ...(text.in != null ? { in: text.in } : {}), ...(text.out != null ? { out: text.out } : {}) }] : [];
			})
		},
		camera: design.camera,
		// What the film uses, and in `own` what this project changed on top of its theme
		wall: { color: wall.color, backgroundColor: wall.backgroundColor, kind: wall.kind, own: wall.own },
		lights: { key: { color: light.color, strength: light.strength, side: light.side, height: light.height, softness: light.softness, exposure: light.exposure, bloom: light.bloom }, own: design.lights ?? {} },
		theme: { id: theme.id, name: theme.name, base: theme.base, overrides: theme.overrides, parts: Object.fromEntries(Object.entries(theme.parts).map(([element, part]) => [element, part.skin])) },
		projectThemes: (design.themes ?? []).map((item) => ({ id: item.id, name: item.name })),
		...(view.packThemes != null && view.packThemes.length > 0 ? { packThemes: view.packThemes } : {}),
		decor: { count: design.decor?.length ?? 0, sources: countBy((design.decor ?? []).map((item) => item.source)) },
		renderPreset: design.renderPreset
	};
}

function round(value: number): number {
	return Math.round(value * 1000) / 1000;
}
