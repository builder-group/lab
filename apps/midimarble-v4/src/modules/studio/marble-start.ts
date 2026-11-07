import type { TMarble, TProject } from '@/modules/project';
import type { StudioCx } from './StudioCx';

/** The project with a marble starting at `time`, for a what-if while its start is dragged */
export function withMarbleStart(project: TProject, marbleId: string, time: number): TProject {
	return { ...project, marbles: project.marbles.map((marble) => (marble.id === marbleId ? { ...marble, start: { ...marble.start, time } } : marble)) };
}

/** How many of a marble's first hits a start at `time` leaves behind */
export function hitsBeforeStart(marble: Pick<TMarble, 'hits'>, time: number): number {
	return marble.hits.filter((hit) => hit.time <= time + TIME_EPSILON).length;
}

/** Said while a start is dragged past the first note, or null before it */
export function hitsBeforeStartWords(marble: Pick<TMarble, 'hits'>, time: number): string | null {
	const count = hitsBeforeStart(marble, time);
	if (count === 0) return null;
	return `${hitsWords(count)} ${count === 1 ? 'comes' : 'come'} before this start`;
}

/**
 * Moves a marble's start as one Undo step. Past its first note it still goes there, as asked: those notes keep their hits
 * and their platforms, show as Too Soon or Missed in every place they did, and the notice says so.
 */
export function moveMarbleStart(cx: StudioCx, marble: TMarble, time: number): void {
	const before = hitsBeforeStart(marble, marble.start.time);
	if (time === marble.start.time || !cx.execute([{ type: 'updateMarble', marbleId: marble.id, patch: { start: { ...marble.start, time } } }], { label: 'Move Start' })) return;
	const count = hitsBeforeStart(marble, time);
	if (count > before) cx.notifyEdit(`${marble.name} now starts after ${hitsWords(count)}. ${count === 1 ? 'It stays on its row but can' : 'They stay on its row but can'}'t play until it starts earlier.`);
}

function hitsWords(count: number): string {
	if (count === 1) return 'Hit 1';
	return count === 2 ? 'Hits 1 and 2' : `Hits 1 to ${count}`;
}

const TIME_EPSILON = 1e-6;
