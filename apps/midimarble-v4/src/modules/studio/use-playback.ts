import { useListener } from 'feature-react/state';
import React from 'react';
import { audibleProject, type StudioCx } from './StudioCx';

// After the project's first run and draw, so the warm-up never delays opening
const WARM_UP_DELAY_MS = 600;

/**
 * Drives the playhead from the audio clock while playing. Seeking during playback restarts audio at
 * the new time, and playback stops at the project end.
 */
export function usePlayback(cx: StudioCx): void {
	const frameRef = React.useRef<number | null>(null);
	// The last playhead value written by this loop, to tell clock updates from user seeks
	const clockRef = React.useRef<number | null>(null);

	const stopLoop = React.useCallback(() => {
		if (frameRef.current != null) cancelAnimationFrame(frameRef.current);
		frameRef.current = null;
		clockRef.current = null;
	}, []);

	const startLoop = React.useCallback(() => {
		const step = (): void => {
			const end = cx.project?.end ?? 0;
			const time = cx.audio.getTime();
			if (time >= end) {
				clockRef.current = end;
				cx.$playhead.set(end);
				cx.$playing.set(false);
				return;
			}
			clockRef.current = time;
			cx.$playhead.set(time);
			frameRef.current = requestAnimationFrame(step);
		};
		frameRef.current = requestAnimationFrame(step);
	}, [cx]);

	useListener(cx.$playing, ({ value: playing }) => {
		stopLoop();
		if (!playing) {
			cx.audio.stop();
			return;
		}
		const project = cx.project;
		if (project == null) return;
		if (cx.$playhead.get() >= project.end) cx.$playhead.set(0);
		const from = cx.$playhead.get();
		void (async () => {
			try {
				await cx.audio.prepare(audibleProject(project, cx.$mix.get()), cx.resolveSourceUrl);
				if (!cx.$playing.get()) return;
				await cx.audio.play(from);
				if (cx.$playing.get()) startLoop();
			} catch (error) {
				cx.$playing.set(false);
				cx.notify(`Playback failed: ${(error as Error).message}`, 'error');
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
		const stop = cx.$path.listen(schedule);
		return () => {
			stop();
			window.clearTimeout(handle);
		};
	}, [cx]);

	// Muting or soloing a lane while playing takes effect immediately, like a mixer
	useListener(cx.$mix, ({ value }) => {
		const project = cx.project;
		if (!cx.$playing.get() || project == null) return;
		void cx.audio.prepare(audibleProject(project, value), cx.resolveSourceUrl);
	});

	React.useEffect(() => stopLoop, [stopLoop]);
}
