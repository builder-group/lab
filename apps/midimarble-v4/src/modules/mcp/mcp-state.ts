import { preflightExport, problemSummary } from '@/modules/design/export-preflight';
import { resolveTheme } from '@/modules/design/project-themes';
import type { TProject } from '@/modules/project';
import type { TSimulationResult } from '@/modules/simulation';
import { hasSongLayer } from '@/modules/studio/song-layer';

// The compact words `get_state` and every edit's reply give an agent, built from the same problem model as the hit
// summary in the window.

const MAX_PROBLEMS = 20;
const MAX_PIECES = 80;

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
export function projectState(project: TProject, result: TSimulationResult | null, view: { path: string | null; workspace: string; selection: readonly string[]; playhead: number; isPlaying: boolean; agentFolder: string | null; references: { images: number; text: string } }): Record<string, unknown> {
	const design = project.design;
	const theme = resolveTheme(design);
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
		agentFolder: view.agentFolder,
		references: view.references,
		workspace: view.workspace,
		playhead: round(view.playhead),
		isPlaying: view.isPlaying,
		selection: view.selection,
		song: hasSongLayer(project) ? { sources: project.music.sources.map((source) => ({ name: source.name, kind: source.kind })), backingNotes: project.music.backing.length, tempo: project.music.tempo ?? null } : null,
		marbles: project.music.lanes.map((lane) => {
			const marble = project.entities.find((entity) => entity.components.marble?.laneId === lane.id);
			const own = hits.filter((hit) => hit.laneId === lane.id);
			return {
				laneId: lane.id,
				entityId: marble?.id ?? null,
				name: marble?.name ?? lane.name,
				release: marble?.components.release?.position ?? null,
				hits: lane.hits.length,
				onTime: own.filter((hit) => hit.status === 'onTime').length,
				nextOpen: own.filter((hit) => hit.status === 'open').slice(0, 3).map((hit) => ({ hitId: hit.hitId, time: round(hit.targetTime), hasDot: hit.dot != null }))
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
					...(entity.components.hitLink != null ? { hitId: entity.components.hitLink.hitId } : {})
				};
			}),
			...(pieces.length > MAX_PIECES ? { piecesLeftOut: pieces.length - MAX_PIECES } : {}),
			shots: design.camera.shots.length,
			lights: design.lights?.added?.length ?? 0,
			titles: project.entities.filter((entity) => entity.components.wallText != null).length
		},
		theme: { id: theme.id, name: theme.name, base: theme.base, overrides: theme.overrides, parts: Object.fromEntries(Object.entries(theme.parts).map(([element, part]) => [element, part.skin])) },
		projectThemes: (design.themes ?? []).map((item) => ({ id: item.id, name: item.name })),
		decor: { count: design.decor?.length ?? 0, sources: countBy((design.decor ?? []).map((item) => item.source)) },
		renderPreset: design.renderPreset
	};
}

function round(value: number): number {
	return Math.round(value * 1000) / 1000;
}
