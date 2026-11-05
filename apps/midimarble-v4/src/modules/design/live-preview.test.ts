import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
	framePath,
	framesAhead,
	lookupFrame,
	previewFrameOrder,
	previewTimeline,
	renderedSpans,
	sceneSignature,
	type TLivePreviewFrames
} from './live-preview';

function frames(rendered: number[], total = 100): TLivePreviewFrames {
	return { signature: 's1', folder: '/p/.cache/preview-frames/s1', fps: 30, startTime: 0, total, rendered: new Set(rendered) };
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

describe('lookupFrame', () => {
	it('finds the frame at a time', () => {
		expect(lookupFrame(frames([10, 11, 12]), 11 / 30)).toBe(11);
	});

	it('uses a neighbor within the tolerance, else nothing', () => {
		const cached = frames([10]);
		expect(lookupFrame(cached, 11 / 30)).toBe(10);
		expect(lookupFrame(cached, 12 / 30)).toBeNull();
		expect(lookupFrame(cached, 12 / 30, 2)).toBe(10);
	});

	it('honors the start time of a scene that starts later', () => {
		const cached = { ...frames([0]), startTime: 2 };
		expect(lookupFrame(cached, 2)).toBe(0);
		expect(lookupFrame(cached, 0)).toBeNull();
	});
});

describe('framesAhead', () => {
	it('lists rendered frames one second ahead in playback order', () => {
		expect(framesAhead(frames([0, 1, 2, 40, 50]), 0, 1)).toEqual([0, 1, 2]);
	});
});

describe('framePath', () => {
	it('names frames by number', () => {
		expect(framePath('/f', 42)).toBe('/f/00042.jpg');
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

describe('the bundled app', () => {
	it('should ship every script the worker starts, so the background render runs outside the repository too', () => {
		const root = resolve(import.meta.dirname, '../../..');
		const config = JSON.parse(readFileSync(resolve(root, 'src-tauri/tauri.conf.json'), 'utf8')) as { bundle: { resources: Record<string, string> } };
		const scripts = readdirSync(resolve(root, 'blender')).filter((name) => name.endsWith('.py'));
		expect(scripts).toContain('preview_job.py');
		for (const script of scripts) expect(config.bundle.resources[`../blender/${script}`]).toBe(`blender/${script}`);
	});
});
