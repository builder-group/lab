import { isTauri } from '@tauri-apps/api/core';
import { z } from 'zod';
import { host, songFileKind, specta } from '@/environment';
import { addWallTextCommands, frameHeightOnWall, previewPointToWall, titleStyles, withTitleStyle, type TTitleStyle } from '@/modules/film';
import { defaultTitleColor, filmFileName, addShotCommands, shotKinds, STARTER_PACK, STARTER_PACK_ID, toItemId, songDisplayName } from '@/modules/scene';
import { framingProblemAt, patternSpan } from '@/modules/building';
import { addedPacks, library } from '@/modules/library';
import { createProject, isPatternGroup, type TProjectTheme, CAMERA_KEY, parseDecorKey, parseHitKey, parseLightKey, SONG_KEY, WALL_KEY, toShotKey } from '@/modules/project';
import type { StudioCx, TAgentStepNotice, TCommand, TCommandId } from '@/modules/studio';
import { editPresenceLabel } from './agent-presence';
import { hitReport, projectState, resolveSelection } from './mcp-state';
import { builtInSkinIds, expandCommands, type TAgentCommand } from './project-commands';

// What each MCP tool does in the app. Edits go through the same `execute` a person's do, inside one named Undo step.

export interface TToolReply {
	content: ({ type: 'text'; text: string } | { type: 'imagePath'; path: string })[];
	isError: boolean;
	/** The project whose `agent/runs/` logs this call */
	packagePath: string | null;
}

const WAIT_FOR_PERSON_MS = 2000;
const PERMISSION_WAIT_MS = 5000;
const SETTLE_MS = 300;
const SETTLE_LIMIT_MS = 8000;
const EXPORT_WAIT_MS = 15_000;
const DRAFT_WIDTH = 540;
const BLENDER_WIDTH = 1280;
const PROJECT_EXECUTE = 'project.execute';
const EDIT_SELECT = 'edit.select';
const REMOVE_PACK = 'film.removePack';

/** Commands that ask a person through a panel, with what they need instead */
const PANEL_COMMANDS: Partial<Record<TCommandId, string>> = {
	'file.open': 'args.path, the .marble package to open',
	'file.saveAs': 'args.path, where to save',
	'file.importMidi': 'the add_song tool',
	'file.replaceSong': 'the add_song tool',
	'file.export': 'the export_film tool',
	'film.exportPack': 'args.path, plus name and either theme or items',
	'film.addText': 'args.text, and style, at, color, in and out if wanted',
	'camera.addShot': 'args.time, kind, distance and hold if wanted',
	'marble.speed': 'args.value, Gravity from 0.05 to 2'
};

/** Rows for the person: they change or copy how agents reach the app, and an agent could cut itself off with one */
const PERSON_COMMANDS = new Set<TCommandId>(['help.connectClaude', 'help.connectCodex', 'help.copyMcpCommand']);

