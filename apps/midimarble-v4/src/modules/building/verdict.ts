import { tieOf, type TPiece, type TProject, type TVec2 } from '@/modules/project';
import { bandAlongGuide, createLinkedPiece, frameBand, paceAt, type THitResult, type TSimulationResult } from '@/modules/simulation';
import { findLongGaps, isInBand, openLongGaps } from './assists';
import { changedPieces } from './edit-rule';
import { openHits } from './reachability';
import { extraStrikes, passThroughs, rollingHits, touchingPairs } from './track-problems';

// The one verdict: given a track before and after, what changed and which facts hold, with reasons. It states them and
// doesn't choose: whoever asks decides what a fact means for what it's doing. Build Track refuses a step with any reason;
// a person may still accept a proposal that says so.

/** A fact that doesn't hold, in the one list, whatever placed it */
export type TVerdictReason =
	/** A placed hit no longer plays on time */
	| { kind: 'late'; marbleId: string; hitId: string; why: string }
	/** A rail or tunnel the marble now passes earlier is left out */
	| { kind: 'blocked'; pieceId: string }
	/** A marble hits another marble or another marble's piece */
	| { kind: 'crossing'; marbleId: string; otherId: string }
	/** A placed dot lies outside the frame band */
	| { kind: 'outsideBand'; marbleId: string; hitId: string }
	| { kind: 'struckTwice'; pieceId: string; hitId: string }
	| { kind: 'rolls'; pieceId: string; hitId: string }
	| { kind: 'passesThrough'; marbleId: string; pieceId: string }
	| { kind: 'touching'; a: string; b: string }
	/** The marble's next dot would leave the band */
	| { kind: 'nextOutOfBand'; marbleId: string; hitId: string; x: number }
	/** A flat platform doesn't fit at the marble's next dot */
	| { kind: 'noRoom'; marbleId: string; hitId: string }
	/** With several marbles the next dot moves further from the shared pace */
	| { kind: 'offPace'; marbleId: string; hitId: string; by: number };

/** What a run already has wrong, which nothing is judged by: the person's, and what a forced step left */
export interface TKnownFaults {
	hits: Set<string>;
	pieces: Set<string>;
	contacts: Set<string>;
	strikes: Set<string>;
	rolls: Set<string>;
	passes: Set<string>;
	touching: Set<string>;
}

export const hitKey = (marbleId: string, hitId: string): string => `${marbleId}/${hitId}`;
const contactKey = (marble: string, other: string): string => `${marble}/${other}`;
const pairKey = (a: string, b: string): string => (a < b ? `${a}/${b}` : `${b}/${a}`);

export function noKnownFaults(): TKnownFaults {
	return { hits: new Set(), pieces: new Set(), contacts: new Set(), strikes: new Set(), rolls: new Set(), passes: new Set(), touching: new Set() };
}

function marbleOfPiece(project: TProject, pieceId: string): string | null {
	return tieOf(project.track.pieces.find((item) => item.id === pieceId))?.marbleId ?? null;
}

/** Adds what this run has wrong to `known`, so steps after it are judged by what they add */
export function addKnownFaults(known: TKnownFaults, project: TProject, result: TSimulationResult): void {
	for (const hit of result.hits) if (hit.status !== 'open' && hit.status !== 'onTime') known.hits.add(hitKey(hit.marbleId, hit.hitId));
	for (const piece of result.pieces) if (piece.status === 'blocked') known.pieces.add(piece.pieceId);
	for (const contact of result.contacts) {
		const marble = marbleOfPiece(project, contact.otherId);
		if (contact.kind === 'marble' || (marble != null && marble !== contact.marbleId)) known.contacts.add(contactKey(contact.marbleId, contact.otherId));
	}
	const bandAt = bandAlongGuide(project);
	for (const hit of result.hits) if (hit.pieceId != null && hit.dot != null && !isInBand(hit.dot, bandAt(hit.dot.y), 1)) known.hits.add(hitKey(hit.marbleId, hit.hitId));
	for (const strike of extraStrikes(project, result)) known.strikes.add(strike.pieceId);
	for (const roll of rollingHits(project, result)) known.rolls.add(roll.pieceId);
	for (const pass of passThroughs(project, result)) known.passes.add(contactKey(pass.marbleId, pass.pieceId));
	for (const pair of touchingPairs(project, result)) known.touching.add(pairKey(pair.a, pair.b));
}

