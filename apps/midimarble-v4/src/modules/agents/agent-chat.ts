import type { TAgentTarget } from './agent-brief';
import type { TAgentRun } from './AgentCx';

// Pure helpers of the shared agent chat: @-mentions in the composer, mapping a message onto runs and
// grouping the project's runs back into chat turns

export interface TAgentMention {
	/** Entity id of a piece or marble, or `scene` */
	id: string;
	kind: 'piece' | 'marble' | 'scene';
	label: string;
}

export const SCENE_MENTION: TAgentMention = { id: 'scene', kind: 'scene', label: 'Project' };

/** A run the composer starts for a message, with the name its status line shows */
export interface TAgentRunPlan {
	target: TAgentTarget;
	label: string;
}

/** One message of the conversation and the runs it started, oldest first */
export interface TAgentChatTurn {
	id: string;
	/** The message as written, with mentions as `@[Name]` */
	request: string;
	startedAt: number;
	runs: TAgentRun[];
}

export type TMentionSegment = { kind: 'text'; text: string } | { kind: 'mention'; label: string };

const BRIEF_NOTE = 'Read BRIEF.md in this folder first and follow its output contract.';
const FOCUS_PREFIX = 'This run makes the candidate for ';
// Runs of one message start together; later messages with the same text are separate turns
const TURN_WINDOW_MS = 15_000;

/**
 * The `@query` being typed at the caret, or null. An @ opens a mention at the start of the text or after
 * whitespace; the query may contain single spaces, since layer names such as `Platform 1` do.
 */
export function findMentionQuery(text: string, caret: number): { start: number; query: string } | null {
	const before = text.slice(0, caret);
	const start = before.lastIndexOf('@');
	if (start < 0) return null;
	const previous = start > 0 ? before[start - 1] : ' ';
	if (previous == null || !/\s/.test(previous)) return null;
	const query = before.slice(start + 1);
	if (query.length > 32 || /\n|\s\s|^\s/.test(query)) return null;
	return { start, query };
}

/** Options whose name has a word starting with the query, without those already mentioned */
export function filterMentions(options: TAgentMention[], query: string, exclude: string[] = []): TAgentMention[] {
	const needle = query.trim().toLowerCase();
	return options.filter((option) => {
		if (exclude.includes(option.id)) return false;
		if (!needle.length) return true;
		const label = option.label.toLowerCase();
		return label.startsWith(needle) || label.split(/\s+/).some((word) => word.startsWith(needle));
	});
}

/** Removes the typed `@query` once a mention is picked, returning the new text and caret */
export function removeMentionQuery(text: string, mention: { start: number; query: string }): { text: string; caret: number } {
	const end = mention.start + 1 + mention.query.length;
	const rest = text.slice(end).replace(/^ +/, '');
	const head = text.slice(0, mention.start);
	return { text: head + rest, caret: head.length };
}

/**
 * Runs for a message. Every mentioned piece gets its own run; marbles and the scene have no asset of their
 * own, so they share one scene run. Without mentions the message goes to the scene.
 */
export function planAgentRuns(mentions: TAgentMention[]): TAgentRunPlan[] {
	const plans: TAgentRunPlan[] = [];
	const seen = new Set<string>();
	let hasScene = !mentions.length;
	for (const mention of mentions) {
		if (mention.kind !== 'piece') {
			hasScene = true;
			continue;
		}
		if (seen.has(mention.id)) continue;
		seen.add(mention.id);
		plans.push({ target: { kind: 'piece', entityId: mention.id }, label: mention.label });
	}
	if (hasScene) plans.push({ target: { kind: 'scene' }, label: SCENE_MENTION.label });
	return plans;
}

/** The request as stored with the runs: mentions first as `@[Name]`, then the text */
export function composeAgentRequest(text: string, mentions: TAgentMention[]): string {
	const prefix = mentions.map((mention) => `@[${mention.label}]`).join(' ');
	const body = text.trim();
	return [prefix, body].filter((part) => part.length > 0).join(' ');
}

/** The CLI prompt of one run: the request, the brief note and which target this run works on */
export function agentRunPrompt(request: string, focus: string | null): string {
	return `${request}\n\n${BRIEF_NOTE}${focus != null ? ` ${FOCUS_PREFIX}${focus}.` : ''}`;
}

/** The request part of a stored prompt */
export function requestFromPrompt(prompt: string): string {
	const index = prompt.indexOf(`\n\n${BRIEF_NOTE}`);
	return (index >= 0 ? prompt.slice(0, index) : prompt).trim();
}

/** The target name a run's prompt records, so status lines survive a reload */
export function focusFromPrompt(prompt: string): string | null {
	const index = prompt.lastIndexOf(FOCUS_PREFIX);
	if (index < 0) return null;
	const focus = prompt.slice(index + FOCUS_PREFIX.length).replace(/\.\s*$/, '').trim();
	return focus.length > 0 ? focus : null;
}

/** Splits stored text into plain text and `@[Name]` mentions for display */
export function splitMentions(text: string): TMentionSegment[] {
	const segments: TMentionSegment[] = [];
	const pattern = /@\[([^\]\n]+)\]/g;
	let last = 0;
	for (const match of text.matchAll(pattern)) {
		const index = match.index;
		if (index > last) segments.push({ kind: 'text', text: text.slice(last, index) });
		segments.push({ kind: 'mention', label: match[1] ?? '' });
		last = index + match[0].length;
	}
	if (last < text.length) segments.push({ kind: 'text', text: text.slice(last) });
	// Spacing between chips and text is drawn by the layout
	return segments
		.map((segment) => (segment.kind === 'text' ? { ...segment, text: segment.text.trim() } : segment))
		.filter((segment) => segment.kind === 'mention' || segment.text.length > 0);
}

/** Groups the project's runs into turns: runs of one message share its request and start together */
export function agentChatTurns(runs: TAgentRun[]): TAgentChatTurn[] {
	const turns: TAgentChatTurn[] = [];
	for (const run of [...runs].sort((a, b) => a.startedAt - b.startedAt)) {
		const request = requestFromPrompt(run.prompt);
		const last = turns[turns.length - 1];
		if (last != null && last.request === request && run.startedAt - last.startedAt <= TURN_WINDOW_MS) {
			last.runs.push(run);
			continue;
		}
		turns.push({ id: run.id, request, startedAt: run.startedAt, runs: [run] });
	}
	return turns;
}

/** Tool steps of a run, and how many of them finished */
export function agentRunSteps(run: Pick<TAgentRun, 'messages'>): { total: number; done: number } {
	const steps = run.messages.filter((message) => message.kind === 'tool');
	return { total: steps.length, done: steps.filter((step) => step.kind === 'tool' && step.status !== 'running').length };
}
