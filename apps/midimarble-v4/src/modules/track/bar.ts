import { isPatternGroup, parseGroupKey, parseHitKey, parseRangeKey, tieOf, toHitKey, toRangeKey, type TPatternGroup, type TPiece, type TProject } from '@/modules/project';
import { findLongGaps, hitOwners, patternOfPiece, type TLongGap, type TProposal, type TProposeAsk } from '@/modules/building';
import { getPieceDefinition, type TSimulationResult } from '@/modules/simulation';
import { patternPhrase } from './PatternsCx';

// What the floating bar is about and what it offers, as pure functions of the track and the selection.

interface TNoteStop {
	kind: 'note';
	marbleId: string;
	hitId: string;
	/** Its number on the marble */
	number: number;
	time: number;
}

interface TRestStop {
	kind: 'rest';
	marbleId: string;
	gap: Pick<TLongGap, 'fromHitId' | 'toHitId' | 'from' | 'to' | 'duration' | 'bridgedBy'>;
}

/** Where ◀ ▶ stop: a marble's notes, and its long rests between them */
export type TBarStop = TNoteStop | TRestStop;

/** Past the built notes only building up to them can come next, as a marble has to get there first */
export type TBarStage = 'open' | 'built' | 'pastBuilt';

export type TBarTarget =
	| (TNoteStop & { total: number; stage: TBarStage; piece: TPiece | null; group: TPatternGroup | null; isLastBuilt: boolean })
	| (TRestStop & { total: number; stage: TBarStage; piece: TPiece | null })
	| { kind: 'notes'; marbleId: string; hitIds: string[]; first: number; last: number; total: number; time: number; pieces: TPiece[]; group: TPatternGroup | null };

export function stopsOf(project: TProject, marbleId: string): TBarStop[] {
	const marble = project.marbles.find((item) => item.id === marbleId);
	if (marble == null) return [];
	const gaps = new Map(findLongGaps(project, marbleId).map((gap) => [gap.toHitId, gap]));
	return marble.hits.flatMap((hit, index): TBarStop[] => {
		const gap = gaps.get(hit.id);
		const note: TBarStop = { kind: 'note', marbleId, hitId: hit.id, number: index + 1, time: hit.time };
		return gap != null ? [{ kind: 'rest', marbleId, gap }, note] : [note];
	});
}

/** The first note of the marble with no piece, or the rest before it when nothing fills that */
export function frontierStop(project: TProject, marbleId: string): TBarStop | null {
	const owners = hitOwners(project, marbleId);
	const stops = stopsOf(project, marbleId);
	const index = stops.findIndex((stop) => stop.kind === 'note' && !owners.has(stop.hitId));
	if (index < 0) return null;
	const before = stops[index - 1];
	return (before?.kind === 'rest' && before.gap.bridgedBy == null ? before : stops[index]) ?? null;
}

export function barTargetOf(project: TProject, selection: readonly string[]): TBarTarget | null {
	const [first] = selection;
	if (first == null) return null;
	const range = selection.length === 1 ? parseRangeKey(first) : null;
	if (range != null) return restTarget(project, range.marbleId, range.from, range.to);
	const groupId = parseGroupKey(first);
	if (groupId != null) return groupTarget(project, groupId);
	const hits = selection.map(parseHitKey);
	if (hits.every((hit) => hit != null)) return hitsTarget(project, hits.flatMap((hit) => hit ?? []));
	const pieces = selection.map((id) => project.track.pieces.find((piece) => piece.id === id));
	if (pieces.some((piece) => tieOf(piece) == null)) return null;
	return piecesTarget(project, pieces.flatMap((piece) => piece ?? []));
}

