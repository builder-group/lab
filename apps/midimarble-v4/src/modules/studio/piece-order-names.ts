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
	const known = new Set(before.track.pieces.map((piece) => piece.id));
	const isAdded = after.track.pieces.some((piece) => !known.has(piece.id));
	if (!isAdded && !hasDuplicateDefaultNames(after)) return after;

	const names = new Map<TPiece, string>();
	const counts = new Map<string, number>();
	for (const piece of piecesInLayersOrder(after)) {
		const type = piece.type;
		if (!isDefaultName(piece.name, type)) continue;
		const number = (counts.get(type) ?? 0) + 1;
		counts.set(type, number);
		names.set(piece, `${pieceLabel(type)} ${number}`);
	}
	if ([...names].every(([piece, name]) => piece.name === name)) return after;
	return {
		...after,
		track: { ...after.track, pieces: after.track.pieces.map((piece) => {
			const name = names.get(piece);
			return name == null || name === piece.name ? piece : { ...piece, name };
		}) }
	};
}

function piecesInLayersOrder(project: TProject): TPiece[] {
	const ordered: TPiece[] = [];
	for (const marble of project.marbles) {
		const order = new Map(marble.hits.map((hit) => [hit.id, hit.time]));
		const tied = project.track.pieces.filter((piece) => tieOf(piece)?.marbleId === marble.id);
		const startRail = startRailOf(project, marble.id);
		if (startRail != null) ordered.push(startRail);
		ordered.push(...tied.map((piece, index) => ({ piece, index, time: tieTime(piece, order) })).sort((a, b) => a.time - b.time || a.index - b.index).map((item) => item.piece));
	}
	const placed = new Set(ordered);
	ordered.push(...project.track.pieces.filter((piece) => !placed.has(piece)));
	return ordered;
}

/** The time a tied piece sits at: its hit's time, plus the delay a piece that follows the marble waits */
function tieTime(piece: TPiece, hitTimes: Map<string, number>): number {
	const link = tieOf(piece);
	const hitTime = link == null ? undefined : hitTimes.get(link.hitId);
	return hitTime == null ? Infinity : hitTime + (piece.params['entryDelay'] ?? 0);
}

function hasDuplicateDefaultNames(project: TProject): boolean {
	const seen = new Set<string>();
	for (const piece of project.track.pieces) {
		if (piece.name == null || !isDefaultName(piece.name, piece.type)) continue;
		if (seen.has(piece.name)) return true;
		seen.add(piece.name);
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
