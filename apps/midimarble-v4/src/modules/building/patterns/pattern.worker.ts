import { createSimulator } from '@/modules/simulation';
import type { TResolvedPiece } from '@/modules/simulation';
import { checkPattern, type TPatternCheck } from './check-pattern';
import type { TGroupChange, TGroupRunProgress } from './run-group';
import type { TProject } from '@/modules/project';

// Patterns run in their own worker: a fit takes seconds, and Stop ends it by ending the worker

export interface TPatternWorkerRequest {
	id: number;
	project: TProject;
	change: TGroupChange;
	isPreview: boolean;
	/** Whether it must keep the song as good as it was before it lands */
	isChecked: boolean;
}

export type TPatternAnswer = Omit<TPatternCheck, 'project'> & {
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
	const { id, project, change, isPreview, isChecked } = event.data;
	simulatorPromise
		.then((sim) => {
			const { project: after, ...check } = checkPattern(project, change, { sim, isPreview, isChecked, onProgress: (progress) => scope.postMessage({ id, kind: 'progress', progress }) });
			const made = new Set(check.madePieces.map((piece) => piece.id));
			const pieces = isPreview && made.size > 0 ? sim.simulate({ ...after, length: change.to + 0.5 }).pieces.filter((piece) => made.has(piece.entityId)) : [];
			scope.postMessage({ id, kind: 'done', answer: { ...check, pieces } });
		})
		.catch((error: unknown) => {
			scope.postMessage({ id, kind: 'error', message: error instanceof Error ? error.message : String(error) });
		});
});
