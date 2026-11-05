import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Ok } from 'tuple-result';
import { host } from '@/environment';
import { addedPacks, library } from '@/modules/library';
import { type TLibraryItem, type TPack } from '@/modules/scene';
import { createHistory, createMarble, createProject, type TMarble, type TPiece, type TProject } from '@/modules/project';
import { checkPattern, type TPatternAsk } from '@/modules/building';
import { createSimulator, type TSimulationResult, type TSimulator } from '@/modules/simulation';
import { readMenuItem } from '@/modules/studio/menu-bar';
import { StudioCx } from '@/modules/studio';
import { expandCommands } from './project-commands';
import { busyReason, runTool } from './mcp-tools';

function projectWithHit(): { project: TProject; marbleId: string; hitId: string } {
	const project = createProject({ title: 'Song' });
	const marble = { ...createMarble(0, { x: 0, y: 0 }), hits: [{ id: 'hit1', time: 1, pitch: 60 }] };
	return { project: { ...project, marbles: [marble] }, marbleId: marble.id, hitId: 'hit1' };
}

function resultFor(project: TProject, marbleId: string, hitId: string): TSimulationResult {
	return {
		revision: project.revision,
		duration: project.length,
		marbles: [],
		pieces: [],
		contacts: [],
		hits: [{ marbleId, hitId, targetTime: 1, pieceEntityId: null, dot: { x: 0, y: -1 }, velocity: { x: 0, y: -3 }, actualTime: null, error: null, status: 'open' }],
		stats: { computeMs: 0, reusedUntil: 0, steps: 0 }
	} as unknown as TSimulationResult;
}

/** A studio whose run keeps up with the project, as the simulation worker does */
function studio(): { cx: StudioCx; marbleId: string; hitId: string } {
	const { project, marbleId, hitId } = projectWithHit();
	const cx = new StudioCx();
	cx.$history.set(createHistory(project));
	cx.$path.set('/tmp/Song.marble');
	cx.simulation.$result.set(resultFor(project, marbleId, hitId));
	cx.$history.listen(({ value }) => {
		if (value != null) cx.simulation.$result.set(resultFor(value.present, marbleId, hitId));
	});
	return { cx, marbleId, hitId };
}

function textOf(reply: { content: { type: string; text?: string }[] }): string {
	return reply.content[0]?.text ?? '';
}

