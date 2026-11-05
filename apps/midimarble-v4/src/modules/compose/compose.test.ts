import { describe, expect, it } from 'vitest';
import { createLinkedPiece, type THitResult, type TSimulationResult } from '@/modules/simulation';
import { createProject } from '@/modules/project';
import { dragRotation, formatDegrees, normalizeSurfaceAngle, parseDegrees, snapAngle, toDegrees, toRadians } from './angles';
import { pick, piecesInRect, type TPickScene } from './picking';
import { marblePositionAt, rotationGrip } from './scene';
import { findStepTarget, stepAngle } from './step-loop';
import { fitBounds, popoverFrame, screenToWorld, worldToScreen, zoomAt } from './view';

const viewport = { width: 800, height: 600 };

describe('view', () => {
	it('maps world and screen points both ways', () => {
		const view = { center: { x: 0.1, y: 0.5 }, scale: 1000 };
		expect(worldToScreen(view, viewport, { x: 0.1, y: 0.5 })).toEqual({ x: 400, y: 300 });
		const moved = worldToScreen(view, viewport, { x: 0.2, y: 0.6 });
		expect(moved.x).toBeCloseTo(500);
		expect(moved.y).toBeCloseTo(200);
		const back = screenToWorld(view, viewport, { x: 123, y: 456 });
		const again = worldToScreen(view, viewport, back);
		expect(again.x).toBeCloseTo(123);
		expect(again.y).toBeCloseTo(456);
	});

	it('zooms around the anchor without moving the point under it', () => {
		const view = { center: { x: 0, y: 0 }, scale: 500 };
		const anchor = { x: 650, y: 120 };
		const before = screenToWorld(view, viewport, anchor);
		const zoomed = zoomAt(view, viewport, anchor, 2.5);
		const after = screenToWorld(zoomed, viewport, anchor);
		expect(zoomed.scale).toBe(1250);
		expect(after.x).toBeCloseTo(before.x, 9);
		expect(after.y).toBeCloseTo(before.y, 9);
	});

	it('fits bounds inside the padded viewport', () => {
		const view = fitBounds({ minX: -0.2, minY: 0, maxX: 0.2, maxY: 1 }, viewport, { top: 50, right: 50, bottom: 50, left: 50 });
		expect(view.scale).toBeCloseTo(500);
		const top = worldToScreen(view, viewport, { x: 0, y: 1 });
		const bottom = worldToScreen(view, viewport, { x: 0, y: 0 });
		expect(top.y).toBeCloseTo(50);
		expect(bottom.y).toBeCloseTo(550);
	});
});

describe('angles', () => {
	it('snaps to 5° steps', () => {
		expect(toDegrees(snapAngle(toRadians(13), 5))).toBeCloseTo(15);
		expect(toDegrees(snapAngle(toRadians(-12.4), 5))).toBeCloseTo(-10);
	});

	it('folds surface angles into one half turn', () => {
		expect(toDegrees(normalizeSurfaceAngle(toRadians(170)))).toBeCloseTo(-10);
		expect(toDegrees(normalizeSurfaceAngle(toRadians(-95)))).toBeCloseTo(85);
		expect(toDegrees(normalizeSurfaceAngle(toRadians(90)))).toBeCloseTo(90);
	});

	it('formats and parses degrees', () => {
		expect(formatDegrees(toRadians(15))).toBe('15°');
		expect(formatDegrees(toRadians(-7.34))).toBe('-7.3°');
		expect(formatDegrees(toRadians(-0.01))).toBe('0°');
		expect(parseDegrees('12.5°')).toBeCloseTo(toRadians(12.5));
		expect(parseDegrees('-3,5')).toBeCloseTo(toRadians(-3.5));
		expect(parseDegrees('abc')).toBeNull();
	});

	it('rotates by the pointer delta around the pivot, with optional snapping', () => {
		const pivot = { x: 100, y: 100 };
		// Pointer starts to the right of the pivot and moves straight up: +90° on screen is counter-clockwise
		const drag = { startAngle: toRadians(10), startPointer: 0 };
		expect(toDegrees(dragRotation(drag, pivot, { x: 100, y: 50 }, false))).toBeCloseTo(100);
		expect(toDegrees(dragRotation(drag, pivot, { x: 200, y: 90 }, true))).toBeCloseTo(15);
	});
});

