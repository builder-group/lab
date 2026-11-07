import { isTauri } from '@tauri-apps/api/core';
import { Err, Ok, type TResult } from 'tuple-result';
import { specta } from '@/environment/specta';
import { SCENE_DESCRIPTION_PATH, type TSceneBuild } from '@/modules/scene';
import type { TFilmEngine, TRenderPreset } from '@/modules/scene';

/**
 * Host wrapper around the Blender worker of an open package. In the browser UI development surface every
 * call reports Blender as unavailable.
 */
export const blender = {
	isAvailable(): boolean {
		return isTauri();
	},

	async detect(): Promise<TBlenderInstall> {
		if (!isTauri()) return { available: false, path: null, version: null };
		const result = await specta.commands.blenderDetect();
		if (result.status === 'error') return { available: false, path: null, version: null };
		return { available: result.data.path != null, path: result.data.path, version: result.data.version };
	},

	async start(packagePath: string, options: { visible?: boolean } = {}): Promise<TResult<TBlenderSession, BlenderError>> {
		if (!isTauri()) return Err(unavailable());
		const result = await specta.commands.blenderStart(packagePath, options.visible ?? false);
		if (result.status === 'error') return Err(new BlenderError('HOST', result.error));
		return Ok(result.data);
	},

	async stop(packagePath: string): Promise<TResult<void, BlenderError>> {
		if (!isTauri()) return Ok(undefined);
		const result = await specta.commands.blenderStop(packagePath);
		if (result.status === 'error') return Err(new BlenderError('HOST', result.error));
		return Ok(undefined);
	},

	/** Opens the package scene in a Blender window, restarting a background worker with a window */
	async show(packagePath: string): Promise<TResult<TBlenderSession, BlenderError>> {
		if (!isTauri()) return Err(unavailable());
		const result = await specta.commands.blenderShow(packagePath);
		if (result.status === 'error') return Err(new BlenderError('HOST', result.error));
		return Ok(result.data);
	},

	async status(packagePath: string): Promise<TBlenderStatus> {
		if (!isTauri()) return { running: false, pid: null, visible: false, worker: null };
		const result = await specta.commands.blenderStatus(packagePath);
		if (result.status === 'error') return { running: false, pid: null, visible: false, worker: null };
		return {
			running: result.data.running,
			pid: result.data.pid,
			visible: result.data.visible,
			worker: result.data.statusJson != null ? (JSON.parse(result.data.statusJson) as TBlenderWorkerStatus) : null
		};
	},

	/** Sends one operation and resolves with its result, or the worker's `{code, message}` error */
	async request<GResult>(
		packagePath: string,
		op: string,
		args: Record<string, unknown> = {},
		options: { timeoutMs?: number } = {}
	): Promise<TResult<GResult, BlenderError>> {
		if (!isTauri()) return Err(unavailable());
		const result = await specta.commands.blenderRequest(
			packagePath,
			op,
			JSON.stringify(args),
			options.timeoutMs ?? 30_000
		);
		if (result.status === 'error') return Err(new BlenderError('HOST', result.error));
		const response = JSON.parse(result.data) as TBlenderResponse<GResult>;
		if (!response.ok) return Err(new BlenderError(response.error.code, response.error.message));
		return Ok(response.result);
	},

	async writePackageFile(packagePath: string, relativePath: string, bytes: Uint8Array): Promise<TResult<string, BlenderError>> {
		if (!isTauri()) return Err(unavailable());
		const result = await specta.commands.writePackageFile(packagePath, relativePath, Array.from(bytes));
		if (result.status === 'error') return Err(new BlenderError('HOST', result.error));
		return Ok(result.data);
	},

	/** Copies a package file to an absolute path, such as a film from `renders/` to the path chosen in the save panel */
	async copyFileOut(packagePath: string, relativePath: string, destinationPath: string): Promise<TResult<string, BlenderError>> {
		if (!isTauri()) return Err(unavailable());
		const result = await specta.commands.copyFileOut(packagePath, relativePath, destinationPath);
		if (result.status === 'error') return Err(new BlenderError('HOST', result.error));
		return Ok(result.data);
	},

	/**
	 * Writes the motion files and the description into the package, then applies them in Blender.
	 */
	async applyScene(
		packagePath: string,
		build: TSceneBuild,
		options: { relink?: string[] } = {}
	): Promise<TResult<TApplySceneResult, BlenderError>> {
		for (const file of build.motionFiles) {
			const [isWrittenOk, writtenErr] = await this.writePackageFile(packagePath, file.path, file.bytes);
			if (!isWrittenOk) return Err(writtenErr);
		}
		const descriptionBytes = new TextEncoder().encode(JSON.stringify(build.description));
		const [isDescriptionOk, descriptionErr] = await this.writePackageFile(packagePath, SCENE_DESCRIPTION_PATH, descriptionBytes);
		if (!isDescriptionOk) return Err(descriptionErr);
		return this.request<TApplySceneResult>(
			packagePath,
			'apply_scene',
			{
				descriptionPath: SCENE_DESCRIPTION_PATH,
				relink: options.relink ?? []
			},
			{ timeoutMs: 120_000 }
		);
	},

	previewFrame(
		packagePath: string,
		options: { time: number; width?: number }
	): Promise<TResult<TPreviewFrameResult, BlenderError>> {
		return this.request<TPreviewFrameResult>(
			packagePath,
			'preview_frame',
			{ time: options.time, width: options.width ?? 540, engine: 'eevee' },
			{ timeoutMs: 120_000 }
		);
	},

	/**
	 * Starts a film render in a separate Blender process and answers right away with the job. Follow it with
	 * `pollJob` and stop it with `cancelJob`.
	 */
	startRenderFilm(
		packagePath: string,
		options: TRenderFilmOptions
	): Promise<TResult<TRenderFilmStarted, BlenderError>> {
		return this.request<TRenderFilmStarted>(
			packagePath,
			'render_film',
			{
				preset: options.preset,
				engine: 'eevee',
				outputPath: options.outputPath,
				audioPath: options.audioPath ?? null,
				...(options.jobId != null ? { jobId: options.jobId } : {}),
				...(options.samples != null ? { samples: options.samples } : {})
			},
			{ timeoutMs: 120_000 }
		);
	},

	/** Reads a job's progress and, once it finished, its result or error. A finished job is reported once. */
	async pollJob<GResult>(packagePath: string, jobId: string): Promise<TResult<TJobPoll<GResult>, BlenderError>> {
		if (!isTauri()) return Err(unavailable());
		const result = await specta.commands.blenderJobPoll(packagePath, jobId);
		if (result.status === 'error') return Err(new BlenderError('HOST', result.error));
		const progress = result.data.progressJson != null ? (JSON.parse(result.data.progressJson) as TJobProgress) : null;
		if (result.data.responseJson == null) return Ok({ progress, done: false });
		const response = JSON.parse(result.data.responseJson) as TBlenderResponse<GResult>;
		if (!response.ok) return Ok({ progress, done: true, error: new BlenderError(response.error.code, response.error.message) });
		return Ok({ progress, done: true, result: response.result });
	},

	cancelJob(packagePath: string, jobId: string): Promise<TResult<{ jobId: string; canceled: boolean }, BlenderError>> {
		return this.request(packagePath, 'cancel', { jobId }, { timeoutMs: 30_000 });
	},

	/**
	 * Starts the background preview frames job for the applied scene, or retargets it when it already runs for
	 * this signature. Frames land in `.cache/preview-frames/<signature>/`.
	 */
	startPreviewRender(
		packagePath: string,
		options: { signature: string; fps: number; width: number; order: number[]; paused: boolean }
	): Promise<TResult<TPreviewRenderStarted, BlenderError>> {
		return this.request<TPreviewRenderStarted>(packagePath, 'preview_render', options, { timeoutMs: 60_000 });
	},

	/** Points the running preview job at the playhead or pauses it, without the worker's queue */
	async targetPreviewRender(packagePath: string, signature: string, target: { order: number[]; paused: boolean }): Promise<TResult<void, BlenderError>> {
		if (!isTauri()) return Err(unavailable());
		const result = await specta.commands.blenderPreviewTarget(packagePath, signature, JSON.stringify(target));
		if (result.status === 'error') return Err(new BlenderError('HOST', result.error));
		return Ok(undefined);
	},

	/** Stops the preview job after its current chunk; rendered frames stay */
	async cancelPreviewRender(packagePath: string, signature: string): Promise<TResult<void, BlenderError>> {
		if (!isTauri()) return Ok(undefined);
		const result = await specta.commands.blenderPreviewCancel(packagePath, signature);
		if (result.status === 'error') return Err(new BlenderError('HOST', result.error));
		return Ok(undefined);
	},

	/** Frames of a signature on disk and the job's status */
	async previewFrames(packagePath: string, signature: string): Promise<TResult<TPreviewFramesListing, BlenderError>> {
		if (!isTauri()) return Err(unavailable());
		const result = await specta.commands.blenderPreviewFrames(packagePath, signature);
		if (result.status === 'error') return Err(new BlenderError('HOST', result.error));
		return Ok({
			folder: result.data.folder,
			frames: result.data.frames,
			status: result.data.statusJson != null ? (JSON.parse(result.data.statusJson) as TPreviewRenderStatus) : null
		});
	},

	inspect(packagePath: string): Promise<TResult<TInspectResult, BlenderError>> {
		return this.request<TInspectResult>(packagePath, 'inspect');
	},

	/** Selects objects by name in the open Blender window and frames nothing else; never changes the scene */
	selectObjects(packagePath: string, names: string[]): Promise<TResult<{ selected: string[] }, BlenderError>> {
		return this.request(packagePath, 'select_objects', { names });
	},

	save(packagePath: string): Promise<TResult<{ path: string; saved: boolean }, BlenderError>> {
		return this.request(packagePath, 'save', {}, { timeoutMs: 60_000 });
	}
};

