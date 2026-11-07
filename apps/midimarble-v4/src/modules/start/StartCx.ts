import { createState } from 'feature-state';
import type { TResult } from 'tuple-result';
import { host, type THostPickedFile, type THostRecentProject } from '@/environment';
import type { TProject } from '@/modules/project';

/**
 * Owns the start window, which shows before the studio has loaded. The studio with Three.js, the synth and the canvases
 * is one dynamic import that starts as soon as this mounts, so an opened project rarely waits; an action taken earlier
 * waits for it.
 */
export class StartCx {
	readonly $recent = createState<THostRecentProject[]>([]);
	/** The loaded studio while a project is open */
	readonly $openStudio = createState<TLoadedStudio | null>(null);
	private loading: Promise<TLoadedStudio> | null = null;

	mount(): () => void {
		let isMounted = true;
		let isLoaded = false;
		let unmountStudio: (() => void) | null = null;
		void host.listRecentProjects().then((recent) => {
			if (isMounted && !isLoaded) this.$recent.set(recent);
		});
		void this.load().then((studio) => {
			if (!isMounted) return;
			isLoaded = true;
			const showOpen = (): void => this.$openStudio.set(studio.cx.$history.get() != null ? studio : null);
			const stops = [
				studio.cx.$recent.listen(({ value }) => this.$recent.set(value)),
				studio.cx.$history.listen(showOpen),
				studio.mountStudio(studio.cx)
			];
			showOpen();
			unmountStudio = () => {
				for (const stop of stops) stop();
			};
		});
		return () => {
			isMounted = false;
			unmountStudio?.();
		};
	}

	async newProject(): Promise<void> {
		await (await this.load()).cx.newProject();
	}

	async newProjectFromSong(): Promise<void> {
		await (await this.load()).cx.newProjectFromSong();
	}

	async newProjectFromFile(file: THostPickedFile): Promise<void> {
		await (await this.load()).cx.newProjectFromFile(file);
	}

	async openProject(path?: string): Promise<void> {
		await (await this.load()).cx.openProject(path);
	}

	async openTemporary(project: TProject, prepare?: (packagePath: string) => Promise<TResult<void, Error>>): Promise<void> {
		await (await this.load()).cx.openTemporary(project, prepare);
	}

	async notify(message: string, tone: 'info' | 'error'): Promise<void> {
		(await this.load()).cx.notify(message, tone);
	}

	private load(): Promise<TLoadedStudio> {
		this.loading ??= import('@/modules/studio/StudioWindow').then(({ mountStudio, StudioCx, StudioWindow }) => ({
			cx: new StudioCx(),
			mountStudio,
			StudioWindow
		}));
		return this.loading;
	}
}

type TStudioWindowModule = typeof import('@/modules/studio/StudioWindow');

export interface TLoadedStudio {
	cx: InstanceType<TStudioWindowModule['StudioCx']>;
	mountStudio: TStudioWindowModule['mountStudio'];
	StudioWindow: TStudioWindowModule['StudioWindow'];
}
