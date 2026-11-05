import { tieOf, type THit, type TPiece, type TProject } from '@/modules/project';
import { frameBand, extraStrikes, hasRide, LONG_FALL, longGapThreshold, rollingHits, soundsHit, touchingPairs } from '@/modules/simulation';
import type { TSimulator, TSimulationResult } from '@/modules/simulation';
import type { THitVerdict, TPatternFit, TPatternInput, TPatternMoment, TPatternWorld } from './contract';
import { arrivalAt } from './arrival';
import { fitLongRail } from './fit-rail';
import { BAR_LENGTH, COLUMN_PROBLEM, fitBars, isOffColumn, MAX_TILT, type TBar, type TBarIssue, type TBarShape, type TBarsFit } from './fit-bars';
import { exitAt, verdictsFor } from './verdicts';
import { formatSeconds, wordsForHitTime } from './words';

// What Zigzag and Staircase share: a shape of bars over the notes, the shapes nearby tried for a clean one, and a verdict
// on each hit. Solving each bar is `fit-bars`.

/** Notes closer than this count as the next hop; a longer gap is left for a rail, where a marble must not free fall (`building-a-track`) */
const LONG_GAP = 0.7;

interface TScoredFit extends TBarsFit {
	width: number;
	drop: number | null;
	score: number;
	late: string[];
	strikes: string[];
	rolls: string[];
	touching: string[];
}

export function fitBarPattern(kind: 'zigzag' | 'staircase', input: TPatternInput, world: TPatternWorld): TPatternFit {
	const { project, marbleId, sim } = world;
	const { hits, settings, arrival } = input;
	const hitIds = hits.map((hit) => hit.id);
	const marble = project.marbles.find((item) => item.id === marbleId);
	const last = hits.at(-1);
	const first = hits[0];
	const nothing = (words: string): TPatternFit => ({ pieces: [], exit: null, verdicts: verdictsFor(hits, [{ hitId: hitIds[0] ?? '', fits: false, words }]), ending: null, notes: [], project, width: settings.width, drop: world.drop ?? null, sims: 0, tries: 0 });
	if (marble == null || last == null || first == null) return nothing('A Zigzag or Staircase needs notes to play, and this range has none.');
	if (arrival == null) return nothing('The marble has not reached this range, so nothing can be fitted here yet.');
	const next = marble.hits.find((hit) => hit.time > last.time);
	const isNextClose = next != null && next.time - last.time < LONG_GAP;
	const ids = isNextClose ? [...hitIds, next.id] : hitIds;
	const asked = settings.width;

	const askedDrop = world.fixedBounce != null ? null : (world.drop ?? (kind === 'zigzag' ? 0.08 : 0.12));

	const shape: TBarShape = {
		kind,
		width: asked,
		// A quarter of a bar from its center, toward where the marble flies next
		strike: kind === 'zigzag' ? (world.barLength ?? BAR_LENGTH) / 4 : 0,
		...(world.barLength != null ? { barLength: world.barLength } : {}),
		...(world.barDepth != null ? { barDepth: world.barDepth } : {}),
		bounce: world.fixedBounce ?? settings.bounce,
		...(settings.maxTilt != null ? { maxTilt: settings.maxTilt } : {}),
		...(next != null && !isNextClose && world.keepsDirection !== true ? { exitToFrame: frameBand(project).centerX } : {}),
		...(world.isGhost !== true ? { stopsAtBadBar: true } : {})
	};
	if (kind === 'staircase') shape.dir = Math.sign(frameBand(project).centerX - arrival.position.x) || 1;

	const drops = askedDrop != null ? [askedDrop, askedDrop * 1.2, askedDrop * 0.85] : [null];
	const maxTries = world.maxTries ?? drops.length;
	let best: TScoredFit | null = null;
	let tries = 0;
	let sims = 0;
	const attemptAt = (width: number, drop: number | null, share: number): TScoredFit => {
		const attempt = tries++;
		const fit = fitRuns(world, runsOf(project, hits), isNextClose ? next : null, arrival, { ...shape, width, ...(drop != null ? { drop } : {}) }, (drop ?? 1) / (askedDrop ?? 1), (done, total) => world.onProgress?.(share * ((attempt + done / total) / maxTries)));
		sims += fit.sims;
		return scoreFit(sim, fit, marbleId, ids, isNextClose, width, drop, last.time);
	};
	for (const drop of drops) {
		if (tries >= maxTries) break;
		const scored = attemptAt(asked, drop, 1);
		if (best == null || scored.score < best.score) best = scored;
		if (scored.score === 0) break;
	}
	const chosen = best as TScoredFit;
	const result = sim.simulate({ ...chosen.project, length: (next?.time ?? last.time + 0.3) + 0.01 });
	const said = [...problemsOf(chosen, marble.hits), ...longFalls(result, ids, marble.hits), ...columnProblems(chosen, shape.maxTilt ?? MAX_TILT)];
	return {
		pieces: chosen.pieces,
		exit: exitAt(result, marbleId, next?.time ?? last.time + 0.3),
		verdicts: verdictsFor(hits, said),
		ending: next != null && isNextClose ? (said.find((item) => item.hitId === next.id && !item.fits) ?? null) : null,
		notes: tiltNotes(chosen),
		project: chosen.project,
		width: chosen.width,
		drop: chosen.drop,
		sims,
		tries
	};
}

