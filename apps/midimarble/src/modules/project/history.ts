import type { TProject } from './types';

export function createProjectHistory(initial: TProject): TProjectHistory {
	let snapshot: THistorySnapshot = {
		project: initial,
		canUndo: false,
		canRedo: false,
		revision: 0
	};
	const past: TProject[] = [];
	const future: TProject[] = [];
	const listeners = new Set<() => void>();
	function publish(project: TProject) {
		snapshot = {
			project,
			canUndo: past.length > 0,
			canRedo: future.length > 0,
			revision: snapshot.revision + 1
		};
		for (const listener of listeners) listener();
	}
	return {
		getSnapshot: () => snapshot,
		subscribe: (listener) => {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		update: (recipe) => {
			const next = structuredClone(snapshot.project);
			recipe(next);
			if (JSON.stringify(next) === JSON.stringify(snapshot.project)) return;
			past.push(snapshot.project);
			if (past.length > 80) past.shift();
			future.length = 0;
			publish(next);
		},
		replace: (project) => {
			past.push(snapshot.project);
			if (past.length > 80) past.shift();
			future.length = 0;
			publish(project);
		},
		undo: () => {
			const previous = past.pop();
			if (previous == null) return;
			future.push(snapshot.project);
			publish(previous);
		},
		redo: () => {
			const next = future.pop();
			if (next == null) return;
			past.push(snapshot.project);
			publish(next);
		}
	};
}
interface THistorySnapshot {
	project: TProject;
	canUndo: boolean;
	canRedo: boolean;
	revision: number;
}
export interface TProjectHistory {
	getSnapshot(): THistorySnapshot;
	subscribe(listener: () => void): () => void;
	update(recipe: (draft: TProject) => void): void;
	replace(project: TProject): void;
	undo(): void;
	redo(): void;
}
