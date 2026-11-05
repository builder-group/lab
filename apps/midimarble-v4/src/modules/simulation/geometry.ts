import type { TVec2 } from '@/modules/project';

// Wall-plane geometry shared by the simulation and the Compose helpers

/** Earth gravity along y; a project scales it by `physics.gravityScale` (`gravityOf`) */
export const GRAVITY_Y = -9.81;

/** Gravity along y of a project: Earth's scaled by its `physics.gravityScale`, Earth's without physics */
export function gravityOf(project: { physics?: { gravityScale: number } }): number {
	return GRAVITY_Y * (project.physics?.gravityScale ?? 1);
}

/** Oriented rectangle in the wall plane. `angle` rotates its length axis from +x toward +y. */
export interface TBox2 {
	cx: number;
	cy: number;
	angle: number;
	halfLength: number;
	halfThickness: number;
}

export interface TBallisticState {
	position: TVec2;
	velocity: TVec2;
}

/** Free flight under `gravity` along y (Earth's by default), exact without contacts */
export function ballistic(
	position: TVec2,
	velocity: TVec2,
	dt: number,
	gravity = GRAVITY_Y
): TBallisticState {
	return {
		position: {
			x: position.x + velocity.x * dt,
			y: position.y + velocity.y * dt + 0.5 * gravity * dt * dt
		},
		velocity: { x: velocity.x, y: velocity.y + gravity * dt }
	};
}

/** Signed distance from a point to the box outline, negative inside */
export function boxDistance(box: TBox2, x: number, y: number): number {
	const [lx, ly] = toBoxLocal(box, x, y);
	const qx = Math.abs(lx) - box.halfLength;
	const qy = Math.abs(ly) - box.halfThickness;
	const outside = Math.hypot(Math.max(qx, 0), Math.max(qy, 0));
	return outside + Math.min(Math.max(qx, qy), 0);
}

/** Closest point on the box outline or inside it */
export function closestPointOnBox(box: TBox2, x: number, y: number): TVec2 {
	const [lx, ly] = toBoxLocal(box, x, y);
	const px = Math.min(box.halfLength, Math.max(-box.halfLength, lx));
	const py = Math.min(box.halfThickness, Math.max(-box.halfThickness, ly));
	const cos = Math.cos(box.angle);
	const sin = Math.sin(box.angle);
	return { x: box.cx + px * cos - py * sin, y: box.cy + px * sin + py * cos };
}

/** Half extents of the box's axis-aligned bounds */
export function boxExtents(box: TBox2): TVec2 {
	const cos = Math.abs(Math.cos(box.angle));
	const sin = Math.abs(Math.sin(box.angle));
	return {
		x: cos * box.halfLength + sin * box.halfThickness,
		y: sin * box.halfLength + cos * box.halfThickness
	};
}

function toBoxLocal(box: TBox2, x: number, y: number): [number, number] {
	const dx = x - box.cx;
	const dy = y - box.cy;
	const cos = Math.cos(box.angle);
	const sin = Math.sin(box.angle);
	return [dx * cos + dy * sin, -dx * sin + dy * cos];
}

/** Unit normal of a surface at `angle`, before it is flipped toward the incoming marble */
export function surfaceNormal(angle: number): TVec2 {
	return { x: -Math.sin(angle), y: Math.cos(angle) };
}

export interface TBoxPlacement {
	box: TBox2;
	contactPoint: TVec2;
	contactNormal: TVec2;
}

/**
 * Places a box so its contact face touches a marble of `radius` centered at `position`. The face normal is
 * flipped when it would face away from the incoming `velocity`.
 */
export function placeBoxAtMarble(
	position: TVec2,
	velocity: TVec2 | null,
	radius: number,
	angle: number,
	contactAt: number,
	length: number,
	thickness: number
): TBoxPlacement {
	let normal = surfaceNormal(angle);
	if (velocity != null && normal.x * velocity.x + normal.y * velocity.y > 0) {
		normal = { x: -normal.x, y: -normal.y };
	}
	const contactPoint = { x: position.x - normal.x * radius, y: position.y - normal.y * radius };
	return placeBoxAtContact(contactPoint, normal, angle, contactAt, length, thickness);
}

/** Places a box so the contact face holds `contactPoint` at `contactAt` along its length */
export function placeBoxAtContact(
	contactPoint: TVec2,
	normal: TVec2,
	angle: number,
	contactAt: number,
	length: number,
	thickness: number
): TBoxPlacement {
	const tangent = { x: Math.cos(angle), y: Math.sin(angle) };
	const along = length * (0.5 - contactAt);
	return {
		box: {
			cx: contactPoint.x - (normal.x * thickness) / 2 + tangent.x * along,
			cy: contactPoint.y - (normal.y * thickness) / 2 + tangent.y * along,
			angle,
			halfLength: length / 2,
			halfThickness: thickness / 2
		},
		contactPoint,
		contactNormal: normal
	};
}
