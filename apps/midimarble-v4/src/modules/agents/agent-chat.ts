import type { TEntity, TLane, TProject } from '@/modules/project';
import type { THitResult, TSimulationResult } from '@/modules/simulation';
import { formatTime, noteName } from '@/modules/studio/format';
import { CAMERA_KEY, KEY_LIGHT_KEY, parseDecorKey, parseHitKey, parseLightKey, parseShotKey, SONG_KEY, WALL_KEY } from '@/modules/studio/selection';
import type { TAgentTarget } from './agent-brief';
import type { TAgentRun } from './AgentCx';

// Pure helpers of the shared agent chat: @-mentions in the composer, the selection in resolved form for the prompt and
// grouping the project's runs back into chat turns

export interface TAgentMention {
	/** A selection key: an entity id, a hit key or a layer key, or `scene` */
	id: string;
	kind: 'piece' | 'marble' | 'scene' | 'hit' | 'layer';
	label: string;
}

export const SCENE_MENTION: TAgentMention = { id: 'scene', kind: 'scene', label: 'Scene' };

/** One message of the conversation and the runs it started, oldest first; a chat message starts one */
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

/** The request as stored with the runs: mentions first as `@[Name]`, then the text */
export function composeAgentRequest(text: string, mentions: TAgentMention[]): string {
	const prefix = mentions.map((mention) => `@[${mention.label}]`).join(' ');
	const body = text.trim();
	return [prefix, body].filter((part) => part.length > 0).join(' ');
}

/** The request part of a stored prompt, for runs from before the chat */
export function requestFromPrompt(prompt: string): string {
	const index = prompt.indexOf(`\n\n${BRIEF_NOTE}`);
	return (index >= 0 ? prompt.slice(0, index) : prompt).trim();
}

/** The target name the prompt of a run from before the chat records */
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
		const request = run.request;
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

// MARK: - The selection

/** What is selected as mentions, in selection order. Whatever has no name of its own takes its kind's. */
export function selectionMentions(project: TProject, selection: readonly string[]): TAgentMention[] {
	return selection.flatMap((key): TAgentMention[] => {
		const hit = parseHitKey(key);
		if (hit != null) {
			const lane = project.music.lanes.find((item) => item.id === hit.laneId);
			const index = lane?.hits.findIndex((item) => item.id === hit.hitId) ?? -1;
			return lane != null && index >= 0 ? [{ id: key, kind: 'hit', label: hitName(lane, index) }] : [];
		}
		const entity = project.entities.find((item) => item.id === key);
		if (entity != null) return [entityMention(project, entity)];
		const label = layerLabel(key);
		return label != null ? [{ id: key, kind: 'layer', label }] : [];
	});
}

/** The scene, then each marble, then the pieces in project order: what @ offers */
export function mentionOptions(project: TProject): TAgentMention[] {
	const marbles = project.entities.filter((entity) => entity.components.marble != null).map((entity) => entityMention(project, entity));
	const pieces = project.entities.filter((entity) => entity.components.piece != null).map((entity) => entityMention(project, entity));
	return [SCENE_MENTION, ...marbles, ...pieces];
}

/**
 * One line for the prompt that says what a mention is right now, in the window's words and with the ids tools take:
 * "Hit 12 of Melody at 0:06.50, C5, On Time, hitId h12, key hit:lane:h12; played by Platform 12 at (1.2, -0.4), angle 14°, id p12"
 */
export function describeMention(project: TProject, result: TSimulationResult | null, mention: TAgentMention): string {
	const hit = parseHitKey(mention.id);
	if (hit != null) return describeHit(project, result, mention, hit.laneId, hit.hitId);
	const entity = project.entities.find((item) => item.id === mention.id);
	if (entity?.components.piece != null) return describePiece(project, result, entity, mention.label);
	if (entity?.components.marble != null) {
		const laneId = entity.components.marble.laneId;
		const hits = result?.hits.filter((item) => item.laneId === laneId) ?? [];
		return `${mention.label}, a marble: ${hits.filter((item) => item.status === 'onTime').length} of ${hits.length} hits On Time, id ${entity.id}, laneId ${laneId}`;
	}
	if (mention.kind === 'scene') return 'The whole project';
	return `${mention.label}, key ${mention.id}`;
}

/** The prompt of a chat message: what was written, then what is selected in resolved form */
export function agentChatPrompt(text: string, resolved: readonly string[]): string {
	const body = text.trim();
	if (!resolved.length) return body;
	return `${body}\n\nSelected in the app:\n${resolved.map((line) => `- ${line}`).join('\n')}`;
}

