import { describe, expect, it } from 'vitest';
import { createProject } from '@/modules/project';
import type { THitResult, TSimulationResult } from '@/modules/simulation';
import { pickTrack, type TScreenTrack } from './picking';
import { fitTargets, nearestMoment, struckAt } from './scene';
import { fitBounds, fitContent, placeBar, worldToScreen } from './view';

const viewport = { width: 800, height: 600 };
const padding = { top: 50, right: 50, bottom: 50, left: 50 };

describe('fitContent', () => {
	it('fits like fitBounds when the content is small enough', () => {
		const all = { minX: -0.2, minY: 0, maxX: 0.2, maxY: 1 };
		expect(fitContent(all, all, viewport, padding, 100)).toEqual(fitBounds(all, viewport, padding));
	});

	it('stops zooming out at the minimum scale and starts at the top of a long fall', () => {
		// Hit dots 14 m down a straight fall, pieces near the release
		const all = { minX: -0.2, minY: -14, maxX: 0.2, maxY: 0.6 };
		const pieces = { minX: -0.05, minY: 0.2, maxX: 0.05, maxY: 0.6 };
		const view = fitContent(all, pieces, viewport, padding, 267);
		expect(view.scale).toBeCloseTo(267);
		expect(worldToScreen(view, viewport, { x: 0, y: 0.6 }).y).toBeCloseTo(50);
		const bottom = worldToScreen(view, viewport, { x: 0, y: 0.2 }).y;
		expect(bottom).toBeLessThanOrEqual(550);
	});

	it('zooms out past the minimum when the pieces need it, so none is cut off', () => {
		const all = { minX: -0.2, minY: -14, maxX: 0.2, maxY: 0.6 };
		const pieces = { minX: -0.1, minY: -5, maxX: 0.1, maxY: 0.6 };
		const view = fitContent(all, pieces, viewport, padding, 267);
		expect(view.scale).toBeCloseTo(500 / 5.6);
		expect(worldToScreen(view, viewport, { x: 0, y: 0.6 }).y).toBeGreaterThanOrEqual(50 - 1e-6);
		expect(worldToScreen(view, viewport, { x: 0, y: -5 }).y).toBeLessThanOrEqual(550 + 1e-6);
	});
});

describe('fitTargets', () => {
	function openHit(laneId: string, time: number, y: number, pieceEntityId: string | null = null): THitResult {
		return { laneId, hitId: `h${time}`, targetTime: time, pieceEntityId, dot: { x: 0, y }, velocity: null, actualTime: null, error: null, status: pieceEntityId == null ? 'open' : 'onTime' };
	}

	it('frames tapped hits only down to the first open dot, not the free fall after it', () => {
		const project = createProject();
		const laneId = project.music.lanes[0]?.id ?? '';
		const result = { hits: [openHit(laneId, 0.6, -0.3), openHit(laneId, 1.1, -2.2), openHit(laneId, 2.5, -14)], pieces: [], marbles: [] } as unknown as TSimulationResult;
		const { all } = fitTargets(project, result);
		expect(all.minY).toBeCloseTo(-0.3);
	});

	it('frames every placed hit and the next open dot after the last one', () => {
		const project = createProject();
		const laneId = project.music.lanes[0]?.id ?? '';
		const hits = [openHit(laneId, 0.5, -0.2, 'p1'), openHit(laneId, 1, -0.5), openHit(laneId, 1.5, -0.8, 'p3'), openHit(laneId, 2, -1.1), openHit(laneId, 3, -6)];
		const { all } = fitTargets(project, { hits, pieces: [], marbles: [] } as unknown as TSimulationResult);
		expect(all.minY).toBeCloseTo(-1.1);
	});

	it('never shrinks the pieces and dots to fit a release high above them, nor the fall to the film end', () => {
		// The review's tapped project: 6 placed hits ending at 0:03.6 of a 0:12 film, released 0.9 m above the first
		const project = createProject();
		const laneId = project.music.lanes[0]?.id ?? '';
		const hits = [0.6, 1.2, 1.8, 2.4, 3, 3.6].map((time, index) => openHit(laneId, time, -0.28 - index * 0.19, `p${index}`));
		const { all, pieces } = fitTargets(project, { hits, pieces: [], marbles: [] } as unknown as TSimulationResult);

		expect(all.maxY).toBeCloseTo(0.6);
		expect(all.minY).toBeCloseTo(-1.23);
		expect(pieces?.maxY).toBeCloseTo(-0.28);
	});
});

describe('pickTrack', () => {
	const track: TScreenTrack = { laneId: 'lane', points: [{ x: 100, y: 0 }, { x: 100, y: 200 }], times: [0, 1] };

	it('picks a trajectory about 12 px away, with the time along it', () => {
		const near = pickTrack({ x: 111, y: 50 }, [track]);
		expect(near?.kind).toBe('track');
		if (near?.kind === 'track') expect(near.time).toBeCloseTo(0.25);
		expect(pickTrack({ x: 114, y: 50 }, [track])).toBeNull();
	});
});

describe('nearestMoment', () => {
	it('returns the time of the closest sample', () => {
		const samples = [0, 1, 2, 3].map((time) => ({ time, position: { x: 0, y: -time } }));
		expect(nearestMoment(samples, { x: 0.1, y: -2.2 })).toBe(2);
		expect(nearestMoment([], { x: 0, y: 0 })).toBeNull();
	});
});

describe('placeBar', () => {
	const size = { width: 200, height: 36 };

	it('stays at the anchor when nothing is in the way', () => {
		expect(placeBar({ x: 400, y: 300 }, size, [], viewport)).toEqual({ left: 400, top: 300 });
	});

	it('moves below the ghosts it would cover', () => {
		const ghosts = [{ x: 380, y: 310, width: 60, height: 20 }, { x: 440, y: 350, width: 60, height: 20 }];
		const placed = placeBar({ x: 400, y: 300 }, size, ghosts, viewport);
		expect(placed).toEqual({ left: 400, top: 380 });
	});

	it('moves beside the ghosts when there is no room below', () => {
		const ghosts = [{ x: 380, y: 300, width: 60, height: 290 }];
		const placed = placeBar({ x: 400, y: 300 }, size, ghosts, viewport);
		expect(placed.left - size.width / 2).toBeGreaterThanOrEqual(440);
		expect(placed.top).toBe(300);
	});
});

describe('struckAt', () => {
	it('names the dots struck at a time and their pieces, for every marble of a chord', () => {
		const hit = (laneId: string, time: number, pieceEntityId: string | null): THitResult =>
			({ laneId, hitId: `h${time}`, targetTime: time, pieceEntityId, dot: { x: 0, y: -time }, velocity: null, actualTime: null, error: null, status: 'onTime' }) as THitResult;
		const hits = [hit('a', 1, 'p1'), hit('b', 1, null), hit('a', 1.5, 'p2')];

		expect(struckAt(hits, 1)).toEqual(['hit:a:h1', 'p1', 'hit:b:h1']);
		expect(struckAt(hits, 1.2)).toEqual([]);
	});
});
