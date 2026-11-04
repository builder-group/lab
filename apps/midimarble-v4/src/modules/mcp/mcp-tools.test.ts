import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Ok } from 'tuple-result';
import { host } from '@/environment';
import { addedPacks, library, type TLibraryItem, type TPack } from '@/modules/library';
import { createHistory, createLane, createMarble, createProject, type TEntity, type TProject } from '@/modules/project';
import type { TSimulationResult } from '@/modules/simulation';
import { readMenuItem } from '@/modules/studio/menu-bar';
import { StudioCx } from '@/modules/studio/StudioCx';
import { expandCommands } from './project-commands';
import { busyReason, runTool } from './mcp-tools';

function projectWithHit(): { project: TProject; laneId: string; hitId: string } {
	const project = createProject({ title: 'Song' });
	const lane = { ...createLane(0), hits: [{ id: 'hit1', time: 1, pitch: 60 }] };
	return { project: { ...project, music: { ...project.music, lanes: [lane] }, entities: [createMarble(lane, { x: 0, y: 0 })] }, laneId: lane.id, hitId: 'hit1' };
}

function resultFor(project: TProject, laneId: string, hitId: string): TSimulationResult {
	return {
		revision: project.revision,
		duration: project.end,
		marbles: [],
		pieces: [],
		contacts: [],
		hits: [{ laneId, hitId, targetTime: 1, pieceEntityId: null, dot: { x: 0, y: -1 }, velocity: { x: 0, y: -3 }, actualTime: null, error: null, status: 'open' }],
		stats: { computeMs: 0, reusedUntil: 0, steps: 0 }
	} as unknown as TSimulationResult;
}

