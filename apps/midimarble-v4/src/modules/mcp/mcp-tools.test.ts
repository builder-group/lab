import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHistory, createLane, createMarble, createProject, type TProject } from '@/modules/project';
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
	});
	afterEach(() => {
		vi.useRealTimers();
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

	it('should select by key with edit.select, and show the Wall and physics in get_state', async () => {
		const { cx, laneId } = studio();
		const reply = await runTool(cx, 'run_command', { id: 'edit.select', args: { select: ['wall'] } });
		expect(JSON.parse(textOf(reply))).toMatchObject({ selection: ['wall'], changed: false });
		const state = JSON.parse(textOf(await runTool(cx, 'get_state', {})));
		expect(state.selection).toEqual(['wall']);
		expect(state.physics).toEqual({ gravityScale: 0.5, default: 0.5, range: [0.05, 2] });
		expect(state.wall).toEqual({});
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

	it('should set Marble Speed from args.value and refuse it without one', async () => {
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
		expect(reply.undid).toBe('Agent: Marble Speed');
		expect(reply.changed).toBe(false);
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
