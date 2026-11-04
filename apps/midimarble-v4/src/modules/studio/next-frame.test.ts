import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { onNextFrame } from './next-frame';

describe('onNextFrame function', () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1));
		vi.stubGlobal('cancelAnimationFrame', vi.fn());
	});
	afterEach(() => {
		vi.useRealTimers();
		vi.unstubAllGlobals();
	});

	it('should run on a timer when frames have stopped, as for a covered window', () => {
		const run = vi.fn();

		onNextFrame(run);
		vi.advanceTimersByTime(100);

		expect(run).toHaveBeenCalledOnce();
	});

	it('should not run after cancel', () => {
		const run = vi.fn();

		onNextFrame(run)();
		vi.advanceTimersByTime(200);

		expect(run).not.toHaveBeenCalled();
	});
});
