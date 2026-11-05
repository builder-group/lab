import { isTauri } from '@tauri-apps/api/core';
import { z } from 'zod';
import { host, songFileKind, specta } from '@/environment';
import { addWallTextCommands, defaultTitleColor, frameHeightOnWall, previewPointToWall, titleStyles, withTitleStyle, type TTitleStyle } from '@/modules/design/design-commands';
import { filmFileName, getRenderPreset } from '@/modules/design/export-estimate';
import { framingProblemAt, preflightExport } from '@/modules/design/export-preflight';
import { addShotCommands, shotKinds } from '@/modules/design/shots';
import type { ComposeCx } from '@/modules/compose/ComposeCx';
import { addedPacks, library, STARTER_PACK, STARTER_PACK_ID, toItemId } from '@/modules/library';
import { createProject, type TProjectTheme } from '@/modules/project';
import { songDisplayName } from '@/modules/design/titles';
import { commands as registry, commandWorkspace, getCommand, isCommandEnabled, type TCommand, type TCommandId } from '@/modules/studio/commands';
import type { StudioCx, TAgentStepNotice } from '@/modules/studio/StudioCx';
import { CAMERA_KEY, parseDecorKey, parseHitKey, parseLightKey, SONG_KEY, WALL_KEY } from '@/modules/studio/selection';
import { toShotKey } from '@/modules/studio/selection';
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
const REMOVE_PACK = 'design.removePack';
/** The export sheet's words for the presets, which `export_film` takes as well as their ids */
const QUALITY_WORDS: Record<string, 'draft' | 'fast' | 'balanced' | 'best'> = { draft: 'draft', fast: 'fast', standard: 'fast', balanced: 'balanced', high: 'balanced', best: 'best' };

