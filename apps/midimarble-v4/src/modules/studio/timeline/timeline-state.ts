import { createState } from 'feature-state';

/** Lanes whose track is expanded into a piano roll. View state for the session, not saved with the project. */
export const $expandedLanes = createState<string[]>([]);

export function toggleExpandedLane(laneId: string): void {
	$expandedLanes.set((ids) => (ids.includes(laneId) ? ids.filter((id) => id !== laneId) : [...ids, laneId]));
}
