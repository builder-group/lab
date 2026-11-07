import { checkRun, NO_BLENDER_OBJECTS, problemSummary, type TProblemSummary } from '../export-preflight';
import { type TMarble, type TProject, type TProjectCommand, type TVec2, parseHitKey, tieOf } from '@/modules/project';
import { soundsHit, stageBand, type TSimulator, type TSimulationResult } from '@/modules/simulation';
import { answerSettle, changedPieces, editCommands, withEditAnswer } from '../edit-rule';
import { playingNotes } from '../verdict';
import type { THitVerdict, TPatternCourse, TPatternLeaving } from './contract';
import { BAR_LENGTH, COLUMN_PROBLEM, sampleAt } from './fit-bars';
import { patternOfKind } from './registry';
import { hitsInRange, runGroupChange, type TGroupChange, type TGroupRunOptions, type TGroupRunOutcome } from './run-group';

// A Pattern matches the hits it was asked for, or it isn't made. Before an edit lands, this looks at the whole song with
// the one problem model: the next platforms take up the change where they can, or what follows moves with the marble. If
// neither keeps the song as good as it was, the project stays as it is and the words name the hit.

/** Why a Pattern wasn't made: the hit to look at and what's wrong there */
export interface TPatternRefusal {
	marbleId: string;
	hitId: string | null;
	words: string;
}

export interface TGroupCheck {
	/** Set when nothing is to change */
	refusal: TPatternRefusal | null;
	/** The whole edit, with what the next platforms take up */
	commands: TProjectCommand[];
	/** Pieces after the range that moved with the marble, because nothing could take up the change */
	movedAfter: number;
}

/** The most shapes a check asks of the whole song before it says no */
const MAX_ATTEMPTS = 5;
/** Physics runs after which a check tries no more shapes: it says no in seconds, and past this another shape rarely fits */
const CHECK_RUNS = 1500;
/** The narrowest Staircase step the app picks by itself */
const MIN_STEP = 0.03;
/** How long after a hit the way a marble leaves it is compared, in seconds */
const MIN_LEAVING = 0.04;
const MAX_LEAVING = 0.2;

/** How a run stands: its summary, and which hits it plays on time */
interface TStanding {
	summary: TProblemSummary;
	onTime: ReadonlySet<string>;
}

function standing(project: TProject, result: TSimulationResult): TStanding {
	return {
		summary: problemSummary(checkRun(project, result, NO_BLENDER_OBJECTS), 'track'),
		onTime: playingNotes(result)
	};
}

function hitWords(project: TProject, hitId: string): { marbleId: string; hitId: string; number: number; name: string } | null {
	for (const marble of project.marbles) {
		const index = marble.hits.findIndex((hit) => hit.id === hitId);
		if (index >= 0) return { marbleId: marble.id, hitId, number: index + 1, name: marble.name };
	}
	return null;
}

/** The hit a problem's target is about: its own key, or the note its piece plays */
function namedHit(project: TProject, ids: readonly string[]): { marbleId: string; hitId: string } | null {
	for (const id of ids) {
		const hit = parseHitKey(id);
		if (hit != null) return hit;
		const link = tieOf(project.track.pieces.find((piece) => piece.id === id));
		if (link != null) return { marbleId: link.marbleId, hitId: link.hitId };
	}
	return null;
}

/** No hit that was on time went off time, and there are no more Problems than there were */
function isKept(before: TStanding, after: TStanding): boolean {
	return [...before.onTime].every((hit) => after.onTime.has(hit)) && after.summary.problems.length <= before.summary.problems.length;
}

/** The first thing the run has that it didn't have, as the problem list says it */
function firstNew(before: TProblemSummary, after: TProblemSummary): TProblemSummary['problems'][number] | null {
	const had = new Set(before.problems.map((issue) => issue.title));
	return after.problems.find((issue) => !had.has(issue.title)) ?? after.problems[0] ?? null;
}

