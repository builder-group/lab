import type { TProject } from '@/modules/project';
import { extraStrikes, rollingHits, touchingPairs } from '../track-problems';
import type { TSimulationResult } from '../types';

const DEGREE = Math.PI / 180;

/** What an agent, a test or a person reads about a Pattern: all from the real run */
export interface TPatternMeasures {
	hits: number;
	onTime: number;
	/** Median sideways distance, in meters, between a bar and the bar two hits before: 0 is a straight column */
	columnStraightness: number | null;
	/** Median fall between two hits, in meters */
	dropPerHit: number | null;
	/** The largest fall between two hits, in meters */
	largestDrop: number | null;
	/** Median bar tilt in degrees, and the steepest */
	medianTilt: number | null;
	steepestTilt: number | null;
	extraStrikes: number;
	rolls: number;
	touching: number;
}

/** Measures one lane's hits, all of them or those given */
export function measurePattern(project: TProject, result: TSimulationResult, laneId: string, hitIds?: readonly string[]): TPatternMeasures {
	const wanted = hitIds != null ? new Set(hitIds) : null;
	const hits = result.hits.filter((hit) => hit.laneId === laneId && (wanted == null || wanted.has(hit.hitId)));
	const pieces = new Map(result.pieces.map((piece) => [piece.entityId, piece]));
	const rows = hits.map((hit) => {
		const piece = hit.pieceEntityId != null ? pieces.get(hit.pieceEntityId) : undefined;
		return piece?.type === 'platform' ? { x: piece.position.x, y: hit.dot?.y ?? piece.position.y, angle: piece.angle } : null;
	});
	const drops: number[] = [];
	const sideways: number[] = [];
	for (let index = 1; index < rows.length; index++) {
		const before = rows[index - 1];
		const here = rows[index];
		if (before != null && here != null) drops.push(before.y - here.y);
		const further = rows[index - 2];
		if (further != null && before != null && here != null && Math.sign(further.angle) === Math.sign(here.angle)) sideways.push(Math.abs(further.x - here.x));
	}
	const tilts = rows.flatMap((row) => (row != null ? [Math.abs(row.angle) / DEGREE] : []));
	const inSet = (hitId: string): boolean => wanted == null || wanted.has(hitId);
	return {
		hits: hits.length,
		onTime: hits.filter((hit) => hit.status === 'onTime' || hit.status === 'drifting').length,
		columnStraightness: median(sideways),
		dropPerHit: median(drops),
		largestDrop: drops.length > 0 ? Math.max(...drops) : null,
		medianTilt: median(tilts),
		steepestTilt: tilts.length > 0 ? Math.max(...tilts) : null,
		extraStrikes: extraStrikes(project, result).filter((item) => inSet(item.hitId)).length,
		rolls: rollingHits(project, result).filter((item) => inSet(item.hitId)).length,
		touching: touchingPairs(project, result).length
	};
}

function median(values: number[]): number | null {
	if (!values.length) return null;
	return [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)] as number;
}