/** What a Result of this message would be for: the first mentioned piece, or the piece playing a mentioned hit */
export function mentionTarget(project: TProject, mentions: readonly TAgentMention[]): TAgentTarget {
	for (const mention of mentions) {
		if (mention.kind === 'piece') return { kind: 'piece', entityId: mention.id };
		const hit = parseHitKey(mention.id);
		if (hit == null) continue;
		const piece = project.entities.find((entity) => entity.components.hitLink?.hitId === hit.hitId && entity.components.hitLink.laneId === hit.laneId);
		if (piece != null) return { kind: 'piece', entityId: piece.id };
	}
	return { kind: 'scene' };
}

function entityMention(project: TProject, entity: TEntity): TAgentMention {
	const { marble, piece } = entity.components;
	if (marble != null) return { id: entity.id, kind: 'marble', label: project.music.lanes.find((lane) => lane.id === marble.laneId)?.name ?? entity.name ?? 'Marble' };
	if (piece != null) return { id: entity.id, kind: 'piece', label: entity.name ?? piece.type };
	return { id: entity.id, kind: 'layer', label: entity.name ?? 'Layer' };
}

function layerLabel(key: string): string | null {
	if (key === WALL_KEY) return 'Wall';
	if (key === SONG_KEY) return 'Song';
	if (key === CAMERA_KEY) return 'Camera';
	if (key === KEY_LIGHT_KEY) return 'Key Light';
	if (parseLightKey(key) != null) return 'Light';
	if (parseDecorKey(key) != null) return 'Decor';
	if (parseShotKey(key) != null) return 'Shot';
	return null;
}

function hitName(lane: TLane, index: number): string {
	return `Hit ${index + 1} of ${lane.name}`;
}

function describeHit(project: TProject, result: TSimulationResult | null, mention: TAgentMention, laneId: string, hitId: string): string {
	const hit = project.music.lanes.find((lane) => lane.id === laneId)?.hits.find((item) => item.id === hitId);
	const run = result?.hits.find((item) => item.laneId === laneId && item.hitId === hitId);
	const parts = [`${mention.label} at ${formatTime(hit?.time ?? run?.targetTime ?? 0)}`];
	if (hit?.pitch != null) parts.push(noteName(hit.pitch));
	parts.push(hitStatusWords(run), `hitId ${hitId}`, `key ${mention.id}`);
	const piece = project.entities.find((entity) => entity.id === run?.pieceEntityId || (entity.components.hitLink?.hitId === hitId && entity.components.hitLink.laneId === laneId));
	if (piece == null) return `${parts.join(', ')}${run?.dot != null ? `; its dot is at ${point(run.dot)}, no platform yet` : ''}`;
	return `${parts.join(', ')}; played by ${pose(result, piece)}`;
}

function describePiece(project: TProject, result: TSimulationResult | null, entity: TEntity, label: string): string {
	const link = entity.components.hitLink;
	if (link == null) return pose(result, entity, label);
	const lane = project.music.lanes.find((item) => item.id === link.laneId);
	const index = lane?.hits.findIndex((item) => item.id === link.hitId) ?? -1;
	const hit = lane?.hits[index];
	const run = result?.hits.find((item) => item.laneId === link.laneId && item.hitId === link.hitId);
	const name = lane != null && hit != null ? `${hitName(lane, index)} at ${formatTime(hit.time)}` : 'its hit';
	return `${pose(result, entity, label)}; plays ${name}, ${hitStatusWords(run)}, hitId ${link.hitId}`;
}

/** A piece's name, place, angle and id */
function pose(result: TSimulationResult | null, entity: TEntity, label?: string): string {
	const parts = [label ?? entity.name ?? entity.components.piece?.type ?? 'Piece'];
	const position = result?.pieces.find((piece) => piece.entityId === entity.id)?.position;
	if (position != null) parts[0] += ` at ${point(position)}`;
	const angle = entity.components.hitLink?.angle ?? entity.components.transform?.angle;
	if (angle != null) parts.push(`angle ${Math.round((angle * 180) / Math.PI)}° (${round(angle)} rad)`);
	parts.push(`id ${entity.id}`);
	return parts.join(', ');
}

function hitStatusWords(run: THitResult | undefined): string {
	switch (run?.status) {
		case 'onTime':
			return 'On Time';
		case 'drifting': {
			const error = run.error ?? 0;
			return `${Math.round(Math.abs(error) * 1000)} ms ${error < 0 ? 'Early' : 'Late'}`;
		}
		case 'missed':
			return 'Missed';
		case 'blocked':
			return 'Blocked';
		case 'open':
		case undefined:
			return 'Open';
	}
}

function point(value: { x: number; y: number }): string {
	return `(${round(value.x)}, ${round(value.y)})`;
}

function round(value: number): number {
	return Math.round(value * 1000) / 1000;
}
