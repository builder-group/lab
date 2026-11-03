import type { TProject } from '@/modules/project';
import { createSimulator } from './simulate';
import type { TSimulationResult } from './types';

export interface TSimulationWorkerRequest {
	id: number;
	project: TProject;
}

export type TSimulationWorkerResponse =
	{ id: number; ok: true; result: TSimulationResult } | { id: number; ok: false; error: string };

interface TWorkerScope {
	postMessage: (message: TSimulationWorkerResponse) => void;
	addEventListener: (
		type: 'message',
		listener: (event: MessageEvent<TSimulationWorkerRequest>) => void
	) => void;
}

const scope = self as unknown as TWorkerScope;
const simulatorPromise = createSimulator();

scope.addEventListener('message', (event) => {
	const { id, project } = event.data;
	simulatorPromise
		.then((simulator) => {
			scope.postMessage({ id, ok: true, result: simulator.simulate(project) });
		})
		.catch((error: unknown) => {
			scope.postMessage({
				id,
				ok: false,
				error: error instanceof Error ? error.message : String(error)
			});
		});
});
