import type { specta } from '@/environment/specta';

/** One entry of an agent conversation as the Design tab shows it */
export type TAgentMessage =
	/** `isPartial` while it still streams; the finished message replaces it */
	| { kind: 'text'; text: string; isPartial?: boolean }
	| {
			kind: 'tool';
			id: string;
			tool: string;
			summary: string;
			status: 'running' | 'done' | 'failed';
	  }
	| {
			kind: 'result';
			text: string;
			durationMs: number | null;
			costUsd: number | null;
			turns: number | null;
	  }
	| { kind: 'error'; text: string }
	/** How much of the CLI's context the last turn used, in tokens, and its size once the CLI has said it */
	| { kind: 'context'; used: number; window: number | null };

export type TAgentCli = specta.AgentCli;

/**
 * Condenses CLI JSON lines (live `agent-run-event` payloads or `transcript.jsonl` lines) into display
 * messages: assistant text, one line per tool step whose status follows its result, and the final result.
 */
export function condenseAgentLines(cli: TAgentCli, lines: string[]): TAgentMessage[] {
	const messages: TAgentMessage[] = [];
	for (const line of lines) appendAgentLine(messages, cli, line);
	return messages;
}

/** Folds one line into `messages` in place */
export function appendAgentLine(messages: TAgentMessage[], cli: TAgentCli, line: string): void {
	let parsed: TJson;
	try {
		parsed = JSON.parse(line) as TJson;
	} catch {
		pushText(messages, line);
		return;
	}
	const value = asObject(parsed);
	if (value == null) return;
	if (value['type'] === 'raw') {
		pushText(messages, asString(value['text']));
		return;
	}
	if (cli === 'claude') appendClaude(messages, value);
	else appendCodex(messages, value);
}

function appendClaude(messages: TAgentMessage[], value: TJsonObject): void {
	const type = value['type'];
	if (type === 'stream_event') {
		const delta = asObject(asObject(value['event'])?.['delta']);
		if (delta?.['type'] === 'text_delta') pushPartial(messages, asString(delta['text']));
		return;
	}
	if (type === 'assistant') {
		const message = asObject(value['message']);
		noteContext(messages, asObject(message?.['usage']));
		for (const item of asArray(message?.['content'])) {
			const part = asObject(item);
			if (part == null) continue;
			if (part['type'] === 'text') finishText(messages, asString(part['text']));
			if (part['type'] === 'tool_use') {
				const tool = asString(part['name']);
				messages.push({
					kind: 'tool',
					id: asString(part['id']),
					tool,
					summary: summarizeToolUse(tool, asObject(part['input']) ?? {}),
					status: 'running'
				});
			}
		}
		return;
	}
	if (type === 'user') {
		for (const item of asArray(asObject(value['message'])?.['content'])) {
			const part = asObject(item);
			if (part?.['type'] !== 'tool_result') continue;
			settleTool(messages, asString(part['tool_use_id']), part['is_error'] === true);
		}
		return;
	}
	if (type === 'result') {
		noteContextWindow(messages, asObject(value['modelUsage']));
		if (value['is_error'] === true || value['subtype'] !== 'success') {
			messages.push({
				kind: 'error',
				text: asString(value['result']) || describeSubtype(value['subtype'])
			});
			return;
		}
		messages.push({
			kind: 'result',
			text: asString(value['result']),
			durationMs: asNumber(value['duration_ms']),
			costUsd: asNumber(value['total_cost_usd']),
			turns: asNumber(value['num_turns'])
		});
	}
}