function hitsTarget(project: TProject, hits: { marbleId: string; hitId: string }[]): TBarTarget | null {
	const marbleId = hits[0]?.marbleId;
	const marble = project.marbles.find((item) => item.id === marbleId);
	if (marble == null || marbleId == null || hits.some((hit) => hit.marbleId !== marbleId)) return null;
	const indexes = hits.map((hit) => marble.hits.findIndex((item) => item.id === hit.hitId)).sort((a, b) => a - b);
	const [first] = indexes;
	const last = indexes.at(-1);
	if (first == null || last == null || first < 0) return null;
	if (hits.length === 1) return noteTarget(project, marbleId, first);
	const owners = hitOwners(project, marbleId);
	const hitIds = indexes.flatMap((index) => marble.hits[index]?.id ?? []);
	return { kind: 'notes', marbleId, hitIds, first: first + 1, last: last + 1, total: marble.hits.length, time: marble.hits[first]?.time ?? 0, pieces: hitIds.flatMap((id) => owners.get(id) ?? []), group: null };
}

function piecesTarget(project: TProject, pieces: TPiece[]): TBarTarget | null {
	const [only] = pieces;
	const tie = tieOf(only);
	if (only == null || tie == null) return null;
	if (pieces.length === 1 && tie.kind !== 'plays') {
		const gap = findLongGaps(project, tie.marbleId).find((item) => item.bridgedBy === only.id);
		return gap != null ? restTarget(project, tie.marbleId, gap.from, gap.to) : null;
	}
	return hitsTarget(project, pieces.flatMap((piece) => tieOf(piece) ?? []));
}

/** A Group over notes reads as those notes, one over a rest as that rest */
function groupTarget(project: TProject, groupId: string): TBarTarget | null {
	const group = project.track.groups.find((item) => item.id === groupId);
	const pieces = project.track.pieces.filter((piece) => group?.pieceIds.includes(piece.id) === true);
	const target = piecesTarget(project, pieces.filter((piece) => tieOf(piece)?.kind === 'plays').length > 0 ? pieces.filter((piece) => tieOf(piece)?.kind === 'plays') : pieces.slice(0, 1));
	if (target == null || group == null || !isPatternGroup(group)) return target;
	return target.kind === 'rest' ? target : { ...target, group };
}

function noteTarget(project: TProject, marbleId: string, index: number): TBarTarget | null {
	const marble = project.marbles.find((item) => item.id === marbleId);
	const hit = marble?.hits[index];
	if (marble == null || hit == null) return null;
	const owners = hitOwners(project, marbleId);
	const piece = owners.get(hit.id) ?? null;
	const firstOpen = marble.hits.findIndex((item) => !owners.has(item.id));
	const stage: TBarStage = piece != null ? 'built' : index === firstOpen ? 'open' : 'pastBuilt';
	const next = marble.hits[index + 1];
	return {
		kind: 'note',
		marbleId,
		hitId: hit.id,
		number: index + 1,
		time: hit.time,
		total: marble.hits.length,
		stage,
		piece,
		group: piece != null ? patternOfPiece(project, piece.id) : null,
		isLastBuilt: piece != null && (next == null || !owners.has(next.id))
	};
}

/** A rest is the long gap it lies in, or else the silence a drag chose */
function restTarget(project: TProject, marbleId: string, from: number, to: number): TBarTarget | null {
	const marble = project.marbles.find((item) => item.id === marbleId);
	if (marble == null) return null;
	const gap = findLongGaps(project, marbleId).find((item) => item.from <= from + 1e-3 && item.to >= to - 1e-3);
	const next = marble.hits.find((hit) => hit.time >= to - 1e-3);
	const before = [...marble.hits].reverse().find((hit) => hit.time <= from + 1e-3);
	const found = gap ?? (next != null && before != null ? { fromHitId: before.id, toHitId: next.id, from: before.time, to: next.time, duration: next.time - before.time, bridgedBy: null } : null);
	if (found == null) return null;
	const owners = hitOwners(project, marbleId);
	const piece = project.track.pieces.find((item) => item.id === found.bridgedBy) ?? null;
	const stage: TBarStage = piece != null ? 'built' : owners.has(found.fromHitId) ? 'open' : 'pastBuilt';
	return { kind: 'rest', marbleId, gap: found, total: marble.hits.length, stage, piece };
}