/** What fits instead, when what was asked doesn't: one click from there */
export interface TPatternOffer {
	/** "Use Hits 12–15", the action's words */
	label: string;
	words: string;
	width?: number;
	from?: number;
	to?: number;
}

/** What a Pattern would do, asked of the whole song: the answer to show first, and the only thing ever applied */
export type TPatternCheck = TGroupRunOutcome & {
	/** Why nothing is to change, naming the hit */
	refusal: TPatternRefusal | null;
	/** Pieces after the range that move with the marble */
	movedAfter: number;
	/** The later hit it breaks: the ending is part of the check */
	ending: THitVerdict | null;
	offers: TPatternOffer[];
};

export interface TPatternCheckOptions extends Omit<TGroupRunOptions, 'along'> {
	/** Whether it must keep the song as good as it was, which a re-fit for new Gravity can't */
	isChecked?: boolean;
	/** The first shape, as soon as it's known: the ghost, before the whole song has been asked */
	onGhost?: (outcome: TGroupRunOutcome) => void;
}

/** A Pattern as it's asked for: without a Width the app picks one, and says which by storing it */
export type TPatternAsk = Omit<TGroupChange, 'width' | 'bounce'> & { width?: number; bounce?: number };

/**
 * Asks a Pattern, a pure calculation: the project isn't touched, and nothing comes of it until the answer's commands are
 * applied. An answer with commands fits, on every hit and at its ending. On a song already built it first follows the way
 * the track goes, so what comes after can stay where it stands, then tries the other side and its own shape. Width is
 * only tried when none was asked; otherwise what fits instead is offered.
 */
export function checkPattern(project: TProject, ask: TPatternAsk, options: TPatternCheckOptions): TPatternCheck {
	const { isChecked = true, onGhost, ...run } = options;
	const { sim } = options;
	const pattern = patternOfKind(ask.kind);
	const bounce = ask.bounce ?? pattern?.defaults.bounce ?? 0.5;
	const firstWidth = ask.width ?? pattern?.defaults.width ?? 0.1;
	const change: TGroupChange = { ...ask, width: firstWidth, bounce };
	if (run.isPreview === true || !isChecked) {
		const outcome = runGroupChange(project, change, run);
		onGhost?.(outcome);
		return answerOf(project, outcome, change, null, isChecked);
	}
	if (onGhost != null) onGhost(runGroupChange(project, change, { ...run, isPreview: true }));

	const was = standing(project, sim.simulate(project));
	const refused: TPatternCheck[] = [];
	const attempts = attemptsOf(project, ask, sim);
	let runs = 0;
	const counting: TSimulator = {
		...sim,
		simulate: (...args) => {
			runs++;
			return sim.simulate(...args);
		}
	};
	for (const [index, attempt] of attempts.entries()) {
		if (runs > CHECK_RUNS && refused.length > 0) break;
		const tried: TGroupChange = { ...change, width: attempt.width };
		const outcome = runGroupChange(project, tried, { ...run, sim: counting, stopsAtBadBar: true, ...(attempt.along != null ? { along: attempt.along } : {}), ...(index > 0 || attempt.along != null ? { maxTries: 1 } : {}), ...scaled(run.onProgress, index, attempts.length) });
		const answer = answerOf(project, outcome, tried, checkFor(project, outcome, ask.marbleId, sim, was), true);
		if (answer.refusal == null) return answer;
		refused.push(answer);
	}
	const answer = furthest(project, refused) ?? answerOf(project, runGroupChange(project, change, run), change, null, true);
	return { ...answer, offers: offersFor(project, ask, change, answer, sim, was, runs <= CHECK_RUNS) };
}

/** Bars are fitted again once per attempt, so progress is shared between them */
function scaled(onProgress: TGroupRunOptions['onProgress'], index: number, count: number): Pick<TGroupRunOptions, 'onProgress'> {
	if (onProgress == null) return {};
	return { onProgress: (progress) => onProgress({ ...progress, fraction: (index + progress.fraction) / count }) };
}