/** A studio whose run keeps up with the project, as the simulation worker does */
function studio(): { cx: StudioCx; laneId: string; hitId: string } {
	const { project, laneId, hitId } = projectWithHit();
	const cx = new StudioCx();
	cx.$history.set(createHistory(project));
	cx.$path.set('/tmp/Song.marble');
	cx.simulation.$result.set(resultFor(project, laneId, hitId));
	cx.$history.listen(({ value }) => {
		if (value != null) cx.simulation.$result.set(resultFor(value.present, laneId, hitId));
	});
	return { cx, laneId, hitId };
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
		expect(textOf(unknownPiece)).toContain('gapPiece is rail or switchback');
	});

	it('should make one project.execute one named Undo step, shown in Edit > Undo', async () => {
		const { cx, laneId, hitId } = studio();
		const before = cx.$history.get()?.past.length;
		const reply = await runTool(cx, 'run_command', {
			id: 'project.execute',
			args: { commands: [{ type: 'placePiece', pieceType: 'platform', hit: { laneId, hitId }, angle: 0.2 }, { type: 'setEnd', end: 9 }], label: 'Place Platform' }
		});
		const answer = JSON.parse(textOf(reply)) as { undoStep: string; selection: string[]; hits: string };
		expect(reply.isError).toBe(false);
		expect(answer.undoStep).toBe('Agent: Place Platform');
		expect(answer.hits).toBeTypeOf('string');
		expect(cx.$history.get()?.past.length).toBe((before ?? 0) + 1);

		const placed = cx.project?.entities.find((entity) => entity.id === answer.selection[0]);
		expect(placed?.components.piece?.type).toBe('platform');
		expect(placed?.components.hitLink?.angle).toBe(0.2);
		expect(cx.undoLabel).toBe('Agent: Place Platform');
		expect(cx.$notice.get()?.message).toBe('Agent: Place Platform');
		expect(cx.$notice.get()?.actions?.some((action) => action.isUndo === true)).toBe(true);
		expect(readMenuItem(cx, { command: 'edit.undo' }, false).title).toBe('Undo Agent: Place Platform');

		cx.undo();
		expect(cx.project?.entities.some((entity) => entity.id === answer.selection[0])).toBe(false);
		expect(cx.undoLabel).toBeNull();
		expect(readMenuItem(cx, { command: 'edit.redo' }, false).title).toBe('Redo Agent: Place Platform');
		expect(readMenuItem(cx, { command: 'edit.undo' }, false).title).toBe('Undo');
	});

	it('should leave a person\'s edits unnamed and in their own steps', async () => {
		const { cx } = studio();
		await runTool(cx, 'run_command', { id: 'project.execute', args: { commands: [{ type: 'setEnd', end: 9 }] } });
		const steps = cx.$history.get()?.past.length ?? 0;
		cx.execute([{ type: 'setEnd', end: 8 }]);
		expect(cx.$history.get()?.past.length).toBe(steps + 1);
		expect(cx.undoLabel).toBeNull();
	});

	it('should refuse an invalid batch without changing the project', async () => {
		const { cx, laneId } = studio();
		const project = cx.project;
		const reply = await runTool(cx, 'run_command', {
			id: 'project.execute',
			args: { commands: [{ type: 'setEnd', end: 9 }, { type: 'placePiece', pieceType: 'nope', hit: { laneId, hitId: 'hit1' } }] }
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
		const { cx, laneId, hitId } = studio();
		let finishBuild: () => void = () => undefined;
		const buildTrack = vi.fn(() => new Promise<null>((resolve) => (finishBuild = () => resolve(null))));
		const key = `hit:${laneId}:${hitId}`;
		const assist = { get rebuildTarget() { return cx.$selection.get().includes(key) ? { laneId, hitId } : null; }, buildTrack, isBuilding: false, isAnswering: false };
		cx.$compose.set({ assist } as never);
		cx.$workspace.set('compose');

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
		expect(buildTrack).toHaveBeenCalledWith({ laneId, hitId });
		expect(isAnswered).toBe(false);
		finishBuild();
		expect((await answer).isError).toBe(false);
	});

	it('should show the running build and its result in get_state', async () => {
		const { cx } = studio();
		const lastBuild = { message: 'Built' };
		cx.$compose.set({ assist: { $building: { get: () => ({ done: 2, total: 5 }) }, $lastBuild: { get: () => lastBuild } } } as never);
		const state = JSON.parse(textOf(await runTool(cx, 'get_state', {})));
		expect(state.building).toEqual({ done: 2, total: 5 });
		expect(state.lastBuild).toEqual(lastBuild);
	});

	it('should select by key with edit.select, and show the Wall and physics in get_state', async () => {
		const { cx, laneId } = studio();
		const reply = await runTool(cx, 'run_command', { id: 'edit.select', args: { select: ['wall'] } });
		expect(JSON.parse(textOf(reply))).toMatchObject({ selection: ['wall'], changed: false });
		const state = JSON.parse(textOf(await runTool(cx, 'get_state', {})));
		expect(state.selection).toEqual([{ kind: 'layer', key: 'wall' }]);
		expect(state.physics).toEqual({ gravityScale: 0.5, default: 0.5, range: [0.05, 2] });
		expect(state.wall).toMatchObject({ own: {} });
		expect((state.wall as { kind: string }).kind).toBeTypeOf('string');
		expect(state.marbles[0]).toMatchObject({ laneId, hitColumns: ['hitId', 'time', 'note', 'status', 'x', 'y'], hitList: [['hit1', 1, 'C4', 'open', 0, -1]] });
	});

	it("should refuse a command's wrong fields, naming them, with no Undo step", async () => {
		const { cx } = studio();
		const before = cx.$history.get();
		for (const command of [{ type: 'setPhysics', gravityScale: 0.4 }, { type: 'setPhysics', foo: 1 }, { type: 'setPhysics', physics: { gravity: 1 } }, { type: 'setComponent', entityId: 'x', component: { name: 'marble', release: {} } }]) {
			const reply = await runTool(cx, 'run_command', { id: 'project.execute', args: { commands: [command] } });
			expect(reply.isError).toBe(true);
			expect(textOf(reply)).toContain("doesn't fit");
		}
		expect(cx.$history.get()).toBe(before);
		const moved = await runTool(cx, 'run_command', { id: 'project.execute', args: { commands: [{ type: 'setPhysics', physics: { gravityScale: 0.4 } }] } });
		expect(JSON.parse(textOf(moved)).changed).toBe(true);
		expect(cx.project?.physics.gravityScale).toBe(0.4);
	});

	it('should say when commands change nothing, and make no Undo step', async () => {
		const { cx } = studio();
		const before = cx.$history.get();
		const gravity = cx.project?.physics.gravityScale;
		const reply = await runTool(cx, 'run_command', { id: 'project.execute', args: { commands: [{ type: 'setPhysics', physics: { gravityScale: gravity } }] } });
		expect(JSON.parse(textOf(reply)).changed).toBe(false);
		expect(cx.$history.get()).toBe(before);
	});

	it('should tell a marble to start at its release, not a transform', async () => {
		const { cx } = studio();
		const marble = cx.project?.entities.find((entity) => entity.components.marble != null);
		const reply = await runTool(cx, 'run_command', { id: 'project.execute', args: { commands: [{ type: 'setComponent', entityId: marble?.id, component: { name: 'transform', value: { position: { x: 1, y: 1 }, angle: 0 } } }] } });
		expect(reply.isError).toBe(true);
		expect(textOf(reply)).toContain('release');
	});

	it('should set Gravity from args.value and refuse it without one', async () => {
		const { cx } = studio();
		const reply = await runTool(cx, 'run_command', { id: 'marble.speed', args: { value: 0.7 } });
		expect(JSON.parse(textOf(reply)).changed).toBe(true);
		expect(cx.project?.physics.gravityScale).toBe(0.7);
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

	function marbleOf(cx: StudioCx): TEntity {
		return cx.project?.entities.find((entity) => entity.components.marble != null) as TEntity;
	}

	function skinItem(id: string, pieceType: string): TLibraryItem {
		return { id, scope: 'project', path: `/x/${id}`, blendPath: `/x/${id}/asset.blend`, previewUrl: null, manifest: { id, label: id, role: 'skin', pieceType }, manifestError: null } as unknown as TLibraryItem;
	}

	describe('skins', () => {
		it.each(['marble:glass', 'marble:metal', 'marble:magic'])('should put %s on a marble from the command to the scene Blender reads', async (skin) => {
			const { cx } = studio();
			const marble = marbleOf(cx);
			const reply = await execute(cx, { type: 'applySkin', assetId: skin, entityIds: [marble.id] });
			expect(reply.isError).toBe(false);
			expect(marbleOf(cx).components.skin?.assetId).toBe(skin);
			const state = JSON.parse(textOf(await runTool(cx, 'get_state', {}))) as { marbles: { skin: string }[] };
			expect(state.marbles[0]?.skin).toBe(skin);
		});

		it('should refuse a skin that does not exist, or fit, with the ones that do', async () => {
			const { cx } = studio();
			const marble = marbleOf(cx);
			for (const assetId of ['marble:nosuchthing', 'platform:copper', 'switchback:gold', 'gift-red']) {
				const reply = await execute(cx, { type: 'applySkin', assetId, entityIds: [marble.id] });
				expect(reply.isError, assetId).toBe(true);
				expect(marbleOf(cx).components.skin).toBeUndefined();
			}
			expect(textOf(await execute(cx, { type: 'applySkin', assetId: 'marble:nosuchthing', pieceType: 'marble' }))).toContain('marble:glass');
			expect(textOf(await execute(cx, { type: 'applySkin', assetId: 'platform:copper', pieceType: 'marble' }))).toContain("can't dress a Marble");
			expect((await execute(cx, { type: 'applySkin', assetId: 'marble:glass', entityIds: ['nobody'] })).isError).toBe(true);
			expect((await execute(cx, { type: 'setComponent', entityId: marble.id, component: { name: 'skin', value: { assetId: 'marble:nope' } } })).isError).toBe(true);
		});

		it('should take a marble skin from the library, and no other piece type', async () => {
			const { cx } = studio();
			cx.library.$projectItems.set([skinItem('green-glass', 'marble'), skinItem('gift-red', 'platform')]);
			const marble = marbleOf(cx);
			expect((await execute(cx, { type: 'applySkin', assetId: 'gift-red', entityIds: [marble.id] })).isError).toBe(true);
			expect((await execute(cx, { type: 'applySkin', assetId: 'green-glass', entityIds: [marble.id] })).isError).toBe(false);
			expect(marbleOf(cx).components.skin?.assetId).toBe('green-glass');
		});

		it("should give the marble a built-in skin's fixed colour", async () => {
			const { cx } = studio();
			const marble = marbleOf(cx);
			expect((await execute(cx, { type: 'applySkin', assetId: 'marble:glass-green', entityIds: [marble.id] })).isError).toBe(false);
			expect(marbleOf(cx).components.marble?.color).toBe('#0c8a3a');
		});

		it('should list every built-in skin and the library in list_commands', async () => {
			const { cx } = studio();
			cx.library.$projectItems.set([skinItem('green-glass', 'marble')]);
			const listed = JSON.parse(textOf(await runTool(cx, 'list_commands', {}))) as { skins: { builtIn: Record<string, string[]>; library: { id: string; fits: string }[] } };
			expect(listed.skins.builtIn['marble']).toContain('marble:glass');
			expect(listed.skins.builtIn['switchback']).toContain('switchback:chrome');
			expect(listed.skins.library).toEqual([expect.objectContaining({ id: 'green-glass', fits: 'marble' })]);
		});
	});

	describe('setDesign', () => {
		it('should refuse an unknown theme and name the ones there are', async () => {
			const { cx } = studio();
			const reply = await execute(cx, { type: 'setDesign', design: { theme: 'theme-nope' } });
			expect(reply.isError).toBe(true);
			expect(textOf(reply)).toContain('There is no theme theme-nope');
			expect(textOf(reply)).toContain('pegboard');
			expect(cx.project?.design.theme).not.toBe('theme-nope');
		});

		it('should change only the fields it names', async () => {
			const { cx } = studio();
			const before = cx.project?.design.camera.distance;
			await execute(cx, { type: 'setDesign', design: { camera: { sway: 0 }, wall: { color: '#f6e3b8' }, lights: { key: { color: '#ffd08a' } } } });
			await execute(cx, { type: 'setDesign', design: { wall: { kind: 'plain' }, lights: { key: { strength: 3 } } } });
			expect(cx.project?.design.camera.sway).toBe(0);
			expect(cx.project?.design.camera.distance).toBe(before);
			expect(cx.project?.design.wall).toEqual({ color: '#f6e3b8', kind: 'plain' });
			expect(cx.project?.design.lights?.key).toEqual({ color: '#ffd08a', strength: 3 });
		});

		it('should say what is wrong with the field that is wrong', async () => {
			const { cx } = studio();
			expect(textOf(await execute(cx, { type: 'setDesign', design: { lights: { fill: {} } } }))).toContain('lights has key and added');
			expect(textOf(await execute(cx, { type: 'setDesign', design: { camera: { zoom: 0.5 } } }))).toContain('sway');
			expect(textOf(await execute(cx, { type: 'setDesign', design: { wall: { paint: '#fff' } } }))).toContain('kind plain');
			const unknown = textOf(await execute(cx, { type: 'setDesign', design: { sky: {} } }));
			expect(unknown).toContain('design takes theme, wall, lights, camera');
			expect(unknown).not.toContain("theme: 'brass' } }.");
		});

		it("should apply an added Pack's theme by its id", async () => {
			const { cx } = studio();
			const theme = { id: 'theme-pack', name: 'Golden', base: 'brass', overrides: { wallColor: '#ffefc8' } };
			addedPacks.set([{ id: 'xmas', name: 'Christmas', version: '1.0', themes: [theme], items: [], builtInDecor: [] } as unknown as TPack]);
			const state = JSON.parse(textOf(await runTool(cx, 'get_state', {}))) as { packThemes: { id: string; pack: string }[] };
			expect(state.packThemes).toEqual([{ id: 'theme-pack', name: 'Golden', pack: 'Christmas' }]);
			expect((await execute(cx, { type: 'setDesign', design: { theme: 'theme-pack' } })).isError).toBe(false);
			expect(cx.project?.design.theme).toBe('theme-pack');
			expect(cx.project?.design.themes?.[0]?.pack?.packName).toBe('Christmas');
			addedPacks.set([]);
		});
	});

	describe('components', () => {
		it('should name the real component names in errors', async () => {
			const { cx } = studio();
			const reply = textOf(await execute(cx, { type: 'setComponent', entityId: marbleOf(cx).id, component: { name: 'walltext', value: {} } }));
			expect(reply).toContain('wallText');
			expect(reply).toContain('hitLink');
		});

		it('should change a marble colour without a radius, and warn when a radius changes', async () => {
			const { cx } = studio();
			const id = marbleOf(cx).id;
			const radius = marbleOf(cx).components.marble?.radius;
			const colour = JSON.parse(textOf(await execute(cx, { type: 'setComponent', entityId: id, component: { name: 'marble', value: { color: '#22ff66' } } }))) as { notices?: string[] };
			expect(marbleOf(cx).components.marble).toMatchObject({ color: '#22ff66', radius });
			expect(colour.notices).toBeUndefined();
			const state = JSON.parse(textOf(await runTool(cx, 'get_state', {}))) as { marbles: { radius: number; color: string }[] };
			expect(state.marbles[0]).toMatchObject({ radius, color: '#22ff66' });
			const bigger = JSON.parse(textOf(await execute(cx, { type: 'setComponent', entityId: id, component: { name: 'marble', value: { radius: 0.0125 } } }))) as { notices: string[] };
			expect(bigger.notices[0]).toContain('radius changes the run');
			expect((await execute(cx, { type: 'setComponent', entityId: id, component: { name: 'marble', value: { radius: 1.2 } } })).isError).toBe(true);
		});

		it('should refuse ids that are not there and fonts a title can not use', async () => {
			const { cx } = studio();
			expect(textOf(await execute(cx, { type: 'removeEntities', entityIds: ['nobody'] }))).toContain('There is nothing called nobody');
			expect((await execute(cx, { type: 'removeLane', laneId: 'nope' })).isError).toBe(true);
			expect((await execute(cx, { type: 'removeSource', sourceId: 'nope' })).isError).toBe(true);
			await runTool(cx, 'run_command', { id: 'design.addText', args: { text: 'Hello' } });
			const title = cx.project?.entities.find((entity) => entity.components.wallText != null) as TEntity;
			expect(textOf(await execute(cx, { type: 'setComponent', entityId: title.id, component: { name: 'wallText', value: { font: 'Georgia' } } }))).toContain("isn't a font");
		});
	});

	describe('titles and shots', () => {
		it('should add a title with its words, readable in get_state', async () => {
			const { cx } = studio();
			const reply = JSON.parse(textOf(await runTool(cx, 'run_command', { id: 'design.addText', args: { text: 'Jingle Bells', style: 'songName', at: { x: 0.1, y: -0.2 }, color: '#112233' } }))) as { changed: boolean };
			expect(reply.changed).toBe(true);
			const state = JSON.parse(textOf(await runTool(cx, 'get_state', {}))) as { layers: { titles: { text: string; style: string }[] } };
			expect(state.layers.titles).toEqual([expect.objectContaining({ text: 'Jingle Bells', style: 'songName' })]);
			const title = cx.project?.entities.find((entity) => entity.components.wallText != null);
			expect(title?.components.transform?.position).toEqual({ x: 0.1, y: -0.2 });
			expect(title?.components.wallText?.color).toBe('#112233');
			expect((await runTool(cx, 'run_command', { id: 'design.addText', args: { style: 'nope' } })).isError).toBe(true);
		});

		it('should add a shot from its arguments, readable in get_state', async () => {
			const { cx } = studio();
			await runTool(cx, 'run_command', { id: 'camera.addShot', args: { time: 3, kind: 'wide', roll: 0.1, distance: 1.2, length: 2 } });
			const state = JSON.parse(textOf(await runTool(cx, 'get_state', {}))) as { camera: { shots: unknown[]; distance: number } };
			expect(state.camera.shots).toEqual([expect.objectContaining({ time: 3, kind: 'wide', roll: 0.1, distance: 1.2, length: 2 })]);
			expect(state.camera.distance).toBeGreaterThan(0);
		});

		it('should say why Add Wide Shot Here can not run, in the list and the reply', async () => {
			const { cx } = studio();
			cx.$workspace.set('design');
			const reply = await runTool(cx, 'run_command', { id: 'camera.addWideShot', args: { time: 0.5 } });
			expect(textOf(reply)).toContain('none does here');
			expect(reply.isError).toBe(true);
			const listed = JSON.parse(textOf(await runTool(cx, 'list_commands', { filter: 'wide shot' }))) as { commands: { id: string; why?: string }[] };
			expect(listed.commands.find((item) => item.id === 'camera.addWideShot')?.why).toContain('camera.addShot');
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
			expect((await runTool(cx, 'run_command', { id: 'design.removePack', args: { name: 'christmas' } })).isError).toBe(false);
			expect(removed).toHaveBeenCalledTimes(1);
			expect(textOf(await runTool(cx, 'run_command', { id: 'design.removePack', args: { name: 'starter' } }))).toContain("can't be removed");
			expect(removed).toHaveBeenCalledTimes(1);
			expect(textOf(await runTool(cx, 'run_command', { id: 'design.removePack', args: { name: 'Nope' } }))).toContain('No Pack called Nope');
			addedPacks.set([]);
			vi.restoreAllMocks();
		});
	});

	it('should wait for a person mid-gesture, then say busy', async () => {
		const { cx } = studio();
		cx.mcp.isPointerDown = true;
		expect(busyReason(cx)).toContain('middle of a drag');
		const pending = runTool(cx, 'run_command', { id: 'project.execute', args: { commands: [{ type: 'setEnd', end: 9 }] } });
		const reply = await pending;
		expect(reply.isError).toBe(true);
		expect(textOf(reply)).toContain('middle of a drag');
		expect(cx.project?.end).not.toBe(9);

		const later = runTool(cx, 'run_command', { id: 'project.execute', args: { commands: [{ type: 'setEnd', end: 9 }] } });
		await new Promise((resolve) => setTimeout(resolve, 100));
		cx.mcp.isPointerDown = false;
		expect((await later).isError).toBe(false);
		expect(cx.project?.end).toBe(9);
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

describe('expandCommands function', () => {
	it('should place a free piece with its parameters, and pass project commands through', () => {
		const { project } = projectWithHit();
		const [isOk, , expanded] = expandCommands(project, null, [], [{ type: 'placePiece', pieceType: 'platform', position: { x: 1, y: 2 }, angle: 0.5, params: { length: 0.1 }, name: 'Top' }, { type: 'setEnd', end: 3 }]);
		expect(isOk).toBe(true);
		const placed = expanded?.commands[0];
		expect(placed?.type === 'upsertEntity' && placed.entity.components.transform).toEqual({ position: { x: 1, y: 2 }, angle: 0.5 });
		expect(placed?.type === 'upsertEntity' && placed.entity.components.piece?.params['length']).toBe(0.1);
		expect(placed?.type === 'upsertEntity' && placed.entity.name).toBe('Top');
		expect(expanded?.commands[1]).toEqual({ type: 'setEnd', end: 3 });
		expect(expanded?.summary).toBeNull();
	});

	it('should name a uniform batch for its Undo step', () => {
		const { project } = projectWithHit();
		const [, , expanded] = expandCommands(project, null, [], [{ type: 'placePiece', pieceType: 'rail', position: { x: 0, y: 0 }, path: [{ x: 0, y: 0 }, { x: 1, y: 0 }] }]);
		expect(expanded?.summary).toBe('Place Rail');
	});

	it('should refuse what it can\'t do in plain words', () => {
		const { project, laneId, hitId } = projectWithHit();
		expect(expandCommands(project, null, [], [{ type: 'placePiece', pieceType: 'platform', hit: { laneId, hitId } }])[1]?.message).toContain('no dot yet');
		expect(expandCommands(project, null, [], [{ type: 'placePiece', pieceType: 'platform' }])[1]?.message).toContain('hit or a position');
		expect(expandCommands(project, null, [], [{ type: 'applySkin', assetId: 'gone', pieceType: 'platform' }])[1]?.message).toContain('add_asset');
		expect(expandCommands(project, null, [], [{ type: 'placeDecor', source: 'gone', at: { x: 0, y: 0 } }])[1]?.message).toContain("isn't a Decor item");
	});
});