/** The selection that puts the bar on a stop: a built note's platform, so it's there to adjust, or the note or rest itself */
export function selectionOfStop(project: TProject, stop: TBarStop): string[] {
	if (stop.kind === 'rest') return [toRangeKey(stop.marbleId, stop.gap.from, stop.gap.to)];
	const piece = hitOwners(project, stop.marbleId).get(stop.hitId);
	return [piece != null && patternOfPiece(project, piece.id) == null ? piece.id : toHitKey(stop.marbleId, stop.hitId)];
}

/**
 * The piece that sends the marble to a note or a rest: the last of the marble's own pieces it touched before getting
 * there, in this run. A Problem that shows here is changed there. Null on several notes, or when no stop holds that piece
 */
export function senderOf(project: TProject, result: TSimulationResult | null, target: TBarTarget): { piece: TPiece; stop: TBarStop } | null {
	if (result == null || target.kind === 'notes') return null;
	const { marbleId } = target;
	const own = target.piece?.id;
	const time = target.kind === 'rest' ? target.gap.from + 1e-3 : (result.hits.find((hit) => hit.marbleId === marbleId && hit.hitId === target.hitId)?.targetTime ?? target.time) - 1e-3;
	const pieces = new Map(project.track.pieces.filter((piece) => piece.id !== own && tieOf(piece)?.marbleId === marbleId).map((piece) => [piece.id, piece]));
	const contact = result.contacts.filter((item) => item.marbleId === marbleId && item.kind === 'piece' && item.time <= time && pieces.has(item.otherId)).at(-1);
	const piece = contact != null ? pieces.get(contact.otherId) : undefined;
	const tie = tieOf(piece);
	if (piece == null || tie == null) return null;
	const stop = stopsOf(project, marbleId).find((item) => (tie.kind === 'plays' ? item.kind === 'note' && item.hitId === tie.hitId : item.kind === 'rest' && item.gap.bridgedBy === piece.id));
	return stop != null ? { piece, stop } : null;
}

/**
 * What's wrong here said from its cause, when the piece before sends the marble past this one: "Platform 1 sends Marble 1
 * past Platform 2". Otherwise the status's own words
 */
export function causeWords(project: TProject, target: TBarTarget, sender: { piece: TPiece } | null, status: { label: string; detail?: string }): string | null {
	const piece = target.kind === 'notes' ? null : target.piece;
	// Only a marble that doesn't touch the piece at all was sent past it; one that lands off time has its own words
	const isPast = status.label === 'Missed' && /without touching|never reaches/.test(status.detail ?? '');
	if (sender == null || piece == null || !isPast) return status.detail ?? null;
	const marble = project.marbles.find((item) => item.id === target.marbleId)?.name ?? 'the marble';
	return `${sender.piece.name ?? 'The piece before'} sends ${marble} past ${piece.name ?? 'it'}`;
}

/** The stop next to where the bar is, the arrows' whole job */
export function stopBeside(project: TProject, target: TBarTarget, direction: 1 | -1): TBarStop | null {
	const stops = stopsOf(project, target.marbleId);
	const noteNumber = target.kind === 'notes' ? (direction > 0 ? target.last : target.first) : target.kind === 'note' ? target.number : null;
	const index = noteNumber != null ? stops.findIndex((stop) => stop.kind === 'note' && stop.number === noteNumber) : stops.findIndex((stop) => stop.kind === 'rest' && target.kind === 'rest' && stop.gap.toHitId === target.gap.toHitId);
	return stops[index + direction] ?? null;
}

/** Whether the arrow that way goes anywhere */
export function hasStopBeside(project: TProject, target: TBarTarget, direction: 1 | -1): boolean {
	return stopBeside(project, target, direction) != null;
}

/** The stop after this note, where Enter goes once it and the notes before it have landed */
export function stopAfterNote(project: TProject, marbleId: string, hitId: string): TBarStop | null {
	const stops = stopsOf(project, marbleId);
	return stops[stops.findIndex((stop) => stop.kind === 'note' && stop.hitId === hitId) + 1] ?? null;
}

/** The notes a target is about, to bring them into view */
export function targetHitKeys(target: TBarTarget): string[] {
	if (target.kind === 'rest') return [toHitKey(target.marbleId, target.gap.fromHitId)];
	return target.kind === 'note' ? [toHitKey(target.marbleId, target.hitId)] : target.hitIds.map((hitId) => toHitKey(target.marbleId, hitId));
}

