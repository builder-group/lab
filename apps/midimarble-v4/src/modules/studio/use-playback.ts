import { useListener } from 'feature-react/state';
import React from 'react';
import { repeatPlayFrom, repeatRestart } from './repeat-range';
import { startPlaybackTicker } from './playback-ticker';
import { audibleProject } from '@/modules/music';
import type { StudioCx } from './StudioCx';
import { useHitFlash } from '@/modules/canvas';

// After the project's first run and draw, so the warm-up never delays opening
const WARM_UP_DELAY_MS = 600;

/**
 * Drives the playhead from the audio clock while playing. Seeking during playback restarts audio at
 * the new time, playback stops at the project end, and with Repeat Range on it jumps back at the end of the range.
 */
export function usePlayback(cx: StudioCx): void {
	useHitFlash(cx);
	const stopTickerRef = React.useRef<(() => void) | null>(null);
	// The last playhead value written by this loop, to tell clock updates from user seeks
	const clockRef = React.useRef<number | null>(null);

	const stopLoop = React.useCallback(() => {
		stopTickerRef.current?.();
		stopTickerRef.current = null;
		clockRef.current = null;
	}, []);

	const startLoop = React.useCallback(() => {
		stopTickerRef.current = startPlaybackTicker(() => {
			// Tapping along runs past a length that follows the song (`playbackEnd`)
			const end = cx.playbackEnd;
			const time = cx.audio.getTime();
			const restart = repeatRestart(time, cx.repeatSpan);
			if (restart != null) {
				clockRef.current = restart;
				cx.$playhead.set(restart);
				void cx.audio.play(restart);
				return true;
			}
			if (time >= end) {
				clockRef.current = end;
				cx.$playhead.set(end);
				cx.$playing.set(false);
				return false;
			}
			clockRef.current = time;
			cx.$playhead.set(time);
			return true;
		});
	}, [cx]);

	useListener(cx.$playing, ({ value: playing }) => {
		stopLoop();
		if (!playing) {
			cx.audio.stop();
			return;
		}
		const project = cx.project;
		if (project == null) return;
		if (cx.$playhead.get() >= cx.playbackEnd) cx.$playhead.set(0);
		const from = repeatPlayFrom(cx.$playhead.get(), cx.repeatSpan);
		if (from !== cx.$playhead.get()) cx.$playhead.set(from);
		void (async () => {
			try {
				await cx.audio.prepare(audibleProject(project, cx.$mix.get()), cx.resolveSourceUrl);
				if (!cx.$playing.get()) return;
				await cx.audio.play(from);
				if (cx.$playing.get()) startLoop();
			} catch (error) {
				cx.$playing.set(false);
				cx.notifyFailed('Playback stopped. Press Play to try again.', error);
			}
		})();
	});

	useListener(cx.$playhead, ({ value }) => {
		if (!cx.$playing.get() || clockRef.current == null || Math.abs(value - clockRef.current) < 1e-6) return;
		clockRef.current = value;
		void cx.audio.play(value);
	});

	// Edits while playing re-render the soundtrack; the engine keeps the current position
	useListener(cx.$history, ({ value }) => {
		if (!cx.$playing.get() || value == null) return;
		void cx.audio.prepare(audibleProject(value.present, cx.$mix.get()), cx.resolveSourceUrl);
	});

	// Warms the soundtrack once a project opens, while the window is idle, so the first Space starts at once
	// instead of loading the instrument bank and rendering the song in its first frame
	React.useEffect(() => {
		let handle: number | undefined;
		const schedule = (): void => {
			window.clearTimeout(handle);
			handle = window.setTimeout(() => {
				const project = cx.project;
				if (project == null || cx.$playing.get()) return;
				void cx.audio.prepare(audibleProject(project, cx.$mix.get()), cx.resolveSourceUrl).catch(() => undefined);
			}, WARM_UP_DELAY_MS);
		};
		if (cx.project != null) schedule();
		const stopPath = cx.$path.listen(schedule);
		// A marble or song muted or soloed while stopped is rendered now too, so the next Play or playhead drag has it at once
		const stopMix = cx.$mix.listen(schedule);
		return () => {
			stopPath();
			stopMix();
			window.clearTimeout(handle);
		};
	}, [cx]);

	// Muting or soloing while playing takes effect immediately, like a mixer
	useListener(cx.$mix, ({ value }) => {
		const project = cx.project;
		if (!cx.$playing.get() || project == null) return;
		void cx.audio.prepare(audibleProject(project, value), cx.resolveSourceUrl);
	});

	React.useEffect(() => stopLoop, [stopLoop]);
}