export interface TVerdictRun {
	project: TProject;
	result: TSimulationResult;
}

export interface TVerdictAsk {
	before: TVerdictRun;
	after: TVerdictRun;
	/** The marble being placed: all its placed hits count, another marble's only up to where this one's path is final */
	marbleId: string;
	known: TKnownFaults;
	/** Hits left without a piece, which every check looks past */
	skipped?: ReadonlySet<string>;
	/** Whether the marble's next open dot counts too: in the band and, with several marbles, near the pace. A gap piece places it by construction */
	checksNext?: boolean;
	/** Stop at the first kind of fact that doesn't hold, so a search's refused try costs little */
	stopsAtFirst?: boolean;
}

export interface TVerdict {
	/** Pieces that are new or differ */
	changed: TPiece[];
	/** Pieces that are gone */
	removed: TPiece[];
	onTime: number;
	total: number;
	/** Notes that played on time before and don't now, on any marble and however far ahead */
	lost: { marbleId: string; hitId: string }[];
	reasons: TVerdictReason[];
}

/** What a placement changed and which facts hold, all but the room at the next dot, which takes a run */
export function verdictOf(ask: TVerdictAsk): TVerdict {
	const { before, after } = ask;
	const isPlaying = (status: string): boolean => status === 'onTime' || status === 'drifting';
	const now = new Set(after.result.hits.filter((hit) => isPlaying(hit.status)).map((hit) => hitKey(hit.marbleId, hit.hitId)));
	const kept = new Set(after.project.track.pieces.map((piece) => piece.id));
	return {
		changed: changedPieces(before.project, after.project),
		removed: before.project.track.pieces.filter((piece) => !kept.has(piece.id)),
		onTime: now.size,
		total: after.result.hits.length,
		lost: before.result.hits.filter((hit) => isPlaying(hit.status) && !now.has(hitKey(hit.marbleId, hit.hitId))).map((hit) => ({ marbleId: hit.marbleId, hitId: hit.hitId })),
		reasons: reasonsOf(ask)
	};
}

/** `verdictOf`, and whether a flat platform fits at the marble's next dot, asked only of a step nothing else is wrong with */
export async function verdictWithRoom(ask: TVerdictAsk, simulate: (project: TProject) => Promise<TSimulationResult> | TSimulationResult): Promise<TVerdict> {
	const found = verdictOf(ask);
	if (found.reasons.length > 0 || ask.checksNext !== true) return found;
	const { project, result } = ask.after;
	const next = nextDotOf(project, result, ask);
	if (next == null) return found;
	const probe = createLinkedPiece('platform', ask.marbleId, next.hitId, 0, { id: 'accept-probe' });
	const probed = await simulate({ ...project, track: { ...project.track, pieces: [...project.track.pieces, probe] }, length: Math.min(project.length, next.targetTime + 0.05) });
	if (probed.pieces.find((piece) => piece.pieceId === probe.id)?.status !== 'blocked') return found;
	return { ...found, reasons: [{ kind: 'noRoom', marbleId: ask.marbleId, hitId: next.hitId }] };
}

