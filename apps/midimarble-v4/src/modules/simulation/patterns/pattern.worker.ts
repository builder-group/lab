import { createSimulator } from '../simulate';
import type { TResolvedPiece } from '../types';
import { runGroupChange, type TGroupChange, type TGroupRunOutcome, type TGroupRunProgress } from './run-group';
import type { TProject } from '@/modules/project';

// Patterns run in their own worker: a fit takes seconds, and Stop ends it by ending the worker

export interface TPatternWorkerRequest {
	id: number;
	project: TProject;
	change: TGroupChange;
	isPreview: boolean;
}

export type TPatternAnswer = Omit<TGroupRunOutcome, 'project'> & {
	/** The Group's pieces as they would stand, for the ghost of a preview */
	pieces: TResolvedPiece[];
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
	const { id, project, change, isPreview } = event.data;
	simulatorPromise
		.then((sim) => {
			const { project: after, ...outcome } = runGroupChange(project, change, { sim, isPreview, onProgress: (progress) => scope.postMessage({ id, kind: 'progress', progress }) });
			const made = new Set(outcome.entities.map((entity) => entity.id));
			const pieces = isPreview && made.size > 0 ? sim.simulate({ ...after, end: change.to + 0.5 }).pieces.filter((piece) => made.has(piece.entityId)) : [];
			scope.postMessage({ id, kind: 'done', answer: { ...outcome, pieces } });
		})
		.catch((error: unknown) => {
			scope.postMessage({ id, kind: 'error', message: error instanceof Error ? error.message : String(error) });
		});
});