/** Commands that ask a person through a panel, with what they need instead */
const PANEL_COMMANDS: Partial<Record<TCommandId, string>> = {
	'file.open': 'args.path, the .marble package to open',
	'file.saveAs': 'args.path, where to save',
	'file.importMidi': 'the add_song tool',
	'file.replaceSong': 'the add_song tool',
	'file.export': 'the export_film tool',
	'design.exportPack': 'args.path, plus name and either theme or items',
	'design.addText': 'args.text, and style, at, color, in and out if wanted',
	'camera.addShot': 'args.time, kind, distance and length if wanted',
	'camera.addWideShot': 'args.time if wanted',
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
		const assist = cx.$compose.get()?.assist;
		return text(
			cx,
			projectState(project, cx.simulation.$result.get(), {
				path: cx.$path.get(),
				workspace: cx.$workspace.get() === 'design' ? 'film' : 'compose',
				selection: resolveSelection(project, cx.simulation.$result.get(), cx.$selection.get()),
				building: assist?.$building.get(),
				lastBuild: assist?.$lastBuild.get(),
				playhead: cx.$playhead.get(),
				isPlaying: cx.$playing.get(),
				agentFolder: await agentFolder(cx),
				packThemes: addedPacks.get().flatMap((pack) => pack.themes.filter((theme) => !project.design.themes.some((item) => item.id === theme.id)).map((theme) => ({ id: theme.id, name: theme.name, pack: pack.name }))),
				references: { images: references.images.length, text: references.text }
			})
		);
	},

	list_commands: async (cx, args) => {
		const { filter } = z.object({ filter: z.string().optional() }).parse(args);
		const words = (filter ?? '').toLowerCase().split(/\s+/).filter(Boolean);
		const listed = registry
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
				{ id: EDIT_SELECT, title: 'Select by keys: args.select, such as hit keys, entity IDs, wall or light:key' },
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
		const command = registry.find((item) => item.id === id);
		if (command == null) return fail(cx, `There is no command called ${id}. Use list_commands to find one.`);
		if (PERSON_COMMANDS.has(command.id)) return fail(cx, `${command.title} is for the person, in the Agent menu.`);
		const special = ARGUMENT_COMMANDS[command.id];
		if (special == null && PANEL_COMMANDS[command.id] != null) return fail(cx, `${command.title} asks a person through a panel. Use ${PANEL_COMMANDS[command.id] ?? ''}.`);
		// Build Track with wait: false answers at once; get_state shows how far it is
		const from = command.id === 'build.track' ? buildFrom(cx, commandArgs) : null;
		if (typeof from === 'string') return fail(cx, from);
		if (command.id === 'build.track' && commandArgs['gapPiece'] != null && gapPreference(commandArgs) == null) return fail(cx, `gapPiece is rail or switchback, not ${String(commandArgs['gapPiece'])}.`);
		if (command.id === 'build.track' && commandArgs['wait'] === false) {
			if (from == null && !canRun(cx, command)) return fail(cx, buildRefusal(cx));
			// The call answers at once, but the agent is still at work until the build ends
			const end = cx.mcp.presence.begin('Building Track');
			void editStep(cx, command.title, () => startBuild(cx, command, from ?? undefined, gapPreference(commandArgs))).finally(end);
			await waitFor(() => cx.$compose.get()?.assist.isBuilding === true, 1500);
			return text(cx, { started: true, note: 'Building. get_state shows building and, when done, lastBuild; build.stop stops it.' });
		}
		// What Undo and Redo take back, named beforehand since the step is gone afterwards
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
		const [isFrameOk, frameErr, frame] = await cx.design.renderStill(time, quality === 'blender' ? BLENDER_WIDTH : DRAFT_WIDTH);
		if (!isFrameOk) return fail(cx, frameErr.message);
		const framing = framingProblemAt(preflightExport(cx.project, cx.simulation.$result.get()), time);
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
		const { quality: word, path } = z.object({ quality: z.enum(['draft', 'fast', 'standard', 'balanced', 'high', 'best']).optional(), path: SPath.optional() }).parse(args);
		const quality = word != null ? QUALITY_WORDS[word] : undefined;
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

/** Commands that take their panel's answers as arguments, or that answer only when their work is done */
const ARGUMENT_COMMANDS: Partial<Record<TCommandId, (cx: StudioCx, args: Record<string, unknown>) => Promise<void>>> = {
	// Like build.track, this answers when the build is done, so the reply reports the finished track
	'build.rebuildFrom': async (cx) => {
		const stopEpoch = cx.mcp.presence.stopEpoch;
		const compose = await openCompose(cx, 'Rebuild From Here');
		const from = compose.assist.rebuildTarget;
		if (from == null) throw new Error('Rebuild From Here needs a hit, or a piece that plays one: select it with args.select.');
		if (cx.mcp.presence.stopEpoch === stopEpoch) await compose.assist.buildTrack(from);
	},
	'design.addText': async (cx, args) => {
		addTitle(cx, args);
	},
	'camera.addShot': async (cx, args) => {
		const { time, kind, distance, length } = SShotArgs.parse(args);
		const project = cx.project;
		if (project == null) return;
		const { commands, shotId } = addShotCommands(project, time ?? cx.$playhead.get(), undefined, { ...(kind != null ? { kind } : {}), ...(distance != null ? { distance } : {}), ...(length != null ? { length } : {}) });
		cx.$workspace.set('design');
		if (cx.execute(commands)) cx.$selection.set([toShotKey(shotId)]);
	},
	'camera.addWideShot': async (cx, args) => {
		const { time } = z.object({ time: z.number().min(0).optional() }).parse(args);
		if (time != null) cx.seek(time);
		await invoke(cx, getCommand('camera.addWideShot'));
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
	'design.addPack': async (cx, args) => {
		const { path, name } = z.object({ path: SPath.optional(), name: z.string().optional() }).parse(args);
		if (name?.toLowerCase() === STARTER_PACK.name.toLowerCase()) {
			cx.notify('The Starter Pack is always there; nothing to add.');
			return;
		}
		const named = name != null ? cx.library.$bundledPacks.get().find((pack) => pack.name.toLowerCase() === name.toLowerCase()) : null;
		if (name != null && named == null) throw new Error(`There is no Pack called ${name} in the app`);
		const from = named?.path ?? path;
		if (from == null) {
			cx.library.$isAddPackOpen.set(true);
			return;
		}
		const [isAddedOk, addedErr, pack] = await cx.library.addPack(from);
		if (!isAddedOk) throw addedErr;
		if (pack != null && pack.themes.length > 0) cx.notify(`Its themes are ${pack.themes.map((theme) => `${theme.name} (${theme.id})`).join(', ')}. Apply one with { type: 'setDesign', design: { theme: id } }.`);
	},
	'design.restartBlender': async (cx) => {
		await cx.design.restart();
		const error = cx.design.$error.get();
		if (error != null) throw new Error(`Blender did not come back: ${error}`);
		cx.notify(cx.design.$status.get() === 'idle' ? 'Blender stopped; it starts again with the next preview' : 'Blender restarted');
	},
	'marble.speed': async (cx, args) => {
		const { value } = z.object({ value: z.number().min(0.05).max(2) }).parse(args);
		cx.execute([{ type: 'setPhysics', physics: { gravityScale: value } }]);
	},
	'design.exportPack': async (cx, args) => {
		const { path, name, description, author, theme, items } = z.object({ path: SPath, name: z.string(), description: z.string().optional(), author: z.string().optional(), theme: z.boolean().optional(), items: z.array(z.string()).optional() }).parse(args);
		const [isExportedOk, exportedErr] = await cx.library.exportPack({ name, ...(description != null ? { description } : {}), ...(author != null ? { author } : {}), includesTheme: theme === true, assetIds: items ?? [] }, path);
		if (!isExportedOk) throw exportedErr;
	}
};

const SShotArgs = z.object({
	time: z.number().min(0).optional(),
	kind: z.enum(shotKinds.map((item) => item.kind) as [string, ...string[]]).optional() as z.ZodOptional<z.ZodType<(typeof shotKinds)[number]['kind']>>,
	distance: z.number().positive().optional(),
	length: z.number().nonnegative().optional()
});

const STitleArgs = z.object({
	text: z.string().regex(/\S/, 'A title needs words').optional(),
	style: z.enum(titleStyles.map((item) => item.style) as [TTitleStyle, ...TTitleStyle[]]).optional(),
	at: z.strictObject({ x: z.number(), y: z.number() }).optional(),
	color: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'A colour is like #1d1d1f').optional(),
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
	const { commands, entityId } = addWallTextCommands(point, { color: color ?? defaultTitleColor(project.design), frameHeight, ...(text != null ? { text } : {}) });
	const styled = commands.flatMap((command) => {
		if (command.type !== 'upsertEntity' || command.entity.components.wallText == null) return [command];
		const title = withTitleStyle(command.entity.components.wallText, style, { frameHeight, playhead, end: project.end, songName: songDisplayName(project), aspect: project.frame.width / project.frame.height });
		const wallText = { ...title, ...(start != null ? { in: start } : {}), ...(out != null ? { out } : {}) };
		return [{ ...command, entity: { ...command.entity, name: wallText.text, components: { ...command.entity.components, wallText } } }];
	});
	cx.$workspace.set('design');
	if (cx.execute(styled)) cx.$selection.set([entityId]);
}

/** Remove Pack by name, which the Add Pack sheet does for a person */
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
	const wanted = commands.flatMap((command) => (command.type === 'setDesign' ? [(command as { design?: { theme?: unknown } }).design?.theme] : []));
	const themes: TProjectTheme[] = [];
	for (const pack of addedPacks.get()) {
		for (const theme of pack.themes) {
			if (!wanted.includes(theme.id) || cx.project?.design.themes.some((item) => item.id === theme.id) === true) continue;
			const ready = await cx.library.packThemeInProject(pack, theme);
			if (ready != null) themes.push(ready);
		}
	}
	return themes;
}

async function runProjectCommands(cx: StudioCx, args: Record<string, unknown>): Promise<TToolReply> {
	const { commands, label } = z.object({ commands: z.array(z.looseObject({ type: z.string() })).min(1), label: z.string().optional() }).parse(args);
	const project = cx.project;
	if (project == null) return noProject(cx);
	const stopEpoch = cx.mcp.presence.stopEpoch;
	await settled(cx);
	const items = cx.library.$projectItems.get();
	const packThemes = await packThemesToApply(cx, commands);
	// Stop came while waiting for the run: this edit never starts, and McpCx's reply says why
	if (cx.mcp.presence.stopEpoch !== stopEpoch) return text(cx, { changed: false, selection: cx.$selection.get(), ...hitReport(project, cx.simulation.$result.get()) });
	const [isExpandedOk, expandedErr, expanded] = expandCommands(project, cx.simulation.$result.get(), items, commands as unknown as TAgentCommand[], packThemes);
	if (!isExpandedOk) return fail(cx, expandedErr.message);
	if (!expanded.isChange) {
		applySelection(cx, args);
		return text(cx, { changed: false, selection: cx.$selection.get(), ...hitReport(project, cx.simulation.$result.get()), notices: ['Those commands leave the project as it was, so there is no Undo step.'] });
	}
	const created = expanded.createdIds.length === 1 ? expanded.commands.find((command) => command.type === 'upsertEntity' && command.entity.id === expanded.createdIds[0]) : undefined;
	cx.mcp.presence.relabel(editPresenceLabel(label, expanded.summary, created?.type === 'upsertEntity' ? (created.entity.name ?? null) : null));
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
		...(project != null ? hitReport(project, cx.simulation.$result.get()) : {}),
		...(notices.length > 0 ? { notices } : {}),
		...(errors.length > 0 ? { errors } : {})
	};
	return { ...text(cx, reply), isError: errors.length > 0 };
}

