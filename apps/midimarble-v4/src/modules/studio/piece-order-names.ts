import type { TEntity, TProject } from '@/modules/project';
import { getPieceDefinition, startRailOf } from '@/modules/simulation';

/**
 * After an edit that adds a piece, renumbers the pieces that still carry a default name ("Platform 4") in the
 * order Layers shows them: each marble's start rail, then its pieces in hit order, marble after marble, then the free pieces. A new
 * project's platform for Hit 1 then reads Platform 1 however the platforms were placed. Custom names stay, and
 * each type counts on its own. It also runs when an edit leaves two pieces with the same default name, such as a
 * refinement that arrives with the name the piece had before the renumbering.
 */
export function renumberDefaultNames(before: TProject, after: TProject): TProject {
	const known = new Set(before.entities.map((entity) => entity.id));
	const isAdded = after.entities.some((entity) => entity.components.piece != null && !known.has(entity.id));
	if (!isAdded && !hasDuplicateDefaultNames(after)) return after;

	const names = new Map<TEntity, string>();
	const counts = new Map<string, number>();
	for (const entity of piecesInLayersOrder(after)) {
		const type = entity.components.piece?.type ?? '';
		if (!isDefaultName(entity.name, type)) continue;
		const number = (counts.get(type) ?? 0) + 1;
		counts.set(type, number);
		names.set(entity, `${pieceLabel(type)} ${number}`);
	}
	if ([...names].every(([entity, name]) => entity.name === name)) return after;
	return {
		...after,
		entities: after.entities.map((entity) => {
			const name = names.get(entity);
			return name == null || name === entity.name ? entity : { ...entity, name };
		})
	};
}

function piecesInLayersOrder(project: TProject): TEntity[] {
	const ordered: TEntity[] = [];
	for (const lane of project.music.lanes) {
		const order = new Map(lane.hits.map((hit) => [hit.id, hit.time]));
		const tied = project.entities.filter((entity) => entity.components.piece != null && entity.components.hitLink?.laneId === lane.id);
		const startRail = startRailOf(project, lane.id);
		if (startRail != null) ordered.push(startRail);
		ordered.push(...tied.map((entity, index) => ({ entity, index, time: tieTime(entity, order) })).sort((a, b) => a.time - b.time || a.index - b.index).map((item) => item.entity));
	}
	const placed = new Set(ordered);
	ordered.push(...project.entities.filter((entity) => entity.components.piece != null && !placed.has(entity)));
	return ordered;
}

/** The time a tied piece sits at: its hit's time, plus the delay a piece that follows the marble waits */
function tieTime(entity: TEntity, hitTimes: Map<string, number>): number {
	const link = entity.components.hitLink;
	const hitTime = link == null ? undefined : hitTimes.get(link.hitId);
	return hitTime == null ? Infinity : hitTime + (entity.components.piece?.params['entryDelay'] ?? 0);
}

function hasDuplicateDefaultNames(project: TProject): boolean {
	const seen = new Set<string>();
	for (const entity of project.entities) {
		const type = entity.components.piece?.type;
		if (type == null || entity.name == null || !isDefaultName(entity.name, type)) continue;
		if (seen.has(entity.name)) return true;
		seen.add(entity.name);
	}
	return false;
}

function isDefaultName(name: string | undefined, type: string): boolean {
	if (name == null) return false;
	const label = pieceLabel(type);
	return name.startsWith(`${label} `) && /^\d+$/.test(name.slice(label.length + 1));
}

function pieceLabel(type: string): string {
	return getPieceDefinition(type)?.label ?? type;
}
