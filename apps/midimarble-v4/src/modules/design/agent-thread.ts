import {
	agentRunPhaseLabel,
	canAcceptRun,
	formatAgentUsage,
	type TAgentAvailability,
	type TAgentCli,
	type TAgentCliInfo,
	type TAgentMessage,
	type TAgentRun,
	type TAgentRunPhase,
	type TAgentTarget
} from '@/modules/agents';

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
	candidate: { previewUrl: string; label: string } | null;
	canAccept: boolean;
	canCancel: boolean;
	error: string | null;
	usage: string | null;
	/** How to fix a CLI that is not logged in, from the run's error */
	setup: TAgentSetupHint | null;
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

/** Runs that belong to a target, oldest first like a comment thread */
export function agentThread(runs: TAgentRun[], target: TAgentTarget): TAgentThreadItem[] {
	return runs
		.filter((run) => isRunForTarget(run, target))
		.sort((a, b) => a.startedAt - b.startedAt)
		.map(toThreadItem);
}

/**
 * Whether a run belongs to a target. Runs from earlier sessions have no recorded target; they show in the
 * Scene thread, or in the thread of a piece of the type their manifest names.
 */
export function isRunForTarget(run: TAgentRun, target: TAgentTarget): boolean {
	if (run.target == null) return target.kind === 'scene';
	if (target.kind === 'piece') return run.target.kind === 'piece' && run.target.entityId === target.entityId;
	return run.target.kind === target.kind;
}

export function toThreadItem(run: TAgentRun): TAgentThreadItem {
	const { lines, hiddenSteps } = threadLines(run.messages);
	const result = [...run.messages].reverse().find((message) => message.kind === 'result');
	const messageError = run.messages.find((message) => message.kind === 'error');
	const error = run.error ?? (messageError?.kind === 'error' ? messageError.text : null) ?? run.manifestError;
	const canAccept = canAcceptRun(run.phase);
	return {
		id: run.id,
		prompt: run.prompt.split('\n\n')[0] ?? run.prompt,
		cliLabel: cliLabel(run.cli),
		phase: run.phase,
		phaseLabel: agentRunPhaseLabel(run.phase),
		lines,
		hiddenSteps,
		candidate:
			run.previewUrl != null && run.phase !== 'declined'
				? { previewUrl: run.previewUrl, label: run.manifest?.label ?? 'Candidate' }
				: null,
		canAccept,
		canCancel: run.phase === 'working',
		error: run.phase === 'failed' || run.phase === 'incomplete' ? error : null,
		usage: result?.kind === 'result' ? formatAgentUsage(result.durationMs, result.costUsd) : null,
		setup: error != null ? loginHint(run.cli, error) : null
	};
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

/** What keeps agents from running, or null when one can run */
export function agentSetupHint(availability: TAgentAvailability, clis: TAgentCliInfo[]): TAgentSetupHint | null {
	switch (availability) {
		case 'unknown':
			return null;
		case 'unavailable':
			return {
				title: 'Agents Run in the Desktop App',
				body: 'The browser preview cannot start Claude Code or Codex. Open MidiMarble on your Mac to ask an agent.',
				command: null
			};
		case 'missing':
			return {
				title: 'No Agent Is Installed',
				body: 'Install Claude Code, log in once in Terminal, then come back.',
				command: 'npm install -g @anthropic-ai/claude-code && claude /login'
			};
		case 'ready':
			return clis.length > 0 ? null : agentSetupHint('missing', clis);
	}
}
