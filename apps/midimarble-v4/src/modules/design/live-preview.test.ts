import { describe, expect, it } from 'vitest';
import {
	framePath,
	framesAhead,
	lookupFrame,
	previewFrameOrder,
	previewTimeline,
	refineFrames,
	renderedSpans,
	sceneSignature,
	type TLivePreviewFrames
} from './live-preview';

function frames(flat: number[], fast: number[] = [], total = 100): TLivePreviewFrames {
	return { signature: 's1', folder: '/p/.cache/preview-frames/s1', fps: 30, startTime: 0, total, flat: new Set(flat), fast: new Set(fast) };
}

describe('previewFrameOrder', () => {
	it('renders the playhead and the lead ahead first, then widens outward', () => {
		expect(previewFrameOrder(5, 12, 2)).toEqual([5, 6, 7, 8, 4, 9, 3, 10, 2, 11, 1, 0]);
	});

	it('covers every frame once, from any playhead', () => {
		for (const target of [-4, 0, 37, 99, 140]) {
			const order = previewFrameOrder(target, 100);
			expect(order).toHaveLength(100);
			expect(new Set(order).size).toBe(100);
		}
		expect(previewFrameOrder(140, 100)[0]).toBe(99);
		expect(previewFrameOrder(3, 0)).toEqual([]);
	});
});

describe('refineFrames', () => {
	it('takes the frames from the playhead ahead, clipped to the song', () => {
		expect(refineFrames(8, 10, 5)).toEqual([8, 9]);
		expect(refineFrames(2, 10, 3)).toEqual([2, 3, 4]);
	});
});

describe('lookupFrame', () => {
	it('finds the frame at a time, Fast before Flat Light', () => {
		const cached = frames([10, 11, 12], [11]);
		expect(lookupFrame(cached, 10 / 30)).toEqual({ index: 10, level: 'flat' });
		expect(lookupFrame(cached, 11 / 30)).toEqual({ index: 11, level: 'fast' });
	});

	it('uses a neighbour within the tolerance, else nothing', () => {
		const cached = frames([10]);
		expect(lookupFrame(cached, 11 / 30)).toEqual({ index: 10, level: 'flat' });
		expect(lookupFrame(cached, 12 / 30)).toBeNull();
		expect(lookupFrame(cached, 12 / 30, 2)).toEqual({ index: 10, level: 'flat' });
	});

	it('honours the start time of a scene that starts later', () => {
		const cached = { ...frames([0]), startTime: 2 };
		expect(lookupFrame(cached, 2)).toEqual({ index: 0, level: 'flat' });
		expect(lookupFrame(cached, 0)).toBeNull();
	});
});

describe('framesAhead', () => {
	it('lists rendered frames one second ahead in playback order', () => {
		const cached = frames([0, 1, 2, 40, 50], [1]);
		expect(framesAhead(cached, 0, 1)).toEqual([
			{ index: 0, level: 'flat' },
			{ index: 1, level: 'fast' },
			{ index: 2, level: 'flat' }
		]);
	});
});

describe('framePath', () => {
	it('names frames by number and level', () => {
		expect(framePath('/f', 42, 'flat')).toBe('/f/00042.jpg');
		expect(framePath('/f', 42, 'fast')).toBe('/f/00042.fast.jpg');
	});
});

describe('renderedSpans', () => {
	it('merges runs of frames into time spans', () => {
		expect(renderedSpans([3, 0, 1, 2, 10, 11], 10)).toEqual([
			{ start: 0, end: 0.4 },
			{ start: 1, end: 1.2 }
		]);
		expect(renderedSpans([], 30)).toEqual([]);
		expect(renderedSpans([5], 10, 1)).toEqual([{ start: 1.5, end: 1.6 }]);
	});
});

describe('sceneSignature', () => {
	const build = { description: { version: 1, fps: 30 }, motionFiles: [{ path: '.cache/motion/a.bin', bytes: new Uint8Array([1, 2, 3]) }] };

	it('is stable for the same scene and changes with the description, motion or salt', () => {
		const signature = sceneSignature(build as never);
		expect(signature).toMatch(/^s[0-9a-f]{16}$/);
		expect(sceneSignature(build as never)).toBe(signature);
		expect(sceneSignature({ ...build, description: { version: 1, fps: 60 } } as never)).not.toBe(signature);
		expect(sceneSignature({ ...build, motionFiles: [{ path: '.cache/motion/a.bin', bytes: new Uint8Array([1, 2, 4]) }] } as never)).not.toBe(signature);
		expect(sceneSignature(build as never, '1')).not.toBe(signature);
	});
});

describe('previewTimeline', () => {
	it('counts frames like the worker, every other frame of a 60 fps scene', () => {
		expect(previewTimeline({ fps: 30, frameStart: 0, frameEnd: 1020 })).toEqual({ fps: 30, startTime: 0, total: 1021 });
		expect(previewTimeline({ fps: 60, frameStart: 0, frameEnd: 2041 })).toEqual({ fps: 30, startTime: 0, total: 1021 });
		expect(previewTimeline({ fps: 30, frameStart: 60, frameEnd: 90 }).startTime).toBe(2);
	});
});
