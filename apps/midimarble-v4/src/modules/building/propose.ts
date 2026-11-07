import { Err, Ok, type TResult } from 'tuple-result';
import { applyProjectCommands, createId, type TPiece, type TProject, type TProjectCommand, type TVec2 } from '@/modules/project';
import { isSuperseded, type THitResult, type TResolvedPiece, type TSimulationResult, type TSimulator } from '@/modules/simulation';
import { findLongGaps, hitOwners, openLongGaps } from './assists';
import { hitReach, isUnreachable, reachMessage } from './reachability';
import { answerEdit, changedPieces, editCommands, type TEditAnswer, type TEditRequest } from './edit-rule';
import { fixPiece, hasPieceProblem, type TFixDeps } from './fix-it';
import { checkPattern, type TPatternAsk, type TPatternCheck } from './patterns/check-pattern';
import { patternOfKind } from './patterns/registry';
import { restOffers } from './rest-order';
import { noKnownFaults, addKnownFaults, reasonWords, verdictWithRoom, type TVerdictReason } from './verdict';
import { answerWorkerRequest, type TAutoPlaceAnswer, type TGapAnswer, type TGapPieceType } from './worker-protocol';

// `propose` says what would be placed for these notes and what would come of it, and changes nothing. A person or an agent
// reads it and chooses; `acceptProposal` is what lands. Build Track and whole-run Fix are searches of their own.

export interface TProposeAsk {
	marbleId: string;
	/** The note, or the notes of a stretch */
	hitIds: string[];
	/** What to place: a piece type for a note, a gap piece for the rest before the note, or a Pattern over these notes or that rest. `flip` turns the note's platform the other way and `remove` takes its piece */
	kind: string;
	/** What the kind takes, the ID its piece gets, and for `remove` the pieces it takes when they don't play these notes */
	settings?: { pieceId?: string; pieceIds?: string[]; width?: number; bounce?: number; maxTilt?: number };
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
	/** Their numbers, on the marble asked about */
	lostNumbers: number[];
	/** New since the track before: pieces struck twice, rolled on or passed through, pieces that touch, what another marble hits */
	strikes: number;
	rolls: number;
	passThroughs: number;
	touching: number;
	crossings: number;
	/** Whether the marble's next dot stays near the shared pace, with several marbles */
	isNearPace: boolean;
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
	/** Those pieces as they'd stand, for a hint */
	shown: TResolvedPiece[];
	/** Where the marble is at its next open note with this, and its way there; empty without a next note or a run */
	nextDot: TVec2 | null;
	flight: TVec2[];
	notes: TNoteVerdict[];
	changes: TProposalChange[];
	facts: TProposalFacts | null;
	reasons: TVerdictReason[];
	/** Plain words when something's wrong: the first reason, why nothing fits, or "Build up to here" */
	words: string | null;
	/** For a gap piece, what the search said of it: its ghost and how it reads */
	gap?: TGapAnswer;
	/** A rest comes before this note: what fills it, and the plain piece with its reason when nothing does */
	instead?: TProposal[];
}

/** What a Pattern's check says, in a worker or in this thread. Null when it was stopped */
export type TProposedPattern = (Pick<TPatternCheck, 'commands' | 'refusal' | 'verdicts' | 'ending'> & { pieces?: TResolvedPiece[] }) | null;

export interface TProposeDeps {
	simulate: (project: TProject) => Promise<TSimulationResult> | TSimulationResult;
	autoPlace: (request: { project: TProject; marbleId: string; hitId: string; type: string; pieceId: string }) => Promise<TAutoPlaceAnswer> | TAutoPlaceAnswer;
	gapPiece: (request: { type: TGapPieceType; project: TProject; marbleId: string; fromHitId: string; toHitId: string; pieceId?: string }) => Promise<TGapAnswer> | TGapAnswer;
	pattern: (project: TProject, ask: TPatternAsk) => Promise<TProposedPattern> | TProposedPattern;
	/** What later pieces do about it, asked only when later pieces exist */
	settle: (request: TEditRequest) => Promise<TEditAnswer> | TEditAnswer;
}

export interface TProposeOptions {
	/** The run of `project`, when the caller has it */
	result?: TSimulationResult;
	/** A place at any dot, past notes still open, or past a rest nothing fills: Next does this, and the bar on such a note */
	isAnyDot?: boolean;
}

