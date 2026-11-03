import { Err, Ok, type TResult } from 'tuple-result';
import { encodeWav, renderProjectAudio, type TResolveSourceUrl } from '@/modules/music';
import type { TProject } from '@/modules/project';
import {
	blender,
	BlenderError,
	type TJobProgress,
	type TRenderFilmOptions,
	type TRenderFilmResult,
	type TRenderFilmStarted
} from './blender-client';

export const SOUNDTRACK_PATH = 'renders/soundtrack.wav';
const SOUNDTRACK_SAMPLE_RATE = 48000;
const POLL_INTERVAL_MS = 250;

/**
 * Renders the film of the scene as it is in Blender: writes the project's soundtrack into the package, starts
 * `render_film` in a separate Blender process and follows its progress until the MP4 is written. Aborting the
 * signal cancels the render. Apply the scene before calling this.
 */
export async function renderFilm(
	packagePath: string,
	project: TProject,
	options: TRenderFilmHelperOptions
): Promise<TResult<TRenderFilmResult, BlenderError>> {
	const audio = await renderProjectAudio(project, options.resolveSourceUrl, { sampleRate: SOUNDTRACK_SAMPLE_RATE });
	const wav = encodeWav(audio.left, audio.right, audio.sampleRate);
	const [isWrittenOk, writtenErr] = await blender.writePackageFile(packagePath, SOUNDTRACK_PATH, wav);
	if (!isWrittenOk) return Err(writtenErr);

	const preset = options.preset ?? project.design.renderPreset;
	const [isStartedOk, startedErr, started] = await blender.startRenderFilm(packagePath, {
		preset,
		engine: options.engine,
		outputPath: options.outputPath ?? `renders/film-${preset}.mp4`,
		audioPath: SOUNDTRACK_PATH,
		samples: options.samples
	});
	if (!isStartedOk) return Err(startedErr);
	options.onStarted?.(started);
	return followJob(packagePath, started.jobId, options);
}

async function followJob(
	packagePath: string,
	jobId: string,
	options: Pick<TRenderFilmHelperOptions, 'onProgress' | 'signal' | 'pollIntervalMs'>
): Promise<TResult<TRenderFilmResult, BlenderError>> {
	let isCancelRequested = false;
	for (;;) {
		if (options.signal?.aborted === true && !isCancelRequested) {
			isCancelRequested = true;
			const [isCancelOk, cancelErr] = await blender.cancelJob(packagePath, jobId);
			if (!isCancelOk) return Err(cancelErr);
		}
		const [isPollOk, pollErr, poll] = await blender.pollJob<TRenderFilmResult>(packagePath, jobId);
		if (!isPollOk) return Err(pollErr);
		if (poll.progress != null) options.onProgress?.(poll.progress);
		if (poll.done) return 'error' in poll ? Err(poll.error) : Ok(poll.result);
		await new Promise((resolve) => setTimeout(resolve, options.pollIntervalMs ?? POLL_INTERVAL_MS));
	}
}

export interface TRenderFilmHelperOptions extends Partial<Pick<TRenderFilmOptions, 'preset' | 'engine' | 'samples'>> {
	resolveSourceUrl: TResolveSourceUrl;
	/** Package-relative `.mp4` path; defaults to `renders/film-<preset>.mp4` */
	outputPath?: string;
	onStarted?: (started: TRenderFilmStarted) => void;
	onProgress?: (progress: TJobProgress) => void;
	/** Aborting cancels the render job */
	signal?: AbortSignal;
	pollIntervalMs?: number;
}