describe('MCP tools', () => {
	beforeEach(() => {
		vi.useFakeTimers({ shouldAdvanceTime: true, advanceTimeDelta: 40 });
		// Autosave writes to the browser's storage when a test runs long enough to reach it
		vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => undefined, removeItem: () => undefined });
	});
	afterEach(() => {
		vi.useRealTimers();
		vi.unstubAllGlobals();
	});

	it('should answer get_state in short with the agent folder and hit summary', async () => {
		const { cx } = studio();
		const reply = await runTool(cx, 'get_state', {});
		const state = JSON.parse(textOf(reply)) as Record<string, unknown>;
		expect(reply.isError).toBe(false);
		expect(reply.packagePath).toBe('/tmp/Song.marble');
		expect(state['agentFolder']).toBe('/tmp/Song.marble/agent');
		expect((state['marbles'] as { nextOpen: { hitId: string }[] }[])[0]?.nextOpen[0]?.hitId).toBe('hit1');
		expect(state['hits']).toBeTypeOf('string');
		expect(textOf(reply).length).toBeLessThan(3000);
	});

	it('should say so when no project is open', async () => {
		const cx = new StudioCx();
		expect(JSON.parse(textOf(await runTool(cx, 'get_state', {})))).toMatchObject({ project: null });
		const reply = await runTool(cx, 'preview_frame', { time: 1 });
		expect(reply.isError).toBe(true);
		expect(textOf(reply)).toContain('No project is open');
	});

	it('should report unknown tools and bad arguments in plain words', async () => {
		const { cx } = studio();
		expect(textOf(await runTool(cx, 'nope', {}))).toContain('no tool called nope');
		const bad = await runTool(cx, 'run_command', {});
		expect(bad.isError).toBe(true);
		expect(textOf(bad)).toContain("don't fit");
		expect(textOf(await runTool(cx, 'run_command', { id: 'nope' }))).toContain('list_commands');
		// Connect is the person's: an agent could cut itself off with it
		const connect = await runTool(cx, 'run_command', { id: 'help.connectClaude' });
		expect(connect.isError).toBe(true);
		expect(textOf(connect)).toContain('Agent menu');
		expect(textOf(await runTool(cx, 'list_commands', { filter: 'connect' }))).not.toContain('help.connect');
	});

	it('should list commands with whether they can run, and project.execute', async () => {
		const { cx } = studio();
		const { commands } = JSON.parse(textOf(await runTool(cx, 'list_commands', {}))) as { commands: { id: string; canRun?: boolean; needs?: string }[] };
		expect(commands[0]?.id).toBe('project.execute');
		expect(commands.find((command) => command.id === 'edit.undo')?.canRun).toBe(false);
		expect(commands.find((command) => command.id === 'file.open')?.needs).toContain('path');
		const filtered = JSON.parse(textOf(await runTool(cx, 'list_commands', { filter: 'scatter decor' }))) as { commands: { id: string }[] };
		expect(filtered.commands.map((command) => command.id)).toContain('decor.scatter');
	});

	it('should say what is wrong with build.track arguments', async () => {
		const { cx } = studio();
		const unknownHit = await runTool(cx, 'run_command', { id: 'build.track', args: { from: 'no-such-hit' } });
		expect(unknownHit.isError).toBe(true);
		expect(textOf(unknownHit)).toContain('no hit called no-such-hit');
		const unknownPiece = await runTool(cx, 'run_command', { id: 'build.track', args: { gapPiece: 'tunnel' } });
		expect(unknownPiece.isError).toBe(true);
		expect(textOf(unknownPiece)).toContain('gapPiece is rail, switchback or chain');
	});

	it('should make one project.execute one named Undo step, shown in Edit > Undo', async () => {
		const { cx, marbleId, hitId } = studio();
		const before = cx.$history.get()?.past.length;
		const reply = await runTool(cx, 'run_command', {
			id: 'project.execute',
			args: { commands: [{ type: 'placePiece', pieceType: 'platform', hit: { marbleId, hitId }, angle: 0.2 }, { type: 'updateProject', patch: { length: 9 } }], label: 'Place Platform' }
		});
		const answer = JSON.parse(textOf(reply)) as { undoStep: string; selection: string[]; hits: string };
		expect(reply.isError).toBe(false);
		expect(answer.undoStep).toBe('Agent: Place Platform');
		expect(answer.hits).toBeTypeOf('string');
		expect(cx.$history.get()?.past.length).toBe((before ?? 0) + 1);

		const placed = cx.project?.track.pieces.find((piece) => piece.id === answer.selection[0]);
		expect(placed?.type).toBe('platform');
		expect(placed?.angle).toBe(0.2);
		expect(cx.undoLabel).toBe('Agent: Place Platform');
		expect(cx.$notice.get()?.message).toBe('Agent: Place Platform');
		expect(cx.$notice.get()?.actions?.some((action) => action.isUndo === true)).toBe(true);
		expect(readMenuItem(cx, { command: 'edit.undo' }, false).title).toBe('Undo Agent: Place Platform');

		cx.undo();
		expect(cx.project?.track.pieces.some((piece) => piece.id === answer.selection[0])).toBe(false);
		expect(cx.undoLabel).toBeNull();
		expect(readMenuItem(cx, { command: 'edit.redo' }, false).title).toBe('Redo Agent: Place Platform');
		expect(readMenuItem(cx, { command: 'edit.undo' }, false).title).toBe('Undo');
	});

	it('should keep a person\'s edits in their own steps, named by what changed', async () => {
		const { cx } = studio();
		await runTool(cx, 'run_command', { id: 'project.execute', args: { commands: [{ type: 'updateProject', patch: { length: 9 } }] } });
		const steps = cx.$history.get()?.past.length ?? 0;
		cx.execute([{ type: 'updateProject', patch: { length: 8 } }]);
		expect(cx.$history.get()?.past.length).toBe(steps + 1);
		expect(cx.undoLabel).toBe('Change Length');
	});

	it('should refuse an invalid batch without changing the project', async () => {
		const { cx, marbleId } = studio();
		const project = cx.project;
		const reply = await runTool(cx, 'run_command', {
			id: 'project.execute',
			args: { commands: [{ type: 'updateProject', patch: { length: 9 } }, { type: 'placePiece', pieceType: 'nope', hit: { marbleId, hitId: 'hit1' } }] }
		});
		expect(reply.isError).toBe(true);
		expect(textOf(reply)).toContain('no piece called nope');
		expect(cx.project).toBe(project);
		expect((await runTool(cx, 'run_command', { id: 'project.execute', args: { commands: [{ type: 'hack' }] } })).isError).toBe(true);
	});

	it('should run a registered command and report one that can\'t run', async () => {
		const { cx } = studio();
		const undo = await runTool(cx, 'run_command', { id: 'edit.undo' });
		expect(undo.isError).toBe(true);
		expect(textOf(undo)).toContain("can't run right now");
		const panel = await runTool(cx, 'run_command', { id: 'file.export' });
		expect(textOf(panel)).toContain('export_film');
		const selected = await runTool(cx, 'run_command', { id: 'edit.deselect', args: { select: ['a'] } });
		expect(selected.isError).toBe(true);
		expect(textOf(selected)).toContain('Nothing can be selected as a');
	});

	it('should answer build.rebuildFrom only when its build is done, and say what it needs without a target', async () => {
		const { cx, marbleId, hitId } = studio();
		let bowlBuild: () => void = () => undefined;
		const buildTrack = vi.fn(() => new Promise<null>((resolve) => (bowlBuild = () => resolve(null))));
		const key = `hit:${marbleId}:${hitId}`;
		const assist = { get rebuildTarget() { return cx.$selection.get().includes(key) ? { marbleId, hitId } : null; }, buildTrack, isBuilding: false, isAnswering: false };
		Object.assign(cx, { assist });
		cx.$trackCx.set({} as never);
		cx.$workspace.set('track');

		const missing = await runTool(cx, 'run_command', { id: 'build.rebuildFrom' });
		expect(missing.isError).toBe(true);
		expect(textOf(missing)).toContain('Rebuild From Here needs a hit');
		expect(buildTrack).not.toHaveBeenCalled();

		let isAnswered = false;
		const answer = runTool(cx, 'run_command', { id: 'build.rebuildFrom', args: { select: [key] } }).then((reply) => {
			isAnswered = true;
			return reply;
		});
		await vi.advanceTimersByTimeAsync(1000);
		expect(buildTrack).toHaveBeenCalledWith({ marbleId, hitId });
		expect(isAnswered).toBe(false);
		bowlBuild();
		expect((await answer).isError).toBe(false);
	});

	it('should show the running build and its result in get_state', async () => {
		const { cx } = studio();
		const lastBuild = { message: 'Built' };
		Object.assign(cx, { assist: { $building: { get: () => ({ done: 2, total: 5 }) }, $lastBuild: { get: () => lastBuild } } });
		const state = JSON.parse(textOf(await runTool(cx, 'get_state', {})));
		expect(state.building).toEqual({ done: 2, total: 5 });
		expect(state.lastBuild).toEqual(lastBuild);
	});

	it('should select by key with edit.select, and show the Wall and physics in get_state', async () => {
		const { cx, marbleId } = studio();
		const reply = await runTool(cx, 'run_command', { id: 'edit.select', args: { select: ['wall'] } });
		expect(JSON.parse(textOf(reply))).toMatchObject({ selection: ['wall'], changed: false });
		const state = JSON.parse(textOf(await runTool(cx, 'get_state', {})));
		expect(state.selection).toEqual([{ kind: 'layer', key: 'wall' }]);
		expect(state.gravity).toEqual({ value: 0.5, default: 0.5, range: [0.05, 2] });
		expect(state.wall).toMatchObject({ own: {} });
		expect((state.wall as { kind: string }).kind).toBeTypeOf('string');
		expect(state.marbles[0]).toMatchObject({ marbleId, hitColumns: ['hitId', 'time', 'note', 'status', 'x', 'y'], hitList: [['hit1', 1, 'C4', 'open', 0, -1]] });
	});

	it('should select a marble and a title by their IDs', async () => {
		const { cx, marbleId } = studio();
		await runTool(cx, 'run_command', { id: 'film.addText', args: { text: 'Hello' } });
		const titleId = cx.project?.film.titles[0]?.id;
		const reply = await runTool(cx, 'run_command', { id: 'edit.select', args: { select: [marbleId, titleId] } });
		expect(reply.isError).toBe(false);
		const state = JSON.parse(textOf(await runTool(cx, 'get_state', {})));
		expect(state.selection).toMatchObject([{ kind: 'marble', id: marbleId }, { kind: 'title', id: titleId }]);
	});

	it("should refuse a command's wrong fields, naming them, with no Undo step", async () => {
		const { cx } = studio();
		const before = cx.$history.get();
		for (const command of [{ type: 'updateProject', gravity: 0.4 }, { type: 'updateProject', foo: 1 }, { type: 'updateProject', patch: { foo: 1 } }, { type: 'updateMarble', marbleId: 'x', patch: { release: {} } }]) {
			const reply = await runTool(cx, 'run_command', { id: 'project.execute', args: { commands: [command] } });
			expect(reply.isError).toBe(true);
			expect(textOf(reply)).toContain("doesn't fit");
		}
		expect(cx.$history.get()).toBe(before);
		const moved = await runTool(cx, 'run_command', { id: 'project.execute', args: { commands: [{ type: 'updateProject', patch: { gravity: 0.4 } }] } });
		expect(JSON.parse(textOf(moved)).changed).toBe(true);
		expect(cx.project?.gravity).toBe(0.4);
	});

	it('should say when commands change nothing, and make no Undo step', async () => {
		const { cx } = studio();
		const before = cx.$history.get();
		const gravity = cx.project?.gravity;
		const reply = await runTool(cx, 'run_command', { id: 'project.execute', args: { commands: [{ type: 'updateProject', patch: { gravity } }] } });
		expect(JSON.parse(textOf(reply)).changed).toBe(false);
		expect(cx.$history.get()).toBe(before);
	});

	it('should tell a marble to set its start, not a place', async () => {
		const { cx } = studio();
		const marble = cx.project?.marbles[0];
		const reply = await runTool(cx, 'run_command', { id: 'project.execute', args: { commands: [{ type: 'updateMarble', marbleId: marble?.id, patch: { place: { kind: 'free', position: { x: 1, y: 1 } } } }] } });
		expect(reply.isError).toBe(true);
		expect(textOf(reply)).toContain("updateMarble doesn't fit");
		expect(textOf(reply)).toContain('start: { position');
	});

	it('should show the project under the names of its fields in get_state', async () => {
		const { cx, marbleId } = studio();
		await runTool(cx, 'run_command', { id: 'project.execute', args: { commands: [{ type: 'addSong', song: { id: 'song-1', name: 'Song.wav', kind: 'audio', path: 'audio/song.wav', start: 1, backing: [] } }] } });
		const state = JSON.parse(textOf(await runTool(cx, 'get_state', {})));
		expect(state.project.format).toEqual({ width: 9, height: 16 });
		expect(state.quality).toBe('final');
		expect(state.song.songs).toEqual([{ id: 'song-1', name: 'Song.wav', kind: 'audio', start: 1 }]);
		expect(state.marbles[0]).toMatchObject({ marbleId, start: { x: 0, y: 0 } });
		expect(state.marbles[0]).not.toHaveProperty('entityId');
		expect(state.camera).toEqual({ auto: true, distance: 1.36, tilt: 1, sway: 1, shots: [] });
	});

	it('should set Gravity from args.value and refuse it without one', async () => {
		const { cx } = studio();
		const reply = await runTool(cx, 'run_command', { id: 'marble.speed', args: { value: 0.7 } });
		expect(JSON.parse(textOf(reply)).changed).toBe(true);
		expect(cx.project?.gravity).toBe(0.7);
		expect((await runTool(cx, 'run_command', { id: 'marble.speed', args: {} })).isError).toBe(true);
	});

	it('should name what Undo takes back', async () => {
		const { cx } = studio();
		await runTool(cx, 'run_command', { id: 'marble.speed', args: { value: 0.7 } });
		const reply = JSON.parse(textOf(await runTool(cx, 'run_command', { id: 'edit.undo' })));
		expect(reply.undid).toBe('Agent: Gravity');
		expect(reply.changed).toBe(true);
	});

	function execute(cx: StudioCx, ...commands: unknown[]): ReturnType<typeof runTool> {
		return runTool(cx, 'run_command', { id: 'project.execute', args: { commands } });
	}

	function marbleOf(cx: StudioCx): TMarble {
		return cx.project?.marbles[0] as TMarble;
	}

	function skinItem(id: string, pieceType: string): TLibraryItem {
		return { id, scope: 'project', path: `/x/${id}`, blendPath: `/x/${id}/asset.blend`, previewUrl: null, manifest: { id, label: id, role: 'skin', pieceType }, manifestError: null } as unknown as TLibraryItem;
	}

	describe('skins', () => {
		it.each(['marble:glass', 'marble:metal', 'marble:magic'])('should put %s on a marble from the command to the scene Blender reads', async (skin) => {
			const { cx } = studio();
			const marble = marbleOf(cx);
			const reply = await execute(cx, { type: 'applySkin', assetId: skin, ids: [marble.id] });
			expect(reply.isError).toBe(false);
			expect(marbleOf(cx).skin?.assetId).toBe(skin);
			const state = JSON.parse(textOf(await runTool(cx, 'get_state', {}))) as { marbles: { skin: string }[] };
			expect(state.marbles[0]?.skin).toBe(skin);
		});

		it('should refuse a skin that does not exist, or fit, with the ones that do', async () => {
			const { cx } = studio();
			const marble = marbleOf(cx);
			for (const assetId of ['marble:nosuchthing', 'platform:copper', 'rail:gold', 'gift-red']) {
				const reply = await execute(cx, { type: 'applySkin', assetId, ids: [marble.id] });
				expect(reply.isError, assetId).toBe(true);
				expect(marbleOf(cx).skin).toBeUndefined();
			}
			expect(textOf(await execute(cx, { type: 'applySkin', assetId: 'marble:nosuchthing', pieceType: 'marble' }))).toContain('marble:glass');
			expect(textOf(await execute(cx, { type: 'applySkin', assetId: 'platform:copper', pieceType: 'marble' }))).toContain("can't dress a Marble");
			expect((await execute(cx, { type: 'applySkin', assetId: 'marble:glass', ids: ['nobody'] })).isError).toBe(true);
			expect((await execute(cx, { type: 'updateMarble', marbleId: marble.id, patch: { skin: { assetId: 'marble:nope' } } })).isError).toBe(true);
		});

		it('should take a marble skin from the library, and no other piece type', async () => {
			const { cx } = studio();
			cx.library.$projectItems.set([skinItem('green-glass', 'marble'), skinItem('gift-red', 'platform')]);
			const marble = marbleOf(cx);
			expect((await execute(cx, { type: 'applySkin', assetId: 'gift-red', ids: [marble.id] })).isError).toBe(true);
			expect((await execute(cx, { type: 'applySkin', assetId: 'green-glass', ids: [marble.id] })).isError).toBe(false);
			expect(marbleOf(cx).skin?.assetId).toBe('green-glass');
		});

		it('should list every built-in skin and the library in list_commands', async () => {
			const { cx } = studio();
			cx.library.$projectItems.set([skinItem('green-glass', 'marble')]);
			const listed = JSON.parse(textOf(await runTool(cx, 'list_commands', {}))) as { skins: { builtIn: Record<string, string[]>; library: { id: string; fits: string }[] } };
			expect(listed.skins.builtIn['marble']).toContain('marble:glass');
			expect(listed.skins.builtIn['rail']).toContain('rail:chrome');
			expect(listed.skins.library).toEqual([expect.objectContaining({ id: 'green-glass', fits: 'marble' })]);
		});
	});

	describe('updateFilm', () => {
		it('should refuse an unknown theme and name the ones there are', async () => {
			const { cx } = studio();
			const reply = await execute(cx, { type: 'updateFilm', film: { theme: 'theme-nope' } });
			expect(reply.isError).toBe(true);
			expect(textOf(reply)).toContain('There is no theme theme-nope');
			expect(textOf(reply)).toContain('pegboard');
			expect(cx.project?.film.theme).not.toBe('theme-nope');
		});

		it('should change only the fields it names', async () => {
			const { cx } = studio();
			const before = cx.project?.film.camera.distance;
			await execute(cx, { type: 'updateFilm', film: { camera: { sway: 0 }, wall: { color: '#f6e3b8' }, lights: { key: { color: '#ffd08a' } } } });
			await execute(cx, { type: 'updateFilm', film: { wall: { kind: 'plain' }, lights: { key: { strength: 3 } } } });
			expect(cx.project?.film.camera.sway).toBe(0);
			expect(cx.project?.film.camera.distance).toBe(before);
			expect(cx.project?.film.wall).toEqual({ color: '#f6e3b8', kind: 'plain' });
			expect(cx.project?.film.lights.key).toEqual({ color: '#ffd08a', strength: 3 });
		});

		it('should say what is wrong with the field that is wrong', async () => {
			const { cx } = studio();
			expect(textOf(await execute(cx, { type: 'updateFilm', film: { lights: { fill: {} } } }))).toContain('lights has key and added');
			expect(textOf(await execute(cx, { type: 'updateFilm', film: { camera: { zoom: 0.5 } } }))).toContain('sway');
			expect(textOf(await execute(cx, { type: 'updateFilm', film: { wall: { paint: '#fff' } } }))).toContain('kind plain');
			const unknown = textOf(await execute(cx, { type: 'updateFilm', film: { sky: {} } }));
			expect(unknown).toContain('film takes theme, wall, lights, camera');
			expect(unknown).not.toContain("theme: 'brass' } }.");
		});

		it("should apply an added Pack's theme by its id", async () => {
			const { cx } = studio();
			const theme = { id: 'theme-pack', name: 'Golden', base: 'brass', overrides: { wallColor: '#ffefc8' } };
			addedPacks.set([{ id: 'xmas', name: 'Christmas', version: '1.0', themes: [theme], items: [], builtInDecor: [] } as unknown as TPack]);
			const state = JSON.parse(textOf(await runTool(cx, 'get_state', {}))) as { packThemes: { id: string; pack: string }[] };
			expect(state.packThemes).toEqual([{ id: 'theme-pack', name: 'Golden', pack: 'Christmas' }]);
			expect((await execute(cx, { type: 'updateFilm', film: { theme: 'theme-pack' } })).isError).toBe(false);
			expect(cx.project?.film.theme).toBe('theme-pack');
			expect(cx.project?.film.themes[0]?.pack?.packName).toBe('Christmas');
			addedPacks.set([]);
		});
	});

	describe('marbles and titles', () => {
		it('should name the real commands in errors', async () => {
			const { cx } = studio();
			const reply = textOf(await execute(cx, { type: 'setComponent', entityId: marbleOf(cx).id, component: { name: 'walltext', value: {} } }));
			expect(reply).toContain('updatePiece');
			expect(reply).toContain('updateFilm');
		});

		it('should change a marble color without a radius, and warn when a radius changes', async () => {
			const { cx } = studio();
			const id = marbleOf(cx).id;
			const radius = marbleOf(cx).radius;
			const color = JSON.parse(textOf(await execute(cx, { type: 'updateMarble', marbleId: id, patch: { skin: { color: '#22ff66' } } }))) as { notices?: string[] };
			expect(marbleOf(cx).skin?.color).toBe('#22ff66');
			expect(marbleOf(cx).radius).toBe(radius);
			expect(color.notices).toBeUndefined();
			const state = JSON.parse(textOf(await runTool(cx, 'get_state', {}))) as { marbles: { radius: number; filmColor: string }[] };
			expect(state.marbles[0]).toMatchObject({ radius, filmColor: '#22ff66' });
			const bigger = JSON.parse(textOf(await execute(cx, { type: 'updateMarble', marbleId: id, patch: { radius: 0.0125 } }))) as { notices: string[] };
			expect(bigger.notices[0]).toContain('radius changes the run');
			expect((await execute(cx, { type: 'updateMarble', marbleId: id, patch: { radius: 1.2 } })).isError).toBe(true);
		});

		it('should refuse ids that are not there and fonts a title can not use', async () => {
			const { cx } = studio();
			expect(textOf(await execute(cx, { type: 'removePieces', pieceIds: ['nobody'] }))).toContain('There is nothing called nobody');
			expect((await execute(cx, { type: 'removeMarble', marbleId: 'nope' })).isError).toBe(true);
			expect((await execute(cx, { type: 'removeSong', songId: 'nope' })).isError).toBe(true);
			await runTool(cx, 'run_command', { id: 'film.addText', args: { text: 'Hello' } });
			const titles = cx.project?.film.titles.map((title) => ({ ...title, font: 'Georgia' }));
			expect(textOf(await execute(cx, { type: 'updateFilm', film: { titles } }))).toContain("isn't a font");
		});
	});

	describe('titles and shots', () => {
		it('should add a title with its words, readable in get_state', async () => {
			const { cx } = studio();
			const reply = JSON.parse(textOf(await runTool(cx, 'run_command', { id: 'film.addText', args: { text: 'Jingle Bells', style: 'songName', at: { x: 0.1, y: -0.2 }, color: '#112233' } }))) as { changed: boolean };
			expect(reply.changed).toBe(true);
			const state = JSON.parse(textOf(await runTool(cx, 'get_state', {}))) as { layers: { titles: { text: string; style: string }[] } };
			expect(state.layers.titles).toEqual([expect.objectContaining({ text: 'Jingle Bells', style: 'songName' })]);
			const title = cx.project?.film.titles[0];
			expect(title?.position).toEqual({ x: 0.1, y: -0.2 });
			expect(title?.color).toBe('#112233');
			expect((await runTool(cx, 'run_command', { id: 'film.addText', args: { style: 'nope' } })).isError).toBe(true);
		});

		it('should add a shot from its arguments, readable in get_state', async () => {
			const { cx } = studio();
			await runTool(cx, 'run_command', { id: 'camera.addShot', args: { time: 3, kind: 'wide', distance: 1.2, hold: 2 } });
			const state = JSON.parse(textOf(await runTool(cx, 'get_state', {}))) as { camera: { shots: unknown[]; distance: number } };
			expect(state.camera.shots).toEqual([expect.objectContaining({ time: 3, kind: 'wide', distance: 1.2, hold: 2 })]);
			expect(state.camera.distance).toBeGreaterThan(0);
		});
	});

	describe('assets and themes', () => {
		it('should read what add_asset is not told from the manifest', async () => {
			const { cx } = studio();
			vi.spyOn(host, 'pickedFileUrl').mockReturnValue('file:///x/manifest.json');
			vi.spyOn(host, 'readFile').mockResolvedValue(Ok(new TextEncoder().encode(JSON.stringify({ label: 'Green Glass', role: 'skin', pieceType: 'marble' }))) as never);
			const added = vi.spyOn(library, 'addAsset').mockResolvedValue(Ok({ id: 'green-glass' }) as never);
			const reply = await runTool(cx, 'add_asset', { path: '/x/green' });
			expect(reply.isError).toBe(false);
			const manifest = JSON.parse(added.mock.calls[0]?.[2] as string) as Record<string, string>;
			expect(manifest).toMatchObject({ label: 'Green Glass', role: 'skin', pieceType: 'marble' });
			vi.restoreAllMocks();
		});

		it('should refuse a quality that is not an export word', async () => {
			const { cx } = studio();
			expect((await runTool(cx, 'export_film', { quality: 'ultra' })).isError).toBe(true);
		});

		it('should remove an added Pack by name, and say so when it is not added', async () => {
			const { cx } = studio();
			const removed = vi.spyOn(cx.library, 'removePack').mockResolvedValue();
			addedPacks.set([{ id: 'christmas', name: 'Christmas', version: '1.0', themes: [], items: [], builtInDecor: [] } as unknown as TPack, { id: 'starter', name: 'Starter', version: '1.0', themes: [], items: [], builtInDecor: [] } as unknown as TPack]);
			expect((await runTool(cx, 'run_command', { id: 'film.removePack', args: { name: 'christmas' } })).isError).toBe(false);
			expect(removed).toHaveBeenCalledTimes(1);
			expect(textOf(await runTool(cx, 'run_command', { id: 'film.removePack', args: { name: 'starter' } }))).toContain("can't be removed");
			expect(removed).toHaveBeenCalledTimes(1);
			expect(textOf(await runTool(cx, 'run_command', { id: 'film.removePack', args: { name: 'Nope' } }))).toContain('No Pack called Nope');
			addedPacks.set([]);
			vi.restoreAllMocks();
		});
	});

	it('should wait for a person mid-gesture, then say busy', async () => {
		const { cx } = studio();
		cx.mcp.isPointerDown = true;
		expect(busyReason(cx)).toContain('middle of a drag');
		const pending = runTool(cx, 'run_command', { id: 'project.execute', args: { commands: [{ type: 'updateProject', patch: { length: 9 } }] } });
		const reply = await pending;
		expect(reply.isError).toBe(true);
		expect(textOf(reply)).toContain('middle of a drag');
		expect(cx.project?.length).not.toBe(9);

		const later = runTool(cx, 'run_command', { id: 'project.execute', args: { commands: [{ type: 'updateProject', patch: { length: 9 } }] } });
		await new Promise((resolve) => setTimeout(resolve, 100));
		cx.mcp.isPointerDown = false;
		expect((await later).isError).toBe(false);
		expect(cx.project?.length).toBe(9);
	});

	it('should check play_range and export arguments', async () => {
		const { cx } = studio();
		expect((await runTool(cx, 'play_range', { from: 2, to: 1 })).isError).toBe(true);
		expect((await runTool(cx, 'add_song', { path: 'relative.mid' })).isError).toBe(true);
		expect(textOf(await runTool(cx, 'add_song', { path: '/x/notes.txt' }))).toContain("isn't a song");
		expect(JSON.parse(textOf(await runTool(cx, 'export_film', {})))).toMatchObject({ phase: 'idle' });
	});

	it('should stop play_range at its end', async () => {
		const { cx } = studio();
		await runTool(cx, 'play_range', { from: 1, to: 2 });
		expect(cx.$playing.get()).toBe(true);
		expect(cx.$playhead.get()).toBe(1);
		cx.$playhead.set(2.1);
		expect(cx.$playing.get()).toBe(false);
	});
});

