import { isTauri } from '@tauri-apps/api/core';
import { z } from 'zod';
import { host, songFileKind, specta } from '@/environment';
import { filmFileName, getRenderPreset } from '@/modules/design/export-estimate';
import { library, toItemId } from '@/modules/library';
import { createProject } from '@/modules/project';

import { commands as registry, commandWorkspace, isCommandEnabled, type TCommand, type TCommandId } from '@/modules/studio/commands';
import type { StudioCx, TAgentStepNotice } from '@/modules/studio/StudioCx';
import { hitReport, projectState } from './mcp-state';
import { expandCommands, type TAgentCommand } from './project-commands';

// What each MCP tool does in the app. Edits go through the same `execute` a person's do, inside one named Undo step.

export interface TToolReply {
	content: ({ type: 'text'; text: string } | { type: 'imagePath'; path: string })[];
	isError: boolean;
	/** The project whose `agent/runs/` logs this call */
	packagePath: string | null;
}

const WAIT_FOR_PERSON_MS = 2000;
const SETTLE_MS = 300;
const SETTLE_LIMIT_MS = 8000;
const EXPORT_WAIT_MS = 15_000;
const DRAFT_WIDTH = 540;
const BLENDER_WIDTH = 1280;
const PROJECT_EXECUTE = 'project.execute';

/** Commands that ask a person through a panel, with what they need instead */
const PANEL_COMMANDS: Partial<Record<TCommandId, string>> = {
	'file.open': 'args.path, the .marble package to open',
	'file.saveAs': 'args.path, where to save',
	'file.importMidi': 'the add_song tool',
	'file.importAudio': 'the add_song tool',
	'file.replaceSong': 'the add_song tool',
	'file.export': 'the export_film tool',
	'design.exportPack': 'args.path, plus name and either theme or items'
};

