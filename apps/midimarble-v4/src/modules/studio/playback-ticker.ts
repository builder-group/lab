/** The clocks a ticker runs on, replaceable in tests */
export interface TTickerClock {
	now: () => number;
	requestFrame: (run: () => void) => number;
	cancelFrame: (handle: number) => void;
	setRepeating: (run: () => void, ms: number) => ReturnType<typeof setInterval>;
	clearRepeating: (handle: ReturnType<typeof setInterval>) => void;
}

/** A timer tick stands in once frames stopped for this long */
export const STALLED_FRAMES_MS = 250;

const browserClock: TTickerClock = {
	now: () => performance.now(),
	requestFrame: (run) => requestAnimationFrame(run),
	cancelFrame: (handle) => cancelAnimationFrame(handle),
	setRepeating: (run, ms) => setInterval(run, ms),
	clearRepeating: (handle) => clearInterval(handle)
};

/**
 * Runs `tick` every animation frame while it returns true. WebKit stops frames for a fully covered window while the
 * audio plays on, so a timer takes over whenever frames stall: the playhead stays with the audio and playback still
 * stops at the end. Returns the stop.
 */
export function startPlaybackTicker(tick: () => boolean, clock: TTickerClock = browserClock): () => void {
	let frame: number | null = null;
	let isStopped = false;
	let lastTick = clock.now();

	const stop = (): void => {
		if (isStopped) return;
		isStopped = true;
		if (frame != null) clock.cancelFrame(frame);
		clock.clearRepeating(timer);
	};
	const run = (): void => {
		lastTick = clock.now();
		if (!tick()) stop();
	};
	const onFrame = (): void => {
		frame = null;
		if (isStopped) return;
		run();
		if (!isStopped) frame = clock.requestFrame(onFrame);
	};
	const timer = clock.setRepeating(() => {
		if (!isStopped && clock.now() - lastTick >= STALLED_FRAMES_MS) run();
	}, STALLED_FRAMES_MS);
	frame = clock.requestFrame(onFrame);
	return stop;
}