/** Deps that answer in this thread with the same requests the workers answer, for scripts and tests */
export function localProposeDeps(simulator: TSimulator): TProposeDeps {
	return {
		simulate: (project) => simulator.simulate(project),
		autoPlace: (request) => answerWorkerRequest(simulator, { kind: 'autoPlace', ...request }) as TAutoPlaceAnswer,
		gapPiece: (request) => answerWorkerRequest(simulator, { kind: 'gapPiece', ...request }) as TGapAnswer,
		pattern: (project, ask) => checkPattern(project, ask, { sim: simulator }),
		settle: (request) => answerEdit(simulator, request)
	};
}

/** Pieces further than this from where they stood count as moved, in meters */
const MOVED = 0.01;
/** A Pattern for a rest asks for the silence just inside its notes */
const SILENCE_MARGIN = 0.01;

export async function propose(project: TProject, ask: TProposeAsk, deps: TProposeDeps, options: TProposeOptions = {}): Promise<TProposal> {
	const before = options.result ?? (await deps.simulate(project));
	const { marbleId, hitIds, kind } = ask;
	const marble = project.marbles.find((item) => item.id === marbleId);
	const hitId = hitIds[0];
	const hit = before.hits.find((item) => item.marbleId === marbleId && item.hitId === hitId);
	if (marble == null || hitId == null || hit == null) return refused(project, before, ask, 'That note is gone.');
	if (kind === 'remove' || kind === 'flip') return proposeEdit(project, before, ask, kind, deps);
	if (kind === 'fix') return proposeFix(project, before, ask, deps);
	const owners = hitOwners(project, marbleId);
	const index = marble.hits.findIndex((item) => item.id === hitId);
	const firstOpen = marble.hits.findIndex((item) => !owners.has(item.id));
	if (options.isAnyDot !== true && firstOpen >= 0 && index > firstOpen) return { ...refused(project, before, ask, `Build up to here: Note ${firstOpen + 1} has no piece yet.`), status: 'buildUpTo' };
	if (isGapKind(kind)) return proposeGapPiece(project, before, ask, kind, marble.hits[index - 1]?.id, deps);
	if (patternOfKind(kind) != null) return proposePattern(project, before, ask, deps);
	if (options.isAnyDot !== true && openLongGaps(project, marbleId).some((gap) => gap.toHitId === hitId)) return proposeRest(project, before, ask, deps);
	const reach = hitReach(project, before, hit);
	if (isUnreachable(reach)) return refused(project, before, ask, reachMessage(reach, { hit: `Note ${index + 1}`, marble: marble.name }, null, false) ?? "The marble can't reach this note.");
	if (hit.dot == null) return refused(project, before, ask, 'The marble does not reach this note.');

	let answer: TAutoPlaceAnswer;
	try {
		answer = await deps.autoPlace({ project, marbleId, hitId, type: kind, pieceId: ask.settings?.pieceId ?? createId('piece') });
	} catch (error) {
		// A newer request took this one's place in the queue, which says nothing about the note
		if (isSuperseded(error)) throw error;
		return refused(project, before, ask, error instanceof Error ? error.message : String(error));
	}
	return landed(project, before, ask, [answer.piece], [{ type: 'addPiece', piece: answer.piece }], { checksNext: true }, deps);
}

const GAP_KINDS: readonly string[] = ['rail', 'switchback', 'chain', 'tunnel'] satisfies TGapPieceType[];

function isGapKind(kind: string): kind is TGapPieceType {
	return GAP_KINDS.includes(kind);
}

/** A gap piece across the rest before the note. The note itself has no piece yet: wherever the marble arrives is its place */
async function proposeGapPiece(project: TProject, before: TSimulationResult, ask: TProposeAsk, type: TGapPieceType, fromHitId: string | undefined, deps: TProposeDeps): Promise<TProposal> {
	const toHitId = ask.hitIds[0];
	if (fromHitId == null || toHitId == null) return refused(project, before, ask, 'A rest lies between two notes, and this note is the first.');
	// What already fills the rest makes way, in the same step
	const bridge = findLongGaps(project, ask.marbleId).find((gap) => gap.toHitId === toHitId)?.bridgedBy;
	const makesWay: TProjectCommand[] = bridge != null ? [{ type: 'removePieces', pieceIds: [bridge] }] : [];
	const [isClear, clearError, clear] = applyProjectCommands(project, makesWay);
	if (!isClear) return refused(project, before, ask, clearError.message);
	let answer: TGapAnswer;
	try {
		const pieceId = ask.settings?.pieceId;
		answer = await deps.gapPiece({ type, project: clear, marbleId: ask.marbleId, fromHitId, toHitId, ...(pieceId != null ? { pieceId } : {}) });
	} catch (error) {
		if (isSuperseded(error)) throw error;
		return refused(project, before, ask, error instanceof Error ? error.message : String(error));
	}
	return { ...(await landed(project, before, ask, [answer.piece], [...makesWay, ...answer.commands], { checksNext: false }, deps)), gap: answer };
}

