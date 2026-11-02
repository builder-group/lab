import { createState } from 'feature-state';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as desktop from '../../environment/desktop';
import { createPart, createProject, executeCommands, type TProject } from '../project/model';
import { AgentCx } from './AgentCx';

vi.mock('../../environment/desktop', () => ({
	isDesktop: vi.fn(() => true),
	agentCapabilities: vi.fn(),
	subscribeAgentEvents: vi.fn(),
	listAgentProposals: vi.fn(),
	startAgentJob: vi.fn(),
	getAgentJob: vi.fn(),
	cancelAgentJob: vi.fn(),
	dismissAgentProposal: vi.fn(),
	openProject: vi.fn()
}));
const cleanups: (() => void)[] = [];
beforeEach(() => {
	vi.clearAllMocks();
	vi.mocked(desktop.agentCapabilities).mockResolvedValue({
		codexPath: '/codex',
		executable: '/Yadori',
		dataRoot: '/data',
		mcpArgs: ['--mcp', '--data-root', '/data']
	});
	vi.mocked(desktop.subscribeAgentEvents).mockResolvedValue(vi.fn());
	vi.mocked(desktop.listAgentProposals).mockResolvedValue([]);
	vi.mocked(desktop.cancelAgentJob).mockResolvedValue();
});
afterEach(() => {
	for (const cleanup of cleanups.splice(0)) cleanup();
});
function fixture() {
	const part = createPart('Pump');
	const state = createState<TProject | null>(
		executeCommands(createProject(), [{ type: 'part.add', part }])
	);
	const host = {
		$project: state,
		$save: createState<{ state: 'saved' | 'error'; error?: string }>({ state: 'saved' }),
		flush: vi.fn(async () => {}),
		execute: vi.fn((commands: Parameters<typeof executeCommands>[1]) => {
			state.set(executeCommands(must(state.get()), commands));
			return true;
		})
	};
	const cx = new AgentCx(host);
	return { cx, host, part, state };
}
describe('AgentCx class', () => {
	it('should perform no agent job or account action on construction and mounting', async () => {
		const { cx } = fixture();
		cleanups.push(cx.mount());
		await vi.waitFor(() => expect(desktop.agentCapabilities).toHaveBeenCalledOnce());
		expect(desktop.startAgentJob).not.toHaveBeenCalled();
		expect(cx.mcpConfiguration()).toContain('--project');
	});
	it('should flush before starting an explicitly requested job at the saved revision', async () => {
		const { cx, host, state } = fixture();
		vi.mocked(desktop.startAgentJob).mockResolvedValue({
			id: 'job',
			projectId: must(state.get()).id,
			state: 'running',
			detail: 'Starting',
			proposalId: null
		});
		await cx.start('Research the pump');
		expect(host.flush).toHaveBeenCalledOnce();
		expect(host.flush.mock.invocationCallOrder[0]).toBeLessThan(
			vi.mocked(desktop.startAgentJob).mock.invocationCallOrder[0] ?? -Infinity
		);
		expect(desktop.startAgentJob).toHaveBeenCalledWith(
			must(state.get()).id,
			must(state.get()).revision,
			'Research the pump'
		);
		expect(cx.$jobs.get()[0]?.state).toBe('running');
	});
	it('should retain a proposal when its applied changes fail to reach durable storage', async () => {
		const { cx, part, state } = fixture();
		const project = must(state.get());
		const proposal = {
			id: 'proposal',
			projectId: project.id,
			baseRevision: project.revision,
			summary: 'Notes',
			createdAt: '2026-11-02',
			commands: [{ type: 'part.update', id: part.id, patch: { notes: 'Research' } }]
		};
		vi.mocked(desktop.openProject).mockResolvedValue({
			id: project.id,
			name: project.name,
			revision: project.revision,
			updatedAt: project.updatedAt,
			content: JSON.stringify(project),
			path: '/project.json'
		});
		expect(await cx.acceptProposal(proposal)).toBe(false);
		expect(must(state.get()).parts[0]?.notes).toBe('Research');
		expect(desktop.dismissAgentProposal).not.toHaveBeenCalled();
		expect(cx.$error.get()).toContain('could not be saved');
	});
	it('should not start a task when flushing leaves an unresolved draft', async () => {
		const { cx, host } = fixture();
		host.flush.mockImplementationOnce(async () => {
			host.$save.set({ state: 'error', error: 'Resolve the notes draft before saving.' });
		});
		await cx.start('Research the pump');
		expect(desktop.startAgentJob).not.toHaveBeenCalled();
		expect(cx.$error.get()).toContain('notes draft');
	});
	it('should flush local typing before validating an agent proposal revision', async () => {
		const { cx, host, part, state } = fixture();
		const before = must(state.get());
		host.flush.mockImplementationOnce(async () => {
			state.set(
				executeCommands(before, [
					{ type: 'part.update', id: part.id, patch: { notes: 'Local draft' } }
				])
			);
		});
		const applied = await cx.acceptProposal({
			id: 'before-typing',
			projectId: before.id,
			baseRevision: before.revision,
			summary: 'Notes',
			createdAt: '2026-11-02',
			commands: [{ type: 'part.update', id: part.id, patch: { notes: 'Agent replacement' } }]
		});
		expect(applied).toBe(false);
		expect(host.execute).not.toHaveBeenCalled();
		expect(must(state.get()).parts[0]?.notes).toBe('Local draft');
		expect(desktop.dismissAgentProposal).not.toHaveBeenCalled();
	});
	it('should reject stale proposals before executing any changes', async () => {
		const { cx, host, state } = fixture();
		const project = must(state.get());
		expect(
			await cx.acceptProposal({
				id: 'old',
				projectId: project.id,
				baseRevision: 0,
				summary: 'Stale',
				createdAt: '2026-11-02',
				commands: []
			})
		).toBe(false);
		expect(host.execute).not.toHaveBeenCalled();
	});
	it('should retain state references when the immutable proposal inbox is unchanged', async () => {
		const { cx, state } = fixture();
		const project = must(state.get());
		const proposal = {
			id: 'same',
			projectId: project.id,
			baseRevision: project.revision,
			summary: 'Review',
			commands: [],
			createdAt: '2026-11-02'
		};
		vi.mocked(desktop.listAgentProposals).mockResolvedValue([proposal]);
		await cx.refresh();
		const first = cx.$proposals.get();
		vi.mocked(desktop.listAgentProposals).mockResolvedValue([{ ...proposal }]);
		await cx.refresh();
		expect(cx.$proposals.get()).toBe(first);
	});
});

function must<T>(value: T | null | undefined): T {
	if (value == null) throw new Error('Missing fixture value');
	return value;
}
