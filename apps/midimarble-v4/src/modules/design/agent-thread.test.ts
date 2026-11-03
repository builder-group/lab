import { describe, expect, it } from 'vitest';
import type { TAgentRun } from '@/modules/agents';
import { agentSetupHint, agentThread, loginHint, toThreadItem } from './agent-thread';

function run(patch: Partial<TAgentRun>): TAgentRun {
	return {
		id: 'run-1',
		cli: 'claude',
		prompt: 'make this a piano key\n\nRead BRIEF.md in this folder first and follow its output contract.',
		target: { kind: 'piece', entityId: 'piece-1' },
		status: 'running',
		review: null,
		phase: 'working',
		startedAt: 1,
		finishedAt: null,
		error: null,
		candidatePath: '/c/run-1',
		hasAsset: false,
		manifestJson: null,
		manifest: null,
		manifestError: null,
		previewUrl: null,
		outsideChanges: [],
		messages: [],
		acceptedItemId: null,
		...patch
	};
}

describe('agentThread function', () => {
	it('should list a target runs oldest first and put runs without a known target in the scene thread', () => {
		const runs = [
			run({ id: 'b', startedAt: 2 }),
			run({ id: 'a', startedAt: 1 }),
			run({ id: 'other', target: { kind: 'piece', entityId: 'piece-2' } }),
			run({ id: 'old', target: null })
		];
		expect(agentThread(runs, { kind: 'piece', entityId: 'piece-1' }).map((item) => item.id)).toEqual(['a', 'b']);
		expect(agentThread(runs, { kind: 'scene' }).map((item) => item.id)).toEqual(['old']);
	});
});

describe('toThreadItem function', () => {
	it('should show the request without the brief instruction and offer cancel while working', () => {
		const item = toThreadItem(run({}));
		expect(item.prompt).toBe('make this a piano key');
		expect(item).toMatchObject({ canCancel: true, canAccept: false, candidate: null, phaseLabel: 'Working…' });
	});

	it('should offer a candidate card with accept once a preview is ready', () => {
		const item = toThreadItem(
			run({
				status: 'succeeded',
				phase: 'review',
				hasAsset: true,
				previewUrl: 'asset://preview.png',
				manifest: { $schema: 'marble-asset@1', id: 'piano-key', label: 'Piano Key', role: 'skin' },
				messages: [{ kind: 'result', text: 'Done', durationMs: 64000, costUsd: 0.42, turns: 3 }]
			})
		);
		expect(item).toMatchObject({ canAccept: true, canCancel: false, candidate: { previewUrl: 'asset://preview.png', label: 'Piano Key' }, usage: '1 min 4 s · $0.42' });
	});

	it('should fold early tool steps and keep the latest ones', () => {
		const messages = Array.from({ length: 7 }, (_, index) => ({ kind: 'tool' as const, id: `t${index}`, tool: 'Bash', summary: `Step ${index}`, status: 'done' as const }));
		const item = toThreadItem(run({ messages: [{ kind: 'text', text: 'Planning' }, ...messages, { kind: 'text', text: 'Rendering the preview' }] }));
		expect(item.hiddenSteps).toBe(3);
		expect(item.lines.map((line) => line.text)).toEqual(['Step 3', 'Step 4', 'Step 5', 'Step 6', 'Rendering the preview']);
	});

	it('should turn a login failure into the command that fixes it', () => {
		const item = toThreadItem(run({ status: 'failed', phase: 'failed', error: 'Invalid API key · Please run /login' }));
		expect(item.setup?.command).toBe('claude /login');
	});
});

describe('agent setup hints', () => {
	it('should name the fix for a missing CLI and say nothing when one is ready', () => {
		expect(agentSetupHint('missing', [])?.command).toContain('claude /login');
		expect(agentSetupHint('unavailable', [])?.command).toBeNull();
		expect(agentSetupHint('ready', [{ cli: 'codex', path: '/bin/codex', version: null }])).toBeNull();
	});

	it('should only treat authentication errors as login problems', () => {
		expect(loginHint('codex', 'Not logged in')?.command).toBe('codex login');
		expect(loginHint('claude', 'Blender crashed while rendering')).toBeNull();
	});
});
