import { NO_BLENDER_OBJECTS, preflightExport, problemSummary, type TProblemSummary } from '../export-preflight';
import type { TProject, TProjectCommand } from '@/modules/project';
import { parseHitKey, tieOf } from '@/modules/project';
import { answerSettle, changedPieces } from '@/modules/simulation';
import type { TSimulator, TSimulationResult } from '@/modules/simulation';
import type { THitVerdict } from './contract';
import { runGroupChange, type TGroupChange, type TGroupRunOptions, type TGroupRunOutcome } from './run-group';

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

function standing(project: TProject, result: TSimulationResult): TProblemSummary {
	return problemSummary(preflightExport(project, { ...result, revision: project.revision }, NO_BLENDER_OBJECTS), 'track');
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

function isKept(before: TProblemSummary, after: TProblemSummary): boolean {
	return after.onTime >= before.onTime && after.problems.length <= before.problems.length;
}

/** The first thing the run has that it didn't have, as the problem list says it */
function firstNew(before: TProblemSummary, after: TProblemSummary): TProblemSummary['problems'][number] | null {
	const had = new Set(before.problems.map((issue) => issue.title));
	return after.problems.find((issue) => !had.has(issue.title)) ?? after.problems[0] ?? null;
}

/** What a Pattern would do, asked of the whole song: the answer to show first, and the only thing ever applied */
export type TPatternCheck = TGroupRunOutcome & {
	/** Why nothing is to change, naming the hit */
	refusal: TPatternRefusal | null;
	/** Pieces after the range that move with the marble */
	movedAfter: number;
	/** The later hit it breaks: the ending is part of the check */
	ending: THitVerdict | null;
};

export interface TPatternCheckOptions extends TGroupRunOptions {
	/** Whether it must keep the song as good as it was, which a re-fit for new Gravity can't */
	isChecked?: boolean;
}

/**
 * Asks a Pattern, a pure calculation: the project isn't touched, and nothing comes of it until the answer's commands are
 * applied. An answer with commands fits, on every hit and at its ending.
 */
export function checkPattern(project: TProject, change: TGroupChange, options: TPatternCheckOptions): TPatternCheck {
	const { isChecked = true, ...run } = options;
	const outcome = runGroupChange(project, change, run);
	const isAlreadyRefused = outcome.groupId == null;
	const check = isChecked && !isAlreadyRefused && options.isPreview !== true ? checkGroupChange(project, outcome, change.marbleId, options.sim) : null;
	const refusal = check?.refusal ?? (isChecked && isAlreadyRefused && outcome.problems[0] != null ? refusalOf(project, outcome, change.marbleId) : null);
	const named = refusal?.hitId ?? null;
	const isOwnHit = outcome.verdicts.some((verdict) => verdict.hitId === named);
	return {
		...outcome,
		commands: check != null ? check.commands : outcome.commands,
		groupId: refusal != null ? null : outcome.groupId,
		refusal,
		movedAfter: check?.movedAfter ?? 0,
		verdicts: refusal != null && isOwnHit ? outcome.verdicts.map((verdict) => (verdict.hitId === named ? { ...verdict, fits: false, words: verdict.words ?? refusal.words } : verdict)) : outcome.verdicts,
		ending: refusal != null && !isOwnHit ? { hitId: named ?? '', fits: false, words: refusal.words } : null
	};
}

/** The refusal for a Pattern that made no pieces at all */
function refusalOf(project: TProject, outcome: TGroupRunOutcome, marbleId: string): TPatternRefusal {
	const [problem] = outcome.problems;
	const hit = problem != null ? hitWords(project, problem.hitId) : null;
	return { marbleId: hit?.marbleId ?? marbleId, hitId: hit?.hitId ?? null, words: problem?.words ?? 'It doesn’t fit here. Nothing changed.' };
}

/** Decides whether a Group change lands, and with what. Nothing is changed here */
export function checkGroupChange(before: TProject, outcome: TGroupRunOutcome, marbleId: string, sim: TSimulator): TGroupCheck {
	const label = outcome.name.replace(/ \d+$/, '');
	const refused = (refusal: TPatternRefusal): TGroupCheck => ({ refusal, commands: [], movedAfter: 0 });
	const [blocking] = outcome.blocking;
	if (blocking != null) {
		const hit = hitWords(before, blocking.hitId);
		const at = hit != null ? `at Hit ${hit.number} of ${hit.name}` : 'here';
		return refused({ marbleId: hit?.marbleId ?? marbleId, hitId: hit?.hitId ?? null, words: `${label} doesn't fit ${at}. ${blocking.words} Nothing changed.` });
	}
	if (!outcome.commands.length) return { refusal: null, commands: [], movedAfter: 0 };

	const was = standing(before, sim.simulate(before));
	const after = outcome.project;
	// The next platforms take up the change, as a local edit does; the track after them stays where it was
	const { answer } = answerSettle(sim, { before, after }, null);
	const settled = answer.pieces.length > 0 ? { ...after, track: { ...after.track, pieces: after.track.pieces.map((piece) => answer.pieces.find((item) => item.id === piece.id) ?? piece) } } : after;
	const settledRun = standing(settled, sim.simulate(settled));
	if (!answer.heldFrom.length && isKept(was, settledRun)) return { refusal: null, commands: [...outcome.commands, ...answer.pieces.map((piece) => ({ type: 'addPiece' as const, piece }))], movedAfter: 0 };
	// Or everything after it moves with the marble, staying on time, which is said
	const freeResult = sim.simulate(after);
	const freeRun = standing(after, freeResult);
	if (isKept(was, freeRun)) {
		const moved = changedPlaces(before, after, sim, freeResult);
		return { refusal: null, commands: outcome.commands, movedAfter: moved };
	}
	const worst = freeRun.problems.length <= settledRun.problems.length ? freeRun : settledRun;
	const first = firstNew(was, worst);
	const named = namedHit(after, first?.target?.ids ?? []);
	return refused({ marbleId: named?.marbleId ?? marbleId, hitId: named?.hitId ?? null, words: `${label} would break what follows: ${first?.title ?? 'a later hit no longer plays'}. Nothing changed.` });
}

/** How many pieces after the Pattern stand somewhere else in the run */
function changedPlaces(before: TProject, after: TProject, sim: TSimulator, result: TSimulationResult): number {
	const was = new Map(sim.simulate(before).pieces.map((piece) => [piece.entityId, piece.position]));
	const made = new Set(changedPieces(before, after).map((piece) => piece.id));
	return result.pieces.filter((piece) => {
		const position = was.get(piece.entityId);
		return !made.has(piece.entityId) && position != null && Math.hypot(piece.position.x - position.x, piece.position.y - position.y) > 0.005;
	}).length;
}