/** Plain words for a reason, naming what a person sees */
export function reasonWords(project: TProject, reason: TVerdictReason): string {
	const pieceName = (id: string): string => project.track.pieces.find((piece) => piece.id === id)?.name ?? id;
	const marbleName = (id: string): string => project.marbles.find((marble) => marble.id === id)?.name ?? id;
	const hitName = (marbleId: string, hitId: string): string => `Hit ${(project.marbles.find((marble) => marble.id === marbleId)?.hits.findIndex((hit) => hit.id === hitId) ?? -1) + 1} of ${marbleName(marbleId)}`;
	switch (reason.kind) {
		case 'late':
			return `${hitName(reason.marbleId, reason.hitId)} no longer plays on time (${reason.why}).`;
		case 'blocked':
			return `${pieceName(reason.pieceId)} is left out: the marble no longer reaches it.`;
		case 'crossing':
			return `${marbleName(reason.marbleId)} hits ${project.marbles.some((marble) => marble.id === reason.otherId) ? marbleName(reason.otherId) : pieceName(reason.otherId)}.`;
		case 'outsideBand':
			return `${hitName(reason.marbleId, reason.hitId)} lies outside the frame band.`;
		case 'struckTwice':
			return `The marble strikes ${pieceName(reason.pieceId)} twice.`;
		case 'rolls':
			return `The marble rolls along ${pieceName(reason.pieceId)} instead of bouncing.`;
		case 'passesThrough':
			return `${marbleName(reason.marbleId)} passes through ${pieceName(reason.pieceId)}.`;
		case 'touching':
			return `${pieceName(reason.a)} touches ${pieceName(reason.b)}.`;
		case 'nextOutOfBand':
			return `The marble lands outside the frame band at ${hitName(reason.marbleId, reason.hitId)}.`;
		case 'noRoom':
			return `There's no room for a platform at ${hitName(reason.marbleId, reason.hitId)}.`;
		case 'offPace':
			return `${hitName(reason.marbleId, reason.hitId)} lands ${reason.by.toFixed(2)} m from the pace.`;
	}
}

/** The facts in the order a search can refuse soonest */
function reasonsOf(ask: TVerdictAsk): TVerdictReason[] {
	const { marbleId, known, skipped, stopsAtFirst = false } = ask;
	const { project, result } = ask.after;
	const reasons: TVerdictReason[] = [];
	const add = (found: TVerdictReason[]): boolean => {
		reasons.push(...found);
		return stopsAtFirst && reasons.length > 0;
	};
	// Each marble's path is final up to its next open hit; beyond that it is free flight that later pieces change,
	// and it may pass through or bump into what the other marble has built
	const frontier = new Map<string, number>();
	for (const hit of result.hits) {
		if (hit.status !== 'open' || skipped?.has(hitKey(hit.marbleId, hit.hitId)) === true) continue;
		frontier.set(hit.marbleId, Math.min(frontier.get(hit.marbleId) ?? Infinity, hit.targetTime));
	}
	// Across a long gap that nothing bridges yet the marble falls freely until its switchback exists
	for (const marble of project.marbles) {
		for (const gap of openLongGaps(project, marble.id)) {
			if (skipped?.has(hitKey(marble.id, gap.toHitId)) !== true) frontier.set(marble.id, Math.min(frontier.get(marble.id) ?? Infinity, gap.from + 0.3));
		}
	}
	const othersFrontier = (marble: string): number => Math.min(Infinity, ...project.marbles.filter((item) => item.id !== marble).map((item) => frontier.get(item.id) ?? Infinity));
	const late = result.hits.filter((hit) => hit.status !== 'open' && hit.status !== 'onTime' && !known.hits.has(hitKey(hit.marbleId, hit.hitId)) && (hit.marbleId === marbleId || hit.targetTime < othersFrontier(hit.marbleId)));
	if (add(late.map((hit): TVerdictReason => ({ kind: 'late', marbleId: hit.marbleId, hitId: hit.hitId, why: hit.reason ?? hit.status })))) return reasons;
	const blocked = result.pieces.filter((piece) => {
		const marble = marbleOfPiece(project, piece.pieceId);
		const time = piece.entryTime ?? piece.hitTime ?? 0;
		return piece.status === 'blocked' && !known.pieces.has(piece.pieceId) && marble != null && (marble === marbleId || time < othersFrontier(marble));
	});
	if (add(blocked.map((piece): TVerdictReason => ({ kind: 'blocked', pieceId: piece.pieceId })))) return reasons;
	// Each marble may only touch its own marble's pieces and never the other marble; a free piece is the person's scenery
	const crossed = result.contacts.filter((contact) => {
		if (known.contacts.has(contactKey(contact.marbleId, contact.otherId))) return false;
		const reach = Math.min(frontier.get(contact.marbleId) ?? Infinity, contact.kind === 'marble' ? (frontier.get(contact.otherId) ?? Infinity) : Infinity);
		if (contact.time >= reach) return false;
		if (contact.kind === 'marble') return true;
		const marble = marbleOfPiece(project, contact.otherId);
		return contact.kind === 'piece' && marble != null && marble !== contact.marbleId;
	});
	if (add(crossed.map((contact): TVerdictReason => ({ kind: 'crossing', marbleId: contact.marbleId, otherId: contact.otherId })))) return reasons;
	// Every hit of the marble with a piece keeps its dot in frame; its own marble's center is only Auto place's preference
	const bandAt = bandAlongGuide(project);
	const outside = result.hits.filter((hit) => hit.marbleId === marbleId && hit.pieceId != null && hit.dot != null && !known.hits.has(hitKey(hit.marbleId, hit.hitId)) && !isInBand(hit.dot, bandAt(hit.dot.y), 1));
	if (add(outside.map((hit): TVerdictReason => ({ kind: 'outsideBand', marbleId, hitId: hit.hitId })))) return reasons;
	// Each marble strikes each platform once, for its note, up to where its path is final
	const struck = extraStrikes(project, result).filter((strike) => !known.strikes.has(strike.pieceId) && strike.time < (frontier.get(strike.marbleId) ?? Infinity));
	if (add(struck.map((strike): TVerdictReason => ({ kind: 'struckTwice', pieceId: strike.pieceId, hitId: strike.hitId })))) return reasons;
	// And bounces off it, a platform not being for rolling
	const rolling = rollingHits(project, result).filter((roll) => !known.rolls.has(roll.pieceId) && roll.time < (frontier.get(roll.marbleId) ?? Infinity));
	if (add(rolling.map((roll): TVerdictReason => ({ kind: 'rolls', pieceId: roll.pieceId, hitId: roll.hitId })))) return reasons;
	// And goes through no piece's skin on its way
	const passing = passThroughs(project, result).filter((pass) => !known.passes.has(contactKey(pass.marbleId, pass.pieceId)) && pass.time < (frontier.get(pass.marbleId) ?? Infinity));
	if (add(passing.map((pass): TVerdictReason => ({ kind: 'passesThrough', marbleId: pass.marbleId, pieceId: pass.pieceId })))) return reasons;
	// No two pieces touch on the wall
	const touching = touchingPairs(project, result).filter((pair) => !known.touching.has(pairKey(pair.a, pair.b)));
	if (add(touching.map((pair): TVerdictReason => ({ kind: 'touching', a: pair.a, b: pair.b })))) return reasons;
	if (ask.checksNext === true) add(nextDotReasons(ask));
	return reasons;
}

