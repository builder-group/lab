import { quaternionToMatrix } from './compare-track';
import { verticalFov, type TCameraTrack } from './follow-camera';

// Shared by the follow camera's tests

/** Marble position in normalized image coordinates (0 to 1, y up) seen through the track at `frame` */
export function project(track: TCameraTrack, frame: number, x: number, y: number): [number, number] {
	const rotation = quaternionToMatrix(track.rotation.subarray(frame * 4, frame * 4 + 4));
	const relative = [
		x - at(track.position, frame * 3),
		-track.depth - at(track.position, frame * 3 + 1),
		y - at(track.position, frame * 3 + 2)
	];
	// Camera space = R^T * relative
	const local = [0, 1, 2].map((column) =>
		rotation.reduce((sum, row, index) => sum + at(row, column) * at(relative, index), 0)
	);
	const depth = -at(local, 2);
	const halfHeight = Math.tan((verticalFov(track.lens, track.aspect) * Math.PI) / 360);
	const halfWidth = halfHeight * track.aspect;
	return [0.5 + at(local, 0) / depth / halfWidth / 2, 0.5 + at(local, 1) / depth / halfHeight / 2];
}

export function at(values: ArrayLike<number>, index: number): number {
	return values[index] ?? Number.NaN;
}

export function required<T>(value: T | null | undefined): T {
	if (value == null) throw new Error('Missing value');
	return value;
}
