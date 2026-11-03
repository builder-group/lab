import type { TProject } from './schema';

export interface TProjectHistory {
	past: TProject[];
	present: TProject;
	future: TProject[];
}

const HISTORY_LIMIT = 200;

export function createHistory(project: TProject): TProjectHistory {
	return { past: [], present: project, future: [] };
}

export function pushHistory(history: TProjectHistory, next: TProject): TProjectHistory {
	return {
		past: [...history.past, history.present].slice(-HISTORY_LIMIT),
		present: next,
		future: []
	};
}

/** Undo and redo still increase the revision so asynchronous work can detect the change */
export function undoHistory(history: TProjectHistory): TProjectHistory {
	const previous = history.past[history.past.length - 1];
	if (previous == null) return history;
	return {
		past: history.past.slice(0, -1),
		present: { ...previous, revision: history.present.revision + 1 },
		future: [history.present, ...history.future]
	};
}

export function redoHistory(history: TProjectHistory): TProjectHistory {
	const next = history.future[0];
	if (next == null) return history;
	return {
		past: [...history.past, history.present],
		present: { ...next, revision: history.present.revision + 1 },
		future: history.future.slice(1)
	};
}