interface TAttempt {
	width: number;
	along?: TPatternCourse;
}

/** The shapes worth asking, best first */
function attemptsOf(project: TProject, ask: TPatternAsk, sim: TSimulator): TAttempt[] {
	const pattern = patternOfKind(ask.kind);
	const marble = project.marbles.find((item) => item.id === ask.marbleId);
	const defaultWidth = pattern?.defaults.width ?? 0.1;
	if (pattern?.takes !== 'notes' || marble == null) return [{ width: ask.width ?? defaultWidth }];
	const hits = hitsInRange(marble, ask.from, ask.to);
	const course = courseOf(project, marble, sim);
	const next = marble.hits.find((hit) => hit.time > ask.to + 1e-6);
	const isBuilt = hits.some((hit) => course.dots.has(hit.id));
	const widths = ask.width != null ? [ask.width] : widthsOf(project, ask.kind, hits, course.dots, next?.id ?? null, defaultWidth);
	const attempts: TAttempt[] = [];
	for (const width of widths) {
		if (isBuilt) {
			attempts.push({ width, along: course });
			if (ask.kind === 'zigzag') attempts.push({ width, along: { ...course, isOtherSide: true } });
		}
		attempts.push({ width });
	}
	return attempts.slice(0, MAX_ATTEMPTS);
}

/** Without a Width asked: for a Zigzag what the track's own hops span, then the usual one and a little wider; for a Staircase steps that stay in frame */
function widthsOf(project: TProject, kind: string, hits: readonly { id: string }[], course: ReadonlyMap<string, TVec2>, nextId: string | null, usual: number): number[] {
	if (kind === 'staircase') {
		const inFrame = Math.max(MIN_STEP, Math.min(usual, (stageBand(project).halfWidth * 2) / Math.max(1, hits.length)));
		return [inFrame, Math.max(MIN_STEP, inFrame * 0.7)];
	}
	if (kind !== 'zigzag') return [usual];
	const dots = [...hits.map((hit) => hit.id), ...(nextId != null ? [nextId] : [])].flatMap((id) => course.get(id) ?? []);
	const hops = dots.slice(1).map((dot, index) => Math.abs(dot.x - (dots[index]?.x ?? dot.x))).sort((a, b) => a - b);
	const hop = hops[Math.floor(hops.length / 2)];
	const own = hop != null ? Math.round(Math.max(usual * 0.8, hop + BAR_LENGTH / 2) * 100) / 100 : null;
	return [...new Set([...(own != null ? [own] : []), usual, usual + 0.02, usual + 0.04])];
}

/** Where the marble is now at each note a piece plays, and how it leaves it: until a rail after the note takes over, or a moment after */
function courseOf(project: TProject, marble: TMarble, sim: TSimulator): TPatternCourse {
	const result = sim.simulate(project);
	const samples = result.marbles.find((item) => item.marbleId === marble.id)?.samples ?? [];
	const dots = new Map<string, TVec2>();
	const leaves = new Map<string, TPatternLeaving>();
	for (const hit of result.hits) {
		if (hit.marbleId !== marble.id || hit.pieceId == null || hit.dot == null) continue;
		dots.set(hit.hitId, hit.dot);
		const rail = project.track.pieces.find((piece) => {
			const tie = tieOf(piece);
			return tie?.marbleId === marble.id && tie.hitId === hit.hitId && !soundsHit(piece.type, tie);
		});
		const after = Math.min(MAX_LEAVING, Math.max(MIN_LEAVING, rail?.params['entryDelay'] ?? MAX_LEAVING));
		const sample = sampleAt(samples, hit.targetTime + after);
		if (sample != null) leaves.set(hit.hitId, { offset: { x: sample.position.x - hit.dot.x, y: sample.position.y - hit.dot.y }, after });
	}
	return { dots, leaves };
}