/** Commands an agent can start while nothing else may run */
const WHILE_BUSY = new Set<string>(['build.stop']);

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
				workspace: cx.$workspace.get(),
				selection: resolveSelection(project, cx.simulation.$result.get(), cx.$selection.get()),
				building: cx.assist.$building.get(),
				lastBuild: cx.assist.$lastBuild.get(),
				problems: cx.simulation.$problems.get(),
				playhead: cx.$playhead.get(),
				isPlaying: cx.$playing.get(),
				agentFolder: await agentFolder(cx),
				packThemes: addedPacks.get().flatMap((pack) => pack.themes.filter((theme) => !project.film.themes.some((item) => item.id === theme.id)).map((theme) => ({ id: theme.id, name: theme.name, pack: pack.name }))),
				references: { images: references.images.length, text: references.text }
			})
		);
	},

	list_commands: async (cx, args) => {
		const { filter } = z.object({ filter: z.string().optional() }).parse(args);
		const words = (filter ?? '').toLowerCase().split(/\s+/).filter(Boolean);
		const listed = cx.commands.all
			.filter((command) => !PERSON_COMMANDS.has(command.id))
			.filter((command) => words.every((word) => `${command.id} ${command.title} ${command.keywords ?? ''}`.toLowerCase().includes(word)))
			.map((command) => ({
				id: command.id,
				title: command.title,
				section: command.section,
				canRun: canRun(cx, command),
				...(!canRun(cx, command) && command.whyDisabled != null ? { why: command.whyDisabled } : {}),
				...(command.isChecked != null ? { isOn: command.isChecked(cx) === true } : {}),
				...(PANEL_COMMANDS[command.id] != null ? { needs: PANEL_COMMANDS[command.id] } : {})
			}));
		const libraryItems = cx.library.$projectItems.get().flatMap((item) => (item.manifest?.role === 'skin' ? [{ id: item.id, label: item.manifest.label, fits: item.manifest.pieceType ?? 'any piece' }] : []));
		return text(cx, {
			commands: [
				{ id: PROJECT_EXECUTE, title: 'Project commands with parameters: see the building-a-track guide' },
				{ id: EDIT_SELECT, title: 'Select by keys: args.select, such as hit keys, piece IDs, wall or light:key' },
				{ id: REMOVE_PACK, title: 'Remove an added Pack: args.name. Projects keep what they use from it' },
				...listed
			],
			// What applySkin takes: built-in skins by element, and the project's own
			skins: { builtIn: builtInSkinIds(), library: libraryItems }
		});
	},

	run_command: async (cx, args) => {
		const { id, args: commandArgs = {} } = SRunCommand.parse(args);
		const busy = WHILE_BUSY.has(id) ? null : await waitUntilFree(cx);
		if (busy != null) return fail(cx, busy);
		if (id === PROJECT_EXECUTE) return runProjectCommands(cx, commandArgs);
		const badKeys = unknownSelection(cx, commandArgs);
		if (badKeys != null) return fail(cx, badKeys);
		if (id === EDIT_SELECT) {
			if (!Array.isArray(commandArgs['select'])) return fail(cx, `${EDIT_SELECT} needs args.select, a list of keys`);
			applySelection(cx, commandArgs);
			return text(cx, { selection: cx.$selection.get(), changed: false });
		}
		if (id === REMOVE_PACK) return removePack(cx, commandArgs);
		const command = cx.commands.all.find((item) => item.id === id);
		if (command == null) return fail(cx, `There is no command called ${id}. Use list_commands to find one.`);
		if (PERSON_COMMANDS.has(command.id)) return fail(cx, `${command.title} is for the person, in the Agent menu.`);
		const special = ARGUMENT_COMMANDS[command.id];
		if (special == null && PANEL_COMMANDS[command.id] != null) return fail(cx, `${command.title} asks a person through a panel. Use ${PANEL_COMMANDS[command.id] ?? ''}.`);
		// Build Track with wait: false answers at once; get_state shows how far it is
		const from = command.id === 'build.track' ? buildFrom(cx, commandArgs) : null;
		if (typeof from === 'string') return fail(cx, from);
		if (command.id === 'build.track' && commandArgs['gapPiece'] != null && gapPreference(commandArgs) == null) return fail(cx, `gapPiece is rail, switchback or chain, not ${String(commandArgs['gapPiece'])}.`);
		if (command.id === 'build.track' && commandArgs['wait'] === false) {
			if (from == null && !canRun(cx, command)) return fail(cx, buildRefusal(cx));
			// The call answers at once, but the agent is still at work until the build ends
			const end = cx.mcp.presence.begin('Building Track');
			void editStep(cx, command.title, () => startBuild(cx, command, from ?? undefined, gapPreference(commandArgs))).finally(end);
			await waitFor(() => cx.assist.isBuilding, 1500);
			return text(cx, { started: true, note: 'Building. get_state shows building and, when done, lastBuild; build.stop stops it.' });
		}
		// What Undo and Redo take back, named beforehand since the step is gone afterward
		const undoName = command.id === 'edit.undo' ? (cx.undoLabel ?? 'a step of your own') : command.id === 'edit.redo' ? (cx.redoLabel ?? 'a step of your own') : null;
		const history = cx.$history.get();
		const canStep = command.id === 'edit.undo' ? (history?.past.length ?? 0) > 0 : command.id === 'edit.redo' ? (history?.future.length ?? 0) > 0 : false;
		return editStep(
			cx,
			command.title,
			async () => {
				applySelection(cx, commandArgs);
				if (special != null) return special(cx, commandArgs);
				if (command.id === 'build.track') {
					if (from == null && !canRun(cx, command)) throw new Error(buildRefusal(cx));
					return startBuild(cx, command, from ?? undefined, gapPreference(commandArgs));
				}
				return invoke(cx, command);
			},
			undoName != null ? (canStep ? { [command.id === 'edit.undo' ? 'undid' : 'redid']: undoName } : { notices: [`Nothing to ${command.id === 'edit.undo' ? 'undo' : 'redo'}.`] }) : {},
			command.id === 'file.save' || command.id === 'file.saveAs' ? () => ({ saved: cx.$path.get(), title: cx.project?.title ?? null }) : undefined
		);
	},

	add_song: async (cx, args) => {
		const { path } = z.object({ path: SPath }).parse(args);
		const name = path.split('/').pop() ?? path;
		if (songFileKind(name) == null) return fail(cx, `${name} isn't a song. Use a MIDI file or a recording.`);
		const busy = await waitUntilFree(cx);
		if (busy != null) return fail(cx, busy);
		if (cx.project == null && !(await cx.openTemporary(createProject({ title: name.replace(/\.[^.]+$/, '') })))) return fail(cx, "A new project couldn't be made for the song.");
		// A file in a protected folder can wait on a macOS dialog, and nothing else says so
		const stalled = setTimeout(() => cx.notify(`Still reading ${name}. macOS may be asking for permission; check for a dialog.`), PERMISSION_WAIT_MS);
		return editStep(cx, 'Add Song', async () => {
			try {
				await cx.importSongFile({ name, path });
			} finally {
				clearTimeout(stalled);
			}
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
		const [isFrameOk, frameErr, frame] = await cx.film.renderStill(time, quality === 'blender' ? BLENDER_WIDTH : DRAFT_WIDTH);
		if (!isFrameOk) return fail(cx, frameErr.message);
		const framing = framingProblemAt(cx.simulation.$problems.get(), time);
		const words = `${frame.width} × ${frame.height} at ${time} s, ${Math.round(frame.renderMs)} ms${framing != null ? `. ${framing.title} here: this frame may not show it` : ''}`;
		return { content: [{ type: 'imagePath', path: frame.path }, { type: 'text', text: words }], isError: false, packagePath: cx.$path.get() };
	},

	play_range: async (cx, args) => {
		const { from, to } = z.object({ from: z.number().min(0), to: z.number() }).parse(args);
		if (cx.project == null) return noProject(cx);
		if (to <= from) return fail(cx, 'play_range needs to after from');
		playRange(cx, from, to);
		return text(cx, { playing: { from, to } });
	},

	export_film: async (cx, args) => {
		const { quality, path } = z.object({ quality: z.enum(['draft', 'final']).optional(), path: SPath.optional() }).parse(args);
		if (cx.project == null) return noProject(cx);
		if (quality != null && !cx.filmExport.isRunning) {
			await settled(cx);
			cx.filmExport.updateSettings({ preset: quality, ...(path != null ? { fileName: filmFileName(path), chosenPath: path } : {}) });
			void cx.filmExport.start();
			await sleep(50);
		}
		const deadline = Date.now() + EXPORT_WAIT_MS;
		while (cx.filmExport.isRunning && quality != null && Date.now() < deadline) await sleep(250);
		const job = cx.filmExport.$job.get();
		if (job.phase === 'failed') return fail(cx, job.error ?? 'The export failed');
		return text(cx, {
			phase: job.phase,
			...(job.frames != null ? { frame: job.frame, frames: job.frames } : {}),
			...(job.progress != null ? { progress: Math.round(job.progress * 100) / 100 } : {}),
			...(job.result != null ? { result: job.result } : {}),
			...(cx.filmExport.isRunning ? { note: 'Still exporting. Call export_film without quality to check again.' } : {})
		});
	},

	add_asset: async (cx, args) => {
		const given = z.object({ path: SPath, role: z.enum(['skin', 'decor', 'decoration']).optional(), name: z.string().regex(/\S/).optional(), pieceType: z.string().optional(), pack: z.string().regex(/\S/).optional() }).parse(args);
		const { path, pack } = given;
		const packagePath = cx.$path.get();
		if (packagePath == null) return noProject(cx);
		const isBlendFile = path.toLowerCase().endsWith('.blend');
		const folder = isBlendFile ? path.slice(0, path.lastIndexOf('/')) : path;
		const manifestUrl = host.pickedFileUrl({ name: 'manifest.json', path: `${folder}/manifest.json` });
		const [isReadOk, , bytes] = manifestUrl != null ? await host.readFile(manifestUrl) : ([false, null, null] as const);
		const written = isReadOk ? parseObject(new TextDecoder().decode(bytes)) : {};
		// What isn't given comes from the manifest
		const name = given.name ?? (typeof written['label'] === 'string' ? written['label'] : null);
		const writtenRole = written['role'] === 'skin' || written['role'] === 'decoration' ? written['role'] : null;
		const role = given.role === 'decor' ? 'decoration' : (given.role ?? writtenRole);
		const pieceType = given.pieceType ?? (typeof written['pieceType'] === 'string' ? written['pieceType'] : undefined);
		if (name == null) return fail(cx, 'add_asset needs a name, or a manifest.json beside the file with a label.');
		if (role == null) return fail(cx, "add_asset needs a role, skin or decor, or a manifest.json beside the file with a role.");
		if (role === 'skin' && pieceType == null) return fail(cx, 'A skin needs a pieceType, the piece it fits, such as platform or marble.');
		const manifest = { $schema: 'marble-asset@1', id: toItemId(name), ...written, label: name, role, ...(pieceType != null ? { pieceType } : {}) };
		const [isAddedOk, addedErr, item] = await library.addAsset(packagePath, path, JSON.stringify(manifest), pack != null ? { packId: toItemId(pack), packName: pack, version: '1.0' } : undefined);
		if (!isAddedOk) return fail(cx, addedErr.message);
		await cx.library.refresh();
		cx.notify(`Agent: ${name} added to the project`);
		return text(cx, { id: item.id, how: role === 'skin' ? `project.execute with { type: 'applySkin', assetId: '${item.id}', pieceType: '${pieceType ?? ''}' }` : `project.execute with { type: 'placeDecor', source: 'assets/${item.id}/asset.blend', at: { x, y } } or scatterDecor` });
	}
};

/** What Rust's `tools/list` offers and forwards here */
export const TOOL_NAMES = Object.keys(TOOLS);

/** Commands that take their panel's answers as arguments, or that answer only when their work is done */
const ARGUMENT_COMMANDS: Partial<Record<TCommandId, (cx: StudioCx, args: Record<string, unknown>) => Promise<void>>> = {
	// Like build.track, this answers when the build is done, so the reply reports the finished track
	'build.rebuildFrom': async (cx) => {
		const stopEpoch = cx.mcp.presence.stopEpoch;
		openTrack(cx);
		const from = cx.assist.rebuildTarget;
		if (from == null) throw new Error('Rebuild From Here needs a hit, or a piece that plays one: select it with args.select.');
		if (cx.mcp.presence.stopEpoch === stopEpoch) await cx.assist.buildTrack(from);
	},
	'film.addText': async (cx, args) => {
		addTitle(cx, args);
	},
	'camera.addShot': async (cx, args) => {
		const { time, kind, distance, hold } = SShotArgs.parse(args);
		const project = cx.project;
		if (project == null) return;
		const { commands, shotId } = addShotCommands(project, time ?? cx.$playhead.get(), undefined, { ...(kind != null ? { kind } : {}), ...(distance != null ? { distance } : {}), ...(hold != null ? { hold } : {}) });
		cx.$workspace.set('film');
		if (cx.execute(commands)) cx.$selection.set([toShotKey(shotId)]);
	},
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
	'film.addPack': async (cx, args) => {
		const { path, name } = z.object({ path: SPath.optional(), name: z.string().optional() }).parse(args);
		if (name?.toLowerCase() === STARTER_PACK.name.toLowerCase()) {
			cx.notify('The Starter Pack is always there; nothing to add.');
			return;
		}
		const named = name != null ? cx.library.$bundledPacks.get().find((pack) => pack.name.toLowerCase() === name.toLowerCase()) : null;
		if (name != null && named == null) throw new Error(`There is no Pack called ${name} in the app`);
		const from = named?.path ?? path;
		if (from == null) {
			cx.library.$isPacksOpen.set(true);
			return;
		}
		const [isAddedOk, addedErr, pack] = await cx.library.addPack(from);
		if (!isAddedOk) throw addedErr;
		if (pack != null && pack.themes.length > 0) cx.notify(`Its themes are ${pack.themes.map((theme) => `${theme.name} (${theme.id})`).join(', ')}. Apply one with { type: 'updateFilm', film: { theme: id } }.`);
	},
	'film.restartBlender': async (cx) => {
		await cx.film.restart();
		const error = cx.film.$error.get();
		if (error != null) throw new Error(`Blender did not come back: ${error}`);
		cx.notify(cx.film.$status.get() === 'idle' ? 'Blender stopped; it starts again with the next preview' : 'Blender restarted');
	},
	'marble.speed': async (cx, args) => {
		const { value } = z.object({ value: z.number().min(0.05).max(2) }).parse(args);
		cx.execute([{ type: 'updateProject', patch: { gravity: value } }]);
	},
	'film.exportPack': async (cx, args) => {
		const { path, name, description, author, theme, items } = z.object({ path: SPath, name: z.string(), description: z.string().optional(), author: z.string().optional(), theme: z.boolean().optional(), items: z.array(z.string()).optional() }).parse(args);
		const [isExportedOk, exportedErr] = await cx.library.exportPack({ name, ...(description != null ? { description } : {}), ...(author != null ? { author } : {}), includesTheme: theme === true, assetIds: items ?? [] }, path);
		if (!isExportedOk) throw exportedErr;
	}
};

const SShotArgs = z.object({
	time: z.number().min(0).optional(),
	kind: z.enum(shotKinds.map((item) => item.kind) as [string, ...string[]]).optional() as z.ZodOptional<z.ZodType<(typeof shotKinds)[number]['kind']>>,
	distance: z.number().positive().optional(),
	hold: z.number().nonnegative().optional()
});

const STitleArgs = z.object({
	text: z.string().regex(/\S/, 'A title needs words').optional(),
	style: z.enum(titleStyles.map((item) => item.style) as [TTitleStyle, ...TTitleStyle[]]).optional(),
	at: z.strictObject({ x: z.number(), y: z.number() }).optional(),
	color: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'A color is like #1d1d1f').optional(),
	in: z.number().nonnegative().optional(),
	out: z.number().nonnegative().optional()
});

