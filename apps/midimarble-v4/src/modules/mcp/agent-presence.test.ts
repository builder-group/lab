import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHistory, createLane, createMarble, createProject, type TProject } from '@/modules/project';
import type { TSimulationResult } from '@/modules/simulation';
import { StudioCx } from '@/modules/studio';
import { agentClientName, agentStatusLine, connectedAgents, doingWords, editPresenceLabel, presenceLabel, touchedKeys } from './agent-presence';
import { AgentPresenceCx, PRESENCE_HOLD_MS, STOP_GRACE_MS, TOUCH_MS } from './AgentPresenceCx';
import { resolveSelection } from './mcp-state';

describe('Agent status line', () => {
	it('should say who is connected in product names', () => {
		expect(agentStatusLine(true, [])).toBe('No agent connected');
		expect(agentStatusLine(true, ['Claude Code'])).toBe('Claude Code connected');
		expect(agentStatusLine(true, ['Claude Code', 'Codex'])).toBe('Claude Code and Codex connected');
		expect(agentStatusLine(false, [])).toBe('MCP is off');
	});

	it('should count a tool set up through Connect as connected, as a live session is, while MCP is on', () => {
		const none = { claude: false, codex: false };
		expect(connectedAgents(true, [], none)).toEqual([]);
		expect(connectedAgents(true, [], { claude: true, codex: false })).toEqual(['Claude Code']);
		expect(connectedAgents(true, ['claude-code', 'claude-code'], { claude: true, codex: false })).toEqual(['Claude Code']);
		expect(connectedAgents(true, ['codex-mcp-client'], none)).toEqual(['Codex']);
		expect(connectedAgents(false, ['claude-code'], { claude: true, codex: true })).toEqual([]);
	});

	it('should keep an unknown client as it calls itself', () => {
		expect(agentClientName('cursor-vscode')).toBe('cursor-vscode');
		expect(agentClientName('')).toBe('An agent');
	});
});

describe('Presence words', () => {
	const titleOf = (id: string): string | null => ({ 'build.track': 'Build Track', 'build.addBowl': 'Add Bowl', 'view.track': 'Track' })[id] ?? null;

	it('should say what a call is doing and nothing for what only reads', () => {
		expect(presenceLabel('run_command', { id: 'build.track' }, titleOf)).toBe('Building Track');
		expect(presenceLabel('run_command', { id: 'view.track' }, titleOf)).toBe('Track');
		expect(presenceLabel('run_command', { id: 'project.execute', args: { label: 'Tilt Platform 12' } }, titleOf)).toBe('Tilting Platform 12');
		expect(presenceLabel('run_command', { id: 'project.execute', args: {} }, titleOf)).toBe('Editing');
		expect(presenceLabel('preview_frame', { time: 12 }, titleOf)).toContain('Looking at');
		expect(presenceLabel('export_film', { quality: 'draft' }, titleOf)).toBe('Exporting Film');
		for (const quiet of [presenceLabel('get_state', {}, titleOf), presenceLabel('list_commands', {}, titleOf), presenceLabel('export_film', {}, titleOf), presenceLabel('run_command', { id: 'build.stop' }, titleOf), presenceLabel('run_command', { id: 'edit.select' }, titleOf)]) expect(quiet).toBeNull();
	});

	it('should name the piece an edit placed', () => {
		expect(editPresenceLabel(undefined, 'Place Platform', 'Platform 12')).toBe('Placing Platform 12');
		expect(editPresenceLabel(undefined, 'Place Platform (3)', null)).toBe('Placing Platform (3)');
		expect(editPresenceLabel('Swing wider', 'Place Platform', 'Platform 12')).toBe('Swing wider');
		expect(editPresenceLabel(undefined, null, null)).toBe('Editing');
		expect(doingWords('Add Bowl…')).toBe('Adding Bowl');
	});
});