/** The whole-song check of a fit whose own hits play */
function checkFor(project: TProject, outcome: TGroupRunOutcome, marbleId: string, sim: TSimulator, was: TStanding): TGroupCheck | null {
	return outcome.groupId != null ? checkGroupChange(project, outcome, marbleId, sim, was) : null;
}

function answerOf(project: TProject, outcome: TGroupRunOutcome, change: TGroupChange, check: TGroupCheck | null, isChecked: boolean): TPatternCheck {
	const refusal = check?.refusal ?? (isChecked && outcome.groupId == null && outcome.problems[0] != null ? refusalOf(project, outcome, change.marbleId) : null);
	const named = refusal?.hitId ?? null;
	const isOwnHit = outcome.verdicts.some((verdict) => verdict.hitId === named);
	return {
		...outcome,
		// A check that passed went over the whole song: no later hit is off time
		laterLateHits: check != null ? 0 : outcome.laterLateHits,
		commands: refusal != null ? [] : check != null ? check.commands : outcome.commands,
		groupId: refusal != null ? null : outcome.groupId,
		refusal,
		movedAfter: check?.movedAfter ?? 0,
		verdicts: refusal != null && isOwnHit ? outcome.verdicts.map((verdict) => (verdict.hitId === named ? { ...verdict, fits: false, words: verdict.words ?? refusal.words } : verdict)) : outcome.verdicts,
		ending: refusal != null && !isOwnHit && named != null ? { hitId: named, fits: false, words: refusal.words } : null,
		offers: []
	};
}

/** Of the attempts refused, the one that got furthest, whose words say what stands in the way last */
function furthest(project: TProject, refused: readonly TPatternCheck[]): TPatternCheck | null {
	const timeOf = (answer: TPatternCheck): number => {
		const marble = project.marbles.find((item) => item.id === answer.refusal?.marbleId);
		return marble?.hits.find((hit) => hit.id === answer.refusal?.hitId)?.time ?? -Infinity;
	};
	return [...refused].sort((a, b) => timeOf(b) - timeOf(a))[0] ?? null;
}

/** What fits instead: a Width near the one asked, or the hits up to the one in the way, or half of those */
function offersFor(project: TProject, ask: TPatternAsk, change: TGroupChange, answer: TPatternCheck, sim: TSimulator, was: TStanding, hasTimeForWidths: boolean): TPatternOffer[] {
	const marble = project.marbles.find((item) => item.id === ask.marbleId);
	const label = patternOfKind(ask.kind)?.label ?? 'Pattern';
	if (marble == null || patternOfKind(ask.kind)?.takes !== 'notes') return [];
	const course = courseOf(project, marble, sim);
	const fits = (tried: TGroupChange): boolean => {
		const outcome = runGroupChange(project, tried, { sim, along: course, maxTries: 1, stopsAtBadBar: true });
		return checkFor(project, outcome, ask.marbleId, sim, was)?.refusal === null;
	};
	const hits = hitsInRange(marble, ask.from, ask.to);
	const number = (id: string | undefined): number => marble.hits.findIndex((hit) => hit.id === id) + 1;
	const offers: TPatternOffer[] = [];
	if (ask.width != null && hasTimeForWidths) {
		const near = [0.02, -0.02].map((offset) => Math.round((ask.width as number + offset) * 100) / 100).find((width) => width > 0 && fits({ ...change, width }));
		if (near != null) offers.push({ label: `Use Width ${Math.round(near * 100)} cm`, words: `Width ${Math.round(near * 100)} cm fits this range.`, width: near });
	}
	const stuckAt = hits.findIndex((hit) => hit.id === answer.refusal?.hitId);
	const count = stuckAt > 0 ? stuckAt : stuckAt < 0 ? Math.max(hits.length - 1, 0) : 0;
	for (const size of [...new Set([count, Math.floor(count / 2)])]) {
		const last = hits[size - 1];
		const first = hits[0];
		if (size < 2 || last == null || first == null || !fits({ ...change, from: first.time, to: last.time })) continue;
		const range = `Notes ${number(first.id)}–${number(last.id)}`;
		offers.push({ label: `Use ${range}`, words: `${label} fits ${range} of ${marble.name}.`, from: first.time, to: last.time });
		break;
	}
	return offers;
}