describe('picking', () => {
	const scene: TPickScene = {
		handles: [{ kind: 'rotate', entityId: 'a', position: { x: 300, y: 100 }, radius: 6 }],
		dots: [
			{ laneId: 'l', hitId: 'h1', position: { x: 100, y: 100 } },
			{ laneId: 'l', hitId: 'h2', position: { x: 108, y: 100 } }
		],
		pieces: [
			{
				entityId: 'a',
				corners: [
					{ x: 200, y: 95 },
					{ x: 290, y: 95 },
					{ x: 290, y: 105 },
					{ x: 200, y: 105 }
				]
			}
		]
	};

	it('prefers handles, then the nearest dot, then pieces', () => {
		expect(pick({ x: 303, y: 102 }, scene)).toEqual({ kind: 'rotate', entityId: 'a' });
		expect(pick({ x: 106, y: 101 }, scene)).toEqual({ kind: 'dot', laneId: 'l', hitId: 'h2' });
		expect(pick({ x: 250, y: 100 }, scene)).toEqual({ kind: 'piece', entityId: 'a' });
		// Thin pieces stay clickable a few pixels outside their outline
		expect(pick({ x: 250, y: 108 }, scene)).toEqual({ kind: 'piece', entityId: 'a' });
		expect(pick({ x: 500, y: 500 }, scene)).toBeNull();
	});

	it('selects pieces the marquee touches', () => {
		expect(piecesInRect({ x: 280, y: 0, width: 50, height: 200 }, scene.pieces)).toEqual(['a']);
		expect(piecesInRect({ x: 220, y: 90, width: 10, height: 30 }, scene.pieces)).toEqual(['a']);
		expect(piecesInRect({ x: 0, y: 0, width: 50, height: 50 }, scene.pieces)).toEqual([]);
	});
});

describe('picking a Rail', () => {
	const rail = { entityId: 'rail', corners: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }], lines: [[{ x: 0, y: 0 }, { x: 100, y: 0 }]] };
	const platform = { entityId: 'platform', corners: [{ x: 40, y: 45 }, { x: 60, y: 45 }, { x: 60, y: 55 }, { x: 40, y: 55 }] };

	it('takes only its path, so its empty box leaves the click to what lies inside', () => {
		expect(pick({ x: 50, y: 50 }, { handles: [], dots: [], pieces: [platform, rail] })).toEqual({ kind: 'piece', entityId: 'platform' });
		expect(pick({ x: 20, y: 60 }, { handles: [], dots: [], pieces: [platform, rail] })).toBeNull();
		expect(pick({ x: 20, y: 2 }, { handles: [], dots: [], pieces: [platform, rail] })).toEqual({ kind: 'piece', entityId: 'rail' });
	});

	it('lets the selected piece win over one on top of it', () => {
		const below = { entityId: 'below', corners: platform.corners, isSelected: true };
		expect(pick({ x: 50, y: 50 }, { handles: [], dots: [], pieces: [below, platform] })).toEqual({ kind: 'piece', entityId: 'below' });
	});
});

