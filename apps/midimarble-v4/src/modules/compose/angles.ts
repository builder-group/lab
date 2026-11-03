import type { TVec2 } from '@/modules/project';

// Surface angles are radians, counter-clockwise from +x in wall coordinates. A surface at `a` and one at
// `a + π` are the same line, so angles shown to the user stay within -90° to 90°.

export function toDegrees(angle: number): number {
	return (angle * 180) / Math.PI;
}

export function toRadians(degrees: number): number {
	return (degrees * Math.PI) / 180;
}

/** Folds an angle into (-π/2, π/2], the range in which every surface direction appears once */
export function normalizeSurfaceAngle(angle: number): number {
	let result = angle % Math.PI;
	if (result <= -Math.PI / 2) result += Math.PI;
	if (result > Math.PI / 2) result -= Math.PI;
	return result;
}

/** Rounds to the nearest multiple of `stepDegrees` */
export function snapAngle(angle: number, stepDegrees: number): number {
	const step = toRadians(stepDegrees);
	return Math.round(angle / step) * step;
}

/** Degrees for readouts, with one decimal only when needed, like Figma */
export function formatDegrees(angle: number): string {
	const degrees = Math.round(toDegrees(angle) * 10) / 10;
	const text = Number.isInteger(degrees) ? degrees.toFixed(0) : degrees.toFixed(1);
	return `${text === '-0' ? '0' : text}°`;
}

/** Parses typed angles such as `15`, `-7.5°` or `12 deg` into radians */
export function parseDegrees(text: string): number | null {
	const match = /^\s*(-?\d+(?:[.,]\d+)?)\s*(?:°|deg)?\s*$/i.exec(text);
	if (match?.[1] == null) return null;
	const degrees = Number(match[1].replace(',', '.'));
	return Number.isFinite(degrees) ? toRadians(degrees) : null;
}

/** World angle of the direction from `pivot` to `point`, both in screen pixels with y down */
export function screenAngle(pivot: TVec2, point: TVec2): number {
	return Math.atan2(pivot.y - point.y, point.x - pivot.x);
}

export interface TRotationDrag {
	/** Surface angle when the drag started */
	startAngle: number;
	/** Screen angle of the pointer when the drag started */
	startPointer: number;
}

/**
 * Surface angle while dragging a rotation grip around `pivot`. The pointer's change in angle is applied to
 * the start angle, so grabbing the grip off-centre does not jump. Shift snaps the result to 5°. The result
 * is not folded, so the grip stays under the pointer past 90°.
 */
export function dragRotation(drag: TRotationDrag, pivot: TVec2, point: TVec2, snap: boolean): number {
	let delta = screenAngle(pivot, point) - drag.startPointer;
	delta = Math.atan2(Math.sin(delta), Math.cos(delta));
	const angle = drag.startAngle + delta;
	return snap ? snapAngle(angle, 5) : angle;
}