/** What identifies a target across runs of the same track */
export function targetKey(target: TBarTarget): string {
	return target.kind === 'rest' ? `rest:${target.marbleId}:${target.gap.toHitId}` : target.kind === 'note' ? `note:${target.marbleId}:${target.hitId}` : `notes:${target.marbleId}:${target.hitIds.join(',')}`;
}

/** What Where says, short enough for its fixed width: "12 / 149", "8 notes", "Rest 1.0 s" */
export function whereWords(target: TBarTarget): string {
	if (target.kind === 'rest') return `Rest ${target.gap.duration.toFixed(1)} s`;
	return target.kind === 'note' ? `${target.number} / ${target.total}` : `${target.hitIds.length} notes`;
}

/** Where in words, for its tooltip and a screen reader: "Note 12 of 149", "Notes 12 to 19", "Rest of 1.0 s" */
export function whereTitle(target: TBarTarget): string {
	if (target.kind === 'rest') return `Rest of ${target.gap.duration.toFixed(1)} s`;
	return target.kind === 'note' ? `Note ${target.number} of ${target.total}` : `Notes ${target.first} to ${target.last}`;
}

// MARK: - Choices

/** What the bar can land, a kind of `propose`, or what's a command with no hint */
export type TBarChoice = string;

export const BUILD_ENTIRE = 'buildEntire';
export const BUILD_UP_TO = 'buildUpTo';
export const REBUILD = 'rebuild';

/** Notes a stretch offer on a note goes over: as `patternPhrase` finds them */
function stretchOf(project: TProject, target: TBarTarget): string[] {
	if (target.kind === 'notes') return target.hitIds;
	if (target.kind === 'rest') return [target.gap.toHitId];
	return patternPhrase(project, target.marbleId, target.hitId).flatMap((key) => parseHitKey(key)?.hitId ?? []);
}

/** What an empty rest offers by default, in this order: a refused one gives way to the next, a rule and not a judgment. The plain piece comes last */
const REST_ORDER: readonly TBarChoice[] = ['longRail', 'switchback', 'platform'];

/**
 * What a press does when nothing was chosen: the plain piece here, what comes first past the built notes, nothing on
 * what's built. At an empty rest it's the first kind of `REST_ORDER` not yet `passed` over
 */
export function defaultChoice(target: TBarTarget, passed: readonly TBarChoice[] = []): TBarChoice | null {
	if (target.kind === 'notes') return null;
	if (target.stage === 'built') return null;
	if (target.stage === 'pastBuilt') return BUILD_UP_TO;
	return target.kind === 'rest' ? (REST_ORDER[Math.min(passed.length, REST_ORDER.length - 1)] ?? null) : 'platform';
}

/** What the default gives way to when `kind` is refused at an empty rest, or null */
export function fallbackOf(target: TBarTarget, kind: TBarChoice): TBarChoice | null {
	if (target.kind !== 'rest' || target.stage !== 'open') return null;
	const index = REST_ORDER.indexOf(kind);
	return index < 0 ? null : (REST_ORDER[index + 1] ?? null);
}

/** Why the bar shows `shown` at a rest: each kind passed over with its reason, then what it shows instead */
export function passedWords(passed: readonly { kind: TBarChoice; proposal: TProposal | null | undefined }[], shown: TBarChoice): string | null {
	if (!passed.length) return null;
	const reasons = passed.map(({ kind, proposal }) => {
		const name = KIND_NAMES[kind] ?? kind;
		const words = proposal?.words?.replace(/ Nothing changed\.$/, '') ?? '';
		return words.includes("doesn't fit") ? words : `${name} doesn't fit.${words !== '' ? ` ${words}` : ''}`;
	});
	return `${reasons.join(' ')} ${KIND_NAMES[shown] ?? shown} instead.`;
}

const KIND_NAMES: Record<string, string> = { platform: 'Platform', zigzag: 'Zigzag', staircase: 'Staircase', longRail: 'Curved Rail', switchback: 'Switchback' };

