import { createSimulator } from './simulate';
import type { TQueueResponse } from './request-queue';
import { answerWorkerRequest, type TWorkerMessage } from './worker-protocol';

export type TSimulationWorkerRequest = TWorkerMessage;
export type TSimulationWorkerResponse = TQueueResponse<unknown>;

interface TWorkerScope {
	postMessage: (message: TSimulationWorkerResponse) => void;
	addEventListener: (type: 'message', listener: (event: MessageEvent<TSimulationWorkerRequest>) => void) => void;
}

const scope = self as unknown as TWorkerScope;
const simulatorPromise = createSimulator();

scope.addEventListener('message', (event) => {
	const { id } = event.data;
	simulatorPromise
		.then((simulator) => {
			scope.postMessage({ id, ok: true, value: answerWorkerRequest(simulator, event.data) });
		})
		.catch((error: unknown) => {
			scope.postMessage({ id, ok: false, error: error instanceof Error ? error.message : String(error) });
		});
});
