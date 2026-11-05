import { type TPiece, type TProject, tieOf } from '@/modules/project';
import { getPieceDefinition, startRailOf } from '@/modules/simulation';

/**
 * After an edit that adds a piece, renumbers the pieces that still carry a default name ("Platform 4") in the
 * order Layers shows them: each marble's start rail, then its pieces in hit order, marble after marble, then the free pieces. A new
 * project's platform for Hit 1 then reads Platform 1 however the platforms were placed. Custom names stay, and
 * each type counts on its own. It also runs when an edit leaves two pieces with the same default name, such as a
 * refinement that arrives with the name the piece had before the renumbering.
 */
export function renumberDefaultNames(before: TProject, after: TProject): TProject {
	const known = new Set(before.track.pieces.map((entity) => entity.id));
	const isAdded = after.track.pieces.some((entity) => !known.has(entity.id));
	if (!isAdded && !hasDuplicateDefaultNames(after)) return after;

	const names = new Map<TPiece, string>();
	const counts = new Map<string, number>();
	for (const entity of piecesInLayersOrder(after)) {
		const type = entity.type;
		if (!isDefaultName(entity.name, type)) continue;
		const number = (counts.get(type) ?? 0) + 1;
		counts.set(type, number);
		names.set(entity, `${pieceLabel(type)} ${number}`);
	}
	if ([...names].every(([entity, name]) => entity.name === name)) return after;
	return {
		...after,
		track: { ...after.track, pieces: after.track.pieces.map((entity) => {
			const name = names.get(entity);
			return name == null || name === entity.name ? entity : { ...entity, name };
		}) }
	};
}

function piecesInLayersOrder(project: TProject): TPiece[] {
	const ordered: TPiece[] = [];
	for (const marble of project.marbles) {
		const order = new Map(marble.hits.map((hit) => [hit.id, hit.time]));
		const tied = project.track.pieces.filter((entity) => tieOf(entity)?.marbleId === marble.id);
		const startRail = startRailOf(project, marble.id);
		if (startRail != null) ordered.push(startRail);
		ordered.push(...tied.map((entity, index) => ({ entity, index, time: tieTime(entity, order) })).sort((a, b) => a.time - b.time || a.index - b.index).map((item) => item.entity));
	}
	const placed = new Set(ordered);
	ordered.push(...project.track.pieces.filter((entity) => !placed.has(entity)));
	return ordered;
}

/** The time a tied piece sits at: its hit's time, plus the delay a piece that follows the marble waits */
function tieTime(entity: TPiece, hitTimes: Map<string, number>): number {
	const link = tieOf(entity);
	const hitTime = link == null ? undefined : hitTimes.get(link.hitId);
	return hitTime == null ? Infinity : hitTime + (entity.params['entryDelay'] ?? 0);
}

function hasDuplicateDefaultNames(project: TProject): boolean {
	const seen = new Set<string>();
	for (const entity of project.track.pieces) {
		if (entity.name == null || !isDefaultName(entity.name, entity.type)) continue;
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