/** The hits split at hops too long for a bounce (`longGapThreshold`), where a rail holds the marble as Build Track's do */
function runsOf(project: TProject, hits: readonly THit[]): THit[][] {
	const threshold = longGapThreshold(project);
	const runs: THit[][] = [];
	hits.forEach((hit, index) => {
		const before = hits[index - 1];
		if (before == null || hit.time - before.time > threshold) runs.push([hit]);
		else runs.at(-1)?.push(hit);
	});
	return runs;
}

/**
 * Bars over each run, with a rail across each long hop between them. On a song already built each run follows the track:
 * it lands where the track's note is, keeps its height, and leaves as the bar it replaces did, so a rail there stays and
 * what follows meets the marble as before. A rail that can't be made leaves the fall to be judged.
 */
function fitRuns(world: TPatternWorld, runs: readonly THit[][], next: THit | null, arrival: TPatternMoment, shape: TBarShape, dropShare: number, onBar: (done: number, total: number) => void): TBarsFit {
	const { sim, marbleId, along } = world;
	const total = runs.reduce((sum, run) => sum + run.length, 0);
	const made: TBarsFit = { project: world.project, pieces: [], bars: [], sims: 0, center: 0 };
	let moment: TPatternMoment | null = arrival;
	for (const [index, run] of runs.entries()) {
		const following = runs[index + 1]?.[0];
		const last = run.at(-1);
		if (moment == null || last == null) break;
		const start: TPatternMoment = moment;
		const ender = following == null ? next : null;
		const ids = [...run.map((hit) => hit.id), ...(ender != null ? [ender.id] : [])];
		const end = along?.dots.get(ender?.id ?? last.id);
		const hops = ids.length - 1;
		const sideOf = (x: number): number => Math.sign(x - start.position.x) || 1;
		const keptRail = along != null && following != null ? railOn(made.project, marbleId, last.id) : null;
		const leave = ender == null ? along?.leaves.get(last.id) : undefined;
		const done = made.bars.length;
		const fit = fitBars(sim, made.project, marbleId, ids, start, {
			...shape,
			...(ender != null ? { stopBefore: true } : {}),
			...(following != null && keptRail == null ? { exitToFrame: frameBand(world.project).centerX } : {}),
			...(leave != null ? { leaveLike: leave } : {}),
			...(end != null && hops > 0 ? {
				endAt: end,
				// The shape keeps the height the track has now, and a marble landing in the column nearer the end crosses toward it first
				drop: Math.max(0.03, ((start.position.y - end.y) / hops) * dropShare),
				dir: shape.kind === 'staircase' ? sideOf(end.x) : (along?.side ?? -sideOf(end.x))
			} : {})
		}, (bar) => onBar(done + bar, total));
		made.project = fit.project;
		made.pieces.push(...fit.pieces);
		made.bars.push(...fit.bars);
		made.sims += fit.sims;
		made.center = fit.center;
		if (fit.bars.at(-1)?.why.length !== 0 && shape.stopsAtBadBar === true) break;
		if (following == null) break;
		if (keptRail != null) made.pieces.push(keptRail);
		else {
			const rail = fitLongRail(sim, made.project, marbleId, { hitId: last.id, time: last.time }, following.id).fit;
			if (rail != null) {
				made.project = rail.project;
				made.pieces.push(rail.piece);
				made.sims += rail.sims;
			}
		}
		moment = arrivalAt(sim, made.project, marbleId, following.id, following.time);
	}
	return made;
}

/** The rail or tunnel carrying the marble on from this hit */
function railOn(project: TProject, marbleId: string, hitId: string): TPiece | null {
	return project.track.pieces.find((piece) => {
		const tie = tieOf(piece);
		return tie?.marbleId === marbleId && tie.hitId === hitId && !soundsHit(piece.type, tie) && hasRide(piece.type);
	}) ?? null;
}

