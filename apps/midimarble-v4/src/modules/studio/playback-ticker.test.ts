import { describe, expect, it } from 'vitest';
import { startPlaybackTicker, STALLED_FRAMES_MS, type TTickerClock } from './playback-ticker';

function fakeClock(): TTickerClock & { time: number; fireFrame: () => void; fireTimer: () => void; timerCleared: boolean; framePending: () => boolean } {
	let frame: (() => void) | null = null;
	let timer: (() => void) | null = null;
	const clock = {
		time: 0,
		timerCleared: false,
		now: () => clock.time,
		requestFrame: (run: () => void) => {
			frame = run;
			return 1;
		},
		cancelFrame: () => {
			frame = null;
		},
		setRepeating: (run: () => void) => {
			timer = run;
			return 1 as unknown as ReturnType<typeof setInterval>;
		},
		clearRepeating: () => {
			clock.timerCleared = true;
		},
		fireFrame: () => {
			const run = frame;
			frame = null;
			run?.();
		},
		fireTimer: () => timer?.(),
		framePending: () => frame != null
	};
	return clock;
}

describe('startPlaybackTicker', () => {
	it('should tick on frames and leave the timer idle while they come', () => {
		const clock = fakeClock();
		let ticks = 0;
		startPlaybackTicker(() => ++ticks > 0, clock);
		clock.time = 16;
		clock.fireFrame();
		clock.time = 32;
		clock.fireFrame();
		clock.time = 48;
		clock.fireTimer();
		expect(ticks).toBe(2);
	});

	it('should keep ticking on the timer when a covered window stops the frames', () => {
		const clock = fakeClock();
		let ticks = 0;
		startPlaybackTicker(() => ++ticks > 0, clock);
		for (let i = 1; i <= 4; i++) {
			clock.time = i * STALLED_FRAMES_MS;
			clock.fireTimer();
		}
		expect(ticks).toBe(4);
	});

	it('should stop for good when a tick says so, from a frame or from the timer', () => {
		const clock = fakeClock();
		let ticks = 0;
		startPlaybackTicker(() => ++ticks < 2, clock);
		clock.time = STALLED_FRAMES_MS;
		clock.fireTimer();
		clock.time = 2 * STALLED_FRAMES_MS;
		clock.fireTimer();
		expect(ticks).toBe(2);
		expect(clock.timerCleared).toBe(true);
		expect(clock.framePending()).toBe(false);
		clock.time = 3 * STALLED_FRAMES_MS;
		clock.fireTimer();
		clock.fireFrame();
		expect(ticks).toBe(2);
	});

	it('should stop when asked', () => {
		const clock = fakeClock();
		let ticks = 0;
		const stop = startPlaybackTicker(() => ++ticks > 0, clock);
		stop();
		clock.time = STALLED_FRAMES_MS;
		clock.fireFrame();
		clock.fireTimer();
		expect(ticks).toBe(0);
	});
});