/** The refusal for a Pattern that made no pieces at all */
function refusalOf(project: TProject, outcome: TGroupRunOutcome, marbleId: string): TPatternRefusal {
	const [problem] = outcome.problems;
	const hit = problem != null ? hitWords(project, problem.hitId) : null;
	const label = outcome.name.replace(/ \d+$/, '');
	const words = hit != null && problem != null ? `${label} doesn't fit at Note ${hit.number} of ${hit.name}. ${problem.words} Nothing changed.` : `${problem?.words ?? `${label} doesn't fit here.`} Nothing changed.`;
	return { marbleId: hit?.marbleId ?? marbleId, hitId: hit?.hitId ?? null, words };
}

/** Decides whether a Group change lands, and with what. Nothing is changed here */
export function checkGroupChange(before: TProject, outcome: TGroupRunOutcome, marbleId: string, sim: TSimulator, known?: TStanding): TGroupCheck {
	const label = outcome.name.replace(/ \d+$/, '');
	const refused = (refusal: TPatternRefusal): TGroupCheck => ({ refusal, commands: [], movedAfter: 0 });
	const [blocking] = outcome.blocking;
	if (blocking != null) {
		const hit = hitWords(before, blocking.hitId);
		const at = hit != null ? `at Note ${hit.number} of ${hit.name}` : 'here';
		return refused({ marbleId: hit?.marbleId ?? marbleId, hitId: hit?.hitId ?? null, words: `${label} doesn't fit ${at}. ${blocking.words} Nothing changed.` });
	}
	if (!outcome.commands.length) return { refusal: null, commands: [], movedAfter: 0 };

	const was = known ?? standing(before, sim.simulate(before));
	const after = outcome.project;
	// The next platforms take up the change, as a local edit does; the track after them stays where it was
	const { answer } = answerSettle(sim, { before, after }, null);
	const settled = withEditAnswer(after, answer);
	const settledResult = sim.simulate(settled);
	const settledRun = standing(settled, settledResult);
	if (!answer.heldFrom.length && isKept(was, settledRun)) return { refusal: null, commands: [...outcome.commands, ...editCommands(answer)], movedAfter: changedPlaces(before, settled, sim, settledResult) };
	// Or everything after it moves with the marble, staying on time, which is said
	const freeResult = sim.simulate(after);
	const freeRun = standing(after, freeResult);
	if (isKept(was, freeRun)) {
		const moved = changedPlaces(before, after, sim, freeResult);
		return { refusal: null, commands: outcome.commands, movedAfter: moved };
	}
	const worst = freeRun.summary.problems.length <= settledRun.summary.problems.length ? freeRun : settledRun;
	const first = firstNew(was.summary, worst.summary);
	const named = namedHit(after, first?.target?.ids ?? []);
	return refused({ marbleId: named?.marbleId ?? marbleId, hitId: named?.hitId ?? null, words: `${label} would break what follows: ${first?.title ?? 'a later hit no longer plays'}. Nothing changed.` });
}

/** How many pieces outside the Pattern stand somewhere else in the run */
function changedPlaces(before: TProject, after: TProject, sim: TSimulator, result: TSimulationResult): number {
	const was = new Map(sim.simulate(before).pieces.map((piece) => [piece.pieceId, piece.position]));
	const made = new Set(changedPieces(before, after).map((piece) => piece.id));
	return result.pieces.filter((piece) => {
		const position = was.get(piece.pieceId);
		return !made.has(piece.pieceId) && position != null && Math.hypot(piece.position.x - position.x, piece.position.y - position.y) > COLUMN_PROBLEM;
	}).length;
}
