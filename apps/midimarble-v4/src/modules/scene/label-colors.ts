import { type TPiece, type TProject, tieOf } from '@/modules/project';
import { startRailOf } from '@/modules/simulation';
import { draftPieceColors, type TDraftColors } from './draft-look';

// A label color shows in Track, and in Film only on the skin None.

const startRails = new WeakMap<TProject, Map<string, string>>();

/** The piece's own label color, else its marble's; null for a piece no marble plays or starts on */
export function pieceLabelColor(project: TProject, piece: TPiece): string | null {
	if (piece.labelColor != null) return piece.labelColor;
	const marbleId = tieOf(piece)?.marbleId ?? startRailsOf(project).get(piece.id);
	return project.marbles.find((marble) => marble.id === marbleId)?.labelColor ?? null;
}

/** The marble's start rail per project state, since every piece asks on every frame */
function startRailsOf(project: TProject): Map<string, string> {
	let rails = startRails.get(project);
	if (rails == null) {
		rails = new Map();
		for (const marble of project.marbles) {
			const rail = startRailOf(project, marble.id);
			if (rail != null) rails.set(rail.id, marble.id);
		}
		startRails.set(project, rails);
	}
	return rails;
}

const pieceIndexes = new WeakMap<TProject, Map<string, TPiece>>();

/** Pieces by id per project state, since every piece asks on every draw. An edit makes a new project, and with it a new index */
function entityOf(project: TProject, entityId: string): TPiece | undefined {
	let index = pieceIndexes.get(project);
	if (index == null) {
		index = new Map();
		for (const piece of project.track.pieces) if (!index.has(piece.id)) index.set(piece.id, piece);
		pieceIndexes.set(project, index);
	}
	return index.get(entityId);
}

const trackColors = new Map<string, TDraftColors>();

/**
 * A piece in Track, 2D and 3D, the way the Pegboard theme's Draft draws it whatever the project's theme: in its label color,
 * or plain wood without one. The same object for the same color, so memoized shapes stay put.
 */
export function trackPieceColors(project: TProject | null | undefined, entityId: string, type: string): TDraftColors {
	const piece = project != null ? entityOf(project, entityId) : undefined;
	const color = project != null && piece != null ? pieceLabelColor(project, piece) : null;
	const key = `${type}:${color ?? ''}`;
	let colors = trackColors.get(key);
	if (colors == null) {
		colors = draftPieceColors('pegboard', { type, color: color ?? '#000000', skin: color != null ? null : { colorSource: 'skin' } });
		trackColors.set(key, colors);
	}
	return colors;
}