function appendCodex(messages: TAgentMessage[], value: TJsonObject): void {
	const type = value['type'];
	const item = asObject(value['item']);
	if (item != null && typeof type === 'string' && type.startsWith('item.')) {
		const id = asString(item['id']);
		const itemType = item['type'];
		if (itemType === 'agent_message' && type === 'item.completed') {
			pushText(messages, asString(item['text']));
			return;
		}
		if (itemType === 'mcp_tool_call') {
			if (!messages.some((message) => message.kind === 'tool' && message.id === id)) {
				const tool = asString(item['tool']);
				messages.push({ kind: 'tool', id, tool, summary: summarizeToolUse(tool, asObject(item['arguments']) ?? {}), status: 'running' });
			}
			if (type === 'item.completed') settleTool(messages, id, item['status'] === 'failed' || item['error'] != null);
			return;
		}
		if (itemType === 'command_execution' || itemType === 'file_change') {
			const failed = item['status'] === 'failed' || (asNumber(item['exit_code']) ?? 0) !== 0;
			const existing = messages.find((message) => message.kind === 'tool' && message.id === id);
			if (existing == null) {
				const tool = itemType === 'command_execution' ? 'Bash' : 'Edit';
				const summary =
					itemType === 'command_execution'
						? summarizeToolUse('Bash', { command: asString(item['command']) })
						: 'Edit files';
				messages.push({ kind: 'tool', id, tool, summary, status: 'running' });
			}
			if (type === 'item.completed') settleTool(messages, id, failed);
		}
		return;
	}
	if (type === 'turn.completed') {
		messages.push({ kind: 'result', text: '', durationMs: null, costUsd: null, turns: null });
		return;
	}
	if (type === 'turn.failed' || type === 'error') {
		const text = asString(asObject(value['error'])?.['message']) || asString(value['message']);
		messages.push({ kind: 'error', text: text || 'The agent stopped with an error' });
	}
}

/** One short line describing a tool call, such as `Run Blender: build_asset.py` or `Write manifest.json` */
export function summarizeToolUse(toolName: string, input: TJsonObject): string {
	// Claude Code names the app's tools `mcp__midimarble__run_command`; Codex names them `run_command`
	const tool = toolName.replace(/^mcp__midimarble__/, '');
	const file = baseName(asString(input['file_path']) || asString(input['path']));
	switch (tool) {
		case 'Bash': {
			const command = asString(input['command']).trim();
			if (/blender/i.test(command)) {
				const script = /--python(?:-expr)?\s+("[^"]+"|\S+)/.exec(command)?.[1]?.replace(/"/g, '');
				if (script == null) return 'Run Blender';
				if (/--python-expr/.test(command)) return 'Run Blender with a Python expression';
				return `Run Blender: ${baseName(script)}`;
			}
			const description = asString(input['description']).trim();
			return description || `Run ${truncate(command, 60)}`;
		}
		case 'Write':
			return `Write ${file}`;
		case 'Edit':
		case 'MultiEdit':
			return `Edit ${file}`;
		case 'Read':
			return `Read ${file}`;
		case 'Glob':
		case 'Grep':
			return `Search ${truncate(asString(input['pattern']), 40)}`;
		case 'TodoWrite':
			return 'Update plan';
		case 'run_command':
			return summarizeCommand(asString(input['id']), asObject(input['args']) ?? {});
		case 'get_state':
			return 'Read the project';
		case 'get_guide':
			return `Read the ${asString(input['topic']) || 'overview'} guide`;
		case 'list_commands':
			return 'Look up commands';
		case 'preview_frame': {
			const time = asNumber(input['time']);
			return time != null ? `Preview the frame at ${time} s` : 'Preview a frame';
		}
		case 'play_range':
			return 'Play a range';
		case 'add_song':
			return `Add song ${baseName(asString(input['path']))}`;
		case 'add_asset':
			return `Add ${asString(input['name']) || baseName(asString(input['path']))}`;
		case 'set_references':
			return 'Set References';
		case 'export_film':
			return 'Export the film';
		default:
			return tool;
	}
}

/** `build.track` reads "Build Track", and a `project.execute` by its label or its first command */
function summarizeCommand(id: string, args: TJsonObject): string {
	if (id === 'project.execute') {
		const label = asString(args['label']);
		if (label.length > 0) return label;
		const first = asString(asObject(asArray(args['commands'])[0])?.['type']);
		return first.length > 0 ? titleWords(first) : 'Edit the project';
	}
	return titleWords(id) || 'Run a command';
}

