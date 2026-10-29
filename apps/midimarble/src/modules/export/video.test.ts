import { describe, expect, it } from 'vitest';
import { exportDimensions, selectExportFormat, waitForExportStep } from './video';

describe('exportDimensions function', () => {
	it.each([
		['9:16', 720, 720, 1280],
		['16:9', 720, 1280, 720],
		['1:1', 720, 720, 720],
		['9:16', 1080, 1080, 1920],
		['16:9', 1080, 1920, 1080],
		['1:1', 1080, 1080, 1080]
	] as const)(
		'should use the selected %s format and %i resolution for still frames and video',
		(aspectRatio, size, width, height) => {
			expect(exportDimensions(aspectRatio, size)).toEqual({ width, height });
		}
	);

	it('should preserve the existing default resolution', () => {
		expect(exportDimensions('9:16')).toEqual({ width: 1080, height: 1920 });
		expect(exportDimensions('16:9')).toEqual({ width: 1920, height: 1080 });
		expect(exportDimensions('1:1')).toEqual({ width: 1080, height: 1080 });
	});

	it.each(['9:16', '16:9', '1:1'] as const)(
		'should use even pixels for both sides of an odd-sized %s export',
		(aspectRatio) => {
			const { width, height } = exportDimensions(aspectRatio, 1081);
			expect(width % 2).toBe(0);
			expect(height % 2).toBe(0);
			expect(Math.min(width, height)).toBe(1082);
		}
	);
});

describe('selectExportFormat function', () => {
	it('should prefer Opus synchronization even when native MP4 encoding is available', () => {
		expect(selectExportFormat({ vp9: true, vp8: true, opus: true, avc: true, aac: true })).toEqual({
			extension: 'webm',
			videoCodec: 'vp9',
			audioCodec: 'opus'
		});
	});

	it('should retain accurate Opus audio with VP8 when VP9 is unavailable', () => {
		expect(selectExportFormat({ vp9: false, vp8: true, opus: true, avc: true, aac: true })).toEqual(
			{ extension: 'webm', videoCodec: 'vp8', audioCodec: 'opus' }
		);
	});

	it('should refuse an AAC-only fallback that could desynchronize instrument hits', () => {
		expect(() =>
			selectExportFormat({ vp9: true, vp8: true, opus: false, avc: true, aac: true })
		).toThrow('Accurate export requires WebM');
	});

	it('should reject unsupported video-with-audio combinations', () => {
		expect(() =>
			selectExportFormat({ vp9: true, vp8: false, opus: false, avc: true, aac: false })
		).toThrow('cannot encode video with sound');
	});
});

describe('waitForExportStep function', () => {
	it('should cancel an export without waiting for a still-rendering soundtrack', async () => {
		const controller = new AbortController();
		let finish: ((value: number) => void) | undefined;
		const soundtrack = new Promise<number>((resolve) => {
			finish = resolve;
		});
		const waiting = waitForExportStep(soundtrack, controller.signal);
		controller.abort();
		await expect(waiting).rejects.toMatchObject({ name: 'AbortError' });
		finish?.(42);
		await expect(soundtrack).resolves.toBe(42);
	});
	it('should report soundtrack failure and handle an already-cancelled export', async () => {
		await expect(
			waitForExportStep(Promise.reject(new Error('Bank failed')), new AbortController().signal)
		).rejects.toThrow('Bank failed');
		const controller = new AbortController();
		controller.abort();
		await expect(waitForExportStep(Promise.resolve(42), controller.signal)).rejects.toMatchObject({
			name: 'AbortError'
		});
	});
});
