import { Err, Ok, type TResult } from 'tuple-result';
import { applyProjectCommands, createId, tieOf, type TPiece, type TProject, type TProjectCommand } from '@/modules/project';
import { isSuperseded, type THitResult, type TSimulationResult, type TSimulator } from '@/modules/simulation';
import { hitOwners } from './assists';
import { hitReach, isUnreachable, reachMessage } from './reachability';
import { answerEdit, editCommands, type TEditAnswer, type TEditRequest } from './edit-rule';
import { noKnownFaults, addKnownFaults, reasonWords, verdictWithRoom, type TVerdictReason } from './verdict';
import { answerWorkerRequest, type TAutoPlaceAnswer, type TGapAnswer, type TGapPieceType } from './worker-protocol';

// `propose` says what would be placed for these notes and what would come of it, and changes nothing. A person or an agent
// reads it and chooses; `acceptProposal` is what lands. Build Track and whole-run Fix are searches of their own.

export interface TProposeAsk {
	marbleId: string;
	/** The note, or the notes of a stretch */
	hitIds: string[];
	/** What to place: a piece type for a note, or a gap piece for the rest before the note */
	kind: string;
	/** What the kind takes, and the ID its piece gets */
	settings?: { pieceId?: string };
}

/** What one note makes of it, in plain words */
export interface TNoteVerdict {
	hitId: string;
	/** Its number in the marble */
	number: number;
	time: number;
	/** It plays on time; the marble reaches it and a piece can still play it; or neither */
	state: 'onTime' | 'reached' | 'off';
	words: string;
}

/** A piece outside the proposal that it would change, before or after the notes asked */
export interface TProposalChange {
	pieceId: string;
	name: string;
	how: 'changed' | 'removed' | 'moved';
	/** Meters, for a piece that moves with the marble */
	distance?: number;
}

export interface TProposalFacts {
	onTime: number;
	total: number;
	/** Notes on time before and not after */
	lost: number;
	/** Whether a flat platform fits at the marble's next dot; null when something else is wrong first, or there's no next dot to ask about */
	hasRoomAtNext: boolean | null;
}

export interface TProposal {
	id: string;
	/** The track it's about: a proposal holds only for this one */
	base: TProject;
	ask: TProposeAsk;
	/** `fits` when every fact holds; `problems` has pieces and reasons, for someone to accept or not; `refused` has nothing to place; `buildUpTo` is past the built notes */
	status: 'fits' | 'problems' | 'refused' | 'buildUpTo';
	/** What lands: the pieces and whatever they make change */
	commands: TProjectCommand[];
	pieces: TPiece[];
	notes: TNoteVerdict[];
	changes: TProposalChange[];
	facts: TProposalFacts | null;
	reasons: TVerdictReason[];
	/** Plain words when something's wrong: the first reason, why nothing fits, or "Build up to here" */
	words: string | null;
	/** For a gap piece, what the search said of it: its ghost and how it reads */
	gap?: TGapAnswer;
}

export interface TProposeDeps {
	simulate: (project: TProject) => Promise<TSimulationResult> | TSimulationResult;
	autoPlace: (request: { project: TProject; marbleId: string; hitId: string; type: string; pieceId: string }) => Promise<TAutoPlaceAnswer> | TAutoPlaceAnswer;
	gapPiece: (request: { type: TGapPieceType; project: TProject; marbleId: string; fromHitId: string; toHitId: string; pieceId?: string }) => Promise<TGapAnswer> | TGapAnswer;
	/** What later pieces do about it, asked only when later pieces exist */
	settle: (request: TEditRequest) => Promise<TEditAnswer> | TEditAnswer;
}

export interface TProposeOptions {
	/** The run of `project`, when the caller has it */
	result?: TSimulationResult;
	/** A place at any dot, past notes still open: Next and a click do this until the bar replaces them */
	isAnyDot?: boolean;
}

/** Deps that answer in this thread with the same requests the workers answer, for scripts and tests */
export function localProposeDeps(simulator: TSimulator): TProposeDeps {
	return {
		simulate: (project) => simulator.simulate(project),
		autoPlace: (request) => answerWorkerRequest(simulator, { kind: 'autoPlace', ...request }) as TAutoPlaceAnswer,
		gapPiece: (request) => answerWorkerRequest(simulator, { kind: 'gapPiece', ...request }) as TGapAnswer,
		settle: (request) => answerEdit(simulator, request)
	};
}

/** Pieces further than this from where they stood count as moved, in meters */
const MOVED = 0.01;

