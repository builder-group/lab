import type { TEntity, TProject } from '@/modules/project';
import { getPieceDefinition } from './pieces';

/**
 * Name for a new piece of a type: its label and the number after the highest one in use, so a new piece
 * continues the numbering even after pieces were deleted or renamed in order
 */
export function nextPieceName(type: string, entities: TEntity[]): string {
	const label = pieceLabel(type);
	const pattern = new RegExp(`^${escapeRegExp(label)} (\\d+)$`);
	let highest = 0;
	let count = 0;
	for (const entity of entities) {
		if (entity.components.piece?.type !== type) continue;
		count++;
		const number = Number(pattern.exec(entity.name ?? '')?.[1] ?? 0);
		highest = Math.max(highest, number);
	}
	return `${label} ${Math.max(highest, count) + 1}`;
}

/**
 * Renames every piece to its type label and a number in the order the Layers list shows them: each marble's
 * pieces in hit order, marble after marble, then the free pieces. Each type counts on its own, so a project
 * reads "Platform 1…n" and "Rail 1…n" in time order. Only `name` changes.
 */
export function namePiecesInOrder(project: TProject): TProject {
	const ordered: TEntity[] = [];
	for (const lane of project.music.lanes) {
		const order = new Map(lane.hits.map((hit, index) => [hit.id, index]));
		ordered.push(
			...project.entities
				.filter((entity) => entity.components.piece != null && entity.components.hitLink?.laneId === lane.id)
				.sort((a, b) => (order.get(a.components.hitLink?.hitId ?? '') ?? 0) - (order.get(b.components.hitLink?.hitId ?? '') ?? 0))
		);
	}
	const placed = new Set(ordered);
	ordered.push(...project.entities.filter((entity) => entity.components.piece != null && !placed.has(entity)));

	const names = new Map<TEntity, string>();
	const counts = new Map<string, number>();
	for (const entity of ordered) {
		const type = entity.components.piece?.type ?? '';
		const number = (counts.get(type) ?? 0) + 1;
		counts.set(type, number);
		names.set(entity, `${pieceLabel(type)} ${number}`);
	}
	return {
		...project,
		entities: project.entities.map((entity) => {
			const name = names.get(entity);
			return name == null || name === entity.name ? entity : { ...entity, name };
		})
	};
}

function pieceLabel(type: string): string {
	return getPieceDefinition(type)?.label ?? type;
}

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
