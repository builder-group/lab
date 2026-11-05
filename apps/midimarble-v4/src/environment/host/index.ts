import { convertFileSrc, isTauri } from '@tauri-apps/api/core';
import { openUrl, revealItemInDir } from '@tauri-apps/plugin-opener';
import { Err, Ok, type TResult } from 'tuple-result';
import { specta } from '../specta';

const midiExtensions = ['mid', 'midi'];
const audioExtensions = ['wav', 'mp3', 'm4a', 'aac', 'aiff', 'aif', 'flac', 'ogg'];

/**
 * Native project storage. In the browser UI development surface, packages live in localStorage
 * so the studio stays usable without the desktop host.
 */
export const host = {
	isDesktop(): boolean {
		return isTauri();
	},

	/**
	 * The save panel for a new package. `panelTitle` is New Project for File > New and "Save Jingle Bells" when an
	 * unsaved project is saved, like a macOS document's save panel.
	 */
	async chooseNewProjectPath(name: string, panelTitle = 'New Project'): Promise<string | null> {
		// The browser names a new project as it will be stored (Untitled 7), so the title bar and Recent agree
		if (!isTauri()) return browserPackages.uniquePath(`/browser/${name}.marble`);
		const { save } = await import('@tauri-apps/plugin-dialog');
		return save({ title: panelTitle, defaultPath: `${name}.marble` });
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

	/**
	 * An unsaved project, such as an opened example, in a temporary location the host controls: a folder in the
	 * app's cache on macOS, a separate key range in the browser. It stays out of Recent until `moveProject` saves it.
	 */
	async createTemporaryProject(name: string, projectJson: string): Promise<TResult<THostProject, Error>> {
		if (!isTauri()) return browserPackages.createTemporary(name, projectJson);
		return toResult(await specta.commands.createTemporaryProject(name, projectJson));
	},

	async isTemporaryProject(path: string): Promise<boolean> {
		if (!isTauri()) return path.startsWith(BROWSER_TEMPORARY_PREFIX);
		return specta.commands.isTemporaryProject(path);
	},

	/** Moves a package with its files to `destinationPath` and adds it to Recent; returns the new package path */
	async moveProject(path: string, destinationPath: string): Promise<TResult<string, Error>> {
		if (!isTauri()) return Ok(browserPackages.move(path, destinationPath));
		const result = await specta.commands.moveProject(path, destinationPath);
		return result.status === 'ok' ? Ok(result.data) : Err(new Error(result.error));
	},

	/** Save As… of a saved project: copies the package with its files and adds the copy to Recent; returns its path */
	async copyProject(path: string, destinationPath: string): Promise<TResult<string, Error>> {
		if (!isTauri()) return Ok(browserPackages.copy(path, destinationPath));
		const result = await specta.commands.copyProject(path, destinationPath);
		return result.status === 'ok' ? Ok(result.data) : Err(new Error(result.error));
	},

	/** Clear Menu in File > Open Recent. The browser lists its stored projects as Recent, so it keeps them. */
	async clearRecentProjects(): Promise<void> {
		if (isTauri()) await specta.commands.clearRecentProjects();
	},

	/**
	 * Forgets an unsaved project closed with Don't Save. On macOS the cache folder is cleared when the next unsaved
	 * project opens, so a closed one costs nothing until then.
	 */
	discardTemporaryProject(path: string): void {
		if (!isTauri() && path.startsWith(BROWSER_TEMPORARY_PREFIX)) browserPackages.remove(path);
	},

	async saveProject(path: string, projectJson: string): Promise<TResult<void, Error>> {
		if (!isTauri()) return browserPackages.save(path, projectJson);
		const result = await specta.commands.saveProject(path, projectJson);
		return result.status === 'ok' ? Ok(undefined) : Err(new Error(result.error));
	},

	/** Keeps the saved project beside it, like Blender's `.blend1`; the browser has no such file */
	async keepPreviousSave(path: string): Promise<void> {
		if (isTauri()) await specta.commands.keepPreviousSave(path);
	},

	/**
	 * Lets the user pick a song file: a MIDI file, a recording, or with `song` either of them in one panel. Returns
	 * a path the host can import.
	 */
	async chooseSourceFile(kind: 'midi' | 'audio' | 'song' = 'song'): Promise<THostPickedFile | null> {
		const extensions = kind === 'song' ? [...midiExtensions, ...audioExtensions] : kind === 'midi' ? midiExtensions : audioExtensions;
		if (!isTauri()) return pickBrowserFile(extensions);
		const { open } = await import('@tauri-apps/plugin-dialog');
		const path = await open({
			title: 'Import Song',
			multiple: false,
			filters: [{ name: kind === 'song' ? 'MIDI File or Recording' : kind === 'midi' ? 'MIDI File' : 'Recording', extensions }]
		});
		if (typeof path !== 'string') return null;
		return { name: path.split('/').pop() ?? path, path };
	},

	/** Open panel for References; empty when canceled or in the browser */
	async chooseImages(): Promise<string[]> {
		if (!isTauri()) return [];
		const { open } = await import('@tauri-apps/plugin-dialog');
		const paths = await open({ title: 'Add Images', multiple: true, filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'heic', 'tiff'] }] });
		return paths ?? [];
	},

	/** Copies a picked or dropped file into the package and returns its package-relative path */
	async importSource(packagePath: string, file: THostPickedFile): Promise<TResult<string, Error>> {
		if (!isTauri()) {
			const relativePath = `audio/${file.name}`;
			const url = browserFiles.get(file.path);
			if (url == null) return Err(new Error(`${file.name} is no longer available. Import it again.`));
			browserFiles.set(`${packagePath}/${relativePath}`, url);
			return Ok(relativePath);
		}
		const result = await specta.commands.importSource(packagePath, file.path);
		return result.status === 'ok' ? Ok(result.data) : Err(new Error(result.error));
	},

	/**
	 * Copies a file the app ships, such as an example's song, into the package at a package-relative path. The
	 * browser development surface keeps the URL instead of the bytes.
	 */
	async addPackageFile(packagePath: string, relativePath: string, url: string): Promise<TResult<string, Error>> {
		if (!isTauri()) {
			browserFiles.set(`${packagePath}/${relativePath}`, url);
			return Ok(relativePath);
		}
		const [isBytesOk, bytesErr, bytes] = await host.readFile(url);
		if (!isBytesOk) return Err(bytesErr);
		const result = await specta.commands.writePackageFile(packagePath, relativePath, Array.from(new Uint8Array(bytes)));
		return result.status === 'ok' ? Ok(relativePath) : Err(new Error(result.error));
	},

	sourceUrl(packagePath: string, relativePath: string): string | null {
		const path = `${packagePath}/${relativePath}`;
		if (!isTauri()) return browserFiles.get(path) ?? null;
		return convertFileSrc(path);
	},

	/** Reads a picked file or package file through the asset protocol */
	async readFile(url: string): Promise<TResult<ArrayBuffer, Error>> {
		try {
			const response = await fetch(url);
			if (!response.ok) return Err(new Error(`The file couldn't be read (status ${response.status})`));
			return Ok(await response.arrayBuffer());
		} catch (error) {
			return Err(error instanceof Error ? error : new Error(String(error)));
		}
	},

	/** Makes a browser `File` usable like a picked path in the development surface */
	registerBrowserFile(file: File): THostPickedFile {
		const path = `browser:${Date.now()}:${file.name}`;
		browserFiles.set(path, URL.createObjectURL(file));
		return { name: file.name, path };
	},

	pickedFileUrl(file: THostPickedFile): string | null {
		if (!isTauri()) return browserFiles.get(file.path) ?? null;
		return convertFileSrc(file.path);
	},

	/** Save panel for an exported film; null when canceled or in the browser */
	async chooseFilmPath(defaultPath: string): Promise<string | null> {
		if (!isTauri()) return null;
		const { save } = await import('@tauri-apps/plugin-dialog');
		return save({ title: 'Export Film', defaultPath, filters: [{ name: 'MPEG-4 Movie', extensions: ['mp4'] }] });
	},

	/** Import from File…: open panel for a Pack, a folder until the bundled app registers the `.marblepack` type; null when canceled */
	async choosePackToImport(): Promise<string | null> {
		if (!isTauri()) return null;
		const { open } = await import('@tauri-apps/plugin-dialog');
		const path = await open({ title: 'Import from File', directory: true, multiple: false });
		return typeof path === 'string' ? path : null;
	},

	/** Save panel for a Pack; null when canceled */
	async choosePackPath(name: string): Promise<string | null> {
		if (!isTauri()) return null;
		const { save } = await import('@tauri-apps/plugin-dialog');
		return save({ title: 'Export This Look', defaultPath: `${name}.marblepack` });
	},

	/** Opens a web link in the browser; anything but http and https is refused */
	async openLink(url: string): Promise<TResult<void, Error>> {
		if (!/^https?:\/\//i.test(url)) return Err(new Error(`${url} isn't a web link`));
		try {
			await openUrl(url);
			return Ok(undefined);
		} catch (error) {
			return Err(new Error(String(error)));
		}
	},

	/** Selects a file in a Finder window */
	async revealInFinder(path: string): Promise<TResult<void, Error>> {
		if (!isTauri()) return Err(new Error('Show in Finder works in the desktop app. Open MidiMarble on your Mac.'));
		try {
			await revealItemInDir(path);
			return Ok(undefined);
		} catch (error) {
			return Err(new Error(String(error)));
		}
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

/** Name of New Project: it opens at once, unsaved, and the first Save asks where to keep it, so no ellipsis */
export function newProjectTitle(): string {
	return 'New Project';
}

/** Whether a picked or dropped song file is MIDI or a recording, by its extension; null for anything else */
export function songFileKind(name: string): 'midi' | 'audio' | null {
	const extension = name.split('.').pop()?.toLowerCase() ?? '';
	if (midiExtensions.includes(extension)) return 'midi';
	if (audioExtensions.includes(extension)) return 'audio';
	return null;
}

/** The error for a file that is neither a MIDI file nor a recording */
export function notSongFileMessage(name: string): string {
	return `${name} isn't a MIDI file or a recording. Choose a .mid, .wav, .mp3 or .m4a file.`;
}

interface THostProject {
	path: string;
	projectJson: string;
}

export interface THostPickedFile {
	name: string;
	path: string;
}

/**
 * URLs for files of the browser development surface, keyed by their pseudo path. Blob URLs of picked files last
 * for the session; URLs of files the app ships persist with the packages in localStorage.
 */
const browserFiles = {
	key: 'midimarble-v4:files',
	session: new Map<string, string>(),
	get(path: string): string | undefined {
		return this.session.get(path) ?? this.read()[path];
	},
	set(path: string, url: string): void {
		this.session.set(path, url);
		if (url.startsWith('blob:')) return;
		try {
			localStorage.setItem(this.key, JSON.stringify({ ...this.read(), [path]: url }));
		} catch {
			// Without storage the file lasts for the session
		}
	},
	read(): Record<string, string> {
		try {
			return JSON.parse(localStorage.getItem(this.key) ?? '{}') as Record<string, string>;
		} catch {
			return {};
		}
	},
	/** Copies every file under the `from` prefix to the `to` prefix, for a package saved as a copy */
	copy(from: string, to: string): void {
		for (const [path, url] of [...this.session]) {
			if (path.startsWith(from)) this.session.set(`${to}${path.slice(from.length)}`, url);
		}
		const stored = this.read();
		for (const [path, url] of Object.entries(stored)) {
			if (path.startsWith(from)) stored[`${to}${path.slice(from.length)}`] = url;
		}
		try {
			localStorage.setItem(this.key, JSON.stringify(stored));
		} catch {
			// Without storage the files last for the session
		}
	},
	/** Moves every file under the `from` prefix to the `to` prefix, for a package that moved */
	move(from: string, to: string): void {
		this.rewrite((path) => (path.startsWith(from) ? `${to}${path.slice(from.length)}` : path));
	},
	remove(prefix: string): void {
		this.rewrite((path) => (path.startsWith(prefix) ? null : path));
	},
	rewrite(map: (path: string) => string | null): void {
		for (const [path, url] of [...this.session]) {
			const next = map(path);
			if (next === path) continue;
			this.session.delete(path);
			if (next != null) this.session.set(next, url);
		}
		const stored: Record<string, string> = {};
		for (const [path, url] of Object.entries(this.read())) {
			const next = map(path);
			if (next != null) stored[next] = url;
		}
		try {
			localStorage.setItem(this.key, JSON.stringify(stored));
		} catch {
			// Without storage the files last for the session
		}
	}
};

function pickBrowserFile(extensions: string[]): Promise<THostPickedFile | null> {
	return new Promise((resolve) => {
		const input = document.createElement('input');
		input.type = 'file';
		input.accept = extensions.map((extension) => `.${extension}`).join(',');
		input.addEventListener('change', () => {
			const file = input.files?.[0];
			if (file == null) {
				resolve(null);
				return;
			}
			const path = `browser:${Date.now()}:${file.name}`;
			browserFiles.set(path, URL.createObjectURL(file));
			resolve({ name: file.name, path });
		});
		input.addEventListener('cancel', () => resolve(null));
		input.click();
	});
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

// Unsaved projects of the browser development surface, kept with the packages but not listed in Recent
const BROWSER_TEMPORARY_PREFIX = '/unsaved/';

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
	/** `path`, or the first of `Name 2.marble`, `Name 3.marble`… that no stored project uses */
	uniquePath(path: string): string {
		const packages = this.read();
		let unique = path;
		for (let index = 2; packages[unique] != null; index++) {
			unique = path.replace(/\.marble$/, ` ${index}.marble`);
		}
		return unique;
	},
	create(path: string, json: string): TResult<THostProject, Error> {
		const packages = this.read();
		const unique = this.uniquePath(path);
		packages[unique] = { json, openedAt: Date.now() };
		this.write(packages);
		return Ok({ path: unique, projectJson: json });
	},
	open(path: string): TResult<THostProject, Error> {
		const packages = this.read();
		const item = packages[path];
		if (item == null) return Err(new Error(`${path.split('/').pop()?.replace(/\.marble$/, '') ?? path} no longer exists. If you moved it, choose it with Open Project…`));
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
	/** Like the macOS cache folder, earlier unsaved projects are cleared when a new one opens */
	createTemporary(name: string, json: string): TResult<THostProject, Error> {
		for (const path of Object.keys(this.read())) {
			if (path.startsWith(BROWSER_TEMPORARY_PREFIX)) this.remove(path);
		}
		return this.create(`${BROWSER_TEMPORARY_PREFIX}${name.replaceAll('/', '-')}.marble`, json);
	},
	/** Moves the package and its files to a free path next to `destination`; returns the path it got */
	move(path: string, destination: string): string {
		const packages = this.read();
		let unique = destination;
		for (let index = 2; packages[unique] != null; index++) {
			unique = destination.replace(/\.marble$/, ` ${index}.marble`);
		}
		const { [path]: item, ...others } = packages;
		if (item != null) this.write({ ...others, [unique]: { ...item, openedAt: Date.now() } });
		browserFiles.move(`${path}/`, `${unique}/`);
		return unique;
	},
	/** Copies the package and its files to a free path next to `destination`; returns the path it got */
	copy(path: string, destination: string): string {
		const packages = this.read();
		const unique = this.uniquePath(destination);
		const item = packages[path];
		if (item != null) this.write({ ...packages, [unique]: { json: item.json, openedAt: Date.now() } });
		browserFiles.copy(`${path}/`, `${unique}/`);
		return unique;
	},
	remove(path: string): void {
		const { [path]: _removed, ...others } = this.read();
		this.write(others);
		browserFiles.remove(`${path}/`);
	},
	list(): THostRecentProject[] {
		return Object.entries(this.read())
			.filter(([path]) => !path.startsWith(BROWSER_TEMPORARY_PREFIX))
			.map(([path, item]) => ({
				path,
				name: path.split('/').pop()?.replace(/\.marble$/, '') ?? path,
				openedAt: item.openedAt
			}))
			.sort((a, b) => b.openedAt - a.openedAt);
	}
};
