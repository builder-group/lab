import { describe, expect, it } from 'vitest';
import { condenseAgentLines, summarizeToolUse } from './agent-messages';
import { agentRunPhase, agentRunPhaseLabel, formatAgentUsage } from './agent-status';

const claudeLines = [
	JSON.stringify({ type: 'system', subtype: 'init', model: 'claude-sonnet-4-5' }),
	JSON.stringify({
		type: 'assistant',
		message: { content: [{ type: 'text', text: 'I will build the bar.' }] }
	}),
	JSON.stringify({
		type: 'assistant',
		message: {
			content: [
				{
					type: 'tool_use',
					id: 't1',
					name: 'Write',
					input: { file_path: '/p/candidates/r/build_asset.py' }
				},
				{
					type: 'tool_use',
					id: 't2',
					name: 'Bash',
					input: {
						command:
							'"/Applications/Blender.app/Contents/MacOS/Blender" --background --factory-startup --python build_asset.py'
					}
				}
			]
		}
	}),
	JSON.stringify({
		type: 'user',
		message: {
			content: [
				{ type: 'tool_result', tool_use_id: 't1', content: 'ok' },
				{ type: 'tool_result', tool_use_id: 't2', content: 'Traceback', is_error: true }
			]
		}
	}),
	JSON.stringify({ type: 'raw', text: '  ' }),
	JSON.stringify({
		type: 'result',
		subtype: 'success',
		is_error: false,
		result: 'Built a brass bar.',
		duration_ms: 64000,
		total_cost_usd: 0.4213,
		num_turns: 9
	})
];

describe('condenseAgentLines function', () => {
	it('should condense a Claude Code stream into text, settled tool steps and the result', () => {
		const messages = condenseAgentLines('claude', claudeLines);

		expect(messages).toEqual([
			{ kind: 'text', text: 'I will build the bar.' },
			{ kind: 'tool', id: 't1', tool: 'Write', summary: 'Write build_asset.py', status: 'done' },
			{
				kind: 'tool',
				id: 't2',
				tool: 'Bash',
				summary: 'Run Blender: build_asset.py',
				status: 'failed'
			},
			{ kind: 'result', text: 'Built a brass bar.', durationMs: 64000, costUsd: 0.4213, turns: 9 }
		]);
	});

	it('should report an error result such as a missing login', () => {
		const line = JSON.stringify({
			type: 'result',
			subtype: 'success',
			is_error: true,
			result: 'Invalid API key · Please run /login'
		});

		expect(condenseAgentLines('claude', [line])).toEqual([
			{ kind: 'error', text: 'Invalid API key · Please run /login' }
		]);
	});

	it('should condense a Codex stream', () => {
		const lines = [
			JSON.stringify({ type: 'thread.started', thread_id: 'x' }),
			JSON.stringify({
				type: 'item.started',
				item: { id: 'i1', type: 'command_execution', command: 'ls -la' }
			}),
			JSON.stringify({
				type: 'item.completed',
				item: {
					id: 'i1',
					type: 'command_execution',
					command: 'ls -la',
					exit_code: 0,
					status: 'completed'
				}
			}),
			JSON.stringify({
				type: 'item.completed',
				item: { id: 'i2', type: 'agent_message', text: 'Done.' }
			}),
			JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 10 } })
		];

		const messages = condenseAgentLines('codex', lines);

		expect(messages.map((message) => message.kind)).toEqual(['tool', 'text', 'result']);
		expect(messages[0]).toMatchObject({ summary: 'Run ls -la', status: 'done' });
	});

	it('should keep plain text lines', () => {
		expect(condenseAgentLines('claude', ['not json'])).toEqual([
			{ kind: 'text', text: 'not json' }
		]);
	});
});

describe('summarizeToolUse function', () => {
	it('should name Blender expressions, descriptions and file tools', () => {
		expect(
			summarizeToolUse('Bash', { command: 'Blender --background --python-expr "import bpy"' })
		).toBe('Run Blender with a Python expression');
		expect(summarizeToolUse('Bash', { command: 'ls', description: 'List files' })).toBe(
			'List files'
		);
		expect(summarizeToolUse('Read', { file_path: '/a/BRIEF.md' })).toBe('Read BRIEF.md');
		expect(summarizeToolUse('TodoWrite', {})).toBe('Update plan');
	});
});

describe('agent run status', () => {
	it('should only offer review for a finished run with an asset and a preview', () => {
		const run = {
			status: 'succeeded' as const,
			review: null,
			hasAsset: true,
			previewUrl: 'asset://p.png'
		};

		expect(agentRunPhase(run)).toBe('review');
		expect(agentRunPhase({ ...run, previewUrl: null })).toBe('incomplete');
		expect(agentRunPhase({ ...run, review: 'declined' })).toBe('declined');
		expect(agentRunPhase({ ...run, status: 'running' })).toBe('working');
		expect(agentRunPhaseLabel('review')).toBe('Ready for review');
	});

	it('should format duration and cost', () => {
		expect(formatAgentUsage(124_000, 0.4213)).toBe('2 min 4 s · $0.42');
		expect(formatAgentUsage(null, null)).toBeNull();
	});
});
