import { createSimulator, type TQueueResponse, packResult, type TSimulationResult } from '@/modules/simulation';
import { answerWorkerRequest, createWorkerMemory, type TWorkerMessage } from './worker-protocol';

export type TSimulationWorkerRequest = TWorkerMessage;
export type TSimulationWorkerResponse = TQueueResponse<unknown>;

interface TWorkerScope {
	postMessage: (message: TSimulationWorkerResponse, transfer?: Transferable[]) => void;
	addEventListener: (type: 'message', listener: (event: MessageEvent<TSimulationWorkerRequest>) => void) => void;
}

const scope = self as unknown as TWorkerScope;
const simulatorPromise = createSimulator();
const memory = createWorkerMemory();

scope.addEventListener('message', (event) => {
	const { id } = event.data;
	simulatorPromise
		.then((simulator) => {
			const value = answerWorkerRequest(simulator, event.data, memory);
			if (event.data.kind !== 'simulate') {
				scope.postMessage({ id, ok: true, value });
				return;
			}
			const { packed, transfer } = packResult(value as TSimulationResult);
			scope.postMessage({ id, ok: true, value: packed }, transfer);
		})
		.catch((error: unknown) => {
			scope.postMessage({ id, ok: false, error: error instanceof Error ? error.message : String(error) });
		});
});
