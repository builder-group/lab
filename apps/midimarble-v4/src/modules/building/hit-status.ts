import type { THit } from '@/modules/project';
import type { THitResult } from '@/modules/simulation';
import { noteName } from '@/modules/project';

/**
 * The timing status of a hit in the words of `docs/words.md`: a Title Case label and a sentence-case tooltip.
 * `unreachable` is the Too Soon or Out of Reach status of an open hit that cannot get a platform.
 */
export function hitTiming(result: THitResult | undefined, names: THitNames, unreachable?: { label: string; detail: string } | null): THitTiming {
	if (result?.status === 'open' && unreachable != null) return { state: 'unreachable', label: unreachable.label, tooltip: unreachable.detail };
	const note = names.pitch == null ? 'its note' : noteName(names.pitch);
	switch (result?.status) {
		case 'onTime':
			return { state: 'onTime', label: 'On Time', tooltip: `${names.marble} hits ${note} on time` };
		case 'drifting': {
			const error = result.error ?? 0;
			const ms = Math.max(1, Math.round(Math.abs(error) * 1000));
			const isLate = error > 0;
			return { state: 'drifting', label: `${ms} ms ${isLate ? 'Late' : 'Early'}`, tooltip: `Lands ${ms} ms ${isLate ? 'after' : 'before'} the note` };
		}
		case 'missed':
			if (result.reason === 'resting') return { state: 'missed', label: 'Stopped', tooltip: `${names.marble} stops on this platform` };
			return { state: 'missed', label: 'Missed', tooltip: `${names.marble} passes the platform without touching it` };
		case 'blocked':
			return { state: 'missed', label: 'Blocked', tooltip: `${names.piece ?? 'The platform'} is in the way of the run before this note` };
		case 'waiting':
			return { state: 'open', label: 'Waiting', tooltip: `${names.piece ?? 'Its platform'} waits where it was until the first note that needs attention is fixed` };
		default:
			return { state: 'open', label: 'Open', tooltip: 'No platform plays this note yet' };
	}
}

export interface THitNames {
	marble: string;
	pitch?: number;
	piece?: string;
}

export interface THitTiming {
	// Drawing state: Stopped and Blocked share Missed's red; Too Soon and Out of Reach are hollow amber
	state: 'open' | 'onTime' | 'drifting' | 'missed' | 'unreachable';
	label: string;
	tooltip: string;
}

/** Whether a hit is a pitched note the piano roll can draw */
export function isPitched(hit: THit): hit is THit & { pitch: number } {
	return hit.pitch != null;
}

/**
 * Problems in the order they happen in the run, like Xcode's issue navigator: by their time, the start of a
 * framing span, or the time their target shows; problems without any time come last, in their given order
 */
export function problemsInTimeOrder<T extends { time?: number; span?: { from: number }; target: { time?: number } | null }>(problems: readonly T[]): T[] {
	const when = (problem: T): number => problem.time ?? problem.span?.from ?? problem.target?.time ?? Infinity;
	return problems
		.map((problem, order) => ({ problem, order, time: when(problem) }))
		.sort((a, b) => (a.time === b.time ? a.order - b.order : a.time - b.time))
		.map((entry) => entry.problem);
}
