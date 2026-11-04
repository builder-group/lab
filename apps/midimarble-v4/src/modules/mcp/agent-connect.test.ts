import { describe, expect, it } from 'vitest';
import { connectedNotice, connectTitle, disconnectedNotice } from './agent-connect';

describe('connect words', () => {
	it('should name the row by what a click would do', () => {
		expect(connectTitle('claude', false)).toBe('Connect Claude Code');
		expect(connectTitle('claude', true)).toBe('Disconnect Claude Code');
		expect(connectTitle('codex', false)).toBe('Connect ChatGPT and Codex');
		expect(connectTitle('codex', true)).toBe('Disconnect ChatGPT and Codex');
	});

	it('should say where to start the new session', () => {
		expect(connectedNotice('claude')).toBe('Connected. Start a new session in Claude Code.');
		expect(connectedNotice('codex')).toBe('Connected. Start a new session in ChatGPT or Codex.');
		expect(disconnectedNotice('codex')).toContain('ChatGPT or Codex');
	});
});
