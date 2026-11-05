import { type TPiece, type TProject, tieOf } from '@/modules/project';
import { startRailOf } from './placement';
import { getPieceDefinition } from './pieces';

/**
 * Name for a new piece of a type: its label and the number after the highest one in use, so a new piece
 * continues the numbering even after pieces were deleted or renamed in order
 */
export function nextPieceName(type: string, pieces: TPiece[]): string {
	const label = pieceLabel(type);
	const pattern = new RegExp(`^${escapeRegExp(label)} (\\d+)$`);
	let highest = 0;
	let count = 0;
	for (const piece of pieces) {
		if (piece.type !== type) continue;
		count++;
		const number = Number(pattern.exec(piece.name ?? '')?.[1] ?? 0);
		highest = Math.max(highest, number);
	}
	return `${label} ${Math.max(highest, count) + 1}`;
}

/**
 * Renames every piece to its type label and a number in the order the Layers list shows them: each marble's
 * start rail, then its pieces in hit order, marble after marble, then the free pieces. Each type counts on its own, so a project
 * reads "Platform 1…n" and "Rail 1…n" in time order. Only `name` changes.
 */
export function namePiecesInOrder(project: TProject): TProject {
	const ordered: TPiece[] = [];
	for (const marble of project.marbles) {
		const order = new Map(marble.hits.map((hit, index) => [hit.id, index]));
		const startRail = startRailOf(project, marble.id);
		if (startRail != null) ordered.push(startRail);
		ordered.push(
			...project.track.pieces
				.filter((piece) => tieOf(piece)?.marbleId === marble.id)
				.sort((a, b) => (order.get(tieOf(a)?.hitId ?? '') ?? 0) - (order.get(tieOf(b)?.hitId ?? '') ?? 0))
		);
	}
	const placed = new Set(ordered);
	ordered.push(...project.track.pieces.filter((piece) => !placed.has(piece)));

	const names = new Map<TPiece, string>();
	const counts = new Map<string, number>();
	for (const piece of ordered) {
		const type = piece.type ?? '';
		const number = (counts.get(type) ?? 0) + 1;
		counts.set(type, number);
		names.set(piece, `${pieceLabel(type)} ${number}`);
	}
	return {
		...project,
		track: { ...project.track, pieces: project.track.pieces.map((piece) => {
			const name = names.get(piece);
			return name == null || name === piece.name ? piece : { ...piece, name };
		}) }
	};
}

export function pieceLabel(type: string): string {
	return getPieceDefinition(type)?.label ?? type;
}

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
