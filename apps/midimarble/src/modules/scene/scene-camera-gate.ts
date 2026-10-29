import * as THREE from 'three';

export interface TCameraGate {
	x: number;
	y: number;
	width: number;
	height: number;
}

export function fitCameraGate(width: number, height: number, aspect: number): TCameraGate {
	const gateWidth = Math.min(width, height * aspect);
	const gateHeight = gateWidth / aspect;
	return {
		x: (width - gateWidth) / 2,
		y: (height - gateHeight) / 2,
		width: gateWidth,
		height: gateHeight
	};
}

/** Extends the projection outside the output frame without changing any pixel inside it. */
export function cameraContextFov(
	outputFov: number,
	hostHeight: number,
	gateHeight: number
): number {
	return THREE.MathUtils.radToDeg(
		2 *
			Math.atan(
				(Math.tan(THREE.MathUtils.degToRad(outputFov / 2)) * hostHeight) /
					Math.max(1e-6, gateHeight)
			)
	);
}

export function cameraPassepartout(
	width: number,
	height: number,
	gate: TCameraGate
): TCameraGate[] {
	return [
		{ x: 0, y: 0, width, height: gate.y },
		{ x: 0, y: gate.y + gate.height, width, height: Math.max(0, height - gate.y - gate.height) },
		{ x: 0, y: gate.y, width: gate.x, height: gate.height },
		{
			x: gate.x + gate.width,
			y: gate.y,
			width: Math.max(0, width - gate.x - gate.width),
			height: gate.height
		}
	];
}
