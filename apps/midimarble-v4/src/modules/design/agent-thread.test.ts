import { describe, expect, it } from 'vitest';
import type { TAgentRun } from '@/modules/agents';
import { agentSetupNote, loginHint, toThreadItem } from './agent-thread';

function run(patch: Partial<TAgentRun>): TAgentRun {
	return {
		id: 'run-1',
		cli: 'claude',
		prompt: 'make this a piano key\n\nSelected in the app:\n- Platform 1',
		request: 'make this a piano key',
		isChat: true,
		target: { kind: 'piece', entityId: 'piece-1' },
		status: 'running',
		review: null,
		phase: 'working',
		startedAt: 1,
		finishedAt: null,
		error: null,
		runPath: '/p/agent/runs/run-1',
		candidatePath: '/p/candidates/run-1',
		hasAsset: false,
		manifestJson: null,
		manifest: null,
		manifestError: null,
		previewUrl: null,
		messages: [],
		acceptedItemId: null,
		...patch
	};
}

describe('toThreadItem function', () => {
	it('should show the message as written and offer stopping while working', () => {
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
		expect(item).toMatchObject({ canAccept: true, canCancel: false, candidate: { previewUrl: 'asset://preview.png', label: 'Piano Key' }, usage: '1 min 4 s' });
		expect(toThreadItem(run({ isChat: false, messages: [{ kind: 'result', text: '', durationMs: 64000, costUsd: 0.42, turns: 3 }] })).usage).toBe('1 min 4 s · $0.42');
	});

	it('should show the theme of a New Theme Result, with its skin as the second part', () => {
		const item = toThreadItem(
			run({
				request: '@[Platform 1] New theme: sunset orange',
				status: 'succeeded',
				phase: 'review',
				previewUrl: 'asset://preview.png',
				manifest: {
					$schema: 'marble-asset@1',
					id: 'sunset-arch',
					label: 'Sunset Arch',
					role: 'skin',
					theme: { name: 'Sunset', base: 'pegboard', overrides: { wallColor: '#e8742c' } }
				}
			})
		);
		expect(item.candidate).toEqual({ previewUrl: 'asset://preview.png', label: 'Sunset Arch', theme: { name: 'Sunset', base: 'pegboard', overrides: { wallColor: '#e8742c' } } });
	});

	it('should leave out a theme the request did not ask for', () => {
		const item = toThreadItem(
			run({
				status: 'succeeded',
				phase: 'review',
				previewUrl: 'asset://preview.png',
				manifest: { $schema: 'marble-asset@1', id: 'key', label: 'Key', role: 'skin', theme: { name: 'Stray', base: 'brass', overrides: {} } }
			})
		);
		expect(item.candidate?.theme).toBeNull();
	});

	it('should fold early tool steps and keep the latest ones', () => {
		const messages = Array.from({ length: 7 }, (_, index) => ({ kind: 'tool' as const, id: `t${index}`, tool: 'Bash', summary: `Step ${index}`, status: 'done' as const }));
		const item = toThreadItem(run({ messages: [{ kind: 'text', text: 'Planning' }, ...messages, { kind: 'text', text: 'Rendering the preview' }] }));
		expect(item.hiddenSteps).toBe(3);
		expect(item.lines.map((line) => line.text)).toEqual(['Step 3', 'Step 4', 'Step 5', 'Step 6', 'Rendering the preview']);
	});

	it('should show what the agent says last, as it streams and when it is done', () => {
		expect(toThreadItem(run({})).reply).toBeNull();
		expect(toThreadItem(run({ messages: [{ kind: 'text', text: 'Moving', isPartial: true }] })).reply).toBe('Moving');
		const steps = [{ kind: 'tool' as const, id: 't', tool: 'x', summary: 'x', status: 'done' as const }];
		expect(toThreadItem(run({ messages: [{ kind: 'text', text: 'First' }, ...steps, { kind: 'text', text: 'Moved it' }] })).reply).toBe('Moved it');
	});

	it('should turn a login failure into the command that fixes it', () => {
		const item = toThreadItem(run({ status: 'failed', phase: 'failed', error: 'Invalid API key · Please run /login' }));
		expect(item.setup?.command).toBe('claude /login');
	});
});

describe('agent setup hints', () => {
	it('should say in one line what to install and that the app works by hand, and nothing when one is ready', () => {
		expect(agentSetupNote('missing', [])).toContain('Install Claude Code or Codex');
		expect(agentSetupNote('missing', [])).toContain('by hand');
		expect(agentSetupNote('unavailable', [])).toContain('desktop app');
		expect(agentSetupNote('unknown', [])).toBeNull();
		expect(agentSetupNote('ready', [{ cli: 'codex', path: '/bin/codex', version: null }])).toBeNull();
	});

	it('should only treat authentication errors as login problems', () => {
		expect(loginHint('codex', 'Not logged in')?.command).toBe('codex login');
		expect(loginHint('claude', 'Blender crashed while rendering')).toBeNull();
	});
});
