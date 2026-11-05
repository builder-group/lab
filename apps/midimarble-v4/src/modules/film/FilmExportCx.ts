import { createState } from 'feature-state';
import { host } from '@/environment';
import { blender, renderFilm, type TRenderFilmResult } from '@/modules/blender';
import type { TFilmEngine, TRenderPreset } from '@/modules/scene';
import { soundtrackProject, type TResolveSourceUrl, type TMix } from '@/modules/music';
import type { TProject } from '@/modules/project';
import type { FilmCx } from './FilmCx';
import { filmFileName, type TMeasuredRender } from '@/modules/scene';

const MEASURED_KEY = 'midimarble-v4:measured-render';
const RENDERS_FOLDER = 'renders';

/**
 * Film export: the settings of the export sheet and the render job it starts. The job keeps running when the
 * sheet closes; the toolbar activity view shows its progress like Xcode.
 */
export class FilmExportCx {
	readonly $isSheetOpen = createState(false);
	readonly $settings = createState<TExportSettings>({ preset: 'final', fileName: 'Film.mp4', chosenPath: null });
	readonly $job = createState<TExportJob>(IDLE_JOB);
	/** Per-frame times of earlier film renders by engine, for the estimate */
	readonly $measured = createState<Partial<Record<TFilmEngine, TMeasuredRender>>>(readMeasured());

	private abort: AbortController | null = null;

	constructor(private readonly source: TFilmExportSource) {}

	get isAvailable(): boolean {
		return blender.isAvailable();
	}

	get isRunning(): boolean {
		const phase = this.$job.get().phase;
		return phase === 'preparing' || phase === 'rendering' || phase === 'encoding';
	}

	openSheet(): void {
		const project = this.source.getProject();
		if (project == null) return;
		if (!this.isRunning && this.$job.get().phase !== 'done') {
			this.$settings.set((settings) => ({
				...settings,
				preset: project.film.quality,
				fileName: settings.chosenPath == null ? filmFileName(project.title) : settings.fileName
			}));
		}
		this.$isSheetOpen.set(true);
	}

	closeSheet(): void {
		this.$isSheetOpen.set(false);
		// A finished or failed job is dismissed with the sheet; a running one continues in the toolbar
		if (!this.isRunning) this.$job.set(IDLE_JOB);
	}

	updateSettings(patch: Partial<TExportSettings>): void {
		this.$settings.set((settings) => ({ ...settings, ...patch }));
	}

	/** Save panel for the film; the package's Renders folder is the default location */
	async chooseLocation(): Promise<void> {
		const packagePath = this.source.getPackagePath();
		if (packagePath == null) return;
		const path = await host.chooseFilmPath(`${packagePath}/${RENDERS_FOLDER}/${this.$settings.get().fileName}`);
		if (path == null) return;
		this.updateSettings({ fileName: filmFileName(path), chosenPath: path });
	}

	async start(): Promise<void> {
		const project = this.source.getProject();
		const packagePath = this.source.getPackagePath();
		if (project == null || packagePath == null || this.isRunning) return;
		const settings = this.$settings.get();
		const output = resolveFilmOutput(packagePath, settings);
		const abort = new AbortController();
		this.abort = abort;
		const startedAt = Date.now();
		this.$job.set({ ...IDLE_JOB, phase: 'preparing', step: 'Preparing the film…', startedAt, outsidePackage: output.outsidePackage });

		if (!(await this.source.film.prepareRender())) {
			this.fail(this.source.film.$error.get() ?? "Blender couldn't prepare the film. Export again; if it fails twice, quit and reopen MidiMarble.");
			return;
		}
		if (abort.signal.aborted) {
			this.$job.set({ ...this.$job.get(), phase: 'canceled' });
			return;
		}
		this.$job.set({ ...this.$job.get(), step: 'Adding the song…' });
		const [isRenderedOk, renderedErr, result] = await renderFilm(packagePath, project, {
			resolveSourceUrl: this.source.resolveSourceUrl,
			soundtrack: soundtrackProject(project, this.source.getMix()),
			preset: settings.preset,
			outputPath: output.relativePath,
			// The worker writes inside the package; a location outside it receives a copy when the film is done
			destinationPath: output.outsidePackage ? (settings.chosenPath ?? undefined) : undefined,
			signal: abort.signal,
			onStarted: (started) => {
				if (import.meta.env.DEV) console.debug('[export] started', started);
				this.$job.set({ ...this.$job.get(), phase: 'rendering', step: null, frames: started.frames, frame: 0 });
			},
			onProgress: (progress) => {
				this.$job.set({
					...this.$job.get(),
					phase: progress.progress >= 0.95 || progress.phase === 'encoding' ? 'encoding' : 'rendering',
					frame: progress.frame,
					frames: progress.frames,
					msPerFrame: progress.msPerFrame,
					progress: progress.progress
				});
			}
		});
		this.abort = null;
		if (!isRenderedOk) {
			if (abort.signal.aborted) this.$job.set({ ...this.$job.get(), phase: 'canceled' });
			else this.fail(renderedErr.message);
			return;
		}
		if (import.meta.env.DEV) console.debug('[export] done', result);
		this.remember(settings.preset, result);
		this.$job.set({ ...this.$job.get(), phase: 'done', progress: 1, result, finishedAt: Date.now() });
	}

