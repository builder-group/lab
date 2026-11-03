import type { specta } from '@/environment/specta';

/** One entry of an agent conversation as the Design tab shows it */
export type TAgentMessage =
	| { kind: 'text'; text: string }
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
	| { kind: 'error'; text: string };

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
	if (type === 'assistant') {
		for (const item of asArray(asObject(value['message'])?.['content'])) {
			const part = asObject(item);
			if (part == null) continue;
			if (part['type'] === 'text') pushText(messages, asString(part['text']));
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
export function summarizeToolUse(tool: string, input: TJsonObject): string {
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
		default:
			return tool;
	}
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