const SPath = z.string().regex(/^\//, 'Use an absolute path');

const SRunCommand = z.object({ id: z.string().min(1), args: z.record(z.string(), z.unknown()).optional() });

export async function runTool(cx: StudioCx, tool: string, args: unknown): Promise<TToolReply> {
	try {
		const handler = TOOLS[tool];
		if (handler == null) return fail(cx, `There is no tool called ${tool}`);
		return await handler(cx, args);
	} catch (error) {
		return fail(cx, error instanceof z.ZodError ? `Those arguments don't fit: ${error.issues.map((issue) => `${issue.path.join('.')} ${issue.message}`).join('; ')}` : `That didn't work: ${(error as Error).message}`);
	}
}

const TOOLS: Record<string, (cx: StudioCx, args: unknown) => Promise<TToolReply>> = {
	get_state: async (cx) => {
		const project = cx.project;
		if (project == null) return text(cx, { project: null, note: 'No project is open. Call add_song, or run_command with file.new or file.open.' });
		const references = cx.$references.get();
		return text(
			cx,
			projectState(project, cx.simulation.$result.get(), {
				path: cx.$path.get(),
				workspace: cx.$workspace.get() === 'design' ? 'film' : 'compose',
				selection: cx.$selection.get(),
				playhead: cx.$playhead.get(),
				isPlaying: cx.$playing.get(),
				agentFolder: await agentFolder(cx),
				references: { images: references.images.length, text: references.text }
			})
		);
	},

	list_commands: async (cx, args) => {
		const { filter } = z.object({ filter: z.string().optional() }).parse(args);
		const words = (filter ?? '').toLowerCase().split(/\s+/).filter(Boolean);
		const listed = registry
			.filter((command) => command.isHidden !== true)
			.filter((command) => words.every((word) => `${command.id} ${command.title} ${command.keywords ?? ''}`.toLowerCase().includes(word)))
			.map((command) => ({
				id: command.id,
				title: command.title,
				section: command.section,
				canRun: canRun(cx, command),
				...(command.isChecked != null ? { isOn: command.isChecked(cx) === true } : {}),
				...(PANEL_COMMANDS[command.id] != null ? { needs: PANEL_COMMANDS[command.id] } : {})
			}));
		return text(cx, { commands: [{ id: PROJECT_EXECUTE, title: 'Project commands with parameters: see the building-a-track guide' }, ...listed] });
	},

	run_command: async (cx, args) => {
		const { id, args: commandArgs = {} } = SRunCommand.parse(args);
		const busy = await waitUntilFree(cx);
		if (busy != null) return fail(cx, busy);
		if (id === PROJECT_EXECUTE) return runProjectCommands(cx, commandArgs);
		const command = registry.find((item) => item.id === id);
		if (command == null) return fail(cx, `There is no command called ${id}. Use list_commands to find one.`);
		const special = ARGUMENT_COMMANDS[command.id];
		if (special == null && PANEL_COMMANDS[command.id] != null) return fail(cx, `${command.title} asks a person through a panel. Use ${PANEL_COMMANDS[command.id] ?? ''}.`);
		return editStep(cx, command.title, async () => {
			applySelection(cx, commandArgs);
			if (special != null) return special(cx, commandArgs);
			return invoke(cx, command);
		});
	},

	add_song: async (cx, args) => {
		const { path } = z.object({ path: SPath }).parse(args);
		const name = path.split('/').pop() ?? path;
		if (songFileKind(name) == null) return fail(cx, `${name} isn't a song. Use a MIDI file or a recording.`);
		const busy = await waitUntilFree(cx);
		if (busy != null) return fail(cx, busy);
		if (cx.project == null && !(await cx.openTemporary(createProject({ title: name.replace(/\.[^.]+$/, '') })))) return fail(cx, "A new project couldn't be made for the song.");
		return editStep(cx, 'Add Song', async () => {
			await cx.importSongFile({ name, path });
			// The import sheet's choices stay at what it opens with: every melodic track, split across marbles
			if (cx.sources.$midiImport.get() != null) await cx.sources.confirmMidiImport();
		});
	},

	set_references: async (cx, args) => {
		const { paths, text: words } = z.object({ paths: z.array(SPath), text: z.string() }).parse(args);
		const project = cx.project;
		const packagePath = cx.$path.get();
		if (project == null || packagePath == null) return noProject(cx);
		const result = await specta.commands.agentReferencesSet(packagePath, project.title, paths, words);
		if (result.status === 'error') return fail(cx, result.error);
		cx.$references.set(result.data);
		cx.notify(`Agent: References set, ${result.data.images.length} ${result.data.images.length === 1 ? 'image' : 'images'}`);
		return text(cx, { folder: `${packagePath}/agent/references`, images: result.data.images, text: result.data.text });
	},

	preview_frame: async (cx, args) => {
		const { time, quality } = z.object({ time: z.number().min(0), quality: z.enum(['draft', 'blender']).optional() }).parse(args);
		if (cx.project == null) return noProject(cx);
		await settled(cx);
		const [isFrameOk, frameErr, frame] = await cx.design.renderStill(time, quality === 'blender' ? BLENDER_WIDTH : DRAFT_WIDTH);
		if (!isFrameOk) return fail(cx, frameErr.message);
		return { content: [{ type: 'imagePath', path: frame.path }, { type: 'text', text: `${frame.width} × ${frame.height} at ${time} s, ${Math.round(frame.renderMs)} ms` }], isError: false, packagePath: cx.$path.get() };
	},

	play_range: async (cx, args) => {
		const { from, to } = z.object({ from: z.number().min(0), to: z.number() }).parse(args);
		if (cx.project == null) return noProject(cx);
		if (to <= from) return fail(cx, 'play_range needs to after from');
		playRange(cx, from, to);
		return text(cx, { playing: { from, to } });
	},

	export_film: async (cx, args) => {
		const { quality, path } = z.object({ quality: z.enum(['draft', 'fast', 'balanced', 'best']).optional(), path: SPath.optional() }).parse(args);
		if (cx.project == null) return noProject(cx);
		if (quality != null && !cx.film.isRunning) {
			await settled(cx);
			cx.film.updateSettings({ preset: quality, ...(path != null ? { fileName: filmFileName(path), chosenPath: path } : {}) });
			if (getRenderPreset(quality).engine !== 'workbench') cx.film.updateSettings({ engine: 'eevee' });
			void cx.film.start();
			await sleep(50);
		}
		const deadline = Date.now() + EXPORT_WAIT_MS;
		while (cx.film.isRunning && quality != null && Date.now() < deadline) await sleep(250);
		const job = cx.film.$job.get();
		if (job.phase === 'failed') return fail(cx, job.error ?? 'The export failed');
		return text(cx, {
			phase: job.phase,
			...(job.frames != null ? { frame: job.frame, frames: job.frames } : {}),
			...(job.progress != null ? { progress: Math.round(job.progress * 100) / 100 } : {}),
			...(job.result != null ? { result: job.result } : {}),
			...(cx.film.isRunning ? { note: 'Still exporting. Call export_film without quality to check again.' } : {})
		});
	},

	add_asset: async (cx, args) => {
		const { path, role, name, pieceType, pack } = z.object({ path: SPath, role: z.enum(['skin', 'decor']), name: z.string().regex(/\S/), pieceType: z.string().optional(), pack: z.string().regex(/\S/).optional() }).parse(args);
		const packagePath = cx.$path.get();
		if (packagePath == null) return noProject(cx);
		if (role === 'skin' && pieceType == null) return fail(cx, 'A skin needs a pieceType, the piece it fits, such as platform.');
		const isBlendFile = path.toLowerCase().endsWith('.blend');
		const folder = isBlendFile ? path.slice(0, path.lastIndexOf('/')) : path;
		const manifestUrl = host.pickedFileUrl({ name: 'manifest.json', path: `${folder}/manifest.json` });
		const [isReadOk, , bytes] = manifestUrl != null ? await host.readFile(manifestUrl) : ([false, null, null] as const);
		const written = isReadOk ? parseObject(new TextDecoder().decode(bytes)) : {};
		const manifest = { $schema: 'marble-asset@1', id: toItemId(name), ...written, label: name, role: role === 'skin' ? 'skin' : 'decoration', ...(pieceType != null ? { pieceType } : {}) };
		const [isAddedOk, addedErr, item] = await library.addAsset(packagePath, path, JSON.stringify(manifest), pack != null ? { packId: toItemId(pack), packName: pack, version: '1.0' } : undefined);
		if (!isAddedOk) return fail(cx, addedErr.message);
		await cx.library.refresh();
		cx.notify(`Agent: ${name} added to the project`);
		return text(cx, { id: item.id, how: role === 'skin' ? `project.execute with { type: 'applySkin', assetId: '${item.id}', pieceType: '${pieceType ?? ''}' }` : `project.execute with { type: 'placeDecor', source: 'assets/${item.id}/asset.blend', at: { x, y } } or scatterDecor` });
	}
};

/** Commands that take their panel's answers as arguments */
const ARGUMENT_COMMANDS: Partial<Record<TCommandId, (cx: StudioCx, args: Record<string, unknown>) => Promise<void>>> = {
	'file.new': async (cx, args) => {
		const { title, path } = z.object({ title: z.string().optional(), path: SPath.optional() }).parse(args);
		if (path != null) await cx.newProject({ ...(title != null ? { title } : {}), path });
		else await cx.openTemporary(createProject({ title: title ?? 'Untitled' }));
	},
	'file.open': async (cx, args) => {
		await cx.openProject(z.object({ path: SPath }).parse(args).path);
	},
	'file.save': async (cx, args) => {
		await cx.save(z.object({ path: SPath.optional() }).parse(args).path);
	},
	'file.saveAs': async (cx, args) => {
		await cx.saveAs(z.object({ path: SPath }).parse(args).path);
	},
	'design.addPack': async (cx, args) => {
		const { path, name } = z.object({ path: SPath.optional(), name: z.string().optional() }).parse(args);
		const named = name != null ? cx.library.$bundledPacks.get().find((pack) => pack.name.toLowerCase() === name.toLowerCase()) : null;
		if (name != null && named == null) throw new Error(`There is no Pack called ${name} in the app`);
		const from = named?.path ?? path;
		if (from == null) cx.library.$isAddPackOpen.set(true);
		else await cx.library.addPack(from);
	},
	'design.exportPack': async (cx, args) => {
		const { path, name, description, author, theme, items } = z.object({ path: SPath, name: z.string(), description: z.string().optional(), author: z.string().optional(), theme: z.boolean().optional(), items: z.array(z.string()).optional() }).parse(args);
		const [isExportedOk, exportedErr] = await cx.library.exportPack({ name, ...(description != null ? { description } : {}), ...(author != null ? { author } : {}), includesTheme: theme === true, assetIds: items ?? [] }, path);
		if (!isExportedOk) throw exportedErr;
	}
};

async function runProjectCommands(cx: StudioCx, args: Record<string, unknown>): Promise<TToolReply> {
	const { commands, label } = z.object({ commands: z.array(z.looseObject({ type: z.string() })).min(1), label: z.string().optional() }).parse(args);
	const project = cx.project;
	if (project == null) return noProject(cx);
	await settled(cx);
	const items = cx.library.$projectItems.get();
	const [isExpandedOk, expandedErr, expanded] = expandCommands(project, cx.simulation.$result.get(), items, commands as unknown as TAgentCommand[]);
	if (!isExpandedOk) return fail(cx, expandedErr.message);
	return editStep(cx, label ?? expanded.summary ?? 'Edit', () => {
		if (!cx.execute(expanded.commands)) return;
		if (expanded.createdIds.length > 0) cx.$selection.set(expanded.createdIds);
		applySelection(cx, args);
	});
}

/** Runs `work` as one Undo step named "Agent: …", waits for the run to catch up and answers with the hit summary */
async function editStep(cx: StudioCx, title: string, work: () => Promise<void> | void): Promise<TToolReply> {
	const label = `Agent: ${title.replace(/…$/, '')}`;
	const outcome = await cx.runAgentStep(label, async () => {
		await work();
		await settled(cx);
	});
	const project = cx.project;
	const errors = outcome.notices.filter((notice: TAgentStepNotice) => notice.tone === 'error').map((notice: TAgentStepNotice) => notice.message);
	const notices = outcome.notices.filter((notice: TAgentStepNotice) => notice.tone !== 'error').map((notice: TAgentStepNotice) => notice.message);
	const reply = {
		...(outcome.stepName != null ? { undoStep: outcome.stepName } : {}),
		selection: cx.$selection.get(),
		...(project != null ? hitReport(project, cx.simulation.$result.get()) : {}),
		...(notices.length > 0 ? { notices } : {}),
		...(errors.length > 0 ? { errors } : {})
	};
	return { ...text(cx, reply), isError: errors.length > 0 };
}

/** Runs a registered command in its workspace, opening that first as the palette does */
async function invoke(cx: StudioCx, command: TCommand): Promise<void> {
	const target = commandWorkspace(command);
	if (target != null && cx.$workspace.get() !== target && cx.project != null) {
		cx.$workspace.set(target);
		await waitFor(() => target === 'design' || cx.$compose.get() != null, 1500);
		await sleep(50);
	}
	if (!isCommandEnabled(cx, command)) throw new Error(`${command.title} can't run right now. get_state shows the project and selection it would act on.`);
	command.run(cx);
}

function canRun(cx: StudioCx, command: TCommand): boolean {
	const target = commandWorkspace(command);
	// A command of the other workspace opens it first; only then can it say whether it applies
	return target != null && target !== cx.$workspace.get() ? cx.project != null : isCommandEnabled(cx, command);
}

function applySelection(cx: StudioCx, args: Record<string, unknown>): void {
	const select = args['select'];
	if (Array.isArray(select) && select.every((key) => typeof key === 'string')) cx.$selection.set(select as string[]);
}

/** Plays from `from` and stops at `to`, unless the person stops it first */
function playRange(cx: StudioCx, from: number, to: number): void {
	cx.seek(from);
	cx.$playing.set(true);
	const stop = cx.$playhead.listen(({ value }) => {
		if (value < to && cx.$playing.get()) return;
		stop();
		if (cx.$playing.get()) cx.$playing.set(false);
	});
}

/** What keeps an edit from starting: a null once the person is done, or why not after a brief wait */
async function waitUntilFree(cx: StudioCx): Promise<string | null> {
	const deadline = Date.now() + WAIT_FOR_PERSON_MS;
	let reason = busyReason(cx);
	while (reason != null && Date.now() < deadline) {
		await sleep(50);
		reason = busyReason(cx);
	}
	return reason;
}

export function busyReason(cx: StudioCx): string | null {
	if (cx.mcp.isPointerDown) return 'The person is in the middle of a drag in MidiMarble. Try again in a moment.';
	if (cx.$confirmPrompt.get() != null || cx.$closePrompt.get() != null) return 'MidiMarble is waiting for the person to answer a question. Try again in a moment.';
	if (cx.sources.$midiImport.get() != null) return 'The person has the Import Song sheet open. Try again in a moment.';
	return null;
}

/** Waits until the project stopped changing and the run matches it, so a reply reports the edit it answers */
export async function settled(cx: StudioCx): Promise<void> {
	const deadline = Date.now() + SETTLE_LIMIT_MS;
	let revision = cx.project?.revision;
	let since = Date.now();
	while (Date.now() < deadline) {
		await sleep(25);
		const current = cx.project?.revision;
		if (current !== revision) {
			revision = current;
			since = Date.now();
		}
		const isRunCurrent = cx.project == null || cx.simulation.$result.get()?.revision === current;
		const isAssistFree = cx.$compose.get()?.assist.isReplacing !== true;
		if (isRunCurrent && isAssistFree && Date.now() - since >= SETTLE_MS) return;
		if (cx.$confirmPrompt.get() != null || cx.$closePrompt.get() != null) return;
	}
}

/** Creates the package's agent folder on first agent use */
async function agentFolder(cx: StudioCx): Promise<string | null> {
	const path = cx.$path.get();
	const project = cx.project;
	if (path == null || project == null) return null;
	if (!isTauri()) return `${path}/agent`;
	const result = await specta.commands.agentFolderEnsure(path, project.title);
	return result.status === 'ok' ? result.data : null;
}

function parseObject(json: string): Record<string, unknown> {
	try {
		const value: unknown = JSON.parse(json);
		return value != null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
	} catch {
		throw new Error('manifest.json is not valid JSON');
	}
}

function text(cx: StudioCx, value: unknown): TToolReply {
	return { content: [{ type: 'text', text: JSON.stringify(value) }], isError: false, packagePath: cx.$path.get() };
}

function fail(cx: StudioCx, message: string): TToolReply {
	return { content: [{ type: 'text', text: message }], isError: true, packagePath: cx.$path.get() };
}

function noProject(cx: StudioCx): TToolReply {
	return fail(cx, 'No project is open. Call add_song, or run_command with file.new or file.open.');
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(isDone: () => boolean, limitMs: number): Promise<void> {
	const deadline = Date.now() + limitMs;
	while (!isDone() && Date.now() < deadline) await sleep(25);
}