export class BlenderError extends Error {
	/** Worker error code such as `INVALID_ARGS`, or `HOST` and `UNAVAILABLE` for failures outside the worker */
	readonly code: string;

	constructor(code: string, message: string) {
		super(message);
		this.name = 'BlenderError';
		this.code = code;
	}
}

function unavailable(): BlenderError {
	return new BlenderError('UNAVAILABLE', 'Blender is available in the desktop app only');
}

type TBlenderResponse<GResult> =
	| { id: string; ok: true; result: GResult }
	| { id: string; ok: false; error: { code: string; message: string } };

export interface TBlenderInstall {
	available: boolean;
	path: string | null;
	version: string | null;
}

export interface TBlenderSession {
	packagePath: string;
	pid: number;
	visible: boolean;
}

export interface TBlenderStatus {
	running: boolean;
	pid: number | null;
	visible: boolean;
	worker: TBlenderWorkerStatus | null;
}

/** `.bridge/status.json` */
export interface TBlenderWorkerStatus {
	pid: number;
	ready: boolean;
	projectDir: string;
	background: boolean;
	/** Operation in progress */
	busy: string | null;
	updatedAt: number;
}

export interface TApplySceneResult {
	created: string[];
	updated: string[];
	/** Unlinked holders the worker left alone */
	skipped: string[];
	/** Pieces whose skins moved to the detached collection */
	removed: string[];
	keyframes: number;
	studioCreated: boolean;
	/** The studio and render look were (re)themed because the theme changed */
	themed: boolean;
	theme: string;
	/**
	 * `baked` follow rig, `framed` static front camera, `takenOver` when the user edited the baked camera in Blender,
	 * which turns Follow Marbles off, `manual` while it is off, `missing` without a camera
	 */
	camera: 'baked' | 'framed' | 'takenOver' | 'manual' | 'missing';
	cameraFramed: boolean;
	/**
	 * Skin notes per holder: `edited` app skins and `custom` skins belong to the user and were left alone;
	 * `missingAsset` and `invalidAsset` name a library skin whose `asset.blend` is missing or has no `MM_ASSET`
	 * collection (the holder keeps its current skin, or gets the theme default)
	 */
	skins: Record<string, 'edited' | 'custom' | 'missingAsset' | 'invalidAsset'>;
	/** Wall texts by piece ID; `skipped` texts were edited in Blender and left alone */
	texts: { created: string[]; updated: string[]; skipped: string[]; removed: string[] };
	fps: number;
	frameStart: number;
	frameEnd: number;
	revision: number;
	ms: number;
}

