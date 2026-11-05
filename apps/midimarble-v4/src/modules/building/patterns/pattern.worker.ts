import { createSimulator } from '@/modules/simulation';
import type { TResolvedPiece } from '@/modules/simulation';
import { checkPattern, type TPatternAsk, type TPatternCheck } from './check-pattern';
import type { TGroupRunOutcome, TGroupRunProgress } from './run-group';
import type { TProject } from '@/modules/project';

// Patterns run in their own worker: a fit takes seconds, and Stop ends it by ending the worker

export interface TPatternWorkerRequest {
	id: number;
	project: TProject;
	change: TPatternAsk;
	/** A person resting on a tile: the first shape is sent ahead as the ghost, and the answer is what a click then applies */
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
	| { id: number; kind: 'ghost'; pieces: TResolvedPiece[] }
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
			// The pieces as they'd stand, for a ghost
			const resolved = (outcome: TGroupRunOutcome): TResolvedPiece[] => {
				const made = new Set(outcome.madePieces.map((piece) => piece.id));
				return made.size > 0 ? sim.simulate({ ...outcome.project, length: change.to + 0.5 }).pieces.filter((piece) => made.has(piece.entityId)) : [];
			};
			const check = checkPattern(project, change, {
				sim,
				isChecked,
				onProgress: (progress) => scope.postMessage({ id, kind: 'progress', progress }),
				...(isPreview ? { onGhost: (outcome: TGroupRunOutcome) => scope.postMessage({ id, kind: 'ghost', pieces: resolved(outcome) }) } : {})
			});
			const { project: _after, ...answer } = check;
			scope.postMessage({ id, kind: 'done', answer: { ...answer, pieces: isPreview ? resolved(check) : [] } });
		})
		.catch((error: unknown) => {
			scope.postMessage({ id, kind: 'error', message: error instanceof Error ? error.message : String(error) });
		});
});
