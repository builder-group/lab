import { NO_BLENDER_OBJECTS, preflightExport, problemSummary, type TProblemSummary } from '@/modules/design/export-preflight';
import type { TProject, TProjectCommand } from '@/modules/project';
import { parseHitKey } from '@/modules/studio/selection';
import { answerSettle, changedEntities } from '../local-edit';
import type { TSimulator } from '../simulate';
import type { TSimulationResult } from '../types';
import type { TGroupRunOutcome } from './run-group';

// A Pattern matches the hits it was asked for, or it isn't made. Before an edit lands, this looks at the whole song with
// the one problem model: the next platforms take up the change where they can, or what follows moves with the marble. If
// neither keeps the song as good as it was, the project stays as it is and the words name the hit.

/** Why a Pattern wasn't made: the hit to look at and what's wrong there */
export interface TPatternRefusal {
	laneId: string;
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
	return problemSummary(preflightExport(project, { ...result, revision: project.revision }, NO_BLENDER_OBJECTS), 'compose');
}

function hitWords(project: TProject, hitId: string): { laneId: string; hitId: string; number: number; name: string } | null {
	for (const lane of project.music.lanes) {
		const index = lane.hits.findIndex((hit) => hit.id === hitId);
		if (index >= 0) return { laneId: lane.id, hitId, number: index + 1, name: lane.name };
	}
	return null;
}

/** The hit a problem's target is about: its own key, or the note its piece plays */
function namedHit(project: TProject, ids: readonly string[]): { laneId: string; hitId: string } | null {
	for (const id of ids) {
		const hit = parseHitKey(id);
		if (hit != null) return hit;
		const link = project.entities.find((entity) => entity.id === id)?.components.hitLink;
		if (link != null) return { laneId: link.laneId, hitId: link.hitId };
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

/** Decides whether a Group change lands, and with what. Nothing is changed here */
export function checkGroupChange(before: TProject, outcome: TGroupRunOutcome, laneId: string, sim: TSimulator): TGroupCheck {
	const label = outcome.name.replace(/ \d+$/, '');
	const refused = (refusal: TPatternRefusal): TGroupCheck => ({ refusal, commands: [], movedAfter: 0 });
	const [blocking] = outcome.blocking;
	if (blocking != null) {
		const hit = hitWords(before, blocking.hitId);
		const at = hit != null ? `at Hit ${hit.number} of ${hit.name}` : 'here';
		return refused({ laneId: hit?.laneId ?? laneId, hitId: hit?.hitId ?? null, words: `${label} doesn't fit ${at}. ${blocking.words} Nothing changed.` });
	}
	if (!outcome.commands.length) return { refusal: null, commands: [], movedAfter: 0 };

	const was = standing(before, sim.simulate(before));
	const after = outcome.project;
	// The next platforms take up the change, as a local edit does; the track after them stays where it was
	const { answer } = answerSettle(sim, { before, after }, null);
	const settled = answer.entities.length > 0 ? { ...after, entities: after.entities.map((entity) => answer.entities.find((item) => item.id === entity.id) ?? entity) } : after;
	const settledRun = standing(settled, sim.simulate(settled));
	if (!answer.heldFrom.length && isKept(was, settledRun)) return { refusal: null, commands: [...outcome.commands, ...answer.entities.map((entity) => ({ type: 'upsertEntity' as const, entity }))], movedAfter: 0 };
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
	return refused({ laneId: named?.laneId ?? laneId, hitId: named?.hitId ?? null, words: `${label} would break what follows: ${first?.title ?? 'a later hit no longer plays'}. Nothing changed.` });
}

/** How many pieces after the Pattern stand somewhere else in the run */
function changedPlaces(before: TProject, after: TProject, sim: TSimulator, result: TSimulationResult): number {
	const was = new Map(sim.simulate(before).pieces.map((piece) => [piece.entityId, piece.position]));
	const made = new Set(changedEntities(before, after).map((entity) => entity.id));
	return result.pieces.filter((piece) => {
		const position = was.get(piece.entityId);
		return !made.has(piece.entityId) && position != null && Math.hypot(piece.position.x - position.x, piece.position.y - position.y) > 0.005;
	}).length;
}
