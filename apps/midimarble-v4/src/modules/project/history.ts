import type { TProject } from './schema';

/**
 * Undo history. Each state carries the id of the edit group that produced it, in `groups` parallel to
 * `past`, `present` and `future`. Commands of one group fold into a single undo step, so a placement
 * and the refinements or ties that follow it undo together, and a notice can tell whether the edit it
 * reports is still the latest.
 */
export interface TProjectHistory {
	past: TProject[];
	present: TProject;
	future: TProject[];
	groups: THistoryGroups;
}

export interface THistoryGroups {
	past: number[];
	/** 0 for the opened state */
	present: number;
	future: number[];
}

const HISTORY_LIMIT = 200;

export function createHistory(project: TProject): TProjectHistory {
	return { past: [], present: project, future: [], groups: { past: [], present: 0, future: [] } };
}

/**
 * Adds `next` as a new undo step. With `group` equal to the present's group, `next` replaces the present
 * instead and stays part of that step. A new step's group is `group` or, without one, the new revision.
 */
export function pushHistory(history: TProjectHistory, next: TProject, group?: number): TProjectHistory {
	if (group != null && group === history.groups.present && history.groups.present !== 0) return amendHistory(history, next);
	return {
		past: [...history.past, history.present].slice(-HISTORY_LIMIT),
		present: next,
		future: [],
		groups: { past: [...history.groups.past, history.groups.present].slice(-HISTORY_LIMIT), present: group ?? next.revision, future: [] }
	};
}

/** Replaces the present with `next` within the same undo step; a redo after it no longer applies */
export function amendHistory(history: TProjectHistory, next: TProject): TProjectHistory {
	return { ...history, present: next, future: [], groups: { ...history.groups, future: [] } };
}

/** Undo and redo still increase the revision so asynchronous work can detect the change */
export function undoHistory(history: TProjectHistory): TProjectHistory {
	const previous = history.past[history.past.length - 1];
	if (previous == null) return history;
	const { groups } = history;
	return {
		past: history.past.slice(0, -1),
		present: { ...previous, revision: history.present.revision + 1 },
		future: [history.present, ...history.future],
		groups: { past: groups.past.slice(0, -1), present: groups.past[groups.past.length - 1] ?? 0, future: [groups.present, ...groups.future] }
	};
}

export function redoHistory(history: TProjectHistory): TProjectHistory {
	const next = history.future[0];
	if (next == null) return history;
	const { groups } = history;
	return {
		past: [...history.past, history.present],
		present: { ...next, revision: history.present.revision + 1 },
		future: history.future.slice(1),
		groups: { past: [...groups.past, groups.present], present: groups.future[0] ?? 0, future: groups.future.slice(1) }
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
