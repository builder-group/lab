import type { THitResult, TResolvedPiece } from '@/modules/simulation';

/** What the inspector header pill says about a piece's hit: a short label, its tone and the detail for the tooltip */
export interface TTimingStatus {
	tone: 'good' | 'warn' | 'bad' | 'neutral';
	label: string;
	detail?: string;
}

/**
 * Timing of a linked piece for the inspector's status pill: On time in green, a drifting hit as
 * "12 ms late" in amber, Missed, Resting and Blocked in red
 */
export function timingStatus(piece: Pick<TResolvedPiece, 'status'> | undefined, hit: THitResult | undefined): TTimingStatus {
	if (piece?.status === 'blocked' || hit?.status === 'blocked') {
		return { tone: 'bad', label: 'Blocked', detail: 'The run before this hit already passes through this spot, so the piece is left out.' };
	}
	if (piece?.status === 'unreached') return { tone: 'bad', label: 'Missed', detail: 'The marble never reaches this hit.' };
	if (hit == null) return { tone: 'neutral', label: 'Simulating…' };
	const offset = hit.error == null ? undefined : signedMs(hit.error);
	switch (hit.status) {
		case 'onTime':
			return { tone: 'good', label: 'On time', detail: offset == null ? undefined : `${offset} from the note` };
		case 'drifting': {
			const label = hit.error == null || Math.abs(hit.error) < 0.0005 ? 'Drifting' : lateness(hit.error);
			return { tone: 'warn', label, detail: `${offset ?? 'Off'} from the note. Still within 20 ms, but an earlier change moved it.` };
		}
		case 'missed':
			if (hit.reason === 'resting') {
				return { tone: 'bad', label: 'Resting', detail: 'The marble rolls or rests onto this piece instead of striking it, so no note sounds.' };
			}
			if (hit.error == null) return { tone: 'bad', label: 'Missed', detail: 'The marble does not touch this piece.' };
			return { tone: 'bad', label: 'Missed', detail: `The marble arrives ${lateness(hit.error)}.` };
		case 'open':
			return { tone: 'neutral', label: 'Not placed' };
	}
}

/** Whole milliseconds with the direction, such as `12 ms late` */
export function lateness(error: number): string {
	const ms = Math.round(Math.abs(error) * 1000);
	return `${ms} ms ${error > 0 ? 'late' : 'early'}`;
}

/** Signed milliseconds with one decimal, such as `+12.3 ms` */
function signedMs(seconds: number): string {
	const ms = Math.round(seconds * 10000) / 10;
	return `${ms > 0 ? '+' : ''}${ms === 0 ? '0.0' : ms.toFixed(1)} ms`;
}
