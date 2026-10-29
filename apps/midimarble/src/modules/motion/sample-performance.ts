import type { TPerformance, TSample, TVec3 } from '../project/types';

/** Samples baked physics without running, reversing, or accumulating simulation state. */
export function samplePerformance(performance: TPerformance, time: number): TSample {
	const samples = performance.samples;
	const first = samples[0];
	if (first == null) return { time: 0, position: [0, 0, 0], rotation: [0, 0, 0, 1] };
	const boundedTime = Math.max(
		first.time,
		Math.min(time, performance.duration, samples[samples.length - 1]?.time ?? performance.duration)
	);
	const index = Math.min(
		samples.length - 1,
		Math.floor((boundedTime - first.time) / performance.dt)
	);
	const left = samples[index] ?? first;
	const right = samples[Math.min(index + 1, samples.length - 1)] ?? left;
	const alpha = right.time === left.time ? 0 : (boundedTime - left.time) / (right.time - left.time);
	const dot = left.rotation.reduce(
		(sum, component, axis) => sum + component * (right.rotation[axis] ?? 0),
		0
	);
	const sign = dot < 0 ? -1 : 1;
	const rotation = left.rotation.map(
		(component, axis) => component + ((right.rotation[axis] ?? 0) * sign - component) * alpha
	);
	const length = Math.hypot(...rotation) || 1;
	return {
		time: boundedTime,
		position: left.position.map(
			(component, axis) => component + ((right.position[axis] ?? 0) - component) * alpha
		) as TVec3,
		rotation: rotation.map((component) => component / length) as TSample['rotation']
	};
}
