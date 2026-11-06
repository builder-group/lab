import type { TProject } from '@/modules/project';
import { type TPackedResult, type TQueueResponse, unpackResult } from '@/modules/simulation';
import { runIssues, type TPreflightIssue } from './export-preflight';

// The open project's run problems are found here: on a long song they took half a second on the main thread after
// every edit, most of it the follow camera's bake, which a person felt as a stall

export interface TProblemsWorkerRequest {
	id: number;
	project: TProject;
	result: TPackedResult;
}

export type TProblemsWorkerResponse = TQueueResponse<TPreflightIssue[]>;

interface TWorkerScope {
	postMessage: (message: TProblemsWorkerResponse) => void;
	addEventListener: (type: 'message', listener: (event: MessageEvent<TProblemsWorkerRequest>) => void) => void;
}

const scope = self as unknown as TWorkerScope;

scope.addEventListener('message', (event) => {
	const { id, project, result } = event.data;
	try {
		scope.postMessage({ id, ok: true, value: runIssues(project, unpackResult(result)) });
	} catch (error) {
		scope.postMessage({ id, ok: false, error: error instanceof Error ? error.message : String(error) });
	}
});
