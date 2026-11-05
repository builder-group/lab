import { describe, expect, it } from 'vitest';
import { estimateExport, filmFileName, filmFrameCount, filmSize, formatClock, formatEstimate, getRenderPreset, remainingExportSeconds, renderPresetOption } from './export-estimate';
import { resolveFilmOutput } from './FilmExportCx';

const portrait = { width: 9, height: 16 };

describe('filmSize function', () => {
	it('should keep the preset short side and an even long side', () => {
		expect(filmSize(portrait, 'final')).toEqual({ width: 1080, height: 1920 });
		expect(filmSize(portrait, 'draft')).toEqual({ width: 720, height: 1280 });
		expect(filmSize({ width: 16, height: 9 }, 'final')).toEqual({ width: 1920, height: 1080 });
	});
});

describe('estimateExport function', () => {
	it('should count frames from frame 0 through the end', () => {
		expect(filmFrameCount(10, 30)).toBe(301);
		expect(estimateExport({ duration: 10, frame: portrait, preset: 'final' }).frames).toBe(301);
	});

	it('should scale the preview time by pixels to the film size', () => {
		const estimate = estimateExport({
			duration: 10,
			frame: portrait,
			preset: 'final',
			preview: { renderMs: 450, width: 540, height: 960 }
		});
		expect(estimate.basis).toBe('preview');
		expect(estimate.msPerFrame).toBeCloseTo(1800);
		expect(estimate.seconds).toBeCloseTo(301 * 1.8 * 1.05);
	});

	it('should prefer a measured render with the same engine over the preview', () => {
		const estimate = estimateExport({
			duration: 2,
			frame: portrait,
			preset: 'final',
			measured: { preset: 'final', engine: 'eevee', msPerFrame: 900, pixels: 1080 * 1920 },
			preview: { renderMs: 450, width: 540, height: 960 }
		});
		expect(estimate.basis).toBe('measured');
		expect(estimate.msPerFrame).toBeCloseTo(900);
	});

	it('should report no estimate without a measurement or a preview', () => {
		const estimate = estimateExport({ duration: 2, frame: portrait, preset: 'final', measured: { preset: 'final', engine: 'workbench', msPerFrame: 100, pixels: 1 } });
		expect(estimate).toMatchObject({ basis: 'none', seconds: null });
	});

	it('should estimate the draft preset from Workbench times, not the Eevee preview', () => {
		const preview = { renderMs: 450, width: 540, height: 960 };
		const typical = estimateExport({ duration: 10, frame: portrait, preset: 'draft', preview });
		expect(typical.basis).toBe('typical');
		expect(typical.frames).toBe(301);
		expect(typical.msPerFrame).toBeLessThan(200);
		const measured = estimateExport({
			duration: 10,
			frame: portrait,
			preset: 'draft',
			measured: { preset: 'draft', engine: 'workbench', msPerFrame: 40, pixels: 720 * 1280 },
			preview
		});
		expect(measured).toMatchObject({ basis: 'measured', msPerFrame: 40 });
	});
});

describe('draft preset', () => {
	it('should always render with Workbench and set Draft apart from Final in the picker', () => {
		expect(getRenderPreset('draft').engine).toBe('workbench');
		expect(renderPresetOption(getRenderPreset('draft'))).toBe('Draft · 720p · Flat Light');
		expect(renderPresetOption(getRenderPreset('final'))).toBe('Final · 1080p');
	});
});

describe('export progress formatting', () => {
	it('should estimate the remaining time from the frames left', () => {
		expect(remainingExportSeconds({ frame: 100, frames: 300, msPerFrame: 500 })).toBeCloseTo(105);
		expect(remainingExportSeconds({ frame: null, frames: 300, msPerFrame: null })).toBeNull();
	});

	it('should format rough estimates and clock durations', () => {
		expect(formatEstimate(20)).toBe('Less than a minute');
		expect(formatEstimate(250)).toBe('About 4 minutes');
		expect(formatEstimate(4800)).toBe('About 1 h 20 min');
		expect(formatClock(42)).toBe('0:42');
		expect(formatClock(3729)).toBe('1:02:09');
	});
});

describe('film output', () => {
	it('should make a safe mp4 file name', () => {
		expect(filmFileName('/Users/me/Movies/Jingle: Bells.mp4')).toBe('Jingle Bells.mp4');
		expect(filmFileName('')).toBe('Film.mp4');
	});

	it('should keep a path inside the package and fall back to Renders outside it', () => {
		expect(resolveFilmOutput('/p/Song.marble', { fileName: 'A.mp4', chosenPath: '/p/Song.marble/renders/A.mp4' })).toEqual({ relativePath: 'renders/A.mp4', outsidePackage: false });
		expect(resolveFilmOutput('/p/Song.marble', { fileName: 'B.mp4', chosenPath: '/Users/me/Movies/B.mp4' })).toEqual({ relativePath: 'renders/B.mp4', outsidePackage: true });
		expect(resolveFilmOutput('/p/Song.marble', { fileName: 'C', chosenPath: null })).toEqual({ relativePath: 'renders/C.mp4', outsidePackage: false });
	});
});
