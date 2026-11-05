import { useListener } from 'feature-react/state';
import React from 'react';
import type { TVec2 } from '@/modules/project';
import type { THitResult } from '@/modules/simulation';
import type { StudioCx } from '@/modules/studio';

/**
 * Timing is shown, not heard: a hit's dot flashes in its status color as the marble lands it during playback,
 * green On Time, amber early or late, red Missed, Blocked or Stopped. Open hits have nothing to land on.
 */
export interface THitFlash {
	marbleId: string;
	hitId: string;
	tone: 'good' | 'warn' | 'bad';
	// When the marble lands: its contact, or the note's own time when it never gets there
	time: number;
	dot: TVec2 | null;
}

// A longer step between frames is a seek or a stall, which flashes nothing
const MAX_FLASH_STEP = 0.25;

/** What each hit does during playback, in time order */
export function hitLandings(hits: readonly THitResult[]): THitFlash[] {
	return hits
		.flatMap((hit): THitFlash[] => {
			const { marbleId, hitId, dot } = hit;
			switch (hit.status) {
				case 'onTime':
					return [{ marbleId, hitId, dot, tone: 'good', time: hit.actualTime ?? hit.targetTime }];
				case 'drifting':
					return [{ marbleId, hitId, dot, tone: 'warn', time: hit.actualTime ?? hit.targetTime }];
				case 'missed':
				case 'blocked':
					return [{ marbleId, hitId, dot, tone: 'bad', time: hit.targetTime }];
				default:
					return [];
			}
		})
		.sort((a, b) => a.time - b.time);
}

/** The landings the playhead crossed between two frames; a step back or a jump crosses none */
export function landedBetween(landings: readonly THitFlash[], from: number, to: number): THitFlash[] {
	if (to <= from || to - from > MAX_FLASH_STEP) return [];
	return landings.filter((landing) => landing.time > from && landing.time <= to);
}

/** The offset of a landed hit from its note, for its tooltip: "+12 ms", "−3 ms", "0 ms" */
export function offsetLabel(error: number): string {
	const ms = Math.round(error * 1000);
	return ms === 0 ? '0 ms' : `${ms > 0 ? '+' : '−'}${Math.abs(ms)} ms`;
}

/**
 * Publishes landed hits on `$hitFlash` as the playhead crosses them. Only a crossing sets state, so a frame without
 * one costs a small filter over the run's hits, and the rows and the wall never re-render per frame.
 */
export function useHitFlash(cx: StudioCx): void {
	const lastRef = React.useRef<number | null>(null);
	const landingsRef = React.useRef<{ hits: readonly THitResult[]; landings: THitFlash[] } | null>(null);

	useListener(cx.$playhead, ({ value }) => {
		const last = lastRef.current;
		lastRef.current = value;
		const result = cx.simulation.$result.get();
		if (last == null || !cx.$playing.get() || result == null || result.revision !== cx.project?.revision) return;
		if (landingsRef.current?.hits !== result.hits) landingsRef.current = { hits: result.hits, landings: hitLandings(result.hits) };
		const landed = landedBetween(landingsRef.current.landings, last, value);
		if (landed.length > 0) cx.$hitFlash.set(landed);
	});
}

/** Flashes a hit's element once; the attribute comes off when the animation ends, so the next landing can restart it */
export function flashElement(element: HTMLElement, tone: THitFlash['tone']): void {
	element.dataset['flash'] = tone;
	element.addEventListener(
		'animationend',
		() => {
			delete element.dataset['flash'];
		},
		{ once: true }
	);
}