/** The marble's next open dot, unless a long gap comes before it: a gap piece picks the marble up, wherever it is */
function nextDotOf(project: TProject, result: TSimulationResult, ask: Pick<TVerdictAsk, 'marbleId' | 'skipped'>): (THitResult & { dot: TVec2 }) | null {
	const next = openHits(result).find((hit) => hit.marbleId === ask.marbleId && ask.skipped?.has(hitKey(hit.marbleId, hit.hitId)) !== true);
	if (next?.dot == null || findLongGaps(project, ask.marbleId).some((gap) => gap.toHitId === next.hitId && gap.bridgedBy == null)) return null;
	return next as THitResult & { dot: TVec2 };
}

function nextDotReasons(ask: TVerdictAsk): TVerdictReason[] {
	const { marbleId } = ask;
	const { project, result } = ask.after;
	const next = nextDotOf(project, result, ask);
	if (next == null) return [];
	// A tenth of a marble inside the frame's edge, as Auto place asks
	const band = bandAlongGuide(project)(next.dot.y);
	if (!isInBand(next.dot, band, 1 - (0.1 * frameBand(project, marbleId).halfWidth) / band.halfWidth)) return [{ kind: 'nextOutOfBand', marbleId, hitId: next.hitId, x: next.dot.x }];
	const { pace } = result;
	if (pace == null || project.marbles.length <= 1) return [];
	const was = ask.before.result.hits.find((hit) => hit.marbleId === marbleId && hit.status === 'open' && hit.dot != null);
	if (was?.dot == null) return [];
	// Beyond the limit a dot may not get further from the pace than the one before it
	const allowed = Math.max(pace.limit, Math.abs(was.dot.y - paceAt(pace, was.targetTime)));
	const off = Math.abs(next.dot.y - paceAt(pace, next.targetTime));
	return off > allowed ? [{ kind: 'offPace', marbleId, hitId: next.hitId, by: off }] : [];
}
