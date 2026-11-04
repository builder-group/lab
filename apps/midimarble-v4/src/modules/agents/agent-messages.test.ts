import { describe, expect, it } from 'vitest';
import { agentContextUse, condenseAgentLines, summarizeToolUse } from './agent-messages';
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

describe('the chat in stream-json', () => {
	const delta = (text: string): string => JSON.stringify({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text } } });
	const finished = (text: string, usage?: object): string => JSON.stringify({ type: 'assistant', message: { usage, content: [{ type: 'text', text }] } });

	it('should stream text and put the finished message in its place', () => {
		expect(condenseAgentLines('claude', [delta('Tilt'), delta('ing')])).toEqual([{ kind: 'text', text: 'Tilting', isPartial: true }]);
		expect(condenseAgentLines('claude', [delta('Tilt'), delta('ing'), finished('Tilting it.')])).toEqual([{ kind: 'text', text: 'Tilting it.' }]);
	});

	it('should keep text before and after a step apart', () => {
		const step = JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 't1', name: 'mcp__midimarble__get_state', input: {} }] } });
		const messages = condenseAgentLines('claude', [delta('Looking'), finished('Looking.'), step, delta('Done')]);
		expect(messages.map((message) => message.kind)).toEqual(['text', 'tool', 'text']);
	});

	it('should word the app tools for the step list', () => {
		expect(summarizeToolUse('mcp__midimarble__get_state', {})).toBe('Read the project');
		expect(summarizeToolUse('mcp__midimarble__get_guide', { topic: 'assets' })).toBe('Read the assets guide');
		expect(summarizeToolUse('mcp__midimarble__run_command', { id: 'build.track', args: { from: 'h-1' } })).toBe('Build Track');
		expect(summarizeToolUse('run_command', { id: 'project.execute', args: { label: 'Tilt Platform 12', commands: [] } })).toBe('Tilt Platform 12');
		expect(summarizeToolUse('run_command', { id: 'project.execute', args: { commands: [{ type: 'placePiece' }] } })).toBe('Place Piece');
		expect(summarizeToolUse('mcp__midimarble__preview_frame', { time: 6.5 })).toBe('Preview the frame at 6.5 s');
	});

	it('should follow a Codex MCP step from start to end', () => {
		const started = JSON.stringify({ type: 'item.started', item: { id: 'i1', type: 'mcp_tool_call', tool: 'get_state', arguments: {} } });
		const done = JSON.stringify({ type: 'item.completed', item: { id: 'i1', type: 'mcp_tool_call', tool: 'get_state', status: 'completed' } });
		expect(condenseAgentLines('codex', [started, done])).toEqual([{ kind: 'tool', id: 'i1', tool: 'get_state', summary: 'Read the project', status: 'done' }]);
	});

	it('should say how full the context is only when the CLI reports its size', () => {
		const used = finished('Hi', { input_tokens: 100, cache_read_input_tokens: 40_000, cache_creation_input_tokens: 9_900, output_tokens: 5 });
		const result = JSON.stringify({ type: 'result', subtype: 'success', is_error: false, modelUsage: { m: { contextWindow: 200_000 } } });
		expect(agentContextUse([{ startedAt: 1, messages: condenseAgentLines('claude', [used]) }])).toBeNull();
		const earlier = { startedAt: 1, messages: condenseAgentLines('claude', [used, result]) };
		expect(agentContextUse([earlier])).toEqual({ share: 0.25, used: 50_000, size: 200_000 });
		const running = { startedAt: 2, messages: condenseAgentLines('claude', [finished('More', { input_tokens: 100_000 })]) };
		expect(agentContextUse([earlier, running])?.share).toBe(0.5);
		expect(agentContextUse([{ startedAt: 1, messages: condenseAgentLines('codex', [JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 5 } })]) }])).toBeNull();
	});

	it('should show a chat message without a Result as done and keep the card of a stopped one', () => {
		const chat = { review: null, hasAsset: false, previewUrl: null, isChat: true };
		expect(agentRunPhase({ ...chat, status: 'succeeded' })).toBe('done');
		expect(agentRunPhase({ ...chat, status: 'cancelled' })).toBe('cancelled');
		expect(agentRunPhase({ ...chat, status: 'cancelled', hasAsset: true, previewUrl: 'x' })).toBe('review');
		expect(agentRunPhase({ ...chat, status: 'succeeded', hasAsset: true })).toBe('incomplete');
	});
});