function titleWords(name: string): string {
	return name
		.replace(/([a-z])([A-Z])/g, '$1 $2')
		.split(/[.\s]+/)
		.filter((word) => word.length > 0)
		.map((word) => `${word.charAt(0).toUpperCase()}${word.slice(1)}`)
		.join(' ');
}

function settleTool(messages: TAgentMessage[], id: string, failed: boolean): void {
	const tool = messages.find((message) => message.kind === 'tool' && message.id === id);
	if (tool?.kind === 'tool') tool.status = failed ? 'failed' : 'done';
}

function pushText(messages: TAgentMessage[], text: string): void {
	const trimmed = text.trim();
	if (!trimmed.length) return;
	messages.push({ kind: 'text', text: trimmed });
}

/** Text arriving piece by piece, shown as it streams */
function pushPartial(messages: TAgentMessage[], text: string): void {
	const last = messages[messages.length - 1];
	if (last?.kind === 'text' && last.isPartial === true) last.text += text;
	else if (text.length > 0) messages.push({ kind: 'text', text, isPartial: true });
}

/** The finished text of a message, in the place of what streamed */
function finishText(messages: TAgentMessage[], text: string): void {
	const trimmed = text.trim();
	const index = messages.findIndex((message) => message.kind === 'text' && message.isPartial === true);
	if (index < 0) {
		pushText(messages, trimmed);
		return;
	}
	if (trimmed.length > 0) messages[index] = { kind: 'text', text: trimmed };
	else messages.splice(index, 1);
}

function noteContext(messages: TAgentMessage[], usage: TJsonObject | null): void {
	if (usage == null) return;
	const used = (asNumber(usage['input_tokens']) ?? 0) + (asNumber(usage['cache_read_input_tokens']) ?? 0) + (asNumber(usage['cache_creation_input_tokens']) ?? 0);
	if (used <= 0) return;
	const entry = messages.find((message) => message.kind === 'context');
	if (entry?.kind === 'context') entry.used = used;
	else messages.push({ kind: 'context', used, window: null });
}

function noteContextWindow(messages: TAgentMessage[], modelUsage: TJsonObject | null): void {
	if (modelUsage == null) return;
	const windows = Object.values(modelUsage).map((model) => asNumber(asObject(model)?.['contextWindow']) ?? 0);
	const size = Math.max(0, ...windows);
	const entry = messages.find((message) => message.kind === 'context');
	if (entry?.kind === 'context' && size > 0) entry.window = size;
}

/** How full the CLI's context is, as a share from 0 to 1 and in tokens, or null when it doesn't report it */
export function agentContextUse(runs: { startedAt: number; messages: TAgentMessage[] }[]): { share: number; used: number; size: number } | null {
	const entries = [...runs].sort((a, b) => b.startedAt - a.startedAt).flatMap((run) => run.messages.filter((message) => message.kind === 'context'));
	const latest = entries[0];
	if (latest?.kind !== 'context') return null;
	// A message still running hasn't said the size; an earlier one of the session has
	const size = entries.find((entry) => entry.kind === 'context' && entry.window != null);
	if (size?.kind !== 'context' || size.window == null) return null;
	return { share: Math.min(1, latest.used / size.window), used: latest.used, size: size.window };
}

function describeSubtype(subtype: unknown): string {
	switch (subtype) {
		case 'error_max_turns':
			return 'The agent reached its turn limit';
		case 'error_max_budget_usd':
			return 'The agent reached its budget';
		default:
			return 'The agent stopped with an error';
	}
}

function baseName(path: string): string {
	return path.split('/').pop() ?? path;
}

function truncate(text: string, length: number): string {
	return text.length > length ? `${text.slice(0, length - 1)}…` : text;
}

type TJson = null | boolean | number | string | TJson[] | TJsonObject;
interface TJsonObject {
	[key: string]: TJson | undefined;
}

function asObject(value: TJson | undefined): TJsonObject | null {
	return value != null && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

function asArray(value: TJson | undefined): TJson[] {
	return Array.isArray(value) ? value : [];
}

function asString(value: TJson | undefined): string {
	return typeof value === 'string' ? value : '';
}

function asNumber(value: TJson | undefined): number | null {
	return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
