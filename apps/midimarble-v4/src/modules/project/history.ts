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

/** Entities that differ in `after` from `before`, or are new in it: what an undo or redo changed that still exists */
export function changedEntityIds(before: TProject, after: TProject): string[] {
	const previous = new Map(before.entities.map((entity) => [entity.id, entity]));
	return after.entities
		.filter((entity) => {
			const old = previous.get(entity.id);
			return old == null || JSON.stringify(old) !== JSON.stringify(entity);
		})
		.map((entity) => entity.id);
}