/** A title with its words, as Add Title then typing makes one; at the frame's middle at the playhead unless `at` says */
function addTitle(cx: StudioCx, args: Record<string, unknown>): void {
	const { text, style = 'wall', at, color, in: start, out } = STitleArgs.parse(args);
	const project = cx.project;
	if (project == null) throw new Error('No project is open.');
	const result = cx.simulation.$result.get();
	const playhead = cx.$playhead.get();
	const frameHeight = frameHeightOnWall(project, result, playhead);
	const point = at ?? previewPointToWall(project, result, playhead, 0.5, 0.5);
	const { title } = addWallTextCommands(project, point, { color: color ?? defaultTitleColor(project.film), frameHeight, ...(text != null ? { text } : {}) });
	const styled = withTitleStyle(title, style, { frameHeight, playhead, end: project.length, songName: songDisplayName(project), aspect: project.format.width / project.format.height });
	const added = { ...styled, name: styled.text, ...(start != null ? { in: start } : {}), ...(out != null ? { out } : {}) };
	cx.$workspace.set('film');
	if (cx.execute([{ type: 'updateFilm', film: { titles: [...project.film.titles, added] } }])) cx.$selection.set([added.id]);
}

/** Remove Pack by name, which the Packs… sheet does for a person */
async function removePack(cx: StudioCx, args: Record<string, unknown>): Promise<TToolReply> {
	const { name } = z.object({ name: z.string() }).parse(args);
	const pack = addedPacks.get().find((item) => item.name.toLowerCase() === name.toLowerCase());
	if (pack?.id === STARTER_PACK_ID) return fail(cx, "The Starter Pack can't be removed.");
	if (pack == null) return fail(cx, `No Pack called ${name} is added. Added: ${addedPacks.get().map((item) => item.name).join(', ') || 'none'}.`);
	await cx.library.removePack(pack);
	return text(cx, { removed: pack.name, changed: false });
}