/** What `propose` is asked for a kind on this target */
export function askOf(project: TProject, target: TBarTarget, kind: string): TProposeAsk {
	const { marbleId } = target;
	if (kind === 'zigzag' || kind === 'staircase') return { marbleId, hitIds: stretchOf(project, target), kind };
	if (target.kind === 'rest') {
		const settings = (kind === 'remove' || kind === 'fix') && target.piece != null ? { settings: { pieceIds: [target.piece.id] } } : {};
		return { marbleId, hitIds: [target.gap.toHitId], kind, ...settings };
	}
	return { marbleId, hitIds: target.kind === 'notes' ? target.hitIds : [target.hitId], kind };
}

export interface TBarRow {
	id: TBarChoice;
	label: string;
	/** A choice is asked of `propose`, shows a hint and waits for accept; a command runs at once */
	isChoice: boolean;
	/** Fixed words at the row's end, when it's a command */
	note?: string;
	/** Starts a new block of rows */
	isSplit?: boolean;
}

/** The dropdown: only what fits the selection, with Build Entire Track last */
export function barRows(project: TProject, target: TBarTarget, openNotes: number): TBarRow[] {
	const rows: TBarRow[] = [];
	const buildEntire: TBarRow = { id: BUILD_ENTIRE, label: 'Build Entire Track', isChoice: false, note: `${openNotes} ${openNotes === 1 ? 'note' : 'notes'} left`, isSplit: true };
	if (target.kind !== 'notes' && target.stage === 'pastBuilt') {
		rows.push({ id: BUILD_UP_TO, label: 'Build Up to Here', isChoice: true });
		return [...rows, buildEntire];
	}
	const isBuilt = target.kind === 'notes' ? target.pieces.length > 0 : target.stage === 'built';
	const prefix = isBuilt ? 'Change to ' : '';
	if (target.kind === 'rest') {
		const current = target.piece != null ? restPieceWord(project, target.piece) : null;
		const kinds = isBuilt ? REST_ORDER.filter((kind) => kind !== 'platform') : REST_ORDER;
		for (const kind of kinds) if (KIND_NAMES[kind] !== current) rows.push({ id: kind, label: `${prefix}${KIND_NAMES[kind]}`, isChoice: true });
	} else {
		if (target.kind === 'note' && !isBuilt) rows.push({ id: 'platform', label: 'Platform', isChoice: true });
		const stretch = stretchOf(project, target);
		const count = target.kind === 'note' && stretch.length > 1 ? ` · ${stretch.length} notes` : '';
		if (stretch.length > 1) for (const kind of ['zigzag', 'staircase']) rows.push({ id: kind, label: `${prefix}${KIND_NAMES[kind]}${count}`, isChoice: true });
	}
	if (isBuilt) {
		if (target.kind !== 'rest') {
			const keeps = target.kind === 'note' ? target.number : target.first;
			rows.push({ id: REBUILD, label: 'Rebuild From Here', isChoice: false, note: keeps > 1 ? `Keeps Notes 1 to ${keeps}` : 'Keeps Note 1', isSplit: true });
		}
		rows.push({ id: 'remove', label: 'Remove', isChoice: true, ...(target.kind === 'rest' ? { isSplit: true } : {}) });
	}
	if (openNotes > 0) rows.push(buildEntire);
	return rows;
}

/** What a rest's piece is called: a Curved Rail by its Pattern or its one curved stroke, a Switchback by its turns, else its type */
function restPieceWord(project: TProject, piece: TPiece): string {
	if (patternOfPiece(project, piece.id)?.pattern.kind === 'longRail' || CURVED_LAYOUTS.has(piece.layout ?? '')) return 'Curved Rail';
	return piece.layout === 'switchback' ? 'Switchback' : (getPieceDefinition(piece.type)?.label ?? 'Rail');
}

/** Rail layouts that are one curved stroke, which is what a Curved Rail is */
const CURVED_LAYOUTS: ReadonlySet<string> = new Set(['curve', 'c']);