describe('AgentPresenceCx', () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});
	afterEach(() => {
		vi.useRealTimers();
	});

	it('should show while calls run and go shortly after the last', () => {
		const presence = new AgentPresenceCx();
		const endFirst = presence.begin('Placing Platform');
		expect(presence.$current.get()).toEqual({ label: 'Placing Platform', isStopping: false });
		endFirst();
		vi.advanceTimersByTime(PRESENCE_HOLD_MS - 1);
		expect(presence.$current.get()?.label).toBe('Placing Platform');
		const endSecond = presence.begin('Adding Bowl');
		vi.advanceTimersByTime(PRESENCE_HOLD_MS * 2);
		expect(presence.$current.get()?.label).toBe('Adding Bowl');
		endSecond();
		vi.advanceTimersByTime(PRESENCE_HOLD_MS);
		expect(presence.$current.get()).toBeNull();
	});

	it('should say Stopping until the running call has ended, then go at once', () => {
		const presence = new AgentPresenceCx();
		const end = presence.begin('Building Track');
		const epoch = presence.stopEpoch;
		presence.requestStop();
		expect(presence.stopEpoch).toBe(epoch + 1);
		expect(presence.$current.get()?.isStopping).toBe(true);
		expect(presence.isStopHeld).toBe(true);
		end();
		expect(presence.$current.get()).toBeNull();
		vi.advanceTimersByTime(STOP_GRACE_MS);
		expect(presence.isStopHeld).toBe(false);
	});

	it('should notify only on what changes, never per frame', () => {
		const presence = new AgentPresenceCx();
		const seen = vi.fn();
		presence.$current.listen(seen);
		const end = presence.begin('Editing');
		presence.relabel('Editing');
		presence.relabel('Placing Platform 3');
		end();
		expect(seen).toHaveBeenCalledTimes(2);
	});

	it('should mark what was touched for about a second, restarting a piece touched again', () => {
		const presence = new AgentPresenceCx();
		presence.touch(['piece1', 'wall']);
		const first = presence.$touched.get().find((item) => item.key === 'piece1')?.stamp;
		vi.advanceTimersByTime(TOUCH_MS / 2);
		presence.touch(['piece1']);
		const second = presence.$touched.get().find((item) => item.key === 'piece1')?.stamp;
		expect(second).not.toBe(first);
		vi.advanceTimersByTime(TOUCH_MS / 2);
		expect(presence.$touched.get().map((item) => item.key)).toEqual(['piece1']);
		vi.advanceTimersByTime(TOUCH_MS / 2);
		expect(presence.$touched.get()).toEqual([]);
	});
});

function withPiece(): { project: TProject; marbleId: string; hitId: string; pieceId: string; result: TSimulationResult } {
	const project = createProject({ title: 'Song' });
	const marble = { ...createLane(0), hits: [{ id: 'hit1', time: 1.5, pitch: 60 }, { id: 'hit2', time: 2, pitch: 62 }] };
	const pieceId = 'platform1';
	const piece = { id: pieceId, name: 'Platform 1', components: { piece: { type: 'platform', params: { length: 0.08 } }, hitLink: { marbleId: marble.id, hitId: 'hit1', angle: 0.25 } } } as unknown as TProject['entities'][number];
	const next = { ...project, music: { ...project.music, marbles: [marble] }, entities: [createMarble(marble, { x: 0, y: 0 }), piece] };
	const result = {
		revision: next.revision,
		pieces: [{ entityId: pieceId, position: { x: 0.1, y: -0.2 } }],
		hits: [
			{ marbleId: marble.id, hitId: 'hit1', targetTime: 1.5, pieceEntityId: pieceId, dot: { x: 0.1, y: -0.2 }, status: 'onTime' },
			{ marbleId: marble.id, hitId: 'hit2', targetTime: 2, pieceEntityId: null, dot: null, status: 'open' }
		]
	} as unknown as TSimulationResult;
	return { project: next, marbleId: marble.id, hitId: 'hit1', pieceId, result };
}

describe('touchedKeys', () => {
	it('should find the entities and layers an edit changed, not a removed one', () => {
		const { project, pieceId } = withPiece();
		expect(touchedKeys(project, { ...project, revision: project.revision + 1 })).toEqual([]);
		const changed = project.entities.map((entity) => (entity.id === pieceId ? { ...entity, name: 'Renamed' } : entity));
		const added = { id: 'new1', name: 'New', components: {} } as TProject['entities'][number];
		expect(touchedKeys(project, { ...project, entities: [...changed, added] })).toEqual([pieceId, 'new1']);
		expect(touchedKeys(project, { ...project, entities: project.entities.filter((entity) => entity.id !== pieceId) })).toEqual([]);
		expect(touchedKeys(project, { ...project, film: { ...project.film, wall: { color: '#123456' } } as TProject['film'] })).toContain('wall');
		expect(touchedKeys(project, { ...project, film: { ...project.film, lights: { ...project.film.lights, key: { color: '#ffffff' } } } as TProject['film'] })).toContain('light:key');
	});
});

describe('resolveSelection', () => {
	it('should give a hit its marble, time, note, status and platform', () => {
		const { project, marbleId, result, pieceId } = withPiece();
		const key = `hit:${marbleId}:hit1`;
		expect(resolveSelection(project, result, [key])).toEqual([
			{
				kind: 'hit',
				key,
				marbleId,
				hitId: 'hit1',
				marble: expect.any(String) as string,
				time: 1.5,
				note: 'C4',
				status: 'onTime',
				dot: { x: 0.1, y: -0.2 },
				platform: { id: pieceId, name: 'Platform 1', type: 'platform', x: 0.1, y: -0.2, angle: 0.25, length: 0.08 }
			}
		]);
	});

	it('should say an open hit has no platform yet', () => {
		const { project, marbleId, result } = withPiece();
		expect(resolveSelection(project, result, [`hit:${marbleId}:hit2`])[0]).toMatchObject({ status: 'open', platform: null, dot: null, note: 'D4' });
	});

	it('should give a piece its hit, and resolve several at once', () => {
		const { project, marbleId, result, pieceId } = withPiece();
		const items = resolveSelection(project, result, [pieceId, 'wall', 'light:key']);
		expect(items[0]).toMatchObject({ kind: 'piece', id: pieceId, x: 0.1, angle: 0.25, length: 0.08, hit: { key: `hit:${marbleId}:hit1`, time: 1.5, note: 'C4', status: 'onTime' } });
		expect(items[1]).toEqual({ kind: 'layer', key: 'wall' });
		expect(items[2]).toEqual({ kind: 'light', key: 'light:key', id: 'key' });
	});

	it('should be empty for the Scene', () => {
		const { project, result } = withPiece();
		expect(resolveSelection(project, result, [])).toEqual([]);
	});
});