/** The themes of added Packs that `commands` apply, as a project stores them: their items copied in */
async function packThemesToApply(cx: StudioCx, commands: readonly { type: string }[]): Promise<TProjectTheme[]> {
	const wanted = commands.flatMap((command) => (command.type === 'updateFilm' ? [(command as { film?: { theme?: unknown } }).film?.theme] : []));
	const themes: TProjectTheme[] = [];
	for (const pack of addedPacks.get()) {
		for (const theme of pack.themes) {
			if (!wanted.includes(theme.id) || cx.project?.film.themes.some((item) => item.id === theme.id) === true) continue;
			const ready = await cx.library.packThemeInProject(pack, theme);
			if (ready != null) themes.push(ready);
		}
	}
	return themes;
}

const SApplyPattern = z.strictObject({
	type: z.literal('applyPattern'),
	marbleId: z.string(),
	from: z.number(),
	to: z.number(),
	kind: z.enum(['zigzag', 'staircase', 'longRail']),
	width: z.number().positive().optional(),
	bounce: z.number().min(0).max(1).optional(),
	maxTilt: z.number().positive().optional(),
	dryRun: z.boolean().optional()
});

/** A Pattern over a range of a marble's row, as one Undo step; `dryRun` changes nothing and answers the same (prototype) */
async function runApplyPattern(cx: StudioCx, command: unknown, label: string | undefined): Promise<TToolReply> {
	const parsed = SApplyPattern.safeParse(command);
	if (!parsed.success) return fail(cx, `applyPattern: ${parsed.error.issues[0]?.path.join('.') ?? ''} ${parsed.error.issues[0]?.message ?? ''}. Example: { type: 'applyPattern', marbleId, from: 2.1, to: 8.4, kind: 'zigzag', width: 0.14, bounce: 0.5, dryRun: true }`);
	const { marbleId, from, to, kind, width, bounce, maxTilt, dryRun } = parsed.data;
	const project = cx.project;
	if (project == null) return noProject(cx);
	if (!project.marbles.some((marble) => marble.id === marbleId)) return fail(cx, `No marble has marble ${marbleId}. get_state lists them.`);
	openTrack(cx);
	const stop = cx.mcp.presence.stopEpoch;
	const settings = { ...(width != null ? { width } : {}), ...(bounce != null ? { bounce } : {}), ...(maxTilt != null ? { maxTilt } : {}) };
	const patternMarble = project.marbles.find((marble) => marble.id === marbleId);
	const existing = project.track.groups.filter(isPatternGroup).find((group) => {
		const span = patternMarble == null ? null : patternSpan(patternMarble, group);
		return group.marbleId === marbleId && group.pattern.kind === kind && span != null && Math.abs(span.from - from) < 1e-3 && Math.abs(span.to - to) < 1e-3;
	});
	const target = { marbleId, from, to, ...(existing != null ? { group: existing } : {}) };
	const report = (answer: Awaited<ReturnType<typeof cx.patterns.apply>>): Record<string, unknown> =>
		answer == null
			? { stopped: true }
			: { group: answer.groupId != null ? { id: answer.groupId, name: answer.name } : null, problems: answer.problems, ...(answer.refusal != null ? { refusal: answer.refusal } : {}), later: answer.later, ...(answer.notes.length > 0 ? { notes: answer.notes } : {}), laterLateHits: answer.laterLateHits, otherMarbleTouches: answer.otherMarbleTouches, measures: answer.measures };
	if (dryRun === true) {
		// A step that edits nothing, so Stop reaches it and no Undo step comes of it
		let answer: Awaited<ReturnType<typeof cx.patterns.dryRun>> = null;
		await cx.runAgentStep('Agent: Try Pattern', async () => {
			answer = await cx.patterns.dryRun(target, kind, settings);
		});
		return text(cx, { changed: false, dryRun: true, ...report(answer) });
	}
	if (cx.mcp.presence.stopEpoch !== stop) return text(cx, { changed: false, selection: cx.$selection.get() });
	cx.mcp.presence.relabel(label ?? `Fitting ${kind === 'longRail' ? 'Long Rail' : kind === 'zigzag' ? 'Zigzag' : 'Staircase'}`);
	let reply: Record<string, unknown> = {};
	return editStep(cx, label ?? 'Apply Pattern', async () => {
		reply = report(await cx.patterns.apply(target, kind, settings));
	}, {}, () => reply);
}