/** The What button when nothing is chosen: what stands here */
export function standingWords(project: TProject, target: TBarTarget): string {
	// Where already counts the notes: What says what stands on them
	if (target.kind === 'notes') {
		const labels = new Set(target.pieces.map((piece) => getPieceDefinition(piece.type)?.label ?? 'Piece'));
		const [only] = labels;
		return !target.pieces.length ? 'Notes' : labels.size === 1 && only != null ? `${only}s` : 'Pieces';
	}
	if (target.piece == null) return target.kind === 'rest' ? 'Rest' : 'Note';
	if (target.kind === 'rest') return restPieceWord(project, target.piece);
	return getPieceDefinition(target.piece.type)?.label ?? 'Piece';
}

/** The accept button's words for a choice */
export function acceptWords(project: TProject, target: TBarTarget, choice: TBarChoice, isProblem: boolean): string {
	const anyway = isProblem ? ' Anyway' : '';
	if (choice === BUILD_UP_TO) return 'Build Up to Here';
	if (choice === 'remove') return `Remove${anyway}`;
	if (choice === 'flip') return `Flip${anyway}`;
	if (choice === 'fix') return `Fix${anyway}`;
	const name = KIND_NAMES[choice] ?? choice;
	const isBuilt = target.kind === 'notes' ? target.pieces.length > 0 : target.stage === 'built';
	const stretch = choice === 'zigzag' || choice === 'staircase' ? stretchOf(project, target).length : 0;
	return `${isBuilt ? 'Change to' : 'Add'} ${name}${stretch > 1 ? ` · ${stretch} Notes` : ''}${anyway}`;
}

// MARK: - What a proposal does

/** One line on what a proposal does to the notes, in the bar's words; null when there's nothing to say */
export function effectWords(target: TBarTarget, proposal: TProposal): string | null {
	// A hint changed nothing, so it needn't say so
	if (proposal.status === 'refused' || proposal.status === 'buildUpTo') return proposal.words?.replace(/ Nothing changed\.$/, '') ?? null;
	const asked = new Set(proposal.notes.map((note) => note.number));
	const lost = (proposal.facts?.lostNumbers ?? []).filter((number) => !asked.has(number));
	if (lost.length > 0) return `${lostNotes(lost)} ${lost.length === 1 ? 'stops' : 'stop'} playing.${lost.length > 1 ? ' Their pieces stay.' : ''}`;
	if (proposal.status === 'problems') return proposal.words;
	return proposal.ask.kind === 'remove' || proposal.ask.kind === 'flip' ? null : laterWords(proposal, isOverBuilt(target));
}

/** It places what's asked but breaks something: never a plain accept */
export function isBadProposal(proposal: TProposal): boolean {
	const asked = new Set(proposal.notes.map((note) => note.number));
	return proposal.status === 'problems' || (proposal.facts?.lostNumbers ?? []).some((number) => !asked.has(number));
}

/** Whether something stands here to remove or fix */
export function isOverBuilt(target: TBarTarget): boolean {
	return target.kind === 'notes' ? target.pieces.length > 0 : target.stage === 'built';
}

function lostNotes(numbers: number[]): string {
	const sorted = [...numbers].sort((a, b) => a - b);
	const [first] = sorted;
	const last = sorted.at(-1);
	return sorted.length === 1 ? `Note ${first}` : `Notes ${first} to ${last}`;
}

/** What it moves after it, which only a change on what's built can */
function laterWords(proposal: TProposal, isOverBuiltNotes: boolean): string | null {
	if (!isOverBuiltNotes) return null;
	const moved = proposal.changes.filter((change) => change.how !== 'removed').length;
	return moved > 0 ? `${moved} later ${moved === 1 ? 'piece changes' : 'pieces change'} to keep notes on time.` : 'Later pieces stay.';
}

/** A row's short answer, at its end */
export function rowWords(target: TBarTarget, proposal: TProposal): string {
	const words = effectWords(target, proposal) ?? (proposal.status === 'fits' ? '' : (proposal.words ?? ''));
	// The row already names it, so it says why
	return proposal.status === 'refused' ? words.replace(/^[^.]* doesn't fit [^.]*\. /, '') : words;
}