/** A note's piece the other way round, or a stretch's pieces gone: what later notes do about it is in the answer */
async function proposeEdit(project: TProject, before: TSimulationResult, ask: TProposeAsk, kind: 'remove' | 'flip', deps: TProposeDeps): Promise<TProposal> {
	const owners = hitOwners(project, ask.marbleId);
	const playing = ask.hitIds.flatMap((hitId) => owners.get(hitId) ?? []);
	if (kind === 'flip') {
		const [piece] = playing;
		if (piece == null) return refused(project, before, ask, 'This note has no platform to flip.');
		const flipped = { ...piece, angle: -piece.angle };
		return landed(project, before, ask, [flipped], [{ type: 'updatePiece', pieceId: piece.id, patch: { angle: flipped.angle } }], { checksNext: true }, deps);
	}
	const wanted = ask.settings?.pieceIds;
	const pieces = wanted != null ? project.track.pieces.filter((piece) => wanted.includes(piece.id)) : playing;
	if (!pieces.length) return refused(project, before, ask, 'There is no piece here to remove.');
	const proposal = await landed(project, before, ask, pieces, [{ type: 'removePieces', pieceIds: pieces.map((piece) => piece.id) }], { checksNext: false }, deps);
	// They aren't there afterward: the hint draws them where they stand
	return { ...proposal, shown: before.pieces.filter((piece) => pieces.some((item) => item.id === piece.pieceId)) };
}

/**
 * Fix for one piece, as a hint: the first of the pieces asked whose note isn't on time or that has a Problem, or else
 * the first, solved again by `fixPiece`. Its what-if already kept the later notes, so nothing settles after it
 */
async function proposeFix(project: TProject, before: TSimulationResult, ask: TProposeAsk, deps: TProposeDeps): Promise<TProposal> {
	const owners = hitOwners(project, ask.marbleId);
	const asked = ask.settings?.pieceIds ?? ask.hitIds.flatMap((hitId) => owners.get(hitId)?.id ?? []);
	const isWrong = (pieceId: string): boolean => before.hits.some((hit) => hit.pieceId === pieceId && hit.status !== 'onTime' && hit.status !== 'open') || hasPieceProblem(project, before, pieceId);
	const pieceId = asked.find(isWrong) ?? asked[0];
	if (pieceId == null) return refused(project, before, ask, 'There is no piece here to fix.');
	const fix = await fixPiece(project, before, pieceId, fixDepsOf(deps));
	if (fix.commands == null) return refused(project, before, ask, fix.message);
	const [isApplied, applyError, after] = applyProjectCommands(project, fix.commands);
	if (!isApplied) return refused(project, before, ask, applyError.message);
	return landed(project, before, ask, changedPieces(project, after), fix.commands, { checksNext: false, isSettled: true }, deps);
}

/** What Fix asks, from the same requests `propose` makes */
function fixDepsOf(deps: TProposeDeps): Pick<TFixDeps, 'simulate' | 'autoPlace' | 'gapPiece' | 'settle'> {
	return {
		simulate: async (next) => deps.simulate(next),
		autoPlace: async (next, hit, piece) => (await deps.autoPlace({ project: next, marbleId: hit.marbleId, hitId: hit.hitId, type: piece.type ?? 'platform', pieceId: piece.id })).piece,
		gapPiece: async (next, gap, type, pieceId) => (await deps.gapPiece({ type, project: next, marbleId: gap.marbleId, fromHitId: gap.fromHitId, toHitId: gap.toHitId, pieceId })).piece,
		settle: async (from, to) => editCommands(await deps.settle({ before: from, after: to }))
	};
}