async function runProjectCommands(cx: StudioCx, args: Record<string, unknown>): Promise<TToolReply> {
	const { commands, label } = z.object({ commands: z.array(z.looseObject({ type: z.string() })).min(1), label: z.string().optional() }).parse(args);
	if (commands.some((command) => command.type === 'applyPattern')) {
		if (commands.length > 1) return fail(cx, 'applyPattern takes its own project.execute call, since it fits against the real run.');
		return runApplyPattern(cx, commands[0], label);
	}
	const project = cx.project;
	if (project == null) return noProject(cx);
	const stopEpoch = cx.mcp.presence.stopEpoch;
	await settled(cx);
	const items = cx.library.$projectItems.get();
	const packThemes = await packThemesToApply(cx, commands);
	// Stop came while waiting for the run: this edit never starts, and McpCx's reply says why
	if (cx.mcp.presence.stopEpoch !== stopEpoch) return text(cx, { changed: false, selection: cx.$selection.get(), ...hitReport(cx.simulation.$problems.get()) });
	const [isExpandedOk, expandedErr, expanded] = expandCommands(project, cx.simulation.$result.get(), items, commands as unknown as TAgentCommand[], packThemes, cx.film.$blenderObjects.get());
	if (!isExpandedOk) return fail(cx, expandedErr.message);
	if (!expanded.isChange) {
		applySelection(cx, args);
		return text(cx, { changed: false, selection: cx.$selection.get(), ...hitReport(cx.simulation.$problems.get()), notices: ['Those commands leave the project as it was, so there is no Undo step.'] });
	}
	const created = expanded.createdIds.length === 1 ? expanded.commands.find((command) => command.type === 'addPiece' && command.piece.id === expanded.createdIds[0]) : undefined;
	cx.mcp.presence.relabel(editPresenceLabel(label, expanded.summary, created?.type === 'addPiece' ? (created.piece.name ?? null) : null));
	return editStep(cx, label ?? expanded.summary ?? 'Edit', () => {
		if (!cx.execute(expanded.commands)) return;
		if (expanded.createdIds.length > 0) cx.$selection.set(expanded.createdIds);
		applySelection(cx, args);
	}, { notices: expanded.notices });
}

