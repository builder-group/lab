import { createId, type TEntity, type TProject, type TProjectCommand } from '@/modules/project';
import { nextPieceName, soundsHit, unanchorPiece, unlinkPiece, type TSimulationResult } from '@/modules/simulation';

/** How far a copy lands from its original, right and down on the wall in metres, like Finder's and Figma's Duplicate */
export const DUPLICATE_OFFSET = { x: 0.05, y: -0.05 };

/**
 * Duplicate (⌘D) for pieces: each copy is a free piece with the next default name, a little right of and below
 * where the original is now. A note has one platform, so a copy never plays the note or follows the marble of
 * its original. Pieces without a pose in this run are skipped. One edit for the whole selection.
 */
export function duplicatePieces(project: TProject, result: TSimulationResult | null, entityIds: string[]): TDuplicate {
	const commands: TProjectCommand[] = [];
	const copies: TEntity[] = [];
	let entities = project.entities;
	for (const entityId of entityIds) {
		const entity = project.entities.find((item) => item.id === entityId);
		const type = entity?.components.piece?.type;
		if (entity == null || type == null) continue;
		const free = freeEntity(project, result, entity);
		const transform = free?.components.transform;
		if (free == null || transform == null) continue;
		const copy: TEntity = {
			...free,
			id: createId('piece'),
			name: nextPieceName(type, entities),
			components: {
				...free.components,
				transform: { ...transform, position: { x: transform.position.x + DUPLICATE_OFFSET.x, y: transform.position.y + DUPLICATE_OFFSET.y } }
			}
		};
		entities = [...entities, copy];
		copies.push(copy);
		commands.push({ type: 'upsertEntity', entity: copy });
	}
	return { commands, copies };
}

export interface TDuplicate {
	commands: TProjectCommand[];
	copies: TEntity[];
}

/** The piece as a free piece where it is now, or null when it is tied and has no pose in this run */
function freeEntity(project: TProject, result: TSimulationResult | null, entity: TEntity): TEntity | null {
	const link = entity.components.hitLink;
	if (link == null) return entity;
	if (result == null) return null;
	const [isOk, , value] = soundsHit(entity.components.piece?.type ?? '', link) ? unlinkPiece(project, result, entity.id) : unanchorPiece(project, result, entity.id);
	return isOk ? value.entity : null;
}
