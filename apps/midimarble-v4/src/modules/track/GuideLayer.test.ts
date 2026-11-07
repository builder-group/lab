import { describe, expect, it } from 'vitest';
import { createMarble, createProject, type TProject } from '@/modules/project';
import type { TSimulationResult } from '@/modules/simulation';
import { guidePoints } from './GuideLayer';

function oneMarble(guide?: { points: { x: number; y: number }[] }): TProject {
	const marble = { ...createMarble(0, { x: 0.1, y: 0.6 }, 'm'), ...(guide != null ? { guide } : {}) };
	return { ...createProject(), marbles: [marble] };
}

const run = { marbles: [{ marbleId: 'm', samples: [{ position: { x: 0.1, y: 0.6 } }, { position: { x: 0.3, y: -2 } }] }] } as unknown as TSimulationResult;

describe('guidePoints', () => {
	it('runs straight down from the release, past the lowest point of the run', () => {
		const project = oneMarble();
		const points = guidePoints(project, run, project.marbles[0] as TProject['marbles'][number]);
		expect(points).toHaveLength(2);
		expect(points[0]).toEqual({ x: points[1]?.x, y: 0.6 });
		expect(points[1]?.y).toBeCloseTo(-2.6);
	});

	it('bends through the points a marble stores', () => {
		const project = oneMarble({ points: [{ x: 0.1, y: 0.6 }, { x: 0.5, y: -1 }] });
		const points = guidePoints(project, run, project.marbles[0] as TProject['marbles'][number]);
		expect(points.map((point) => point.y)).toEqual([0.6, -1, expect.closeTo(-2.6) as number]);
		expect(points[1]?.x).toBeCloseTo(0.5);
	});
});
