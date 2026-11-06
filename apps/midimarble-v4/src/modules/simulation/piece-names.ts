import type { TPiece } from '@/modules/project';
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

export function pieceLabel(type: string): string {
	return getPieceDefinition(type)?.label ?? type;
}

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
