import { createSimulator } from '../simulate';
import type { TResolvedPiece } from '../types';
import { checkGroupChange, type TPatternRefusal } from './check-group';
import { runGroupChange, type TGroupChange, type TGroupRunOutcome, type TGroupRunProgress } from './run-group';
import type { TProject } from '@/modules/project';

// Patterns run in their own worker: a fit takes seconds, and Stop ends it by ending the worker

export interface TPatternWorkerRequest {
	id: number;
	project: TProject;
	change: TGroupChange;
	isPreview: boolean;
	/** Whether it must keep the song as good as it was before it lands, which a re-fit for new Gravity can't */
	isChecked: boolean;
}

export type TPatternAnswer = Omit<TGroupRunOutcome, 'project'> & {
	/** The Group's pieces as they would stand, for the ghost of a preview */
	pieces: TResolvedPiece[];
	/** Why nothing is to change, naming the hit */
	refusal: TPatternRefusal | null;
	/** Pieces after the range that move with the marble */
	movedAfter: number;
};

export type TPatternWorkerResponse =
	| { id: number; kind: 'progress'; progress: TGroupRunProgress }
	| { id: number; kind: 'done'; answer: TPatternAnswer }
	| { id: number; kind: 'error'; message: string };

interface TWorkerScope {
	postMessage: (message: TPatternWorkerResponse) => void;
	addEventListener: (type: 'message', listener: (event: MessageEvent<TPatternWorkerRequest>) => void) => void;
}

const scope = self as unknown as TWorkerScope;
const simulatorPromise = createSimulator();

scope.addEventListener('message', (event) => {
	const { id, project, change, isPreview, isChecked } = event.data;
	simulatorPromise
		.then((sim) => {
			const { project: after, ...outcome } = runGroupChange(project, change, { sim, isPreview, onProgress: (progress) => scope.postMessage({ id, kind: 'progress', progress }) });
			const made = new Set(outcome.entities.map((entity) => entity.id));
			const pieces = isPreview && made.size > 0 ? sim.simulate({ ...after, end: change.to + 0.5 }).pieces.filter((piece) => made.has(piece.entityId)) : [];
			const check = isChecked ? checkGroupChange(project, { ...outcome, project: after }, change.laneId, sim) : null;
			const checked = check != null ? { commands: check.commands, groupId: check.refusal != null ? null : outcome.groupId, refusal: check.refusal, movedAfter: check.movedAfter } : { refusal: null, movedAfter: 0 };
			scope.postMessage({ id, kind: 'done', answer: { ...outcome, pieces, ...checked } });
		})
		.catch((error: unknown) => {
			scope.postMessage({ id, kind: 'error', message: error instanceof Error ? error.message : String(error) });
		});
});