export async function propose(project: TProject, ask: TProposeAsk, deps: TProposeDeps, options: TProposeOptions = {}): Promise<TProposal> {
	const before = options.result ?? (await deps.simulate(project));
	const { marbleId, hitIds, kind } = ask;
	const marble = project.marbles.find((item) => item.id === marbleId);
	const hitId = hitIds[0];
	const hit = before.hits.find((item) => item.marbleId === marbleId && item.hitId === hitId);
	if (marble == null || hitId == null || hit == null) return refused(project, before, ask, 'That note is gone.');
	const owners = hitOwners(project, marbleId);
	const index = marble.hits.findIndex((item) => item.id === hitId);
	const firstOpen = marble.hits.findIndex((item) => !owners.has(item.id));
	if (options.isAnyDot !== true && firstOpen >= 0 && index > firstOpen) return { ...refused(project, before, ask, `Build up to here: Hit ${firstOpen + 1} has no piece yet.`), status: 'buildUpTo' };
	if (isGapKind(kind)) return proposeGapPiece(project, before, ask, kind, marble.hits[index - 1]?.id, deps);
	const reach = hitReach(project, before, hit);
	if (isUnreachable(reach)) return refused(project, before, ask, reachMessage(reach, { hit: `Hit ${index + 1}`, marble: marble.name }, null, false) ?? "The marble can't reach this note.");
	if (hit.dot == null) return refused(project, before, ask, 'The marble does not reach this note.');

	let answer: TAutoPlaceAnswer;
	try {
		answer = await deps.autoPlace({ project, marbleId, hitId, type: kind, pieceId: ask.settings?.pieceId ?? createId('piece') });
	} catch (error) {
		// A newer request took this one's place in the queue, which says nothing about the note
		if (isSuperseded(error)) throw error;
		return refused(project, before, ask, error instanceof Error ? error.message : String(error));
	}
	return landed(project, before, ask, [answer.piece], [{ type: 'addPiece', piece: answer.piece }], true, deps);
}

const GAP_KINDS: readonly string[] = ['rail', 'switchback', 'chain', 'tunnel'] satisfies TGapPieceType[];

function isGapKind(kind: string): kind is TGapPieceType {
	return GAP_KINDS.includes(kind);
}

/** A gap piece across the rest before the note. The note itself has no piece yet: wherever the marble arrives is its place */
async function proposeGapPiece(project: TProject, before: TSimulationResult, ask: TProposeAsk, type: TGapPieceType, fromHitId: string | undefined, deps: TProposeDeps): Promise<TProposal> {
	const toHitId = ask.hitIds[0];
	if (fromHitId == null || toHitId == null) return refused(project, before, ask, 'A rest lies between two notes, and this note is the first.');
	let answer: TGapAnswer;
	try {
		const pieceId = ask.settings?.pieceId;
		answer = await deps.gapPiece({ type, project, marbleId: ask.marbleId, fromHitId, toHitId, ...(pieceId != null ? { pieceId } : {}) });
	} catch (error) {
		if (isSuperseded(error)) throw error;
		return refused(project, before, ask, error instanceof Error ? error.message : String(error));
	}
	return { ...(await landed(project, before, ask, [answer.piece], answer.commands, false, deps)), gap: answer };
}

function refused(project: TProject, before: TSimulationResult, ask: TProposeAsk, words: string): TProposal {
	return { id: createId('proposal'), base: project, ask, status: 'refused', commands: [], pieces: [], notes: notesOf(project, ask, before, []), changes: [], facts: null, reasons: [], words };
}

/** Applies a proposal's pieces to its track on paper and states the facts */
async function landed(project: TProject, before: TSimulationResult, ask: TProposeAsk, pieces: TPiece[], commands: TProjectCommand[], checksNext: boolean, deps: TProposeDeps): Promise<TProposal> {
	const [isApplied, applyError, applied] = applyProjectCommands(project, commands);
	if (!isApplied) return refused(project, before, ask, applyError.message);
	const last = project.marbles.find((item) => item.id === ask.marbleId)?.hits.findIndex((item) => item.id === ask.hitIds.at(-1)) ?? -1;
	const owners = hitOwners(project, ask.marbleId);
	const hasLater = project.marbles.find((item) => item.id === ask.marbleId)?.hits.slice(last + 1).some((item) => owners.has(item.id)) === true;
	// With later pieces already there, they take up the change or move with the marble, as any edit does
	const settled = hasLater ? await deps.settle({ before: project, after: applied }) : null;
	const allCommands = settled != null ? [...commands, ...editCommands(settled)] : commands;
	const [isSettledOk, , settledProject] = applyProjectCommands(project, allCommands);
	const after = isSettledOk ? settledProject : applied;
	const result = await deps.simulate(after);
	const known = noKnownFaults();
	addKnownFaults(known, project, before);
	const verdict = await verdictWithRoom({ before: { project, result: before }, after: { project: after, result }, marbleId: ask.marbleId, known, checksNext }, deps.simulate);
	const made = new Set(pieces.map((piece) => piece.id));
	const nextDotAsked = checksNext && (!verdict.reasons.length || verdict.reasons.every((reason) => reason.kind === 'noRoom'));
	return {
		id: createId('proposal'),
		base: project,
		ask,
		status: verdict.reasons.length > 0 ? 'problems' : 'fits',
		commands: allCommands,
		pieces,
		notes: notesOf(after, ask, result, verdict.reasons),
		changes: changesOf(project, after, before, result, made),
		facts: {
			onTime: verdict.onTime,
			total: verdict.total,
			lost: verdict.lost.length,
			hasRoomAtNext: nextDotAsked ? !verdict.reasons.some((reason) => reason.kind === 'noRoom') : null
		},
		reasons: verdict.reasons,
		words: verdict.reasons[0] != null ? reasonWords(after, verdict.reasons[0]) : null
	};
}

