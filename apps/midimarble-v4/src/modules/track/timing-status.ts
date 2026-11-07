import type { THitResult, TResolvedPiece } from '@/modules/simulation';

/** What the inspector header pill says about a piece's hit: a short label, its tone and the detail for the tooltip */
export interface TTimingStatus {
	tone: 'good' | 'warn' | 'bad' | 'neutral';
	label: string;
	detail?: string;
}

/** Names the tooltips use, such as `Marble 1` and `C4`; generic words stand in for missing ones */
export interface TTimingNames {
	marble?: string;
	note?: string;
	piece?: string;
	/** Whether a drag left the platform off its dot; says what is behind a late hit when known */
}

/**
 * Timing of a linked piece for the status pill, with the words of the Timing statuses table in words.md: On Time
 * in green, "12 ms Late" in amber, Missed, Stopped and Blocked in red, Open for a note without a platform, and
 * `unreachable` (Too Soon or Out of Reach) in amber for an open note no platform can play yet
 */
export function timingStatus(
	piece: Pick<TResolvedPiece, 'status'> | undefined,
	hit: THitResult | undefined,
	names: TTimingNames = {},
	unreachable?: { label: string; detail: string } | null
): TTimingStatus {
	const marble = names.marble ?? 'The marble';
	const target = names.piece == null ? 'this piece' : names.piece;
	if (piece?.status === 'blocked' || hit?.status === 'blocked') {
		return { tone: 'bad', label: 'Blocked', detail: `${marble} already passes through this spot earlier in its run` };
	}
	if (piece?.status === 'unreached') return { tone: 'bad', label: 'Missed', detail: `${marble} never reaches ${target}` };
	if (hit == null) return { tone: 'neutral', label: 'Checking…' };
	switch (hit.status) {
		case 'onTime': {
			const what = names.note == null ? 'its note' : names.note;
			const offset = hit.error == null || Math.abs(hit.error) < 0.00005 ? '' : ` (${signedMs(hit.error)})`;
			return { tone: 'good', label: 'On Time', detail: `${marble} hits ${what} on time${offset}` };
		}
		case 'drifting':
			return { tone: 'warn', label: hit.error == null ? 'Off Time' : latenessLabel(hit.error), detail: `${hit.error == null ? 'Lands off the note' : landsDetail(hit.error)}${offTimeCause(names)}` };
		case 'missed':
			if (hit.reason === 'resting') return { tone: 'bad', label: 'Stopped', detail: `${marble} stops on ${target} instead of striking it` };
			if (hit.error == null) return { tone: 'bad', label: 'Missed', detail: `${marble} passes ${target} without touching it` };
			return { tone: 'bad', label: 'Missed', detail: landsDetail(hit.error) };
		case 'waiting':
			return { tone: 'neutral', label: 'Waiting', detail: `${target === 'this piece' ? 'This platform' : target} waits where it was until the first note that needs attention is fixed` };
		case 'open':
			if (unreachable != null) return { tone: 'warn', label: unreachable.label, detail: unreachable.detail };
			return { tone: 'neutral', label: 'Open', detail: 'No platform plays this note yet' };
	}
}

/** Why a hit is off time, since neither its tilt nor its Time is the fix: the tilt moves the notes after it, the Time moves the note */
function offTimeCause(names: TTimingNames): string {
	return names.piece == null ? '' : '. The marble arrives off time from the piece before: Fix';
}

/** The status pill for an early or late hit, such as `12 ms Late` */
export function latenessLabel(error: number): string {
	const ms = Math.round(Math.abs(error) * 1000);
	return `${ms} ms ${error > 0 ? 'Late' : 'Early'}`;
}

/** `Lands 12 ms after the note` */
function landsDetail(error: number): string {
	const ms = Math.round(Math.abs(error) * 1000);
	return `Lands ${ms} ms ${error > 0 ? 'after' : 'before'} the note`;
}

/** Signed milliseconds with one decimal, such as `+12.3 ms` */
function signedMs(seconds: number): string {
	const ms = Math.round(seconds * 10000) / 10;
	return `${ms > 0 ? '+' : ''}${ms === 0 ? '0.0' : ms.toFixed(1)} ms`;
}