/** Build Track, which answers when it is done: opens Compose first, as `invoke` does */
async function startBuild(cx: StudioCx, command: TCommand, from?: { laneId: string; hitId: string }, gapPiece?: 'rail' | 'switchback'): Promise<void> {
	const stopEpoch = cx.mcp.presence.stopEpoch;
	const compose = await openCompose(cx, command.title);
	if (cx.mcp.presence.stopEpoch === stopEpoch) await compose.assist.buildTrack(from, gapPiece);
}

async function openCompose(cx: StudioCx, title: string): Promise<ComposeCx> {
	if (cx.$workspace.get() !== 'compose') {
		cx.$workspace.set('compose');
		await waitFor(() => cx.$compose.get() != null, 1500);
	}
	await sleep(50);
	const compose = cx.$compose.get();
	if (compose == null) throw new Error(`${title} needs Compose, which didn't open.`);
	return compose;
}

/** `gapPiece` of `build.track`: the piece tried first across a long gap */
function gapPreference(args: Record<string, unknown>): 'rail' | 'switchback' | undefined {
	const piece = args['gapPiece'];
	return piece === 'rail' || piece === 'switchback' ? piece : undefined;
}

/** `from` of `build.track`: the hit Rebuild From Here starts at, null without one, or why it can't */
function buildFrom(cx: StudioCx, args: Record<string, unknown>): { laneId: string; hitId: string } | string | null {
	const hitId = args['from'];
	if (hitId == null) return null;
	const lane = cx.project?.music.lanes.find((item) => item.hits.some((hit) => hit.id === hitId));
	if (lane == null || typeof hitId !== 'string') return `There is no hit called ${String(hitId)}. get_state lists every marble's hits.`;
	if (cx.$compose.get()?.assist.isBuilding === true) return buildRefusal(cx);
	return { laneId: lane.id, hitId };
}

