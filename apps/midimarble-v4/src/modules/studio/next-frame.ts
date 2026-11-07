/** A frame stands in for this long at most: WebKit stops animation frames for a covered or hidden window */
const FRAME_FALLBACK_MS = 100;

/**
 * Runs `run` on the next animation frame, or after a short timer when frames have stopped, so work the app depends on
 * (the simulation, commands waiting for the canvas) never waits for the window to be seen. Returns the cancel.
 */
export function onNextFrame(run: () => void): () => void {
	let isDone = false;
	const once = (): void => {
		if (isDone) return;
		isDone = true;
		cancelAnimationFrame(frame);
		clearTimeout(timer);
		run();
	};
	const frame = requestAnimationFrame(once);
	const timer = setTimeout(once, FRAME_FALLBACK_MS);
	return () => {
		isDone = true;
		cancelAnimationFrame(frame);
		clearTimeout(timer);
	};
}
