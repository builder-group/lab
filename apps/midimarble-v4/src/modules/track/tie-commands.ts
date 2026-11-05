import { openContextMenu, type TMenuItem } from '@/components';
import type { TProjectCommand } from '@/modules/project';
import { anchorPiece, isMusicalPiece, unanchorPiece, unlinkPiece } from '@/modules/simulation';
import type { StudioCx } from '@/modules/studio';
import { attachState } from '@/modules/building';
import type { TrackCx } from './TrackCx';
import { nearestMoment } from '@/modules/scene';
import { selectedPieceIds } from './step-loop';

// Links of the selected pieces for the piece context menus and the command palette: Play a Note…, Follow a Marble…
// and Detach

/**
 * Follow a Marble for the selected pieces: each piece follows the moment of `laneId`'s
 * fall closest to it, or of the nearest marble's fall without one, keeping where it is. One undo step.
 */
export function followSelection(cx: StudioCx, laneId?: string): void {
	const project = cx.project;
	const result = cx.simulation.$result.get();
	if (project == null || result == null) return;
	let current = project;
	const commands: TProjectCommand[] = [];
	for (const entityId of selectedPieceIds(project, cx.$selection.get())) {
		const resolved = result.pieces.find((piece) => piece.entityId === entityId);
		if (resolved == null) continue;
		const point = resolved.contactPoint ?? resolved.position;
		const moments = result.marbles
			.filter((track) => laneId == null || track.laneId === laneId)
			.flatMap((track) => {
				const time = nearestMoment(track.samples, point);
				const sample = time == null ? null : track.samples.find((item) => item.time >= time - 1e-9);
				return time == null || sample == null ? [] : [{ laneId: track.laneId, time, distance: Math.hypot(sample.position.x - point.x, sample.position.y - point.y) }];
			})
			.sort((a, b) => a.distance - b.distance);
		const nearest = moments[0];
		if (nearest == null) continue;
		const [isOk, error, value] = anchorPiece(current, result, entityId, nearest.laneId, nearest.time);
		if (!isOk) {
			cx.notify(error.message);
			return;
		}
		commands.push(...value.commands);
		current = { ...current, entities: current.entities.map((entity) => (entity.id === entityId ? value.entity : entity)) };
	}
	if (commands.length) cx.execute(commands);
}

/** Detach for the selected pieces: frees pieces that play a note or follow a marble, in place, as one undo step */
export function detachSelection(cx: StudioCx): void {
	const project = cx.project;
	const result = cx.simulation.$result.get();
	if (project == null || result == null) return;
	const commands: TProjectCommand[] = [];
	for (const entityId of selectedPieceIds(project, cx.$selection.get())) {
		const entity = project.entities.find((item) => item.id === entityId);
		if (entity == null || entity.components.hitLink == null) continue;
		const attach = attachState(project, entity);
		const [isOk, error, value] = attach.kind === 'linked' ? unlinkPiece(project, result, entityId) : unanchorPiece(project, result, entityId);
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
	return selectedPieceIds(project, cx.$selection.get()).some((id) => project.entities.find((entity) => entity.id === id)?.components.hitLink != null);
}

/** The one selected piece Play a Note… can link: a platform that does not play a note yet */
function pieceToLink(cx: StudioCx): string | null {
	const project = cx.project;
	if (project == null) return null;
	const ids = selectedPieceIds(project, cx.$selection.get());
	const entity = ids.length === 1 ? project.entities.find((item) => item.id === ids[0]) : undefined;
	if (entity == null || !isMusicalPiece(entity.components.piece?.type ?? '')) return null;
	return attachState(project, entity).kind === 'linked' ? null : entity.id;
}

/** Whether Play a Note… has a piece to link */
export function canPlayNote(cx: StudioCx): boolean {
	return pieceToLink(cx) != null;
}

/** Play a Note…: arms the selected platform for a click on a note's dot */
export function armPlayNote(cx: StudioCx, trackCx: TrackCx): void {
	const entityId = pieceToLink(cx);
	if (entityId != null) trackCx.armPlayNote(entityId);
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
	const entity = ids.length === 1 ? project.entities.find((item) => item.id === ids[0]) : undefined;
	const attach = entity != null ? attachState(project, entity) : null;
	return project.music.lanes
		.filter((lane) => result.marbles.some((track) => track.laneId === lane.id))
		.map((lane) => ({ label: lane.name, checked: attach?.kind === 'anchored' && attach.laneId === lane.id, onSelect: () => followSelection(cx, lane.id) }));
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
