import { type TPiece, type TProject, type TProjectCommand, tieOf } from '@/modules/project';
import { soundsHit } from '@/modules/simulation';
import type { TSimulator } from '@/modules/simulation';
import { arrivalAt } from './arrival';
import type { THitVerdict, TPatternFit, TPatternOptions } from './contract';
import { patternOfKind } from './registry';

export interface TFitPatternRequest extends TPatternOptions {
	project: TProject;
	marbleId: string;
	/** The hits to play, in time order. A Long Rail takes the two hits around its silence */
	hitIds: string[];
	kind: string;
	/** Its starting Width unless asked */
	width?: number;
	/** The same bounce on every bar */
	bounce?: number;
	maxTilt?: number;
}

export interface TPatternProblem {
	/** The hit it is about */
	hitId: string;
	words: string;
}

export interface TFitPatternResult extends TPatternFit {
	commands: TProjectCommand[];
	/** Pieces on these hits it replaces */
	removedIds: string[];
	/** What the verdicts say: why it can't fit and what isn't as asked; empty when it fits as asked */
	problems: TPatternProblem[];
	/** The problems that keep a hit from playing cleanly, so the Pattern isn't made there; a bar off its column isn't one */
	blocking: TPatternProblem[];
}

export interface TFitPatternOptions {
	sim: TSimulator;
	onProgress?: (fraction: number) => void;
}

/** Pieces on the hits a Pattern plays. A rail on the last hit stays, as it belongs to the silence after it, and so do all rails on a track it follows */
function piecesOnHits(project: TProject, marbleId: string, hitIds: string[], keepsRails: boolean): string[] {
	const last = hitIds.at(-1);
	const ids = new Set(hitIds);
	return project.track.pieces
		.filter((piece) => {
			const link = tieOf(piece);
			if (link == null || link.marbleId !== marbleId || !ids.has(link.hitId)) return false;
			return (link.hitId !== last && !keepsRails) || soundsHit(piece.type, link);
		})
		.map((piece) => piece.id);
}

function without(project: TProject, ids: string[]): TProject {
	if (!ids.length) return project;
	const removed = new Set(ids);
	return { ...project, track: { ...project.track, pieces: project.track.pieces.filter((piece) => !removed.has(piece.id)) } };
}

/** The verdict on a Pattern this version doesn't have, or a hit that's gone */
function refused(request: TFitPatternRequest, words: string): TFitPatternResult {
	const said: THitVerdict = { hitId: request.hitIds[0] ?? '', fits: false, words };
	return { commands: [], removedIds: [], pieces: [], exit: null, verdicts: [said], ending: null, notes: [], project: request.project, width: request.width ?? 0, drop: request.drop ?? null, sims: 0, tries: 0, problems: [{ hitId: said.hitId, words }], blocking: [{ hitId: said.hitId, words }] };
}

/** Fits one Pattern where the marble is now, through the real simulator, and says what it can't do. It never falls back silently */
export function fitPattern(request: TFitPatternRequest, options: TFitPatternOptions): TFitPatternResult {
	const { project, marbleId, hitIds, kind } = request;
	const { sim, onProgress } = options;
	const pattern = patternOfKind(kind);
	if (pattern == null) return refused(request, `This version of the app has no Pattern called ${kind}.`);
	const marble = project.marbles.find((item) => item.id === marbleId);
	const hits = hitIds.flatMap((id) => marble?.hits.find((hit) => hit.id === id) ?? []);
	const removedIds = pattern.takes === 'notes' ? piecesOnHits(project, marbleId, hitIds, request.along != null) : [];
	const base = without(project, removedIds);
	const first = hits[0];
	const arrival = first != null ? arrivalAt(sim, base, marbleId, first.id, first.time) : null;
	const { along, barLength, barDepth, drop, fixedBounce, isGhost, keepsDirection, maxTries } = request;
	const fit = pattern.fit(
		{ arrival, hits, settings: { width: request.width ?? pattern.defaults.width, bounce: request.bounce ?? pattern.defaults.bounce, ...(request.maxTilt != null ? { maxTilt: request.maxTilt } : {}) } },
		{
			project: base,
			marbleId,
			sim,
			...(onProgress != null ? { onProgress } : {}),
			...(along != null ? { along } : {}),
			...(barLength != null ? { barLength } : {}),
			...(barDepth != null ? { barDepth } : {}),
			...(drop != null ? { drop } : {}),
			...(fixedBounce != null ? { fixedBounce } : {}),
			...(keepsDirection != null ? { keepsDirection } : {}),
			...(maxTries != null ? { maxTries } : {}),
			...(isGhost != null ? { isGhost } : {})
		}
	);
	const said = [...fit.verdicts, ...(fit.ending != null ? [fit.ending] : [])].flatMap((verdict) => (verdict.words != null ? [{ ...verdict, words: verdict.words }] : []));
	const pieces: TPiece[] = fit.pieces;
	return {
		...fit,
		removedIds,
		commands: pieces.length > 0 ? [...(removedIds.length > 0 ? [{ type: 'removePieces' as const, pieceIds: removedIds }] : []), ...pieces.map((piece) => ({ type: 'addPiece' as const, piece }))] : [],
		problems: said.map(({ hitId, words }) => ({ hitId, words })),
		blocking: said.filter((verdict) => !verdict.fits).map(({ hitId, words }) => ({ hitId, words }))
	};
}
