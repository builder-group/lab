import type { TEntity, TProject, TProjectCommand, TVec2 } from '@/modules/project';
import { formatSeconds, wordsForHitTime } from './words';
import { frameBand } from '../placement';
import { soundsHit } from '../pieces';
import type { TSimulator } from '../simulate';
import { extraStrikes, rollingHits, touchingPairs } from '../track-look';
import type { TSimulationResult } from '../types';
import { COLUMN_PROBLEM, fitBars, isOffColumn, MAX_TILT, sampleAt, type TBar, type TBarIssue, type TBarShape, type TBarsFit } from './fit-bars';
import { fitLongRail } from './fit-rail';

/** Notes closer than this count as the next hop; a longer gap is left for a rail, where a marble must not free fall (`building-a-track`) */
const LONG_GAP = 0.7;

export type TPatternKind = 'zigzag' | 'staircase' | 'longRail';

export interface TFitPatternRequest {
	project: TProject;
	laneId: string;
	/** The hits to play, in time order. A Long Rail takes the two hits around its silence */
	hitIds: string[];
	kind: TPatternKind;
	/** Bar centres apart (Zigzag) or sideways per hit (Staircase), in metres */
	width?: number;
	/** The same bounce on every bar */
	bounce?: number;
	/** A bounce per bar instead, aiming for this wall drop per hit, in metres */
	drop?: number;
	/** How many nearby shapes to try for a clean one; a hover preview takes the first */
	maxTries?: number;
	/** The last bar keeps its own direction instead of turning the marble toward the frame's middle */
	keepsDirection?: boolean;
}

export interface TPatternProblem {
	/** The hit it is about */
	hitId: string;
	words: string;
}

export interface TPatternExit {
	position: TVec2;
	velocity: TVec2;
	time: number;
}

export interface TFitPatternResult {
	commands: TProjectCommand[];
	/** The pieces it makes */
	entities: TEntity[];
	/** Pieces on these hits it replaces */
	removedIds: string[];
	/** How the marble leaves it: at the next note, or 0.3 s after the last */
	exit: TPatternExit | null;
	/** What was used: a neighbouring shape when the asked one left problems */
	width: number;
	drop: number | null;
	/** Why it can't fit, in plain words; empty when it fits */
	problems: TPatternProblem[];
	/** The project with `commands` applied */
	project: TProject;
	/** Physics runs it took, and how many shapes it tried */
	sims: number;
	tries: number;
}

export interface TFitPatternOptions {
	sim: TSimulator;
	onProgress?: (fraction: number) => void;
}

/** Fits one Pattern where the marble is now, through the real simulator, and says what it can't do. It never falls back silently */
export function fitPattern(request: TFitPatternRequest, options: TFitPatternOptions): TFitPatternResult {
	return request.kind === 'longRail' ? fitRail(request, options) : fitBarPattern(request, options);
}

/** Pieces on the hits a Pattern plays. A rail on the last hit stays: it belongs to the silence after it */
function piecesOnHits(project: TProject, laneId: string, hitIds: string[]): string[] {
	const last = hitIds.at(-1);
	const ids = new Set(hitIds);
	return project.entities
		.filter((entity) => {
			const link = entity.components.hitLink;
			if (link == null || link.laneId !== laneId || !ids.has(link.hitId)) return false;
			return link.hitId !== last || entity.components.piece == null || soundsHit(entity.components.piece.type, link);
		})
		.map((entity) => entity.id);
}

function without(project: TProject, ids: string[]): TProject {
	if (!ids.length) return project;
	const removed = new Set(ids);
	return { ...project, entities: project.entities.filter((entity) => !removed.has(entity.id)) };
}

function exitOf(result: TSimulationResult, laneId: string, time: number): TPatternExit | null {
	const sample = sampleAt(result.marbles.find((marble) => marble.laneId === laneId)?.samples ?? [], time - 1e-6);
	return sample == null ? null : { position: sample.position, velocity: sample.velocity, time: sample.time };
}

function nothing(request: TFitPatternRequest, problems: TPatternProblem[], sims = 0): TFitPatternResult {
	return { commands: [], entities: [], removedIds: [], exit: null, width: request.width ?? 0, drop: request.drop ?? null, problems, project: request.project, sims, tries: 0 };
}

