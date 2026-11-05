import type React from 'react';
import { SIDE_ANGLE } from '@/modules/camera';
import type { TDesign } from '@/modules/project';
import type { StudioCx } from '@/modules/studio/StudioCx';
import { cameraCommands } from './design-commands';

/** Radians per pixel of a drag, Blender's orbit speed */
const ORBIT_SPEED = (0.4 * Math.PI) / 180;
/** Past this tilt the camera lies flat against the wall; the follow camera stops at about 83° */
export const MAX_TILT_DEGREES = 80;
/** Pixels a press moves before it is a drag rather than a click */
const DRAG_THRESHOLD = 3;

export interface TCameraAngles {
	/** Turn in radians */
	side: number;
	/** Tilt in radians */
	pitch: number;
}

export function cameraAngles(camera: TDesign['camera']): TCameraAngles {
	return { side: camera.side ?? SIDE_ANGLE, pitch: camera.pitch };
}

/**
 * The angles after a drag, as Blender orbits with Lock Camera to View: the wall follows the pointer, so left and right
 * change Turn, up and down change Tilt. Turn goes all the way around, Tilt stops at the wall.
 */
export function orbitedAngles(start: TCameraAngles, deltaX: number, deltaY: number): TCameraAngles {
	const fullTurn = 2 * Math.PI;
	return {
		side: (((start.side - deltaX * ORBIT_SPEED) % fullTurn) + fullTurn) % fullTurn,
		pitch: Math.min((MAX_TILT_DEGREES * Math.PI) / 180, Math.max(0, start.pitch - deltaY * ORBIT_SPEED))
	};
}

/**
 * Orbits the film camera with a drag on the preview. The Draft Preview answers at once from `design.$orbit`; the project
 * takes the angles on release, as one Undo step, and Blender catches up then.
 */
export function startCameraOrbit(cx: StudioCx, event: React.PointerEvent): void {
	const project = cx.project;
	if (project == null) return;
	const start = cameraAngles(project.design.camera);
	const [startX, startY] = [event.clientX, event.clientY];
	const pointerId = event.pointerId;
	let isDragged = false;

	function onMove(move: PointerEvent): void {
		if (move.pointerId !== pointerId) return;
		if (!isDragged && Math.hypot(move.clientX - startX, move.clientY - startY) < DRAG_THRESHOLD) return;
		isDragged = true;
		cx.design.$orbit.set(orbitedAngles(start, move.clientX - startX, move.clientY - startY));
	}

	function onEnd(end: PointerEvent): void {
		if (end.pointerId !== pointerId) return;
		window.removeEventListener('pointermove', onMove);
		window.removeEventListener('pointerup', onEnd);
		window.removeEventListener('pointercancel', onEnd);
		if (!isDragged) return;
		const angles = cx.design.$orbit.get();
		const current = cx.project;
		if (angles != null && current != null && end.type === 'pointerup') cx.execute(cameraCommands(current, angles));
		// Track draws only the Draft Preview, so no Blender frame will end the orbit there
		if (cx.$workspace.get() === 'compose') cx.design.clearOrbit();
		else cx.design.endOrbit();
		if (end.type === 'pointerup') swallowNextClick();
	}

	window.addEventListener('pointermove', onMove);
	window.addEventListener('pointerup', onEnd);
	window.addEventListener('pointercancel', onEnd);
}

/** The click that ends a drag selects nothing: it lands wherever the pointer stopped, even off the preview */
function swallowNextClick(): void {
	function onClick(event: MouseEvent): void {
		event.stopPropagation();
		event.preventDefault();
	}
	window.addEventListener('click', onClick, { capture: true, once: true });
	setTimeout(() => window.removeEventListener('click', onClick, { capture: true }), 0);
}