/** Runs `work` as one Undo step named "Agent: …", waits for the run to catch up and answers with the hit summary */
async function editStep(cx: StudioCx, title: string, work: () => Promise<void> | void, extra: { notices?: string[]; undid?: string; redid?: string } = {}, after?: () => Record<string, unknown>): Promise<TToolReply> {
	const label = `Agent: ${title.replace(/…$/, '')}`;
	const outcome = await cx.runAgentStep(label, async () => {
		await work();
		await settled(cx);
	});
	const project = cx.project;
	const errors = outcome.notices.filter((notice: TAgentStepNotice) => notice.tone === 'error').map((notice: TAgentStepNotice) => notice.message);
	const notices = [...outcome.notices.filter((notice: TAgentStepNotice) => notice.tone !== 'error').map((notice: TAgentStepNotice) => notice.message), ...(extra.notices ?? [])];
	const reply = {
		// Whether this call changed the project: an Undo step made, or one taken back or redone. A reply with only a notice changed nothing
		changed: outcome.stepName != null || extra.undid != null || extra.redid != null,
		...(outcome.stepName != null ? { undoStep: outcome.stepName } : {}),
		...(extra.undid != null ? { undid: extra.undid } : {}),
		...(extra.redid != null ? { redid: extra.redid } : {}),
		...after?.(),
		selection: cx.$selection.get(),
		...(project != null ? hitReport(cx.simulation.$problems.get()) : {}),
		...(notices.length > 0 ? { notices } : {}),
		...(errors.length > 0 ? { errors } : {})
	};
	return { ...text(cx, reply), isError: errors.length > 0 };
}