function fitRail(request: TFitPatternRequest, options: TFitPatternOptions): TFitPatternResult {
	const { project, laneId, hitIds } = request;
	const lane = project.music.lanes.find((item) => item.id === laneId);
	const [fromId, toId] = hitIds;
	const from = lane?.hits.find((hit) => hit.id === fromId);
	const to = lane?.hits.find((hit) => hit.id === toId);
	if (from == null || to == null) return nothing(request, [{ hitId: fromId ?? toId ?? '', words: 'A Long Rail runs from one note to the next, so it needs a note on either side.' }]);
	const gap = to.time - from.time;
	let tries = 0;
	const { fit, why } = fitLongRail(options.sim, project, laneId, from.id, to.id, () => {
		tries++;
		options.onProgress?.(Math.min(0.95, tries / 80));
	});
	if (fit == null) return nothing(request, [{ hitId: from.id, words: `No rail holds the marble for ${formatSeconds(gap)} here${why != null ? `: ${why}` : ''}.` }], tries);
	const problems: TPatternProblem[] = [];
	if (Math.abs(fit.holdErr) > 0.05) problems.push({ hitId: from.id, words: `The rail lets go ${formatSeconds(Math.abs(fit.holdErr))} ${fit.holdErr > 0 ? 'late' : 'early'} for the note at ${wordsForHitTime(to.time)}.` });
	if (fit.isTouching) problems.push({ hitId: from.id, words: `The rail touches a piece beside it at ${wordsForHitTime(from.time)}.` });
	const result = options.sim.simulate({ ...fit.project, end: to.time + 0.02 });
	return {
		commands: [{ type: 'upsertEntity', entity: fit.entity }],
		entities: [fit.entity],
		removedIds: [],
		exit: exitOf(result, laneId, to.time),
		width: fit.width,
		drop: null,
		problems,
		project: fit.project,
		sims: fit.sims,
		tries: 1
	};
}

interface TScoredFit extends TBarsFit {
	width: number;
	drop: number | null;
	score: number;
	late: string[];
	strikes: string[];
	rolls: string[];
	touching: string[];
}

function fitBarPattern(request: TFitPatternRequest, options: TFitPatternOptions): TFitPatternResult {
	const { project, laneId, hitIds, kind } = request;
	const { sim } = options;
	const lane = project.music.lanes.find((item) => item.id === laneId);
	const hits = hitIds.flatMap((id) => lane?.hits.find((hit) => hit.id === id) ?? []);
	const last = hits.at(-1);
	if (lane == null || last == null || kind === 'longRail') return nothing(request, [{ hitId: hitIds[0] ?? '', words: 'A Zigzag or Staircase needs notes to play, and this range has none.' }]);
	const removedIds = piecesOnHits(project, laneId, hitIds);
	const base = without(project, removedIds);
	const next = lane.hits.find((hit) => hit.time > last.time);
	const isNextClose = next != null && next.time - last.time < LONG_GAP;
	const ids = isNextClose ? [...hitIds, next.id] : hitIds;
	const asked = request.width ?? (kind === 'zigzag' ? 0.14 : 0.09);
	const askedDrop = request.bounce != null ? null : (request.drop ?? (kind === 'zigzag' ? 0.08 : 0.12));

	const shape: TBarShape = {
		kind,
		width: asked,
		strike: kind === 'zigzag' ? 0.0225 : 0,
		bounce: request.bounce ?? 0.5,
		...(isNextClose ? { stopBefore: true } : {}),
		...(next != null && !isNextClose && request.keepsDirection !== true ? { exitToFrame: frameBand(project).centerX } : {})
	};
	if (kind === 'staircase') {
		const head = sim.simulate({ ...base, end: (hits[0]?.time ?? 0) + 0.01 });
		const dotX = head.hits.find((hit) => hit.hitId === hitIds[0])?.dot?.x ?? 0;
		shape.dir = Math.sign(frameBand(project).centerX - dotX) || 1;
	}

	const widths = [0, -0.005, 0.005, 0.01, -0.01, 0.02].map((offset) => asked + offset);
	const drops = askedDrop != null ? [askedDrop, askedDrop * 1.2, askedDrop * 0.85] : [null];
	const maxTries = request.maxTries ?? 9;
	let best: TScoredFit | null = null;
	let tries = 0;
	let sims = 0;
	outer: for (const drop of drops) {
		for (const width of widths) {
			if (tries >= maxTries) break outer;
			tries++;
			const attempt = tries;
			const fit = fitBars(sim, base, laneId, ids, { ...shape, width, ...(drop != null ? { drop } : {}) }, (done, total) => options.onProgress?.((attempt - 1 + done / total) / maxTries));
			sims += fit.sims;
			const scored = scoreFit(sim, fit, laneId, ids, isNextClose, width, drop, last.time);
			if (best == null || scored.score < best.score) best = scored;
			if (scored.score === 0) break outer;
		}
	}
	const chosen = best as TScoredFit;
	const result = sim.simulate({ ...chosen.project, end: (next?.time ?? last.time + 0.3) + 0.01 });
	const entities = chosen.entities;
	return {
		commands: [...(removedIds.length > 0 ? [{ type: 'removeEntities' as const, entityIds: removedIds }] : []), ...entities.map((entity) => ({ type: 'upsertEntity' as const, entity }))],
		entities,
		removedIds,
		exit: exitOf(result, laneId, next?.time ?? last.time + 0.3),
		width: chosen.width,
		drop: chosen.drop,
		problems: problemsOf(chosen, lane.hits),
		project: chosen.project,
		sims,
		tries
	};
}

