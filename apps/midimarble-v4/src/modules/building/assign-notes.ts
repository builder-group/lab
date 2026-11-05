import { BACKING_ID, createMarble, MARBLE_SPACING, type TPiece, type TProject, type TProjectCommand, type TVec2, backingOf, tieOf } from '@/modules/project';
// Deep imports keep the simulation client and its worker out of the music module
import { anchorHit, freePose, soundsHit } from '@/modules/simulation';
import type { TSimulationResult } from '@/modules/simulation';
import { IMPORT_RELEASE_LEAD } from '@/modules/music';

/**
 * Hands notes to a marble or to Backing (`BACKING_ID`) as one edit, keeping their IDs. A platform exists
 * to play its note, so it goes with the note: handed to another marble it plays the note in that marble's run,
 * handed to Backing it is removed (Backing needs no piece). Leaving a platform on the wall instead would put an
 * obstacle in every marble's path. A piece that follows the marble at a moment keeps that moment, tied to
 * another hit of the marble, and stands Free only when no hit is near enough.
 */
export function assignNotesCommands(
	project: TProject,
	result: TSimulationResult | null,
	hitIds: string[],
	marbleId: string
): TProjectCommand[] {
	const wanted = new Set(hitIds);
	const leaving = new Map<string, Set<string>>();
	for (const marble of project.marbles) {
		if (marble.id === marbleId) continue;
		const ids = marble.hits.filter((hit) => wanted.has(hit.id)).map((hit) => hit.id);
		if (ids.length > 0) leaving.set(marble.id, new Set(ids));
	}
	const fromBacking = marbleId !== BACKING_ID && backingOf(project).some((hit) => wanted.has(hit.id));
	if (!leaving.size && !fromBacking) return [];

	const removed: string[] = [];
	const ties = project.track.pieces.flatMap((entity): TProjectCommand[] => {
		const link = tieOf(entity);
		if (link == null || leaving.get(link.marbleId)?.has(link.hitId) !== true) return [];
		if (soundsHit(entity.type, link)) {
			if (marbleId === BACKING_ID) {
				removed.push(entity.id);
				return [];
			}
			return [{ type: 'addPiece', piece: { ...entity, place: { ...link, marbleId } } }];
		}
		const followed = refollow(project, entity, leaving.get(link.marbleId) ?? new Set());
		return [{ type: 'addPiece', piece: followed ?? asFreePiece(project, result, entity) }];
	});
	return [...ties, ...(removed.length ? [{ type: 'removePieces' as const, pieceIds: removed }] : []), { type: 'assignHits', hitIds: [...wanted], marbleId }];
}

/** A new marble, to the right of the last marble and released a short drop before `firstTime` */
export function newMarbleCommands(project: TProject, firstTime?: number): { marbleId: string; commands: TProjectCommand[] } {
	const releases = project.marbles.map((marble) => marble.start.position);
	const position = { x: releases.length ? Math.max(...releases.map((point) => point.x)) + MARBLE_SPACING : 0, y: releases[0]?.y ?? 0.6 };
	const marble = createMarble(project.marbles.length, position);
	if (firstTime != null) marble.start.time = Math.round(Math.max(0, firstTime - IMPORT_RELEASE_LEAD) * 10000) / 10000;
	return { marbleId: marble.id, commands: [{ type: 'addMarble', marble }] };
}

/** A following piece tied to the marble's nearest remaining hit with the delay that keeps its moment */
function refollow(project: TProject, entity: TPiece, leaving: Set<string>): TPiece | null {
	const link = tieOf(entity);
	const hits = project.marbles.find((marble) => marble.id === link?.marbleId)?.hits ?? [];
	const hit = hits.find((item) => item.id === link?.hitId);
	if (link == null || hit == null) return null;
	const moment = hit.time + (entity.params['entryDelay'] ?? 0);
	const anchor = anchorHit(
		hits.filter((item) => !leaving.has(item.id)),
		moment
	);
	if (anchor == null) return null;
	const entryDelay = Math.round((moment - anchor.time) * 1e6) / 1e6;
	return { ...entity, params: { ...entity.params, entryDelay }, place: { ...link, hitId: anchor.id } };
}

/** The piece without its tie, standing where the current run shows it */
function asFreePiece(project: TProject, result: TSimulationResult | null, entity: TPiece): TPiece {
	const params = { ...entity.params };
	delete params['entryDelay'];
	const pose = currentPose(project, result, entity) ?? { position: fallbackPosition(project, entity), angle: entity.angle };
	return { ...entity, params, angle: pose.angle, place: { kind: 'free', position: pose.position } };
}

function currentPose(project: TProject, result: TSimulationResult | null, entity: TPiece): { position: TVec2; angle: number } | null {
	if (result == null || result.revision !== project.revision) return null;
	const resolved = result.pieces.find((item) => item.entityId === entity.id);
	if (resolved == null || resolved.status === 'unreached') return null;
	const radius = result.marbles.find((marble) => marble.marbleId === tieOf(entity)?.marbleId)?.radius;
	return freePose(entity, resolved, radius);
}

// Without a pose from the run: where it waits, otherwise beside its marble's release
function fallbackPosition(project: TProject, entity: TPiece): TVec2 {
	const link = tieOf(entity);
	if (link?.held != null) return { ...link.held.dot };
	const release = project.marbles.find((item) => item.id === link?.marbleId)?.start.position;
	return release != null ? { x: release.x, y: release.y - 0.2 } : { x: 0, y: 0 };
}
