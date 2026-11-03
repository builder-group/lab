import { Err, Ok } from 'tuple-result';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createProject } from '@/modules/project';
import { blender, BlenderError, type TJobPoll, type TRenderFilmResult } from './blender-client';
import { renderFilm, SOUNDTRACK_PATH } from './render-film';

vi.mock('@/modules/music', () => ({
	renderProjectAudio: vi.fn(async () => ({
		left: new Float32Array(4),
		right: new Float32Array(4),
		sampleRate: 48000
	})),
	encodeWav: vi.fn(() => new Uint8Array([1, 2, 3]))
}));

const result: TRenderFilmResult = {
	path: '/tmp/Song.marble/renders/film-fast.mp4',
	frames: 30,
	fps: 30,
	width: 720,
	height: 1280,
	duration: 1,
	engine: 'eevee',
	samples: 16,
	encoder: 'ffmpeg',
	renderSeconds: 3,
	msPerFrame: 100,
	hasAudio: true
};

const started = {
	jobId: 'film-1',
	pid: 1,
	frames: 30,
	fps: 30,
	width: 720,
	height: 1280,
	engine: 'eevee' as const,
	jobDir: '/tmp/job'
};

const progress = {
	id: 'film-1',
	progress: 0.5,
	phase: 'Rendering frame 15 of 30',
	frame: 15,
	frames: 30,
	msPerFrame: 100,
	updatedAt: 0
};

afterEach(() => {
	vi.restoreAllMocks();
});

describe('renderFilm function', () => {
	it('should write the soundtrack, start the job and resolve with its result', async () => {
		const write = vi.spyOn(blender, 'writePackageFile').mockResolvedValue(Ok('/tmp/x'));
		const start = vi.spyOn(blender, 'startRenderFilm').mockResolvedValue(Ok(started));
		const polls: TJobPoll<TRenderFilmResult>[] = [
			{ progress, done: false },
			{ progress: { ...progress, progress: 1 }, done: true, result }
		];
		vi.spyOn(blender, 'pollJob').mockImplementation(async () => Ok(polls.shift() as TJobPoll<never>));
		const seen: number[] = [];
		const project = createProject({ title: 'Song', id: 'project-1' });

		const [isOk, , film] = await renderFilm('/tmp/Song.marble', project, {
			resolveSourceUrl: () => null,
			preset: 'fast',
			pollIntervalMs: 0,
			onProgress: (value) => seen.push(value.progress)
		});

		expect(isOk).toBe(true);
		expect(film).toEqual(result);
		expect(write).toHaveBeenCalledWith('/tmp/Song.marble', SOUNDTRACK_PATH, new Uint8Array([1, 2, 3]));
		expect(start).toHaveBeenCalledWith('/tmp/Song.marble', {
			preset: 'fast',
			engine: undefined,
			outputPath: 'renders/film-fast.mp4',
			audioPath: SOUNDTRACK_PATH,
			samples: undefined
		});
		expect(seen).toEqual([0.5, 1]);
	});

	it('should copy the finished film to the destination path', async () => {
		vi.spyOn(blender, 'writePackageFile').mockResolvedValue(Ok('/tmp/x'));
		vi.spyOn(blender, 'startRenderFilm').mockResolvedValue(Ok(started));
		vi.spyOn(blender, 'pollJob').mockResolvedValue(Ok({ progress: null, done: true, result }));
		const copy = vi.spyOn(blender, 'copyFileOut').mockResolvedValue(Ok('/Users/me/Movies/Song.mp4'));
		const project = createProject({ title: 'Song', id: 'project-1' });

		const [isOk, , film] = await renderFilm('/tmp/Song.marble', project, {
			resolveSourceUrl: () => null,
			preset: 'fast',
			outputPath: 'renders/Song.mp4',
			destinationPath: '/Users/me/Movies/Song.mp4',
			pollIntervalMs: 0
		});

		expect(isOk).toBe(true);
		expect(copy).toHaveBeenCalledWith('/tmp/Song.marble', 'renders/Song.mp4', '/Users/me/Movies/Song.mp4');
		expect(film).toEqual({ ...result, path: '/Users/me/Movies/Song.mp4' });
	});

	it('should report a failed copy with the rendered path', async () => {
		vi.spyOn(blender, 'writePackageFile').mockResolvedValue(Ok('/tmp/x'));
		vi.spyOn(blender, 'startRenderFilm').mockResolvedValue(Ok(started));
		vi.spyOn(blender, 'pollJob').mockResolvedValue(Ok({ progress: null, done: true, result }));
		vi.spyOn(blender, 'copyFileOut').mockResolvedValue(Err(new BlenderError('HOST', 'Permission denied')));
		const project = createProject({ title: 'Song', id: 'project-1' });

		const [isOk, error] = await renderFilm('/tmp/Song.marble', project, {
			resolveSourceUrl: () => null,
			destinationPath: '/Volumes/Locked/Song.mp4',
			pollIntervalMs: 0
		});

		expect(isOk).toBe(false);
		expect(error?.message).toContain(result.path);
		expect(error?.message).toContain('Permission denied');
	});

	it('should cancel the job when the signal aborts', async () => {
		vi.spyOn(blender, 'writePackageFile').mockResolvedValue(Ok('/tmp/x'));
		vi.spyOn(blender, 'startRenderFilm').mockResolvedValue(Ok(started));
		const cancel = vi.spyOn(blender, 'cancelJob').mockResolvedValue(Ok({ jobId: 'film-1', cancelled: true }));
		const controller = new AbortController();
		let calls = 0;
		vi.spyOn(blender, 'pollJob').mockImplementation(async () => {
			calls += 1;
			if (calls === 1) {
				controller.abort();
				return Ok({ progress, done: false });
			}
			return Ok({ progress: null, done: true, error: new BlenderError('CANCELLED', 'The render was cancelled') });
		});
		const project = createProject({ title: 'Song', id: 'project-1' });

		const [isOk, error] = await renderFilm('/tmp/Song.marble', project, {
			resolveSourceUrl: () => null,
			pollIntervalMs: 0,
			signal: controller.signal
		});

		expect(isOk).toBe(false);
		expect(error?.code).toBe('CANCELLED');
		expect(cancel).toHaveBeenCalledTimes(1);
	});
});