describe('applyPattern', () => {
	let sim: TSimulator;

	beforeAll(async () => {
		sim = await createSimulator();
	});
	afterAll(() => sim.dispose());

	/** A studio on a real project, with its Patterns asked in this thread instead of a worker */
	function patternStudio(times: number[]): { cx: StudioCx; project: TProject; marbleId: string } {
		const created = createProject({ id: 'pattern', title: 'Pattern' });
		const marble = { ...createMarble(0, { x: 0, y: 0.6 }), start: { position: { x: 0, y: 0.6 }, time: (times[0] ?? 0) - 0.35 }, hits: times.map((time, index) => ({ id: `h${index + 1}`, time })) };
		const project: TProject = { ...created, marbles: [marble], length: (times.at(-1) ?? 0) + 0.6 };
		const cx = new StudioCx();
		cx.$history.set(createHistory(project));
		cx.$path.set('/tmp/Pattern.marble');
		cx.simulation.$result.set({ ...sim.simulate(project), revision: project.revision });
		const client = {
			run: (asked: TProject, change: TPatternAsk, _progress: unknown, isChecked = true) => {
				const { project: _after, ...answer } = checkPattern(asked, change, { sim, isChecked });
				return Promise.resolve({ ...answer, pieces: [] });
			},
			cancel: () => undefined,
			dispose: () => undefined
		};
		(cx.patterns as unknown as { client: unknown }).client = client;
		return { cx, project, marbleId: marble.id };
	}

	it('should refuse over MCP the way a person is refused, with the hit, the reason and nothing changed', async () => {
		const { cx, project, marbleId } = patternStudio([1, 1.14, 1.28, 1.42, 1.56]);
		const ask = { marbleId, from: 1, to: 1.56, kind: 'zigzag', width: 0.3 };
		const person = checkPattern(project, ask, { sim });

		const dry = JSON.parse(textOf(await runTool(cx, 'run_command', { id: 'project.execute', args: { commands: [{ type: 'applyPattern', ...ask, dryRun: true }] } }))) as Record<string, unknown>;
		const real = JSON.parse(textOf(await runTool(cx, 'run_command', { id: 'project.execute', args: { commands: [{ type: 'applyPattern', ...ask }] } }))) as Record<string, unknown>;

		expect(person.refusal?.words).toMatch(/^Zigzag doesn't fit at Hit \d of .*Nothing changed\.$/);
		expect(dry).toMatchObject({ changed: false, dryRun: true, fits: false, group: null, refusal: person.refusal, verdicts: person.verdicts });
		expect(real).toMatchObject({ changed: false, fits: false, group: null, refusal: person.refusal, verdicts: person.verdicts });
		expect(cx.project).toBe(project);
		expect(cx.$history.get()?.past).toHaveLength(0);
	}, 60_000);

	it('should list the Patterns in get_state and answer a dry run that fits, applying the same pieces', async () => {
		const { cx, marbleId } = patternStudio([1, 1.4, 1.8, 2.2]);
		const ask = { type: 'applyPattern', marbleId, from: 1, to: 1.8, kind: 'zigzag' };

		const state = JSON.parse(textOf(await runTool(cx, 'get_state', {}))) as { patterns: { kind: string }[] };
		const dry = JSON.parse(textOf(await runTool(cx, 'run_command', { id: 'project.execute', args: { commands: [{ ...ask, dryRun: true }] } }))) as { fits: boolean; verdicts: unknown[] };
		const before = cx.$history.get()?.past.length;
		const real = JSON.parse(textOf(await runTool(cx, 'run_command', { id: 'project.execute', args: { commands: [ask] } }))) as { fits: boolean; group: { name: string } };

		expect(state.patterns.map((item) => item.kind)).toEqual(['zigzag', 'staircase', 'longRail']);
		expect(dry.fits).toBe(true);
		expect(dry.verdicts).toHaveLength(3);
		expect(real.fits).toBe(true);
		expect(real.group.name).toBe('Zigzag');
		expect(cx.$history.get()?.past.length).toBe((before ?? 0) + 1);
		expect(cx.project?.track.groups[0]?.pattern?.kind).toBe('zigzag');
	}, 60_000);
});

describe('expandCommands function', () => {
	it('should place a free piece with its parameters, and pass project commands through', () => {
		const { project } = projectWithHit();
		const [isOk, , expanded] = expandCommands(project, null, [], [{ type: 'placePiece', pieceType: 'platform', position: { x: 1, y: 2 }, angle: 0.5, params: { length: 0.1 }, name: 'Top' }, { type: 'updateProject', patch: { length: 3 } }]);
		expect(isOk).toBe(true);
		const placed = expanded?.commands[0];
		expect(placed?.type === 'addPiece' && placed.piece.place).toEqual({ kind: 'free', position: { x: 1, y: 2 } });
		expect(placed?.type === 'addPiece' && placed.piece.angle).toBe(0.5);
		expect(placed?.type === 'addPiece' && placed.piece.params['length']).toBe(0.1);
		expect(placed?.type === 'addPiece' && placed.piece.name).toBe('Top');
		expect(expanded?.commands[1]).toEqual({ type: 'updateProject', patch: { length: 3 } });
		expect(expanded?.summary).toBeNull();
	});

	it('should name a uniform batch for its Undo step', () => {
		const { project } = projectWithHit();
		const [, , expanded] = expandCommands(project, null, [], [{ type: 'placePiece', pieceType: 'rail', position: { x: 0, y: 0 }, path: [{ x: 0, y: 0 }, { x: 1, y: 0 }] }]);
		expect(expanded?.summary).toBe('Place Rail');
	});

	it("should answer in words that a live Pattern's piece doesn't edit, and free it with flattenPattern", () => {
		const base = createProject({ id: 'p', title: 'P' });
		const bar: TPiece = { id: 'bar', name: 'Bar', type: 'platform', params: { depth: 0.09 }, angle: 0, place: { kind: 'free', position: { x: 0, y: 0 } } };
		const project: TProject = { ...base, track: { pieces: [...base.track.pieces, bar], groups: [{ id: 'g', name: 'Zigzag', marbleId: base.marbles[0]?.id ?? '', pieceIds: ['bar'], pattern: { kind: 'zigzag', hitIds: [], width: 0.14, bounce: 0.5 } }] } };
		const moved: TPiece = { ...bar, place: { kind: 'free', position: { x: 1, y: 0 } } };
		const deeper: TPiece = { ...bar, params: { depth: 0.05 } };

		expect(expandCommands(project, null, [], [{ type: 'addPiece', piece: moved }])[1]?.message).toContain('Part of Zigzag. Flatten to edit it.');
		expect(expandCommands(project, null, [], [{ type: 'removePieces', pieceIds: ['bar'] }])[0]).toBe(true);
		expect(expandCommands(project, null, [], [{ type: 'addPiece', piece: deeper }])[0]).toBe(true);
		expect(expandCommands(project, null, [], [{ type: 'flattenPattern', groupId: 'g' }])[2]?.commands).toEqual([{ type: 'addGroup', group: { id: 'g', name: 'Zigzag', marbleId: base.marbles[0]?.id ?? '', pieceIds: ['bar'] } }]);
	});

	it('should refuse what it can\'t do in plain words', () => {
		const { project, marbleId, hitId } = projectWithHit();
		expect(expandCommands(project, null, [], [{ type: 'placePiece', pieceType: 'platform', hit: { marbleId, hitId } }])[1]?.message).toContain('no dot yet');
		expect(expandCommands(project, null, [], [{ type: 'placePiece', pieceType: 'platform' }])[1]?.message).toContain('hit or a position');
		expect(expandCommands(project, null, [], [{ type: 'applySkin', assetId: 'gone', pieceType: 'platform' }])[1]?.message).toContain('add_asset');
		expect(expandCommands(project, null, [], [{ type: 'placeDecor', source: 'gone', at: { x: 0, y: 0 } }])[1]?.message).toContain("isn't a Decor item");
	});
});
