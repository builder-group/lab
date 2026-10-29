import type { TVec3 } from '../project';

/** Moves a coarse handle with a smooth, compact falloff along the original curve. */
export function deformRailProfile(path: TVec3[], index: number, delta: [number, number]): TVec3[] {
	if (path[index] == null) return path.map((point) => [...point]);
	const distances = getDistances(path);
	const center = distances[index] ?? 0;
	const radius = Math.max(0.01, (distances.at(-1) ?? 0) * 0.2);
	return path.map(([x, y, z], pointIndex): TVec3 => {
		const distance = Math.abs((distances[pointIndex] ?? 0) - center);
		const weight = distance < radius ? (1 + Math.cos((Math.PI * distance) / radius)) / 2 : 0;
		return [clamp(x + delta[0] * weight), clamp(y + delta[1] * weight), z];
	});
}

/** Uses the meaningful high and low points, with evenly spaced handles for a flat profile. */
export function getRailProfileHandles(path: TVec3[]): number[] {
	if (path.length <= 5) return path.map((_, index) => index);
	const distances = getDistances(path);
	const length = distances.at(-1) ?? 0;
	const result = [0, path.length - 1];
	for (let index = 1; index < path.length - 1; index++) {
		const previous = path[index - 1];
		const point = path[index];
		const next = path[index + 1];
		if (previous == null || point == null || next == null) continue;
		if (
			(point[1] - previous[1]) * (next[1] - point[1]) < -1e-10 &&
			result.every(
				(other) => Math.abs((distances[other] ?? 0) - (distances[index] ?? 0)) > length * 0.07
			)
		)
			result.push(index);
		if (result.length >= 7) break;
	}
	if (result.length < 5) {
		for (const fraction of [0.5, 0.25, 0.75]) {
			const target = fraction * length;
			let nearest = 0;
			for (const [index, distance] of distances.entries())
				if (Math.abs(distance - target) < Math.abs((distances[nearest] ?? 0) - target))
					nearest = index;
			if (
				result.every(
					(other) => Math.abs((distances[other] ?? 0) - (distances[nearest] ?? 0)) > length * 0.1
				)
			)
				result.push(nearest);
			if (result.length >= 5) break;
		}
	}
	return result.sort((left, right) => left - right);
}

export function getRailProfileProjection(path: TVec3[]): TRailProfileProjection {
	const points: TVec3[] = path.length ? path : [[0, 0, 0]];
	const minX = Math.min(...points.map((point) => point[0]));
	const maxX = Math.max(...points.map((point) => point[0]));
	const minY = Math.min(...points.map((point) => point[1]));
	const maxY = Math.max(...points.map((point) => point[1]));
	return {
		x: (minX + maxX) / 2,
		y: (minY + maxY) / 2,
		scale: Math.min(204 / Math.max(0.5, maxX - minX), 68 / Math.max(0.5, maxY - minY))
	};
}

export interface TRailProfileProjection {
	x: number;
	y: number;
	scale: number;
}

function getDistances(path: TVec3[]): number[] {
	let distance = 0;
	return path.map((point, index) => {
		const previous = path[index - 1];
		if (previous != null)
			distance += Math.hypot(...point.map((value, axis) => value - (previous[axis] ?? 0)));
		return distance;
	});
}

function clamp(value: number): number {
	return Math.max(-100, Math.min(100, value));
}