/** What a rest offers instead of a plain piece, in the order Build fills one (`restOffers`): a Curved Rail and a Switchback, each with its own answer, and the plain piece only when neither fits */
async function proposeRest(project: TProject, before: TSimulationResult, ask: TProposeAsk, deps: TProposeDeps): Promise<TProposal> {
	const instead: TProposal[] = [];
	for (const kind of restOffers()) if (kind !== 'platform') instead.push(await propose(project, { ...ask, kind }, deps, { result: before }));
	if (!instead.some((proposal) => proposal.status === 'fits')) instead.push(await propose(project, ask, deps, { result: before, isAnyDot: true }));
	return { ...refused(project, before, ask, 'A rest comes before this note.'), instead };
}

/** A Pattern over these notes, or over the rest before this note, asked of the whole song by its own check */
async function proposePattern(project: TProject, before: TSimulationResult, ask: TProposeAsk, deps: TProposeDeps): Promise<TProposal> {
	const { marbleId, hitIds, kind, settings } = ask;
	const hits = project.marbles.find((item) => item.id === marbleId)?.hits ?? [];
	const firstIndex = hits.findIndex((hit) => hit.id === hitIds[0]);
	const [first, last] = [hits[firstIndex], hits.find((hit) => hit.id === hitIds.at(-1))];
	if (first == null || last == null) return refused(project, before, ask, 'That note is gone.');
	const isSilence = patternOfKind(kind)?.takes === 'silence';
	const range = isSilence ? { from: (hits[firstIndex - 1]?.time ?? 0) + SILENCE_MARGIN, to: first.time - SILENCE_MARGIN } : { from: first.time, to: last.time };
	const { width, bounce, maxTilt } = settings ?? {};
	const answer = await deps.pattern(project, { marbleId, kind, ...range, ...(width != null ? { width } : {}), ...(bounce != null ? { bounce } : {}), ...(maxTilt != null ? { maxTilt } : {}) });
	if (answer == null) return refused(project, before, ask, 'The Pattern was stopped.');
	const said = new Map(answer.verdicts.flatMap((verdict) => (verdict.words != null ? [[verdict.hitId, verdict.words] as const] : [])));
	const withWords = (proposal: TProposal): TProposal => ({ ...proposal, notes: proposal.notes.map((note) => ({ ...note, words: said.get(note.hitId) ?? note.words })) });
	if (answer.refusal != null || !answer.commands.length) return { ...withWords(refused(project, before, ask, answer.refusal?.words ?? answer.ending?.words ?? "It doesn't fit here.")), shown: answer.pieces ?? [] };
	const [isApplied, applyError, after] = applyProjectCommands(project, answer.commands);
	if (!isApplied) return refused(project, before, ask, applyError.message);
	// Its check already had the later pieces take up the change
	return withWords(await landed(project, before, ask, changedPieces(project, after), answer.commands, { checksNext: !isSilence, isSettled: true }, deps));
}

function refused(project: TProject, before: TSimulationResult, ask: TProposeAsk, words: string): TProposal {
	return { id: createId('proposal'), base: project, ask, status: 'refused', commands: [], pieces: [], shown: [], nextDot: null, flight: [], notes: notesOf(project, ask, before, []), changes: [], facts: null, reasons: [], words };
}