/** Build Track, which answers when it is done: opens Track first, as `invoke` does */
async function startBuild(cx: StudioCx, command: TCommand, from?: { marbleId: string; hitId: string }, gapPiece?: 'rail' | 'switchback' | 'chain'): Promise<void> {
	const stopEpoch = cx.mcp.presence.stopEpoch;
	openTrack(cx);
	if (cx.mcp.presence.stopEpoch === stopEpoch) await cx.assist.buildTrack(from, gapPiece);
}

/** Shows Track, for the person watching; Assist and Patterns don't wait for its canvas */
function openTrack(cx: StudioCx): void {
	cx.$workspace.set('track');
}

/** `gapPiece` of `build.track`: the piece tried first across a long gap */
function gapPreference(args: Record<string, unknown>): 'rail' | 'switchback' | 'chain' | undefined {
	const piece = args['gapPiece'];
	return piece === 'rail' || piece === 'switchback' || piece === 'chain' ? piece : undefined;
}

/** `from` of `build.track`: the hit Rebuild From Here starts at, null without one, or why it can't */
function buildFrom(cx: StudioCx, args: Record<string, unknown>): { marbleId: string; hitId: string } | string | null {
	const hitId = args['from'];
	if (hitId == null) return null;
	const marble = cx.project?.marbles.find((item) => item.hits.some((hit) => hit.id === hitId));
	if (marble == null || typeof hitId !== 'string') return `There is no hit called ${String(hitId)}. get_state lists every marble's hits.`;
	if (cx.assist.isBuilding) return buildRefusal(cx);
	return { marbleId: marble.id, hitId };
}

