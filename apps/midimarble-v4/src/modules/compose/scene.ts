import type { TProject, TVec2 } from '@/modules/project';
import { frameBand, PHYSICS_HZ, type TMarbleTrack, type TResolvedPiece, type TSimulationResult } from '@/modules/simulation';
import type { TBounds } from './view';

// Pure derivations from a project and its simulation result that the canvas draws and picks against

/** Marble centre at `time`, interpolated between samples. Before release it waits at its release point. */
export function marblePositionAt(track: TMarbleTrack | undefined, time: number, release: TVec2): TVec2 {
	const samples = track?.samples ?? [];
	const first = samples[0];
	if (first == null || time <= first.time) return release;
	const exact = (time - first.time) * PHYSICS_HZ;
	const index = Math.floor(exact);
	const last = samples[samples.length - 1];
	if (index >= samples.length - 1) return last?.position ?? release;
	const a = samples[index];
	const b = samples[index + 1];
	if (a == null || b == null) return release;
	const t = exact - index;
	return { x: a.position.x + (b.position.x - a.position.x) * t, y: a.position.y + (b.position.y - a.position.y) * t };
}

/** Flat x, y pairs and times of a track, for the trajectory line buffers */
export function trackBuffers(track: TMarbleTrack): { points: Float32Array; times: Float32Array } {
	const points = new Float32Array(track.samples.length * 2);
	const times = new Float32Array(track.samples.length);
	track.samples.forEach((sample, index) => {
		points[index * 2] = sample.position.x;
		points[index * 2 + 1] = sample.position.y;
		times[index] = sample.time;
	});
	return { points, times };
}

/** Corners of a piece's outline on the wall, in order around the box */
export function pieceCorners(piece: TResolvedPiece): TVec2[] {
	const halfLength = (piece.params['length'] ?? 0.06) / 2;
	const halfThickness = (piece.params['thickness'] ?? 0.008) / 2;
	const cos = Math.cos(piece.angle);
	const sin = Math.sin(piece.angle);
	return [
		[-halfLength, -halfThickness],
		[halfLength, -halfThickness],
		[halfLength, halfThickness],
		[-halfLength, halfThickness]
	].map(([x = 0, y = 0]) => ({ x: piece.position.x + x * cos - y * sin, y: piece.position.y + x * sin + y * cos }));
}

/** Rotation pivot and grip of a piece: the pivot is its hit point, the grip sits at the far end of the bar */
export function rotationGrip(piece: TResolvedPiece): { pivot: TVec2; grip: TVec2; tangent: TVec2 } {
	const halfLength = (piece.params['length'] ?? 0.06) / 2;
	const tangent = { x: Math.cos(piece.angle), y: Math.sin(piece.angle) };
	const pivot = piece.contactPoint ?? piece.position;
	// Project the pivot onto the bar axis and walk to the +tangent end
	const along = (pivot.x - piece.position.x) * tangent.x + (pivot.y - piece.position.y) * tangent.y;
	const reach = halfLength - along;
	return { pivot, grip: { x: pivot.x + tangent.x * reach, y: pivot.y + tangent.y * reach }, tangent };
}

/** Area worth showing: releases, pieces, reachable hit dots and the frame band */
export function contentBounds(project: TProject, result: TSimulationResult | null): TBounds {
	const points: TVec2[] = [];
	for (const entity of project.entities) {
		const release = entity.components.release;
		if (release != null) points.push(release.position);
	}
	for (const piece of result?.pieces ?? []) points.push(...pieceCorners(piece));
	for (const hit of result?.hits ?? []) if (hit.dot != null) points.push(hit.dot);
	const band = frameBand(project);
	let minX = band.centerX - band.halfWidth;
	let maxX = band.centerX + band.halfWidth;
	let minY = Number.POSITIVE_INFINITY;
	let maxY = Number.NEGATIVE_INFINITY;
	for (const point of points) {
		minX = Math.min(minX, point.x);
		maxX = Math.max(maxX, point.x);
		minY = Math.min(minY, point.y);
		maxY = Math.max(maxY, point.y);
	}
	if (!Number.isFinite(minY)) {
		minY = -0.2;
		maxY = 0.2;
	}
	// A run with only a release still shows a frame-shaped area below it
	if (maxY - minY < 0.3) minY = maxY - 0.3;
	return { minX, minY, maxX, maxY };
}

export function boundsOfPieces(pieces: TResolvedPiece[]): TBounds | null {
	const corners = pieces.flatMap(pieceCorners);
	if (!corners.length) return null;
	return {
		minX: Math.min(...corners.map((point) => point.x)),
		minY: Math.min(...corners.map((point) => point.y)),
		maxX: Math.max(...corners.map((point) => point.x)),
		maxY: Math.max(...corners.map((point) => point.y))
	};
}