describe('Stop and edits through McpCx', () => {
	beforeEach(() => {
		vi.useFakeTimers({ shouldAdvanceTime: true, advanceTimeDelta: 40 });
		vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => undefined, removeItem: () => undefined });
	});
	afterEach(() => {
		vi.useRealTimers();
		vi.unstubAllGlobals();
	});

	function studio(): StudioCx {
		const { project, result } = withPiece();
		const cx = new StudioCx();
		// Edits check the whole project, and the fixture's piece holds only what resolving a selection reads
		cx.$history.set(createHistory({ ...project, entities: project.entities.filter((entity) => entity.components.marble != null) }));
		cx.simulation.$result.set(result);
		cx.$history.listen(({ value }) => {
			if (value != null) cx.simulation.$result.set({ ...result, revision: value.present.revision });
		});
		return cx;
	}
	const call = (tool: string, args: unknown): { tool: string; argumentsJson: string } => ({ tool, argumentsJson: JSON.stringify(args) });

	it('should show a running call and say Stop in its reply; an edit that had not landed stays out', async () => {
		const cx = studio();
		const arrival = { epoch: cx.mcp.presence.stopEpoch, isStopHeld: false };
		const answer = cx.mcp.answer(call('run_command', { id: 'project.execute', args: { commands: [{ type: 'updateProject', patch: { title: 'Renamed' } }], label: 'Rename' } }), arrival);
		await vi.advanceTimersByTimeAsync(5);
		expect(cx.mcp.presence.$current.get()?.label).toBe('Renaming');
		cx.mcp.stop();
		expect(cx.mcp.presence.$current.get()?.isStopping).toBe(true);
		const reply = await answer;
		expect(reply.content.at(-1)).toMatchObject({ text: expect.stringContaining('pressed Stop') as string });
		expect(cx.project?.title).toBe('Song');
		expect(cx.mcp.presence.$current.get()).toBeNull();
	});

	it('should end an agent build on Stop and keep what it built, leaving a person\'s own build alone', async () => {
		const cx = studio();
		const assist = { stopBuild: vi.fn(), isBuilding: true };
		Object.assign(cx, { assist, patterns: { stop: vi.fn() } });
		cx.mcp.stop();
		expect(assist.stopBuild).not.toHaveBeenCalled();
		let bowl: () => void = () => undefined;
		const step = cx.runAgentStep('Agent: Build Track', () => new Promise<void>((resolve) => (bowl = resolve)));
		cx.mcp.stop();
		expect(assist.stopBuild).toHaveBeenCalledTimes(1);
		bowl();
		await step;
	});

	it('should turn away a call that waited behind Stop, but not one that only reads', async () => {
		const cx = studio();
		const arrival = { epoch: cx.mcp.presence.stopEpoch, isStopHeld: false };
		cx.mcp.stop();
		const refused = await cx.mcp.answer(call('run_command', { id: 'project.execute', args: { commands: [{ type: 'updateProject', patch: { title: 'Nope' } }] } }), arrival);
		expect(refused.isError).toBe(true);
		expect(cx.project?.title).toBe('Song');
		const reading = await cx.mcp.answer(call('list_commands', {}), arrival);
		expect(reading.isError).toBe(false);
	});

	it('should mark what an agent edit changed, and not a person edit', async () => {
		const cx = studio();
		const stop = cx.mcp.watchEdits();
		const seen: string[][] = [];
		cx.mcp.presence.$touched.listen(({ value }) => {
			seen.push(value.map((item) => item.key));
		});
		cx.execute([{ type: 'updateProject', patch: { gravity: 0.5 } }]);
		expect(seen).toEqual([]);
		const marble = cx.project?.entities.find((item) => item.components.marble != null);
		const outcome = await cx.runAgentStep('Agent: Rename', async () => {
			if (marble != null) cx.execute([{ type: 'upsertEntity', entity: { ...marble, name: 'Renamed' } }]);
		});
		expect(outcome.notices).toEqual([]);
		expect(seen[0]).toEqual([marble?.id]);
		stop();
	});
});