function buildRefusal(cx: StudioCx): string {
	if (cx.assist.isBuilding) return 'Build Track is already running. get_state shows how far it is; build.stop stops it.';
	if (cx.project?.marbles.some((marble) => marble.hits.length > 0) !== true) return 'Build Track needs notes. Call add_song first.';
	return 'Every hit already has a platform.';
}

/** Runs a registered command in its workspace, opening that first as the palette does */
async function invoke(cx: StudioCx, command: TCommand): Promise<void> {
	const target = cx.commands.workspaceOf(command);
	if (target != null && cx.$workspace.get() !== target && cx.project != null) {
		cx.$workspace.set(target);
		await waitFor(() => target === 'film' || cx.$trackCx.get() != null, 1500);
		await sleep(50);
	}
	if (!cx.commands.isEnabled(command)) throw new Error(`${command.title} can't run right now. ${command.whyDisabled ?? 'get_state shows the project and selection it would act on.'}`);
	command.run(cx);
}

function canRun(cx: StudioCx, command: TCommand): boolean {
	const target = cx.commands.workspaceOf(command);
	// A command of the other workspace opens it first; only then can it say whether it applies
	return target != null && target !== cx.$workspace.get() ? cx.project != null : cx.commands.isEnabled(command);
}

/** `args.select`'s keys the project doesn't know, in words, so a bad key is never a silent success */
function unknownSelection(cx: StudioCx, args: Record<string, unknown>): string | null {
	const select = args['select'];
	const project = cx.project;
	if (!Array.isArray(select) || project == null) return null;
	const isKnown = (key: unknown): boolean => {
		if (typeof key !== 'string') return false;
		if ([...project.marbles, ...project.track.pieces, ...project.film.titles].some((piece) => piece.id === key)) return true;
		const hit = parseHitKey(key);
		if (hit != null) return project.marbles.some((marble) => marble.id === hit.marbleId && marble.hits.some((item) => item.id === hit.hitId));
		return key === WALL_KEY || key === CAMERA_KEY || key === SONG_KEY || parseLightKey(key) != null || parseDecorKey(key) != null || key.includes(':');
	};
	const bad = select.filter((key) => !isKnown(key));
	return bad.length > 0 ? `Nothing can be selected as ${bad.join(', ')}. Use a piece or marble ID from get_state, a hit key such as hit:marbleId:hitId, wall, light:key, camera or song.` : null;
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
	if (cx.assist.isBuilding) return 'Build Track is running. get_state shows how far it is; build.stop stops it.';
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
		const isAssistFree = !cx.simulation.isSettling && !cx.assist.isAnswering;
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