describe('scene', () => {
	it('interpolates the marble between samples and waits at the release before', () => {
		const track = {
			entityId: 'm',
			laneId: 'l',
			radius: 0.008,
			samples: [0, 1, 2].map((index) => ({
				time: index / 240,
				position: { x: index, y: -index },
				angle: 0,
				velocity: { x: 0, y: 0 }
			}))
		};
		const release = { x: 9, y: 9 };
		expect(marblePositionAt(track, -1, release)).toEqual(release);
		expect(marblePositionAt(track, 1.5 / 240, release)).toEqual({ x: 1.5, y: -1.5 });
		expect(marblePositionAt(track, 1, release)).toEqual({ x: 2, y: -2 });
	});

	it('puts the rotation grip at the far end of the bar from the hit point', () => {
		const piece = {
			entityId: 'p',
			type: 'platform',
			position: { x: 0, y: 0 },
			angle: 0,
			params: { length: 0.1, thickness: 0.01, depth: 0.03 },
			contactPoint: { x: 0.02, y: 0.005 },
			contactNormal: { x: 0, y: 1 },
			hitTime: 1,
			status: 'placed' as const
		};
		const { pivot, grip } = rotationGrip(piece);
		expect(pivot).toEqual({ x: 0.02, y: 0.005 });
		expect(grip.x).toBeCloseTo(0.05);
		expect(grip.y).toBeCloseTo(0.005);
	});
});

describe('step loop', () => {
	const project = createProject();
	const lane = project.music.lanes[0];
	if (lane == null) throw new Error('missing lane');
	lane.hits = [0.4, 0.8, 1.2].map((time, index) => ({ id: `h${index + 1}`, time }));
	const placed = createLinkedPiece('platform', lane.id, 'h1', 0.3, { id: 'p1' });
	project.entities.push(placed);

	const hit = (hitId: string, time: number, status: THitResult['status']): THitResult => ({
		laneId: lane.id,
		hitId,
		targetTime: time,
		pieceEntityId: status === 'open' ? null : 'p1',
		dot: { x: 0, y: -time },
		velocity: { x: 0, y: -1 },
		actualTime: null,
		error: null,
		status
	});
	const result: TSimulationResult = {
		revision: 0,
		duration: 2,
		marbles: [],
		pieces: [],
		contacts: [],
		hits: [hit('h3', 1.2, 'open'), hit('h1', 0.4, 'onTime'), hit('h2', 0.8, 'open')],
		stats: { computeMs: 0, reusedUntil: 0, steps: 0 }
	};

	it('targets the focused dot, else the next open dot after the selected piece', () => {
		expect(findStepTarget(project, result, [`hit:${lane.id}:h3`])?.hitId).toBe('h3');
		expect(findStepTarget(project, result, ['p1'])?.hitId).toBe('h2');
		expect(findStepTarget(project, result, [])?.hitId).toBe('h2');
	});

	it('goes back to the earliest open dot from a hit after it', () => {
		const later: TSimulationResult = { ...result, hits: [hit('h1', 0.4, 'open'), hit('h2', 0.8, 'onTime'), hit('h3', 1.2, 'onTime')] };
		expect(findStepTarget(project, later, [`hit:${lane.id}:h3`])?.hitId).toBe('h1');
	});

	it('repeats and mirrors the previous piece angle', () => {
		const next = result.hits.find((item) => item.hitId === 'h2');
		if (next == null) throw new Error('missing hit');
		expect(stepAngle(project, next, 'repeat')).toBeCloseTo(0.3);
		expect(stepAngle(project, next, 'mirror')).toBeCloseTo(-0.3);
		expect(Math.abs(stepAngle(project, next, 'default'))).toBeCloseTo(toRadians(15));
	});
});

describe('popoverFrame function', () => {
	const canvas = { left: 300, right: 1100, top: 40, bottom: 600 };

	it('should sit against the canvas edge beside its control, inside the canvas', () => {
		expect(popoverFrame({ top: 200 }, canvas, { width: 304, height: 200 }, 'start')).toEqual({ left: 308, top: 188, maxHeight: 544 });
		expect(popoverFrame({ top: 200 }, canvas, { width: 304, height: 200 }, 'end').left).toBe(788);
	});

	it('should move up to fit, and scroll what is taller than the canvas', () => {
		expect(popoverFrame({ top: 560 }, canvas, { width: 304, height: 300 }, 'end').top).toBe(292);
		expect(popoverFrame({ top: 560 }, canvas, { width: 304, height: 2000 }, 'end')).toMatchObject({ top: 48, maxHeight: 544 });
	});
});
