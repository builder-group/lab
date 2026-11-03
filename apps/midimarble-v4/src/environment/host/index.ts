import { isTauri } from '@tauri-apps/api/core';
import { Err, Ok, type TResult } from 'tuple-result';
import { specta } from '../specta';

/**
 * Native project storage. In the browser UI development surface, packages live in localStorage
 * so the studio stays usable without the desktop host.
 */
export const host = {
	isDesktop(): boolean {
		return isTauri();
	},

	async chooseNewProjectPath(name: string): Promise<string | null> {
		if (!isTauri()) return `/browser/${name}.marble`;
		const { save } = await import('@tauri-apps/plugin-dialog');
		return save({ title: 'New Project', defaultPath: `${name}.marble` });
	},

	async chooseProjectToOpen(): Promise<string | null> {
		if (!isTauri()) return browserPackages.list()[0]?.path ?? null;
		const { open } = await import('@tauri-apps/plugin-dialog');
		// Packages show as folders until the bundled app registers the `.marble` type
		const path = await open({ title: 'Open Project', directory: true, multiple: false });
		return typeof path === 'string' ? path : null;
	},

	async createProject(path: string, projectJson: string): Promise<TResult<THostProject, Error>> {
		if (!isTauri()) return browserPackages.create(path, projectJson);
		return toResult(await specta.commands.createProject(path, projectJson));
	},

	async openProject(path: string): Promise<TResult<THostProject, Error>> {
		if (!isTauri()) return browserPackages.open(path);
		return toResult(await specta.commands.openProject(path));
	},

	async saveProject(path: string, projectJson: string): Promise<TResult<void, Error>> {
		if (!isTauri()) return browserPackages.save(path, projectJson);
		const result = await specta.commands.saveProject(path, projectJson);
		return result.status === 'ok' ? Ok(undefined) : Err(new Error(result.error));
	},

	async listRecentProjects(): Promise<THostRecentProject[]> {
		if (!isTauri()) return browserPackages.list();
		return (await specta.commands.listRecentProjects()).map((item) => ({
			path: item.path,
			name: item.name,
			openedAt: item.openedAt ?? 0
		}));
	}
};

export interface THostProject {
	path: string;
	projectJson: string;
}

export interface THostRecentProject {
	path: string;
	name: string;
	openedAt: number;
}

function toResult(
	result: { status: 'ok'; data: specta.OpenedProjectDto } | { status: 'error'; error: string }
): TResult<THostProject, Error> {
	if (result.status === 'error') return Err(new Error(result.error));
	return Ok({ path: result.data.path, projectJson: result.data.projectJson });
}

const browserPackages = {
	key: 'midimarble-v4:packages',
	read(): Record<string, { json: string; openedAt: number }> {
		try {
			return JSON.parse(localStorage.getItem(this.key) ?? '{}') as Record<
				string,
				{ json: string; openedAt: number }
			>;
		} catch {
			return {};
		}
	},
	write(value: Record<string, { json: string; openedAt: number }>): void {
		localStorage.setItem(this.key, JSON.stringify(value));
	},
	create(path: string, json: string): TResult<THostProject, Error> {
		const packages = this.read();
		let unique = path;
		for (let index = 2; packages[unique] != null; index++) {
			unique = path.replace(/\.marble$/, ` ${index}.marble`);
		}
		packages[unique] = { json, openedAt: Date.now() };
		this.write(packages);
		return Ok({ path: unique, projectJson: json });
	},
	open(path: string): TResult<THostProject, Error> {
		const packages = this.read();
		const item = packages[path];
		if (item == null) return Err(new Error(`${path} does not exist`));
		item.openedAt = Date.now();
		this.write(packages);
		return Ok({ path, projectJson: item.json });
	},
	save(path: string, json: string): TResult<void, Error> {
		const packages = this.read();
		packages[path] = { json, openedAt: packages[path]?.openedAt ?? Date.now() };
		this.write(packages);
		return Ok(undefined);
	},
	list(): THostRecentProject[] {
		return Object.entries(this.read())
			.map(([path, item]) => ({
				path,
				name: path.split('/').pop()?.replace(/\.marble$/, '') ?? path,
				openedAt: item.openedAt
			}))
			.sort((a, b) => b.openedAt - a.openedAt);
	}
};
