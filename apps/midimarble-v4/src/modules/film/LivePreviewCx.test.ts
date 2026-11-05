import { Ok } from 'tuple-result';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LivePreviewCx } from './LivePreviewCx';

const blender = vi.hoisted(() => ({
	isAvailable: vi.fn(() => true),
	startPreviewRender: vi.fn(),
	targetPreviewRender: vi.fn(),
	cancelPreviewRender: vi.fn(),
	previewFrames: vi.fn()
}));

vi.mock('@/modules/blender', () => ({ blender }));

const SCENE = { fps: 30, frameStart: 0, frameEnd: 299 };

describe('LivePreviewCx class', () => {
	let isPlaying = false;

	function open(): LivePreviewCx {
		const live = new LivePreviewCx({ getPlayhead: () => 2, isPlaying: () => isPlaying });
		live.setActive(true);
		return live;
	}

	beforeEach(() => {
		vi.useFakeTimers();
		isPlaying = false;
		for (const mock of Object.values(blender)) mock.mockClear();
		blender.startPreviewRender.mockResolvedValue(Ok({ pid: 7, fps: 30, startTime: 0, frames: 300 }));
		blender.targetPreviewRender.mockResolvedValue(Ok(undefined));
		blender.previewFrames.mockResolvedValue(Ok({ folder: '/f', frames: [], status: null }));
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it('should start from the playhead once the scene is there', async () => {
		const live = open();
		live.sceneApplied('/p', 's1', SCENE);
		await vi.advanceTimersByTimeAsync(0);
		expect(blender.startPreviewRender).toHaveBeenCalledOnce();
		expect(blender.startPreviewRender.mock.calls[0]?.[1]).toMatchObject({ signature: 's1', paused: false });
		expect(blender.startPreviewRender.mock.calls[0]?.[1].order[0]).toBe(60);
		expect(live.$isRendering.get()).toBe(true);
		live.close();
	});

	it('should not start while the person works, and start a moment after they stop', async () => {
		const live = open();
		live.pauseForWork();
		live.sceneApplied('/p', 's1', SCENE);
		await vi.advanceTimersByTimeAsync(1000);
		expect(blender.startPreviewRender).not.toHaveBeenCalled();
		live.pauseForWork();
		await vi.advanceTimersByTimeAsync(1000);
		expect(blender.startPreviewRender).not.toHaveBeenCalled();
		await vi.advanceTimersByTimeAsync(600);
		expect(blender.startPreviewRender).toHaveBeenCalledOnce();
		live.close();
	});

	it('should pause a running job, then point it at the playhead', async () => {
		const live = open();
		live.sceneApplied('/p', 's1', SCENE);
		await vi.advanceTimersByTimeAsync(0);
		live.pauseForWork();
		live.pauseForWork();
		expect(blender.targetPreviewRender).toHaveBeenCalledOnce();
		expect(blender.targetPreviewRender.mock.calls[0]?.[2]).toEqual({ order: [], paused: true });
		expect(live.$isRendering.get()).toBe(false);
		await vi.advanceTimersByTimeAsync(1600);
		expect(blender.targetPreviewRender.mock.calls[1]?.[2]).toMatchObject({ paused: false });
		expect(blender.targetPreviewRender.mock.calls[1]?.[2].order[0]).toBe(60);
		expect(live.$isRendering.get()).toBe(true);
		live.close();
	});

	it('should stay paused through playback', async () => {
		const live = open();
		live.sceneApplied('/p', 's1', SCENE);
		await vi.advanceTimersByTimeAsync(0);
		isPlaying = true;
		live.pauseForWork();
		await vi.advanceTimersByTimeAsync(5000);
		expect(blender.targetPreviewRender).toHaveBeenCalledOnce();
		isPlaying = false;
		live.pauseForWork();
		await vi.advanceTimersByTimeAsync(1600);
		expect(blender.targetPreviewRender).toHaveBeenCalledTimes(2);
		live.close();
	});

	it('should not start a job that failed again for the same scene', async () => {
		const live = open();
		live.sceneApplied('/p', 's1', SCENE);
		await vi.advanceTimersByTimeAsync(0);
		blender.previewFrames.mockResolvedValue(Ok({ folder: '/f', frames: [], status: { pid: 7, state: 'failed', updatedAt: Date.now() / 1000 } }));
		await vi.advanceTimersByTimeAsync(500);
		live.pauseForWork();
		await vi.advanceTimersByTimeAsync(5000);
		expect(blender.startPreviewRender).toHaveBeenCalledOnce();
		live.close();
	});

	it('should render nothing with Draft Preview on', async () => {
		const live = open();
		live.setEnabled(false);
		live.sceneApplied('/p', 's1', SCENE);
		await vi.advanceTimersByTimeAsync(2000);
		expect(blender.startPreviewRender).not.toHaveBeenCalled();
		live.setEnabled(true);
		await vi.advanceTimersByTimeAsync(0);
		expect(blender.startPreviewRender).toHaveBeenCalledOnce();
		live.close();
	});
});
