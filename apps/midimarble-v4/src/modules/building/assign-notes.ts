import { BACKING_ID, createLane, createMarble, MARBLE_SPACING, type TEntity, type TProject, type TProjectCommand, type TVec2 } from '@/modules/project';
// Deep imports keep the simulation client and its worker out of the music module
import { anchorHit, freePose, soundsHit } from '@/modules/simulation';
import type { TSimulationResult } from '@/modules/simulation';
import { IMPORT_RELEASE_LEAD } from '@/modules/music';

/**
 * Hands notes to a marble's marble or to Backing (`BACKING_ID`) as one edit, keeping their IDs. A platform exists
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
	for (const marble of project.music.marbles) {
		if (marble.id === marbleId) continue;
		const ids = marble.hits.filter((hit) => wanted.has(hit.id)).map((hit) => hit.id);
		if (ids.length > 0) leaving.set(marble.id, new Set(ids));
	}
	const fromBacking = marbleId !== BACKING_ID && project.music.backing.some((hit) => wanted.has(hit.id));
	if (!leaving.size && !fromBacking) return [];

	const removed: string[] = [];
	const ties = project.entities.flatMap((entity): TProjectCommand[] => {
		const link = entity.components.hitLink;
		const piece = entity.components.piece;
		if (piece == null || link == null || leaving.get(link.marbleId)?.has(link.hitId) !== true) return [];
		if (soundsHit(piece.type, link)) {
			if (marbleId === BACKING_ID) {
				removed.push(entity.id);
				return [];
			}
			return [{ type: 'upsertEntity', entity: { ...entity, components: { ...entity.components, hitLink: { ...link, marbleId } } } }];
		}
		const followed = refollow(project, entity, leaving.get(link.marbleId) ?? new Set());
		return [{ type: 'upsertEntity', entity: followed ?? asFreePiece(project, result, entity) }];
	});
	return [...ties, ...(removed.length ? [{ type: 'removeEntities' as const, entityIds: removed }] : []), { type: 'assignHits', hitIds: [...wanted], marbleId }];
}

/** A new marble with its marble, to the right of the last marble and released a short drop before `firstTime` */
export function newMarbleCommands(project: TProject, firstTime?: number): { marbleId: string; commands: TProjectCommand[] } {
	const marble = createLane(project.music.marbles.length);
	const releases = project.entities.flatMap((entity) => (entity.components.release != null ? [entity.components.release.position] : []));
	const position = { x: releases.length ? Math.max(...releases.map((point) => point.x)) + MARBLE_SPACING : 0, y: releases[0]?.y ?? 0.6 };
	const marbleEntity = createMarble(marble, position);
	if (marbleEntity.components.release != null && firstTime != null) {
		marbleEntity.components.release.time = Math.round(Math.max(0, firstTime - IMPORT_RELEASE_LEAD) * 10000) / 10000;
	}
	return { marbleId: marble.id, commands: [{ type: 'upsertLane', marble }, { type: 'upsertEntity', entity: marbleEntity }] };
}

/** A following piece tied to the marble's nearest remaining hit with the delay that keeps its moment */
function refollow(project: TProject, entity: TEntity, leaving: Set<string>): TEntity | null {
	const { hitLink: link, piece } = entity.components;
	const hits = project.music.marbles.find((marble) => marble.id === link?.marbleId)?.hits ?? [];
	const hit = hits.find((item) => item.id === link?.hitId);
	if (link == null || piece == null || hit == null) return null;
	const moment = hit.time + (piece.params['entryDelay'] ?? 0);
	const anchor = anchorHit(
		hits.filter((item) => !leaving.has(item.id)),
		moment
	);
	if (anchor == null) return null;
	const entryDelay = Math.round((moment - anchor.time) * 1e6) / 1e6;
	return {
		...entity,
		components: { ...entity.components, piece: { ...piece, params: { ...piece.params, entryDelay } }, hitLink: { ...link, hitId: anchor.id } }
	};
}

/** The piece without its tie, standing where the current run shows it */
function asFreePiece(project: TProject, result: TSimulationResult | null, entity: TEntity): TEntity {
	const { hitLink, piece } = entity.components;
	const { hitLink: _, ...components } = entity.components;
	const params = { ...piece?.params };
	delete params['entryDelay'];
	return {
		...entity,
		components: {
			...components,
			...(piece != null ? { piece: { ...piece, params } } : {}),
			transform: currentPose(project, result, entity) ?? { position: fallbackPosition(project, entity), angle: hitLink?.angle ?? 0 }
		}
	};
}

function currentPose(project: TProject, result: TSimulationResult | null, entity: TEntity): { position: TVec2; angle: number } | null {
	if (result == null || result.revision !== project.revision) return null;
	const resolved = result.pieces.find((item) => item.entityId === entity.id);
	if (resolved == null || resolved.status === 'unreached') return null;
	const radius = result.marbles.find((marble) => marble.marbleId === entity.components.hitLink?.marbleId)?.radius;
	return freePose(entity, resolved, radius);
}

// Without a pose from the run: where it waits, otherwise beside its marble's release
function fallbackPosition(project: TProject, entity: TEntity): TVec2 {
	const link = entity.components.hitLink;
	if (link?.held != null) return { ...link.held.dot };
	const release = project.entities.find((item) => item.components.marble?.marbleId === link?.marbleId)?.components.release?.position;
	return release != null ? { x: release.x, y: release.y - 0.2 } : { x: 0, y: 0 };
}
