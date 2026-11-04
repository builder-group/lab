import { useFeatureState } from 'feature-react/state';
import React from 'react';
import { audibleProject, BACKING_COLOR, backingNoteLength, laneNoteLength, soundsNotes } from '@/modules/music';
import type { THit, TProject } from '@/modules/project';
import type { StudioCx } from '../StudioCx';

/** One note as it sounds: when it starts and ends, and the colour its key lights in */
export interface TNoteSpan {
	pitch: number;
	color: string;
	start: number;
	end: number;
}

type TPitchedHit = THit & { pitch: number };

// How long a key stays lit after the playhead stopped moving while scrubbing, in milliseconds
const SCRUB_HOLD_MS = 180;

const NOTHING_SOUNDS: ReadonlyMap<number, string> = new Map();

/** The notes a project plays, in the order they start: marbles in their colours, Backing in grey */
export function noteSpans(project: TProject): TNoteSpan[] {
	if (!soundsNotes(project)) return [];
	const pitched = (hits: THit[]): TPitchedHit[] => hits.filter((hit): hit is TPitchedHit => hit.pitch != null).sort((a, b) => a.time - b.time);
	const lanes = project.music.lanes.flatMap((lane) =>
		pitched(lane.hits).map((hit, index, hits) => ({ pitch: hit.pitch, color: lane.color, start: hit.time, end: hit.time + laneNoteLength(hit, hits[index + 1]) }))
	);
	const backing = pitched(project.music.backing).map((hit, index, hits) => {
		const next = hits.slice(index + 1).find((item) => item.pitch === hit.pitch);
		return { pitch: hit.pitch, color: BACKING_COLOR, start: hit.time, end: hit.time + backingNoteLength(hit, next) };
	});
	return [...lanes, ...backing].sort((a, b) => a.start - b.start);
}

/** The keys sounding at `time` with their colours; of two notes on one key the later one shows */
export function soundingKeys(spans: readonly TNoteSpan[], time: number): Map<number, string> {
	const keys = new Map<number, string>();
	for (const span of spans) {
		if (span.start > time) break;
		if (time < span.end) keys.set(span.pitch, span.color);
	}
	return keys;
}

/**
 * Lights the keys under `container` (each with `data-pitch`) while their notes sound, playing or scrubbing, set on the
 * elements like `flashElement` so the keyboard never re-renders per frame. A key lit or released is state, not motion,
 * so Reduce Motion leaves this on.
 */
export function useSoundingKeys(cx: StudioCx, project: TProject, container: React.RefObject<HTMLElement | null>): void {
	const mix = useFeatureState(cx.$mix);
	const spans = React.useMemo(() => noteSpans(audibleProject(project, mix)), [project, mix]);

	React.useEffect(() => {
		let lit: ReadonlyMap<number, string> = NOTHING_SOUNDS;
		let timer: ReturnType<typeof setTimeout> | undefined;

		function show(keys: ReadonlyMap<number, string>): void {
			const element = container.current;
			if (element != null) {
				for (const pitch of lit.keys()) if (!keys.has(pitch)) keyElement(element, pitch)?.removeAttribute('data-sounding');
				for (const [pitch, color] of keys) {
					if (lit.get(pitch) === color) continue;
					const key = keyElement(element, pitch);
					key?.setAttribute('data-sounding', '');
					key?.style.setProperty('--sounding', color);
				}
			}
			lit = keys;
		}

		const stopPlayhead = cx.$playhead.listen(({ value }) => {
			clearTimeout(timer);
			show(soundingKeys(spans, value));
			if (!cx.$playing.get()) timer = setTimeout(() => show(NOTHING_SOUNDS), SCRUB_HOLD_MS);
		});
		const stopPlaying = cx.$playing.listen(({ value }) => {
			if (!value) show(NOTHING_SOUNDS);
		});
		return () => {
			clearTimeout(timer);
			stopPlayhead();
			stopPlaying();
			show(NOTHING_SOUNDS);
		};
	}, [cx, spans, container]);
}

function keyElement(container: HTMLElement, pitch: number): HTMLElement | null {
	return container.querySelector<HTMLElement>(`[data-pitch="${pitch}"]`);
}
