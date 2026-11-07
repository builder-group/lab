import { parseHitKey, tieOf, type TPiece, type TProject } from '@/modules/project';
import type { THitResult, TSimulationResult } from '@/modules/simulation';
import { openLongGaps, type TLongGap } from './assists';
import { hitReach, isUnreachable, openHits } from './reachability';

// What Next acts on, a pure decision from the track and the selection. It places nothing and says nothing.

export type TNextStep =
	/** A long gap comes first: across it the marble may fall too far to leave a dot */
	| { kind: 'gap'; gap: TLongGap }
	/** The earliest open note before the target that can't get a platform */
	| { kind: 'unreachable'; hit: THitResult }
	/** Nothing open */
	| { kind: 'done' }
	| { kind: 'place'; hit: THitResult };

export function nextStepOf(project: TProject, result: TSimulationResult, selection: string[]): TNextStep {
	const target = findStepTarget(project, result, selection);
	const gap = project.marbles
		.flatMap((marble) => openLongGaps(project, marble.id))
		.filter((item) => target == null || item.marbleId === target.marbleId || item.to <= target.targetTime)
		.sort((a, b) => a.to - b.to)[0];
	if (gap != null && (target == null || gap.to <= target.targetTime + 1e-9)) return { kind: 'gap', gap };
	const marbleId = target?.marbleId ?? focusedMarbleId(project, selection);
	const open = result.hits.filter((hit) => hit.status === 'open' && (marbleId == null || hit.marbleId === marbleId) && (target == null || hit.targetTime <= target.targetTime)).sort((a, b) => a.targetTime - b.targetTime);
	const unreachable = open.find((hit) => isUnreachable(hitReach(project, result, hit)));
	if (unreachable != null) return { kind: 'unreachable', hit: unreachable };
	return target != null ? { kind: 'place', hit: target } : { kind: 'done' };
}

/** The marble a selection is about: itself, or the marble of its piece or note */
export function focusedMarbleId(project: TProject, selection: string[]): string | null {
	for (const key of selection) {
		if (project.marbles.some((item) => item.id === key)) return key;
		const marbleId = tieOf(project.track.pieces.find((item) => item.id === key))?.marbleId;
		if (marbleId != null) return marbleId;
		const marble = project.marbles.find((item) => key.startsWith(`hit:${item.id}:`));
		if (marble != null) return marble.id;
	}
	return null;
}

export interface TLinkedPiece {
	piece: TPiece;
	marbleId: string;
	hitId: string;
	angle: number;
	time: number;
}

/** Hit-linked pieces with their hit time, in time order */
export function linkedPieces(project: TProject, marbleId?: string): TLinkedPiece[] {
	const times = new Map<string, number>();
	for (const marble of project.marbles) for (const hit of marble.hits) times.set(`${marble.id}/${hit.id}`, hit.time);
	const pieces: TLinkedPiece[] = [];
	for (const piece of project.track.pieces) {
		const link = tieOf(piece);
		if (link == null || (marbleId != null && link.marbleId !== marbleId)) continue;
		const time = times.get(`${link.marbleId}/${link.hitId}`);
		if (time == null) continue;
		pieces.push({ piece, marbleId: link.marbleId, hitId: link.hitId, angle: piece.angle, time });
	}
	return pieces.sort((a, b) => a.time - b.time);
}

/**
 * The open hit that Return, Repeat and Mirror act on: the focused dot, otherwise the next open dot after
 * the selected piece's hit, otherwise the first open dot of the first marble that has one.
 */
export function findStepTarget(project: TProject, result: TSimulationResult, selection: string[]): THitResult | null {
	const open = openHits(result);
	if (selection.length === 1) {
		const key = selection[0] ?? '';
		const hitKey = parseHitKey(key);
		if (hitKey != null) {
			const focused = open.find((hit) => hit.marbleId === hitKey.marbleId && hit.hitId === hitKey.hitId);
			if (focused != null) return focused;
			const time = result.hits.find((hit) => hit.marbleId === hitKey.marbleId && hit.hitId === hitKey.hitId)?.targetTime;
			// A Backing note belongs to no marble, so the next step is the first open dot of any marble
			if (time == null) return open[0] ?? null;
			// Past the last open note the next step is still that marble's earliest open note
			return open.find((hit) => hit.marbleId === hitKey.marbleId && hit.targetTime > time) ?? open.find((hit) => hit.marbleId === hitKey.marbleId) ?? null;
		}
		const piece = linkedPieces(project).find((item) => item.piece.id === key);
		if (piece != null) return open.find((hit) => hit.marbleId === piece.marbleId && hit.targetTime > piece.time) ?? open.find((hit) => hit.marbleId === piece.marbleId) ?? null;
	}
	return open[0] ?? null;
}
