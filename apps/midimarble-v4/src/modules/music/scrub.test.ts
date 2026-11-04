import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createScrubber, SCRUB_FADE, SCRUB_SNIPPET, scrubWindow, type TScrubContext } from './scrub';

function createFakeContext() {
	const sources: {
		buffer: AudioBuffer | null;
		onended: (() => void) | null;
		start: ReturnType<typeof vi.fn>;
		stop: ReturnType<typeof vi.fn>;
		connect: ReturnType<typeof vi.fn>;
		disconnect: ReturnType<typeof vi.fn>;
	}[] = [];
	const gains: { gain: { setValueAtTime: ReturnType<typeof vi.fn>; linearRampToValueAtTime: ReturnType<typeof vi.fn> } }[] = [];
	const context = {
		currentTime: 0,
		createBufferSource: () => {
			const source = { buffer: null, onended: null, start: vi.fn(), stop: vi.fn(), connect: vi.fn(), disconnect: vi.fn() };
			sources.push(source);
			return source;
		},
		createGain: () => {
			const gain = { gain: { setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn() }, connect: vi.fn(), disconnect: vi.fn() };
			gains.push(gain);
			return gain;
		}
	};
	return { context: context as unknown as TScrubContext & { currentTime: number }, sources, gains };
}

const BUFFER = { duration: 10 } as AudioBuffer;
const DESTINATION = {} as AudioNode;

describe('scrubWindow function', () => {
	it('should play a whole snippet from the position', () => {
		expect(scrubWindow(2, 10)).toEqual({ offset: 2, length: SCRUB_SNIPPET, fade: SCRUB_FADE });
	});

	it('should cut the snippet at the end of the buffer and shorten fades to fit', () => {
		const window = scrubWindow(9.99, 10);
		expect(window?.length).toBeCloseTo(0.01);
		expect(window?.fade).toBeCloseTo(0.005);
	});

	it('should clamp a position before the start and have nothing past the end', () => {
		expect(scrubWindow(-1, 10)?.offset).toBe(0);
		expect(scrubWindow(10, 10)).toBeNull();
		expect(scrubWindow(11, 10)).toBeNull();
	});
});

describe('createScrubber function', () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	function startScrubber() {
		const fake = createFakeContext();
		const scrubber = createScrubber(fake.context, DESTINATION);
		scrubber.begin();
		scrubber.setBuffer(BUFFER);
		const advance = (seconds: number): void => {
			fake.context.currentTime += seconds;
			vi.advanceTimersByTime(seconds * 1000);
		};
		return { ...fake, scrubber, advance };
	}

	it('should start a snippet with short fades at the position', () => {
		const { scrubber, sources, gains } = startScrubber();
		scrubber.move(3);
		expect(sources[0]?.buffer).toBe(BUFFER);
		expect(sources[0]?.start).toHaveBeenCalledWith(0, 3, SCRUB_SNIPPET);
		expect(gains[0]?.gain.setValueAtTime).toHaveBeenNthCalledWith(1, 0, 0);
		expect(gains[0]?.gain.linearRampToValueAtTime).toHaveBeenNthCalledWith(1, 1, SCRUB_FADE);
		expect(gains[0]?.gain.linearRampToValueAtTime).toHaveBeenNthCalledWith(2, 0, SCRUB_SNIPPET);
	});

	it('should throttle a fast drag to one voice at the latest position', () => {
		const { scrubber, sources, advance } = startScrubber();
		scrubber.move(1);
		scrubber.move(1.1);
		scrubber.move(1.2);
		expect(sources).toHaveLength(1);
		advance(SCRUB_SNIPPET);
		expect(sources).toHaveLength(2);
		expect(sources[1]?.start).toHaveBeenCalledWith(expect.closeTo(SCRUB_SNIPPET), 1.2, SCRUB_SNIPPET);
	});

	it('should repeat only when the position changes', () => {
		const { scrubber, sources, advance } = startScrubber();
		scrubber.move(1);
		advance(SCRUB_SNIPPET);
		scrubber.move(1);
		advance(SCRUB_SNIPPET);
		expect(sources).toHaveLength(1);
		scrubber.move(1.01);
		expect(sources).toHaveLength(2);
	});

	it('should wait for the buffer and start at the latest position', () => {
		const { context, sources } = createFakeContext();
		const scrubber = createScrubber(context, DESTINATION);
		scrubber.begin();
		scrubber.move(1);
		scrubber.move(2);
		expect(sources).toHaveLength(0);
		scrubber.setBuffer(BUFFER);
		expect(sources).toHaveLength(1);
		expect(sources[0]?.start).toHaveBeenCalledWith(0, 2, SCRUB_SNIPPET);
	});

	it('should fade the voice out on end and play nothing more', () => {
		const { scrubber, sources, gains, advance } = startScrubber();
		scrubber.move(1);
		scrubber.move(2);
		scrubber.end();
		expect(sources[0]?.stop).toHaveBeenCalledWith(SCRUB_FADE);
		expect(gains[1]?.gain.linearRampToValueAtTime).toHaveBeenCalledWith(0, SCRUB_FADE);
		advance(1);
		scrubber.move(3);
		expect(sources).toHaveLength(1);
	});

	it('should disconnect a voice once it has ended', () => {
		const { scrubber, sources } = startScrubber();
		scrubber.move(1);
		sources[0]?.onended?.();
		expect(sources[0]?.disconnect).toHaveBeenCalled();
	});

	it('should play nothing past the end of the buffer', () => {
		const { scrubber, sources } = startScrubber();
		scrubber.move(10);
		expect(sources).toHaveLength(0);
	});
});
