import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { TOOL_NAMES } from './mcp-tools';
import { AGENT_COMMAND_EXAMPLES } from './project-commands';

const MCP_FOLDER = new URL('../../../src-tauri/src/modules/mcp/', import.meta.url);

function guides(): string {
	const folder = new URL('guides/', MCP_FOLDER);
	return readdirSync(folder).map((name) => readFileSync(new URL(name, folder), 'utf8')).join('\n');
}

describe('MCP guides', () => {
	it('should show every project command', () => {
		const text = guides();
		const missing = Object.keys(AGENT_COMMAND_EXAMPLES).filter((type) => !text.includes(`type: '${type}'`));
		expect(missing).toEqual([]);
	});

	it('should have every tool Rust offers answered by the app, and the other way round', () => {
		const protocol = readFileSync(new URL('protocol.rs', MCP_FOLDER), 'utf8');
		// What Rust answers itself instead of forwarding
		const inRust = new Set(['get_guide']);
		const definitions = protocol.slice(protocol.indexOf('pub fn tool_definitions'), protocol.indexOf('#[cfg(test)]'));
		const offered = [...definitions.matchAll(/tool\(\s*"([a-z_]+)"/g)].flatMap((match) => (match[1] == null || inRust.has(match[1]) ? [] : [match[1]]));
		expect(offered.sort()).toEqual([...TOOL_NAMES].sort());
	});
});