export interface TPreviewFrameResult {
	/** Absolute path of the Eevee render */
	path: string;
	/** Absolute path of the flat object ID image */
	idPath: string;
	/** `#rrggbb` of the ID image to the holder's piece ID; other colors are unmanaged objects or background */
	ids: Record<string, string>;
	width: number;
	height: number;
	time: number;
	frame: number;
	renderMs: number;
	idMs: number;
}

export interface TInspectResult {
	holders: {
		mmId: string;
		role: 'marble' | 'piece';
		name: string;
		link: 'linked' | 'unlinked';
		/** Why a holder is unlinked: `marked`, `transform` or `keyframes` */
		reason: string | null;
		skins: string[];
		/** `default`, `asset` or a user value of the skin root's `mm_skin` */
		skinKind: string | null;
	}[];
	detached: string[];
	texts: { mmId: string; name: string; text: string; link: 'linked' | 'unlinked' }[];
	/** Objects the user added in Blender, listed in the Decor group; lights and cameras stay out */
	madeInBlender?: { name: string; bounds: { minX: number; minY: number; maxX: number; maxY: number } }[];
	studio: { name: string; role: string | null }[];
	revision: number | null;
	frameStart: number;
	frameEnd: number;
	fps: number;
}

export interface TRenderFilmOptions {
	/** Draft 720p 30 fps in Workbench, Final 1080p 30 fps in Eevee; short side for portrait frames */
	preset: TRenderPreset;
	/** Package-relative `.mp4` path */
	outputPath: string;
	/** Package-relative WAV muxed as AAC */
	audioPath?: string | null;
	jobId?: string;
	/** Overrides the preset's samples per frame */
	samples?: number;
}

