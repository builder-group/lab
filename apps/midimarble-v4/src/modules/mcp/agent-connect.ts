import type { specta } from '@/environment';

// The words of Connect in the Agent menu. Each row names who shares a config: ChatGPT and Codex both read
// `~/.codex/config.toml`, so one row stands for the two.

export type TAgentTool = specta.McpAgentTool;

const ROW_NAMES: Record<TAgentTool, string> = { claude: 'Claude Code', codex: 'ChatGPT and Codex' };
const SESSION_NAMES: Record<TAgentTool, string> = { claude: 'Claude Code', codex: 'ChatGPT or Codex' };

export const COMMAND_COPIED_NOTICE = 'Copied. Paste it into Terminal, or ask your agent to run it. Then start a new session.';
export const SERVER_COMMAND_COPIED_NOTICE = 'Copied. Add it to your app as a local stdio MCP server.';

export function connectTitle(tool: TAgentTool, isConnected: boolean): string {
	return `${isConnected ? 'Disconnect' : 'Connect'} ${ROW_NAMES[tool]}`;
}

export function connectedNotice(tool: TAgentTool): string {
	return `Connected. Start a new session in ${SESSION_NAMES[tool]}.`;
}

export function disconnectedNotice(tool: TAgentTool): string {
	return `Disconnected. New sessions in ${SESSION_NAMES[tool]} won't list MidiMarble.`;
}
