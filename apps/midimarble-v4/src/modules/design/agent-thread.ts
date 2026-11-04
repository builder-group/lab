import {
	agentRunPhaseLabel,
	canAcceptRun,
	formatAgentUsage,
	isNewThemeRequest,
	type TAgentAvailability,
	type TAgentCli,
	type TAgentCliInfo,
	type TAgentMessage,
	type TAgentRun,
	type TAgentRunPhase
} from '@/modules/agents';
import type { TThemeOverrides } from '@/modules/project';

// View model of the agent conversation in the Design inspector, shaped like a comment thread

export interface TAgentThreadItem {
	id: string;
	prompt: string;
	cliLabel: string;
	phase: TAgentRunPhase;
	phaseLabel: string;
	/** Assistant text and tool steps in order; long runs keep the latest steps */
	lines: TAgentThreadLine[];
	/** Tool steps folded away before `lines` */
	hiddenSteps: number;
	/** What the agent said last, as it streams and once it's done */
	reply: string | null;
	candidate: TAgentCandidate | null;
	canAccept: boolean;
	canCancel: boolean;
	error: string | null;
	usage: string | null;
	/** How to fix a CLI that is not logged in, from the run's error */
	setup: TAgentSetupHint | null;
}

/**
 * A finished Result. A New Theme Result shows the theme it proposes, with the skin it made as its second part; any
 * other Result shows its preview still.
 */
export interface TAgentCandidate {
	previewUrl: string | null;
	label: string;
	theme: TAgentThemeProposal | null;
}

export interface TAgentThemeProposal {
	name: string;
	base: string;
	overrides: TThemeOverrides;
}

export type TAgentThreadLine =
	| { kind: 'text'; key: string; text: string }
	| { kind: 'step'; key: string; text: string; status: 'running' | 'done' | 'failed' };

export interface TAgentSetupHint {
	title: string;
	body: string;
	/** Terminal command that fixes it, shown as copyable code */
	command: string | null;
}

const MAX_STEPS = 4;

export function toThreadItem(run: TAgentRun): TAgentThreadItem {
	const { lines, hiddenSteps } = threadLines(run.messages);
	const result = [...run.messages].reverse().find((message) => message.kind === 'result');
	const messageError = run.messages.find((message) => message.kind === 'error');
	const error = run.error ?? (messageError?.kind === 'error' ? messageError.text : null) ?? run.manifestError;
	const canAccept = canAcceptRun(run.phase);
	const proposal = run.manifest?.theme;
	const theme = proposal != null && isNewThemeRequest(run.request) ? { name: proposal.name, base: proposal.base, overrides: proposal.overrides } : null;
	return {
		id: run.id,
		prompt: run.request,
		cliLabel: cliLabel(run.cli),
		phase: run.phase,
		phaseLabel: agentRunPhaseLabel(run.phase),
		lines,
		hiddenSteps,
		reply: lastReply(run.messages),
		candidate: run.phase !== 'declined' && (run.previewUrl != null || theme != null) ? { previewUrl: run.previewUrl, label: run.manifest?.label ?? 'Candidate', theme } : null,
		canAccept,
		canCancel: run.phase === 'working',
		error: run.phase === 'failed' || run.phase === 'incomplete' ? error : null,
		// A resumed session reports what the whole session cost, which says nothing about this message
		usage: result?.kind === 'result' ? formatAgentUsage(result.durationMs, run.isChat ? null : result.costUsd) : null,
		setup: error != null ? loginHint(run.cli, error) : null
	};
}

function lastReply(messages: TAgentMessage[]): string | null {
	for (const message of [...messages].reverse()) {
		if (message.kind === 'text' && message.text.trim().length > 0) return message.text.trim();
		if (message.kind === 'result' && message.text.trim().length > 0) return message.text.trim();
	}
	return null;
}

function threadLines(messages: TAgentMessage[]): { lines: TAgentThreadLine[]; hiddenSteps: number } {
	const lines: TAgentThreadLine[] = [];
	messages.forEach((message, index) => {
		if (message.kind === 'text' && message.text.trim().length > 0) lines.push({ kind: 'text', key: `t${index}`, text: message.text.trim() });
		if (message.kind === 'tool') lines.push({ kind: 'step', key: message.id || `s${index}`, text: message.summary, status: message.status });
	});
	const steps = lines.filter((line) => line.kind === 'step');
	const hiddenSteps = Math.max(0, steps.length - MAX_STEPS);
	const firstKept = steps[hiddenSteps];
	if (!hiddenSteps || firstKept == null) return { lines, hiddenSteps: 0 };
	// Everything before the first kept step narrates folded work
	return { lines: lines.slice(lines.indexOf(firstKept)), hiddenSteps };
}

export function cliLabel(cli: TAgentCli): string {
	return cli === 'claude' ? 'Claude Code' : 'Codex';
}

export function loginCommand(cli: TAgentCli): string {
	return cli === 'claude' ? 'claude /login' : 'codex login';
}

/** A setup hint when a CLI's error says it is not logged in */
export function loginHint(cli: TAgentCli, error: string): TAgentSetupHint | null {
	if (!/not logged in|log ?in|authenticat|api key|unauthori[sz]ed|\b401\b|credentials/i.test(error)) return null;
	return {
		title: `${cliLabel(cli)} Is Not Logged In`,
		body: 'Log in once in Terminal, then run the agent again.',
		command: loginCommand(cli)
	};
}

/** The one line that says what keeps the agent from running here, or null when one can run */
export function agentSetupNote(availability: TAgentAvailability, clis: TAgentCliInfo[]): string | null {
	switch (availability) {
		case 'unknown':
			return null;
		case 'unavailable':
			return 'The agent runs in the desktop app.';
		case 'missing':
			return 'Install Claude Code or Codex to ask here. The app works fully by hand without one.';
		case 'ready':
			return clis.length > 0 ? null : agentSetupNote('missing', clis);
	}
}