export interface TRenderFilmStarted {
	jobId: string;
	pid: number;
	frames: number;
	fps: number;
	width: number;
	height: number;
	engine: TFilmEngine;
	jobDir: string;
}

/** `.bridge/outbox/<jobId>.progress.json` of a film job */
export interface TJobProgress {
	id: string;
	/** 0 to 1; rendering covers 0 to 0.95, encoding the rest */
	progress: number;
	phase: string;
	frame: number | null;
	frames: number;
	msPerFrame: number | null;
	updatedAt: number;
}

export type TJobPoll<GResult> =
	| { progress: TJobProgress | null; done: false }
	| { progress: TJobProgress | null; done: true; result: GResult }
	| { progress: TJobProgress | null; done: true; error: BlenderError };

export interface TRenderFilmResult {
	/** Absolute path of the MP4 */
	path: string;
	frames: number;
	fps: number;
	width: number;
	height: number;
	duration: number;
	engine: TFilmEngine;
	samples: number;
	/** `ffmpeg`, or `blender` when no FFmpeg binary was found */
	encoder: 'ffmpeg' | 'blender';
	renderSeconds: number;
	msPerFrame: number;
	hasAudio: boolean;
}

export interface TPreviewRenderStarted {
	signature: string;
	pid: number;
	frames: number;
	/** Preview frames per second: the scene's rate divided by a whole step */
	fps: number;
	width: number;
	height: number;
	/** Scene time of frame 0 in seconds */
	startTime: number;
	folder: string;
	/** The job already ran for this signature and only took the new target */
	retargeted: boolean;
}

/** `.cache/preview-frames/<signature>/status.json` */
export interface TPreviewRenderStatus {
	signature: string;
	state: 'rendering' | 'done' | 'canceled' | 'failed';
	frames: number;
	fps: number;
	startTime: number;
	width: number;
	height: number;
	pid: number;
	/** Frames on disk */
	rendered: number;
	/** Recent milliseconds per frame */
	frameMs: number | null;
	error?: string;
	startedAt: number;
	updatedAt: number;
}

export interface TPreviewFramesListing {
	folder: string;
	frames: number[];
	status: TPreviewRenderStatus | null;
}