	cancel(): void {
		this.abort?.abort();
		if (this.$job.get().phase === 'preparing') this.$job.set({ ...this.$job.get(), phase: 'canceled' });
	}

	private fail(message: string): void {
		this.abort = null;
		this.$job.set({ ...this.$job.get(), phase: 'failed', error: message });
	}

	private remember(preset: TRenderPreset, result: TRenderFilmResult): void {
		if (!(result.msPerFrame > 0)) return;
		const measured = { ...this.$measured.get(), [result.engine]: { preset, engine: result.engine, msPerFrame: result.msPerFrame, pixels: result.width * result.height } };
		this.$measured.set(measured);
		try {
			localStorage.setItem(MEASURED_KEY, JSON.stringify(measured));
		} catch {
			// Storage can be unavailable; the next estimate then comes from the preview
		}
	}
}

export interface TFilmExportSource {
	getProject: () => TProject | null;
	getMix: () => TMix;
	getPackagePath: () => string | null;
	resolveSourceUrl: TResolveSourceUrl;
	film: FilmCx;
}

export interface TExportSettings {
	preset: TRenderPreset;
	/** File name of the film, ending in `.mp4` */
	fileName: string;
	/** Absolute path from the save panel, if one was chosen */
	chosenPath: string | null;
}

export interface TExportJob {
	phase: 'idle' | 'preparing' | 'rendering' | 'encoding' | 'done' | 'failed' | 'canceled';
	/** What happens before frames render, such as updating the scene */
	step: string | null;
	startedAt: number | null;
	finishedAt: number | null;
	frame: number | null;
	frames: number | null;
	msPerFrame: number | null;
	/** 0 to 1; rendering covers 0 to 0.95, encoding the rest */
	progress: number;
	result: TRenderFilmResult | null;
	error: string | null;
	/** The save panel pointed outside the package; the film was written to the package's Renders folder */
	outsidePackage: boolean;
}

const IDLE_JOB: TExportJob = {
	phase: 'idle',
	step: null,
	startedAt: null,
	finishedAt: null,
	frame: null,
	frames: null,
	msPerFrame: null,
	progress: 0,
	result: null,
	error: null,
	outsidePackage: false
};

/**
 * Package-relative output path. The worker writes films only inside the package, so a path chosen elsewhere
 * keeps its file name and lands in the Renders folder.
 */
export function resolveFilmOutput(packagePath: string, settings: Pick<TExportSettings, 'fileName' | 'chosenPath'>): { relativePath: string; outsidePackage: boolean } {
	const prefix = `${packagePath.replace(/\/+$/, '')}/`;
	if (settings.chosenPath?.startsWith(prefix) === true) {
		return { relativePath: settings.chosenPath.slice(prefix.length), outsidePackage: false };
	}
	return { relativePath: `${RENDERS_FOLDER}/${filmFileName(settings.fileName)}`, outsidePackage: settings.chosenPath != null };
}

function readMeasured(): Partial<Record<TFilmEngine, TMeasuredRender>> {
	try {
		const value: unknown = JSON.parse(localStorage.getItem(MEASURED_KEY) ?? '{}');
		return value != null && typeof value === 'object' ? (value as Partial<Record<TFilmEngine, TMeasuredRender>>) : {};
	} catch {
		return {};
	}
}
