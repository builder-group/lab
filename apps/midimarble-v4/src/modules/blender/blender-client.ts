import { isTauri } from '@tauri-apps/api/core';
import { Err, Ok, type TResult } from 'tuple-result';
import { specta } from '@/environment/specta';
import { SCENE_DESCRIPTION_PATH, type TSceneBuild } from './scene-builder';

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

	/** Writes the motion files and the description into the package, then applies them in Blender */
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
			{ descriptionPath: SCENE_DESCRIPTION_PATH, relink: options.relink ?? [] },
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

	inspect(packagePath: string): Promise<TResult<TInspectResult, BlenderError>> {
		return this.request<TInspectResult>(packagePath, 'inspect');
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
	/** Entities whose skins moved to the detached collection */
	removed: string[];
	keyframes: number;
	studioCreated: boolean;
	cameraFramed: boolean;
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
	/** `#rrggbb` of the ID image to the holder's entity ID; other colors are unmanaged objects or background */
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
	}[];
	detached: string[];
	studio: { name: string; role: string | null }[];
	revision: number | null;
	frameStart: number;
	frameEnd: number;
	fps: number;
}