/** A note's verdict: on time, or the first reason that names it, or what the run says about it */
function notesOf(project: TProject, ask: TProposeAsk, result: TSimulationResult, reasons: readonly TVerdictReason[]): TNoteVerdict[] {
	const marble = project.marbles.find((item) => item.id === ask.marbleId);
	return ask.hitIds.map((hitId) => {
		const number = (marble?.hits.findIndex((item) => item.id === hitId) ?? -1) + 1;
		const hit = result.hits.find((item) => item.marbleId === ask.marbleId && item.hitId === hitId);
		const state = noteState(project, result, hit);
		const named = reasons.find((reason) => 'hitId' in reason && reason.hitId === hitId);
		return { hitId, number, time: hit?.targetTime ?? marble?.hits[number - 1]?.time ?? 0, state, words: named != null ? reasonWords(project, named) : noteWords(number, hit, state) };
	});
}

function noteState(project: TProject, result: TSimulationResult, hit: THitResult | undefined): TNoteVerdict['state'] {
	if (hit == null) return 'off';
	if (hit.status === 'onTime' || hit.status === 'drifting') return 'onTime';
	return hit.status === 'open' && hit.dot != null && !isUnreachable(hitReach(project, result, hit)) ? 'reached' : 'off';
}

function noteWords(number: number, hit: THitResult | undefined, state: TNoteVerdict['state']): string {
	if (state === 'onTime') return `Hit ${number} plays on time.`;
	if (state === 'reached') return `The marble reaches Hit ${number}, which can take a piece.`;
	if (hit?.status === 'open') return `The marble doesn't reach Hit ${number}.`;
	const error = hit?.error != null ? ` by ${Math.round(Math.abs(hit.error) * 1000)} ms` : '';
	return `Hit ${number} doesn't play on time${error}: ${hit?.reason ?? hit?.status ?? 'missed'}.`;
}

/** Pieces beyond the proposal's own that change, go, or stand somewhere else */
function changesOf(project: TProject, after: TProject, before: TSimulationResult, result: TSimulationResult, made: ReadonlySet<string>): TProposalChange[] {
	const nameOf = (piece: TPiece | undefined, id: string): string => piece?.name ?? id;
	const was = new Map(project.track.pieces.map((piece) => [piece.id, piece]));
	const now = new Map(after.track.pieces.map((piece) => [piece.id, piece]));
	const standing = new Map(before.pieces.map((piece) => [piece.pieceId, piece.position]));
	const changes: TProposalChange[] = [];
	for (const piece of project.track.pieces) if (!now.has(piece.id)) changes.push({ pieceId: piece.id, name: nameOf(piece, piece.id), how: 'removed' });
	for (const piece of after.track.pieces) {
		const old = was.get(piece.id);
		if (old == null || made.has(piece.id)) continue;
		if (old !== piece && JSON.stringify(old) !== JSON.stringify(piece)) changes.push({ pieceId: piece.id, name: nameOf(piece, piece.id), how: 'changed' });
	}
	const listed = new Set(changes.map((change) => change.pieceId));
	for (const piece of result.pieces) {
		const position = standing.get(piece.pieceId);
		if (position == null || made.has(piece.pieceId) || listed.has(piece.pieceId)) continue;
		const distance = Math.hypot(piece.position.x - position.x, piece.position.y - position.y);
		if (distance > MOVED) changes.push({ pieceId: piece.pieceId, name: nameOf(now.get(piece.pieceId), piece.pieceId), how: 'moved', distance });
	}
	return changes;
}

/** The commands that land a proposal, as one Undo. It holds only for the track it was made for, and it has to have something to land */
export function acceptProposal(project: TProject, proposal: TProposal): TResult<TProjectCommand[], Error> {
	if (proposal.base !== project) return Err(new Error('The track changed since this was proposed. Propose again.'));
	if (!proposal.commands.length) return Err(new Error(proposal.words ?? 'This proposal has nothing to place.'));
	return Ok(proposal.commands);
}

/** The piece that plays a note in a proposal's commands, for what selects it */
export function proposedPieceFor(proposal: TProposal, hitId: string): TPiece | undefined {
	return proposal.pieces.find((piece) => tieOf(piece)?.hitId === hitId) ?? proposal.pieces[0];
}
