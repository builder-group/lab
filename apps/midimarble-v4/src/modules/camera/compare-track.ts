import type { TCameraTrack } from './follow-camera';

/**
 * Per-frame difference between a ported camera track and the keyframes Blender baked, as dumped by
 * `blender/tests/dump_camera.py`. Position error in metres, angle error in degrees (the rotation between both
 * camera orientations), focus error in metres.
 */
export function compareCameraTrack(
	track: TCameraTrack,
	dump: TBlenderCameraDump
): TCameraTrackError {
	const error: TCameraTrackError = {
		frames: 0,
		maxPosition: 0,
		meanPosition: 0,
		maxAngle: 0,
		meanAngle: 0,
		maxFocus: 0,
		worstFrame: 0,
		lens: Math.abs(track.lens - dump.lens),
		frameCountDelta: track.frameCount - dump.frames.length
	};
	for (const frame of dump.frames) {
		const index = frame.frame;
		if (index < 0 || index >= track.frameCount) continue;
		const position = Math.hypot(
			(track.position[index * 3] ?? 0) - frame.location[0],
			(track.position[index * 3 + 1] ?? 0) - frame.location[1],
			(track.position[index * 3 + 2] ?? 0) - frame.location[2]
		);
		const rotation = quaternionToMatrix(track.rotation.subarray(index * 4, index * 4 + 4));
		let trace = 0;
		for (let row = 0; row < 3; row++)
			for (let column = 0; column < 3; column++)
				trace += (rotation[row]?.[column] ?? 0) * (frame.matrix[row]?.[column] ?? 0);
		const angle = (Math.acos(Math.min(1, Math.max(-1, (trace - 1) / 2))) * 180) / Math.PI;
		error.frames++;
		error.meanPosition += position;
		error.meanAngle += angle;
		if (position > error.maxPosition) {
			error.maxPosition = position;
			error.worstFrame = index;
		}
		error.maxAngle = Math.max(error.maxAngle, angle);
		error.maxFocus = Math.max(error.maxFocus, Math.abs((track.focus[index] ?? 0) - frame.focus));
	}
	if (error.frames > 0) {
		error.meanPosition /= error.frames;
		error.meanAngle /= error.frames;
	}
	return error;
}

/** Rotation matrix rows of a unit quaternion wxyz */
export function quaternionToMatrix(q: ArrayLike<number>): number[][] {
	const w = q[0] ?? 0;
	const x = q[1] ?? 0;
	const y = q[2] ?? 0;
	const z = q[3] ?? 0;
	return [
		[1 - 2 * (y * y + z * z), 2 * (x * y - w * z), 2 * (x * z + w * y)],
		[2 * (x * y + w * z), 1 - 2 * (x * x + z * z), 2 * (y * z - w * x)],
		[2 * (x * z - w * y), 2 * (y * z + w * x), 1 - 2 * (x * x + y * y)]
	];
}

export interface TBlenderCameraDump {
	camera: string;
	fps: number;
	resolution: [number, number];
	lens: number;
	sensorWidth: number;
	sensorFit: string;
	frames: {
		frame: number;
		location: [number, number, number];
		matrix: number[][];
		focus: number;
	}[];
}

export interface TCameraTrackError {
	frames: number;
	maxPosition: number;
	meanPosition: number;
	maxAngle: number;
	meanAngle: number;
	maxFocus: number;
	worstFrame: number;
	lens: number;
	frameCountDelta: number;
}
