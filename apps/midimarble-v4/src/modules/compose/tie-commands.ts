import type { TProjectCommand } from '@/modules/project';
import { anchorPiece, unanchorPiece, unlinkPiece } from '@/modules/simulation';
import type { StudioCx } from '@/modules/studio/StudioCx';
import { attachState } from './attach-edit';
import { nearestMoment } from './scene';
import { selectedPieceIds } from './step-loop';

// Ties of the selected pieces for the command palette, as the canvas context menu's Follow Marble ▸ and Detach

/**
 * Follow Marble for the selected pieces from the command palette: each piece follows the moment of `laneId`'s
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
