import { openContextMenu, type TMenuItem } from '@/components';
import { type TProjectCommand, tieOf } from '@/modules/project';
import { anchorPiece, isMusicalPiece, unanchorPiece, unlinkPiece } from '@/modules/simulation';
import type { StudioCx } from '@/modules/studio';
import { attachState } from '@/modules/building';
import type { TrackCx } from './TrackCx';
import { nearestMoment } from '@/modules/scene';
import { selectedPieceIds } from './step-loop';

// Links of the selected pieces for the piece context menus and the command palette: Play a Note…, Follow a Marble…
// and Detach

/**
 * Follow a Marble for the selected pieces: each piece follows the moment of `marbleId`'s
 * fall closest to it, or of the nearest marble's fall without one, keeping where it is. One undo step.
 */
export function followSelection(cx: StudioCx, marbleId?: string): void {
	const project = cx.project;
	const result = cx.simulation.$result.get();
	if (project == null || result == null) return;
	let current = project;
	const commands: TProjectCommand[] = [];
	for (const pieceId of selectedPieceIds(project, cx.$selection.get())) {
		const resolved = result.pieces.find((piece) => piece.pieceId === pieceId);
		if (resolved == null) continue;
		const point = resolved.contactPoint ?? resolved.position;
		const moments = result.marbles
			.filter((track) => marbleId == null || track.marbleId === marbleId)
			.flatMap((track) => {
				const time = nearestMoment(track.samples, point);
				const sample = time == null ? null : track.samples.find((item) => item.time >= time - 1e-9);
				return time == null || sample == null ? [] : [{ marbleId: track.marbleId, time, distance: Math.hypot(sample.position.x - point.x, sample.position.y - point.y) }];
			})
			.sort((a, b) => a.distance - b.distance);
		const nearest = moments[0];
		if (nearest == null) continue;
		const [isOk, error, value] = anchorPiece(current, result, pieceId, nearest.marbleId, nearest.time);
		if (!isOk) {
			cx.notify(error.message);
			return;
		}
		commands.push(...value.commands);
		current = { ...current, track: { ...current.track, pieces: current.track.pieces.map((piece) => (piece.id === pieceId ? value.piece : piece)) } };
	}
	if (commands.length) cx.execute(commands);
}

/** Detach for the selected pieces: frees pieces that play a note or follow a marble, in place, as one undo step */
export function detachSelection(cx: StudioCx): void {
	const project = cx.project;
	const result = cx.simulation.$result.get();
	if (project == null || result == null) return;
	const commands: TProjectCommand[] = [];
	for (const pieceId of selectedPieceIds(project, cx.$selection.get())) {
		const piece = project.track.pieces.find((item) => item.id === pieceId);
		if (piece == null || tieOf(piece) == null) continue;
		const attach = attachState(project, piece);
		const [isOk, error, value] = attach.kind === 'linked' ? unlinkPiece(project, result, pieceId) : unanchorPiece(project, result, pieceId);
		if (!isOk) {
			cx.notify(error.message);
			return;
		}
		commands.push(...value.commands);
	}
	if (commands.length) cx.execute(commands);
}

/** Whether a selected piece is tied to a note or a marble, so Detach has something to do */
export function hasTiedSelection(cx: StudioCx): boolean {
	const project = cx.project;
	if (project == null) return false;
	return selectedPieceIds(project, cx.$selection.get()).some((id) => tieOf(project.track.pieces.find((piece) => piece.id === id)) != null);
}

/** The one selected piece Play a Note… can link: a platform that does not play a note yet */
function pieceToLink(cx: StudioCx): string | null {
	const project = cx.project;
	if (project == null) return null;
	const ids = selectedPieceIds(project, cx.$selection.get());
	const piece = ids.length === 1 ? project.track.pieces.find((item) => item.id === ids[0]) : undefined;
	if (piece == null || !isMusicalPiece(piece.type ?? '')) return null;
	return attachState(project, piece).kind === 'linked' ? null : piece.id;
}

/** Whether Play a Note… has a piece to link */
export function canPlayNote(cx: StudioCx): boolean {
	return pieceToLink(cx) != null;
}

/** Play a Note…: arms the selected platform for a click on a note's dot */
export function armPlayNote(cx: StudioCx, trackCx: TrackCx): void {
	const pieceId = pieceToLink(cx);
	if (pieceId != null) trackCx.armPlayNote(pieceId);
}

/** Whether a selected piece can follow a marble in the run */
export function canFollow(cx: StudioCx): boolean {
	const project = cx.project;
	const marbles = cx.simulation.$result.get()?.marbles ?? [];
	return project != null && marbles.length > 0 && selectedPieceIds(project, cx.$selection.get()).length > 0;
}

/** The marbles Follow a Marble… offers, with the one the only selected piece follows checked */
export function followItems(cx: StudioCx): TMenuItem[] {
	const project = cx.project;
	const result = cx.simulation.$result.get();
	if (project == null || result == null) return [];
	const ids = selectedPieceIds(project, cx.$selection.get());
	const piece = ids.length === 1 ? project.track.pieces.find((item) => item.id === ids[0]) : undefined;
	const attach = piece != null ? attachState(project, piece) : null;
	return project.marbles
		.filter((marble) => result.marbles.some((track) => track.marbleId === marble.id))
		.map((marble) => ({ label: marble.name, checked: attach?.kind === 'anchored' && attach.marbleId === marble.id, onSelect: () => followSelection(cx, marble.id) }));
}

/**
 * Follow a Marble… from the command palette, which cannot show a submenu: follows the only marble right away, and
 * with several marbles opens the list of them
 */
export function openFollowMenu(cx: StudioCx): void {
	const items = followItems(cx);
	if (items.length === 1) {
		items[0]?.onSelect();
		return;
	}
	openContextMenu({ clientX: window.innerWidth / 2, clientY: window.innerHeight / 3, preventDefault: () => undefined }, items);
}