function scoreFit(sim: TSimulator, fit: TBarsFit, marbleId: string, ids: string[], stopsBefore: boolean, width: number, drop: number | null, lastTime: number): TScoredFit {
	const mine = new Set(stopsBefore ? ids.slice(0, -1) : ids);
	const made = new Set(fit.pieces.map((piece) => piece.id));
	const nextTime = fit.project.marbles.find((marble) => marble.id === marbleId)?.hits.find((hit) => hit.id === ids.at(-1))?.time ?? lastTime;
	const result = sim.simulate({ ...fit.project, length: Math.max(lastTime, nextTime) + 0.02 });
	const late = result.hits.filter((hit) => ids.includes(hit.hitId) && hit.status !== 'onTime' && hit.status !== 'drifting' && hit.status !== 'open').map((hit) => hit.hitId);
	const strikes = extraStrikes(fit.project, result).flatMap((item) => (mine.has(item.hitId) ? [item.hitId] : []));
	const rolls = rollingHits(fit.project, result).flatMap((item) => (mine.has(item.hitId) ? [item.hitId] : []));
	const touching = touchingPairs(fit.project, result).flatMap((pair) => (made.has(pair.a) || made.has(pair.b) ? [tieOf(fit.project.track.pieces.find((piece) => piece.id === pair.b))?.hitId ?? ids[0] ?? ''] : []));
	const off = fit.bars.filter((bar) => isOffColumn(bar) && bar.hitId !== ids.at(-1)).length;
	const failures = fit.bars.filter((bar) => bar.why.length > 0 || Math.abs(bar.errX) > COLUMN_PROBLEM).length;
	const short = fit.bars.length < mine.size ? 1000 : 0;
	return { ...fit, width, drop, score: short + late.length * 100 + strikes.length * 20 + rolls.length * 20 + touching.length * 5 + off * 3 + failures, late, strikes, rolls, touching };
}

function problemsOf(fit: TScoredFit, hits: readonly THit[]): THitVerdict[] {
	const problems: THitVerdict[] = [];
	const seen = new Set<string>();
	const add = (hitId: string, words: string): void => {
		const key = `${hitId}/${words}`;
		if (seen.has(key)) return;
		seen.add(key);
		problems.push({ hitId, fits: false, words });
	};
	if (!fit.bars.length) add(hits[0]?.id ?? '', 'The marble has not reached this range, so nothing can be fitted here yet.');
	for (const hitId of fit.late) add(hitId, "The marble can't reach this note on time.");
	for (const bar of fit.bars) for (const issue of bar.why) add(bar.hitId, issueWords(issue, fit.width));
	for (const hitId of fit.strikes) add(hitId, 'The marble strikes this bar twice.');
	for (const hitId of fit.rolls) add(hitId, 'The marble rolls along this bar instead of bouncing. Try a higher Bounce.');
	for (const hitId of fit.touching) add(hitId, 'Two pieces touch on the wall here. Try another Width or Bounce.');
	return problems;
}

/** Bars off their column: the hits still play, only the shape isn't what was asked */
function columnProblems(fit: TScoredFit, maxTilt: number): THitVerdict[] {
	const words = new Set<string>();
	return fit.bars.flatMap((bar) => {
		const said = columnWords(bar, fit.width, maxTilt);
		if (Math.abs(bar.errX) <= COLUMN_PROBLEM || words.has(said)) return [];
		words.add(said);
		return [{ hitId: bar.hitId, fits: true, words: said }];
	});
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

/** A fall a person would see as the marble leaving, in a range that says it plays: "The marble falls 1.27 m after 0:08" */
function longFalls(result: TSimulationResult, ids: readonly string[], hits: readonly THit[]): THitVerdict[] {
	const problems: THitVerdict[] = [];
	ids.forEach((hitId, index) => {
		const here = result.hits.find((hit) => hit.hitId === hitId)?.dot;
		const after = result.hits.find((hit) => hit.hitId === ids[index + 1])?.dot;
		if (here == null || after == null || here.y - after.y < LONG_FALL) return;
		problems.push({ hitId, fits: false, words: `The marble falls ${(here.y - after.y).toFixed(2)} m after the note at ${wordsForHitTime(hits.find((hit) => hit.id === hitId)?.time ?? 0)}. A Long Rail fills that gap.` });
	});
	return problems;
}

/** A bar past the usual limit is allowed once asked for, and said */
function tiltNotes(fit: TScoredFit): string[] {
	const steepest = Math.max(0, ...fit.bars.map((bar) => (Math.abs(bar.angle) * 180) / Math.PI));
	return steepest > MAX_TILT + 0.5 ? [`Bars tilt up to ${steepest.toFixed(0)}°, past the usual ${MAX_TILT}°.`] : [];
}

/** The report's sentence: "The 0.21 s hop needs more than 40° of tilt at Width 14 cm." */
function columnWords(bar: TBar, width: number, maxTilt: number): string {
	const tilt = (Math.abs(bar.angle) * 180) / Math.PI;
	if (tilt >= maxTilt - 0.5) return `The ${formatSeconds(bar.hop)} hop needs more than ${maxTilt}° of tilt at Width ${formatCm(width)}.`;
	return `The ${formatSeconds(bar.hop)} hop lands ${formatCm(Math.abs(bar.errX))} off its column at Width ${formatCm(width)}.`;
}

function formatCm(meters: number): string {
	return `${Math.round(meters * 100)} cm`;
}