/** Applies a proposal's pieces to its track on paper and states the facts */
async function landed(project: TProject, before: TSimulationResult, ask: TProposeAsk, pieces: TPiece[], commands: TProjectCommand[], { checksNext, isSettled = false }: { checksNext: boolean; isSettled?: boolean }, deps: TProposeDeps): Promise<TProposal> {
	const [isApplied, applyError, applied] = applyProjectCommands(project, commands);
	if (!isApplied) return refused(project, before, ask, applyError.message);
	const last = project.marbles.find((item) => item.id === ask.marbleId)?.hits.findIndex((item) => item.id === ask.hitIds.at(-1)) ?? -1;
	const owners = hitOwners(project, ask.marbleId);
	const hasLater = !isSettled && project.marbles.find((item) => item.id === ask.marbleId)?.hits.slice(last + 1).some((item) => owners.has(item.id)) === true;
	// With later pieces already there, they take up the change or move with the marble, as any edit does
	const settled = hasLater ? await deps.settle({ before: project, after: applied }) : null;
	const allCommands = settled != null ? [...commands, ...editCommands(settled)] : commands;
	const [isSettledOk, , settledProject] = applyProjectCommands(project, allCommands);
	const after = isSettledOk ? settledProject : applied;
	const result = await deps.simulate(after);
	const known = noKnownFaults();
	addKnownFaults(known, project, before);
	const verdict = await verdictWithRoom({ before: { project, result: before }, after: { project: after, result }, marbleId: ask.marbleId, known, checksNext }, deps.simulate);
	const countOf = (kind: TVerdictReason['kind']): number => verdict.reasons.filter((reason) => reason.kind === kind).length;
	const made = new Set(pieces.map((piece) => piece.id));
	const nextDotAsked = checksNext && (!verdict.reasons.length || verdict.reasons.every((reason) => reason.kind === 'noRoom'));
	const hitsOfMarble = project.marbles.find((item) => item.id === ask.marbleId)?.hits ?? [];
	return {
		id: createId('proposal'),
		base: project,
		ask,
		status: verdict.reasons.length > 0 ? 'problems' : 'fits',
		commands: allCommands,
		pieces,
		shown: result.pieces.filter((piece) => made.has(piece.pieceId)),
		...wayOnward(result, ask),
		notes: notesOf(after, ask, result, verdict.reasons),
		changes: changesOf(project, after, before, result, made),
		facts: {
			onTime: verdict.onTime,
			total: verdict.total,
			lost: verdict.lost.length,
			lostNumbers: verdict.lost.filter((note) => note.marbleId === ask.marbleId).map((note) => hitsOfMarble.findIndex((hit) => hit.id === note.hitId) + 1),
			strikes: countOf('struckTwice'),
			rolls: countOf('rolls'),
			passThroughs: countOf('passesThrough'),
			touching: countOf('touching'),
			crossings: countOf('crossing'),
			isNearPace: countOf('offPace') === 0,
			hasRoomAtNext: nextDotAsked ? !verdict.reasons.some((reason) => reason.kind === 'noRoom') : null
		},
		reasons: verdict.reasons,
		words: verdict.reasons[0] != null ? reasonWords(after, verdict.reasons[0]) : null
	};
}

/** Where the marble goes from the notes asked to its next open note, for a hint */
function wayOnward(result: TSimulationResult, ask: TProposeAsk): Pick<TProposal, 'nextDot' | 'flight'> {
	const asked = result.hits.filter((hit) => hit.marbleId === ask.marbleId && ask.hitIds.includes(hit.hitId));
	const from = Math.max(...asked.map((hit) => hit.targetTime), 0);
	const next = result.hits.filter((hit) => hit.marbleId === ask.marbleId && hit.status === 'open' && hit.targetTime > from - 1e-6).sort((a, b) => a.targetTime - b.targetTime)[0];
	if (next?.dot == null) return { nextDot: null, flight: [] };
	const samples = result.marbles.find((track) => track.marbleId === ask.marbleId)?.samples ?? [];
	return { nextDot: next.dot, flight: samples.filter((sample) => sample.time >= from && sample.time <= next.targetTime).map((sample) => sample.position) };
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
	if (state === 'onTime') return `Note ${number} plays on time.`;
	if (state === 'reached') return `The marble reaches Note ${number}, which can take a piece.`;
	if (hit?.status === 'open') return `The marble doesn't reach Note ${number}.`;
	const error = hit?.error != null ? ` by ${Math.round(Math.abs(hit.error) * 1000)} ms` : '';
	return `Note ${number} doesn't play on time${error}: ${hit?.reason ?? hit?.status ?? 'missed'}.`;
}

/** Pieces beyond the proposal's own that change, go, or stand somewhere else */
function changesOf(project: TProject, after: TProject, before: TSimulationResult, result: TSimulationResult, made: ReadonlySet<string>): TProposalChange[] {
	const nameOf = (piece: TPiece | undefined, id: string): string => piece?.name ?? id;
	const was = new Map(project.track.pieces.map((piece) => [piece.id, piece]));
	const now = new Map(after.track.pieces.map((piece) => [piece.id, piece]));
	const standing = new Map(before.pieces.map((piece) => [piece.pieceId, piece.position]));
	const changes: TProposalChange[] = [];
	for (const piece of project.track.pieces) if (!now.has(piece.id) && !made.has(piece.id)) changes.push({ pieceId: piece.id, name: nameOf(piece, piece.id), how: 'removed' });
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