function scoreFit(sim: TSimulator, fit: TBarsFit, laneId: string, ids: string[], stopsBefore: boolean, width: number, drop: number | null, lastTime: number): TScoredFit {
	const mine = new Set(stopsBefore ? ids.slice(0, -1) : ids);
	const made = new Set(fit.entities.map((entity) => entity.id));
	const nextTime = fit.project.music.lanes.find((lane) => lane.id === laneId)?.hits.find((hit) => hit.id === ids.at(-1))?.time ?? lastTime;
	const result = sim.simulate({ ...fit.project, end: Math.max(lastTime, nextTime) + 0.02 });
	const late = result.hits.filter((hit) => ids.includes(hit.hitId) && hit.status !== 'onTime' && hit.status !== 'drifting' && hit.status !== 'open').map((hit) => hit.hitId);
	const strikes = extraStrikes(fit.project, result).flatMap((item) => (mine.has(item.hitId) ? [item.hitId] : []));
	const rolls = rollingHits(fit.project, result).flatMap((item) => (mine.has(item.hitId) ? [item.hitId] : []));
	const touching = touchingPairs(fit.project, result).flatMap((pair) => (made.has(pair.a) || made.has(pair.b) ? [fit.project.entities.find((entity) => entity.id === pair.b)?.components.hitLink?.hitId ?? ids[0] ?? ''] : []));
	const off = fit.bars.filter((bar) => isOffColumn(bar) && bar.hitId !== ids.at(-1)).length;
	const failures = fit.bars.filter((bar) => bar.why.length > 0 || Math.abs(bar.errX) > COLUMN_PROBLEM).length;
	const short = fit.bars.length < mine.size ? 1000 : 0;
	return { ...fit, width, drop, score: short + late.length * 100 + strikes.length * 20 + rolls.length * 20 + touching.length * 5 + off * 3 + failures, late, strikes, rolls, touching };
}

function problemsOf(fit: TScoredFit, hits: readonly { id: string; time: number }[]): TPatternProblem[] {
	const when = (hitId: string): string => wordsForHitTime(hits.find((hit) => hit.id === hitId)?.time ?? 0);
	const problems: TPatternProblem[] = [];
	const seen = new Set<string>();
	const add = (hitId: string, words: string): void => {
		if (seen.has(words)) return;
		seen.add(words);
		problems.push({ hitId, words });
	};
	if (!fit.bars.length) add(hits[0]?.id ?? '', 'The marble has not reached this range, so nothing can be fitted here yet.');
	for (const hitId of fit.late) add(hitId, `The note at ${when(hitId)} can't be reached on time.`);
	for (const bar of fit.bars) {
		for (const issue of bar.why) add(bar.hitId, `${issueWords(issue, fit.width)} (${when(bar.hitId)})`);
		if (Math.abs(bar.errX) > COLUMN_PROBLEM) add(bar.hitId, columnWords(bar, fit.width));
	}
	for (const hitId of fit.strikes) add(hitId, `The marble strikes a bar twice at ${when(hitId)}.`);
	for (const hitId of fit.rolls) add(hitId, `The marble rolls along a bar at ${when(hitId)} instead of bouncing. Try a higher Bounce.`);
	for (const hitId of fit.touching) add(hitId, `Two pieces touch at ${when(hitId)}. Try a wider Width.`);
	return problems;
}

function issueWords(issue: TBarIssue, width: number): string {
	switch (issue) {
		case 'late':
			return 'The marble misses this note.';
		case 'resting':
			return 'The marble settles on this bar instead of striking it.';
		case 'restrike':
			return 'The marble lands on this bar a second time.';
		case 'stray':
			return `The marble strikes another bar on the way at Width ${formatCm(width)}.`;
		case 'rolls':
			return 'The marble rolls along this bar instead of bouncing. Try a higher Bounce.';
	}
}

/** The report's sentence: "The 0.21 s hop needs 41° of tilt at Width 14 cm; the limit is 40°. Try Width 12 cm." */
function columnWords(bar: TBar, width: number): string {
	const tilt = (Math.abs(bar.angle) * 180) / Math.PI;
	const smaller = Math.max(0.08, Math.round((width - 0.02) * 100) / 100);
	if (tilt >= MAX_TILT - 0.5) return `The ${formatSeconds(bar.hop)} hop needs more than ${MAX_TILT}° of tilt at Width ${formatCm(width)}; the limit is ${MAX_TILT}°. Try Width ${formatCm(smaller)}.`;
	return `The ${formatSeconds(bar.hop)} hop lands ${formatCm(Math.abs(bar.errX))} off its column at Width ${formatCm(width)}.`;
}

function formatCm(metres: number): string {
	return `${Math.round(metres * 100)} cm`;
}