function buildRefusal(cx: StudioCx): string {
	const assist = cx.$compose.get()?.assist;
	if (assist?.isBuilding === true) return 'Build Track is already running. get_state shows how far it is; build.stop stops it.';
	if (cx.project?.music.lanes.some((lane) => lane.hits.length > 0) !== true) return 'Build Track needs notes. Call add_song first.';
	return 'Every hit already has a platform.';
}

/** Runs a registered command in its workspace, opening that first as the palette does */
async function invoke(cx: StudioCx, command: TCommand): Promise<void> {
	const target = commandWorkspace(command);
	if (target != null && cx.$workspace.get() !== target && cx.project != null) {
		cx.$workspace.set(target);
		await waitFor(() => target === 'design' || cx.$compose.get() != null, 1500);
		await sleep(50);
	}
	if (!isCommandEnabled(cx, command)) throw new Error(`${command.title} can't run right now. ${command.whyDisabled ?? 'get_state shows the project and selection it would act on.'}`);
	command.run(cx);
}

function canRun(cx: StudioCx, command: TCommand): boolean {
	const target = commandWorkspace(command);
	// A command of the other workspace opens it first; only then can it say whether it applies
	return target != null && target !== cx.$workspace.get() ? cx.project != null : isCommandEnabled(cx, command);
}

/** `args.select`'s keys the project doesn't know, in words, so a bad key is never a silent success */
function unknownSelection(cx: StudioCx, args: Record<string, unknown>): string | null {
	const select = args['select'];
	const project = cx.project;
	if (!Array.isArray(select) || project == null) return null;
	const isKnown = (key: unknown): boolean => {
		if (typeof key !== 'string') return false;
		if (project.entities.some((entity) => entity.id === key)) return true;
		const hit = parseHitKey(key);
		if (hit != null) return project.music.lanes.some((lane) => lane.id === hit.laneId && lane.hits.some((item) => item.id === hit.hitId));
		return key === WALL_KEY || key === CAMERA_KEY || key === SONG_KEY || parseLightKey(key) != null || parseDecorKey(key) != null || key.includes(':');
	};
	const bad = select.filter((key) => !isKnown(key));
	return bad.length > 0 ? `Nothing can be selected as ${bad.join(', ')}. Use a piece or marble ID from get_state, a hit key such as hit:laneId:hitId, wall, light:key, camera or song.` : null;
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
	if (cx.$compose.get()?.assist.isBuilding === true) return 'Build Track is running. get_state shows how far it is; build.stop stops it.';
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
		const isAssistFree = !cx.simulation.isSettling && cx.$compose.get()?.assist.isAnswering !== true;
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
