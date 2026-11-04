import { createState } from 'feature-state';

/** Whether the Song track shows every note in a piano roll. View state for the session, not saved with the project. */
export const $songExpanded = createState(false);

export function toggleSongExpanded(): void {
	$songExpanded.set((isExpanded) => !isExpanded);
}
