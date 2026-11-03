import { useListener } from 'feature-react/state';
import React from 'react';
import type { StudioCx } from './StudioCx';

/** Advances the playhead in real time while playing and stops at the project end */
export function usePlayback(cx: StudioCx): void {
	const frameRef = React.useRef<number | null>(null);

	useListener(cx.$playing, ({ value: playing }) => {
		if (frameRef.current != null) cancelAnimationFrame(frameRef.current);
		frameRef.current = null;
		if (!playing) return;
		const end = cx.project?.end ?? 0;
		if (cx.$playhead.get() >= end) cx.$playhead.set(0);
		let last = performance.now();
		const step = (now: number): void => {
			const next = cx.$playhead.get() + (now - last) / 1000;
			last = now;
			if (next >= (cx.project?.end ?? 0)) {
				cx.$playhead.set(cx.project?.end ?? 0);
				cx.$playing.set(false);
				return;
			}
			cx.$playhead.set(next);
			frameRef.current = requestAnimationFrame(step);
		};
		frameRef.current = requestAnimationFrame(step);
	});

	React.useEffect(() => {
		return () => {
			if (frameRef.current != null) cancelAnimationFrame(frameRef.current);
		};
	}, []);
}
