import { beforeAll, describe, expect, it } from 'vitest';
import { applyProjectCommands, LANE_SPACING, type TEntity, type TProject } from '@/modules/project';
import {
	autoPlace,
	continueSuggestions,
	copyLinkedPiece,
	crossesOtherLanes,
	findLongGaps,
	mirrorPiece,
	nextOpenHit,
	openLongGaps,
	repeatPiece,
	type TSimulateFn
} from './assists';
import { resolvedPieceShapes, shapesGap } from './clearance';
import { createBareRunProject } from './fixture-projects';
import { createRailForGap, createSwitchbackForGap } from './gap-pieces';
import { paceAt } from './pace';
import { createLinkedPiece, frameBand } from './placement';
import { createSimulator } from './simulate';
import type { TContact, THitResult, TSimulationResult } from './types';

let simulate: TSimulateFn;

beforeAll(async () => {
	const simulator = await createSimulator();
	simulate = (project) => simulator.simulate(project);
});

// Tilt of the hand placed zigzag start for the default kit. Steeper starts crowd its 9 cm bars at 0.3 s.
const TILT = 0.25;
const CONTINUE_TILT = 0.45;

function zigzagStart(hitTimes: number[], tilt = TILT, gravityScale = 1): TProject {
	const project = createBareRunProject({
		gravityScale,
		id: 'assists',
		title: 'Assists',
		end: 4,
		marbles: [{ x: 0, y: 0.6, releaseTime: 0, hitTimes }]
	});
	project.entities.push(
		createLinkedPiece('platform', 'lane-1', 'hit-1-1', -tilt, { id: 'piece-1-1' }),
		createLinkedPiece('platform', 'lane-1', 'hit-1-2', tilt, { id: 'piece-1-2' })
	);
	return project;
}

function evenTimes(count: number, gap = 0.3, start = 0.15): number[] {
	return Array.from({ length: count }, (_, i) => Math.round((start + gap * i) * 1000) / 1000);
}

/**
 * Two marbles in their lanes at half gravity, released 0.5 s before their first hits, with the first
 * `placed` hits of lane 1 auto placed. Lane 2 plays quarter notes and has no pieces yet.
 */
function halfGravityRun(hitTimes: number[], placed: number): TProject {
	const end = (hitTimes.at(-1) ?? 0) + 1;
	let project = createBareRunProject({
		gravityScale: 0.5,
		id: 'half',
		title: 'Half gravity',
		end,
		marbles: [
			{ x: -LANE_SPACING / 2, y: 0.6, releaseTime: (hitTimes[0] ?? 0.5) - 0.5, hitTimes },
			{ x: LANE_SPACING / 2, y: 0.6, releaseTime: 0.5, hitTimes: evenTimes(Math.floor(end / 0.5) - 1, 0.5, 1) }
		]
	});
	for (const hit of project.music.lanes[0]?.hits.slice(0, placed) ?? []) {
		const [isPlacedOk, placedErr, piece] = autoPlace(project, simulate(project), 'lane-1', hit.id, {
			simulate,
			id: hit.id.replace('hit', 'piece')
		});
		if (!isPlacedOk) throw new Error(`${hit.id}: ${placedErr.message}`);
		project = { ...project, entities: [...project.entities, piece.entity] };
	}
	return project;
}

// Shorter than a platform plus its clearance, so a step this short would put two pieces side by side
const MIN_TRAVEL = 0.06;
const MIN_GAP = 0.003;

/** Auto places every open hit of lane 1 in order, as repeated Next presses do */
function autoPlaceAll(start: TProject): { project: TProject; travels: number[] } {
	let project = start;
	const travels: number[] = [];
	const lane = project.music.lanes[0];
	for (const hit of lane?.hits ?? []) {
		if (project.entities.some((entity) => entity.components.hitLink?.hitId === hit.id)) continue;
		const [isPlacedOk, placedErr, placed] = autoPlace(
			project,
			simulate(project),
			'lane-1',
			hit.id,
			{
				simulate,
				id: hit.id.replace('hit', 'auto')
			}
		);
		if (!isPlacedOk) throw new Error(`${hit.id}: ${placedErr.message}`);
		travels.push(placed.travel);
		const [isAppliedOk, appliedErr, applied] = applyProjectCommands(project, placed.commands);
		if (!isAppliedOk) throw appliedErr;
		project = applied;
	}
	return { project, travels };
}

/** `chosenFrom` is the index of the first dot an Auto placed piece chose */
function expectClearRun(project: TProject, travels: number[], chosenFrom = 0): void {
	const result = simulate(project);
	expect(result.hits.every((hit) => hit.status === 'onTime')).toBe(true);
	for (const travel of travels) expect(Math.abs(travel)).toBeGreaterThanOrEqual(MIN_TRAVEL);
	// Dots of consecutive hits are apart sideways, so the marble never bounces in place
	result.hits.slice(1).forEach((hit, i) => {
		const previous = result.hits[i]?.dot?.x ?? 0;
		expect(Math.abs((hit.dot?.x ?? previous) - previous), hit.hitId).toBeGreaterThanOrEqual(
			MIN_TRAVEL
		);
	});
	const band = frameBand(project);
	for (const hit of result.hits.slice(chosenFrom))
		expect(Math.abs((hit.dot?.x ?? Infinity) - band.centerX)).toBeLessThanOrEqual(band.halfWidth);
	result.pieces.forEach((piece, i) => {
		for (const other of result.pieces.slice(i + 1))
			expect(
				shapesGap(resolvedPieceShapes(piece), resolvedPieceShapes(other)),
				`${piece.entityId} and ${other.entityId}`
			).toBeGreaterThanOrEqual(MIN_GAP);
	});
}

describe('assists', () => {
	it('finds the next open hit after the last piece', () => {
		const project = zigzagStart(evenTimes(4));
		const open = nextOpenHit(project, simulate(project), 'lane-1');
		expect(open?.hit.id).toBe('hit-1-3');
		expect(open?.previous?.entity.id).toBe('piece-1-2');
		expect(open?.result?.status).toBe('open');
	});

	it('repeats and mirrors the previous piece', () => {
		const project = zigzagStart(evenTimes(4));
		const result = simulate(project);
		const [isRepeatOk, , repeated] = repeatPiece(project, result, 'lane-1', { id: 'r' });
		expect(isRepeatOk).toBe(true);
		expect(repeated?.hitId).toBe('hit-1-3');
		expect(repeated?.entity.components.hitLink?.angle).toBe(TILT);
		const [isMirrorOk, , mirrored] = mirrorPiece(project, result, 'lane-1', { id: 'm' });
		expect(isMirrorOk).toBe(true);
		expect(mirrored?.entity.components.hitLink).toMatchObject({ hitId: 'hit-1-3', angle: -TILT });
		expect(mirrored?.commands).toEqual([{ type: 'upsertEntity', entity: mirrored?.entity }]);

		const empty = createBareRunProject({
		gravityScale: 1,
			id: 'empty',
			title: 'Empty',
			end: 1,
			marbles: [{ x: 0, y: 0.6, releaseTime: 0, hitTimes: [0.3] }]
		});
		const [isEmptyOk, emptyErr] = repeatPiece(empty, null, 'lane-1');
		expect(isEmptyOk).toBe(false);
		expect(emptyErr?.message).toMatch(/no earlier piece/);
	});

	it('mirrors each piece type across the vertical axis', () => {
		const platform = createLinkedPiece('platform', 'lane-1', 'a', 0.2, { id: 'p' });
		if (platform.components.hitLink != null) platform.components.hitLink.contactAt = 0.3;
		expect(copyLinkedPiece(platform, 'b', true).components.hitLink).toMatchObject({
			angle: -0.2,
			contactAt: 0.7
		});
		const windmill = createLinkedPiece('windmill', 'lane-1', 'a', 0.2, { id: 'w' });
		expect(copyLinkedPiece(windmill, 'b', true).components.hitLink?.angle).toBeCloseTo(
			Math.PI - 0.2,
			12
		);
		const rail: TEntity = {
			...createLinkedPiece('rail', 'lane-1', 'a', 0.1, { id: 'r' }),
			components: {
				...createLinkedPiece('rail', 'lane-1', 'a', 0.1, { id: 'r' }).components,
				path: {
					points: [
						{ x: 0, y: 0 },
						{ x: 0.1, y: -0.02 }
					]
				}
			}
		};
		const mirroredRail = copyLinkedPiece(rail, 'b', true);
		expect(mirroredRail.components.path?.points).toEqual([
			{ x: -0, y: 0 },
			{ x: -0.1, y: -0.02 }
		]);
		expect(mirroredRail.components.hitLink?.angle).toBe(-0.1);
	});

	it('auto places deterministically with the next dot in frame', () => {
		const project = zigzagStart(evenTimes(4));
		const result = simulate(project);
		const [isPlacedOk, placedErr, placed] = autoPlace(project, result, 'lane-1', 'hit-1-3', {
			simulate,
			id: 'auto'
		});
		if (!isPlacedOk) throw placedErr;
		const [, , again] = autoPlace(project, result, 'lane-1', 'hit-1-3', { simulate, id: 'auto' });
		expect(again?.angle).toBe(placed.angle);
		expect(Math.abs(placed.angle)).toBeLessThanOrEqual((40 * Math.PI) / 180 + 1e-9);
		const band = frameBand(project);
		expect(Math.abs((placed.nextDot?.x ?? Infinity) - band.centerX)).toBeLessThanOrEqual(
			band.halfWidth * 0.9
		);
		const placedProject = { ...project, entities: [...project.entities, placed.entity] };
		const after = simulate(placedProject);
		expect(after.hits[2]?.status).toBe('onTime');
		expect(after.hits[3]?.dot).toEqual(placed.nextDot);
	});

	it('auto places a bare run with sideways travel and clear pieces up to the last hit', () => {
		for (const gap of [0.2, 0.3, 0.45]) {
			const bare = createBareRunProject({
		gravityScale: 1,
				id: 'bare',
				title: 'Bare',
				end: 4,
				marbles: [{ x: 0, y: 0.6, releaseTime: 0, hitTimes: evenTimes(8, gap, 0.3) }]
			});
			const { project, travels } = autoPlaceAll(bare);
			expect(travels).toHaveLength(8);
			expectClearRun(project, travels);
		}
	}, 20_000);

	it('auto places a zigzag that keeps alternating', () => {
		const { project, travels } = autoPlaceAll(zigzagStart(evenTimes(8)));
		expectClearRun(project, travels);
		travels.slice(1).forEach((travel, i) => expect(Math.sign(travel)).toBe(-Math.sign(travels[i] ?? 0)));
	});

	it('auto places after a staircase start without bouncing in place', () => {
		const project = zigzagStart(evenTimes(8));
		for (const entity of project.entities)
			if (entity.components.hitLink != null) entity.components.hitLink.angle = -0.2;
		// The two hand placed pieces send the third dot out of frame; Auto place brings the marble back
		const placed = autoPlaceAll(project);
		expectClearRun(placed.project, placed.travels, 3);
	});

	it('auto places the hit before a long gap with a sideways launch', () => {
		const project = zigzagStart([0.15, 0.45, 0.75, 2.25]);
		const result = simulate(project);
		const [isPlacedOk, placedErr, placed] = autoPlace(project, result, 'lane-1', 'hit-1-3', {
			simulate,
			id: 'launch'
		});
		if (!isPlacedOk) throw placedErr;
		expect(placed.nextDot).toBeNull();
		expect(Math.abs(placed.travel)).toBeGreaterThanOrEqual(MIN_TRAVEL);
		const after = simulate({ ...project, entities: [...project.entities, placed.entity] });
		expect(after.hits[2]?.status).toBe('onTime');
	});

	it('continues a mirrored pattern while the rhythm repeats', () => {
		// The eighth interval is 0.1 s longer, so Continue stops before it
		const times = evenTimes(10).map((time, i) => (i >= 7 ? time + 0.1 : time));
		// Continue copies the default bounce, which mirrors cleanly from a steeper start
		const project = zigzagStart(times, CONTINUE_TILT);
		const continued = continueSuggestions(project, simulate(project), 'lane-1', {
			simulate,
			idFor: (hitId) => `ghost-${hitId}`
		});
		expect(continued?.pattern).toBe('mirror');
		const suggestions = continued?.suggestions ?? [];
		expect(suggestions.map((s) => s.hitId)).toEqual([
			'hit-1-3',
			'hit-1-4',
			'hit-1-5',
			'hit-1-6',
			'hit-1-7'
		]);
		expect(
			suggestions.every((s) => s.isOk && s.status === 'onTime' && s.piece?.status === 'placed')
		).toBe(true);
		expect(suggestions.map((s) => s.entity.components.hitLink?.angle)).toEqual([
			-CONTINUE_TILT, CONTINUE_TILT, -CONTINUE_TILT, CONTINUE_TILT, -CONTINUE_TILT
		]);
		expect(continued?.commands).toHaveLength(5);
	});

	it('stops Continue at the first ghost that leaves the frame', () => {
		const project = createBareRunProject({
		gravityScale: 1,
			id: 'drift',
			title: 'Drift',
			end: 4,
			marbles: [{ x: 0, y: 0.6, releaseTime: 0, hitTimes: evenTimes(10) }]
		});
		project.entities.push(
			createLinkedPiece('platform', 'lane-1', 'hit-1-1', -0.2, { id: 'piece-1-1' }),
			createLinkedPiece('platform', 'lane-1', 'hit-1-2', -0.2, { id: 'piece-1-2' })
		);
		const continued = continueSuggestions(project, simulate(project), 'lane-1', { simulate });
		expect(continued?.pattern).toBe('repeat');
		const suggestions = continued?.suggestions ?? [];
		const last = suggestions[suggestions.length - 1];
		expect(last?.isOk).toBe(false);
		expect(suggestions.slice(0, -1).every((s) => s.isOk)).toBe(true);
		expect(continued?.commands).toHaveLength(suggestions.length - 1);
	});

	it('finds long gaps and bridges one with a rail', () => {
		const project = zigzagStart([0.15, 0.45, 0.75, 2.25]);
		project.entities.push(
			createLinkedPiece('platform', 'lane-1', 'hit-1-3', -TILT, { id: 'piece-1-3' })
		);
		expect(findLongGaps(project, 'lane-1')).toEqual([
			{
				laneId: 'lane-1',
				fromHitId: 'hit-1-3',
				toHitId: 'hit-1-4',
				from: 0.75,
				to: 2.25,
				duration: 1.5,
				bridgedBy: null
			}
		]);
		expect(findLongGaps(project, 'lane-1', 2)).toEqual([]);

		const result = simulate(project);
		const [isRailOk, railErr, rail] = createRailForGap(
			project,
			result,
			'lane-1',
			'hit-1-3',
			'hit-1-4',
			{
				simulate,
				id: 'rail'
			}
		);
		if (!isRailOk) throw railErr;
		expect(rail.entity.components.piece?.params['entryDelay']).toBeGreaterThan(0);
		expect(rail.check?.pieceStatus).toBe('placed');
		expect(rail.check?.isRunInFrame).toBe(true);
		expect(rail.check?.isDotInFrame).toBe(true);
		const bridged = { ...project, entities: [...project.entities, rail.entity] };
		expect(findLongGaps(bridged, 'lane-1')[0]?.bridgedBy).toBe('rail');
		// The rail follows hit 3 and does not take over its result
		const after = simulate(bridged);
		expect(after.hits[2]?.pieceEntityId).toBe('piece-1-3');
		expect(after.hits[2]?.status).toBe('onTime');

		const [isBadOk, badErr] = createRailForGap(project, result, 'lane-1', 'hit-1-4', 'hit-1-3');
		expect(isBadOk).toBe(false);
		expect(badErr?.message).toMatch(/end after/);
	}, 20_000);

	it('holds the marble across a long gap in a switchback near the pace', () => {
		let project = zigzagStart([0.15, 0.45, 0.75, 2.25, 2.55]);
		const [isLaunchOk, launchErr, launch] = autoPlace(project, simulate(project), 'lane-1', 'hit-1-3', {
			simulate,
			id: 'piece-1-3'
		});
		if (!isLaunchOk) throw launchErr;
		project = { ...project, entities: [...project.entities, launch.entity] };
		expect(openLongGaps(project, 'lane-1').map((gap) => gap.toHitId)).toEqual(['hit-1-4']);
		const result = simulate(project);
		const [isHeldOk, heldErr, held] = createSwitchbackForGap(project, result, 'lane-1', 'hit-1-3', 'hit-1-4', {
			simulate,
			id: 'switchback'
		});
		if (!isHeldOk) throw heldErr;
		expect(held.entity.components.piece?.type).toBe('switchback');
		expect(held.entity.components.piece?.params['entryDelay']).toBeGreaterThan(0);
		expect(held.check).toMatchObject({ pieceStatus: 'placed', isDotInFrame: true, isRunInFrame: true });
		// The marble drops out below the switchback before the next hit, close to the pace
		expect(held.check?.leaveTime).toBeLessThan(2.25);
		expect(Math.abs(held.check?.paceError ?? Infinity)).toBeLessThan(0.25);
		const bridged = { ...project, entities: [...project.entities, held.entity] };
		expect(findLongGaps(bridged, 'lane-1')[0]?.bridgedBy).toBe('switchback');
		expect(openLongGaps(bridged, 'lane-1')).toEqual([]);
		const after = simulate(bridged);
		expect(after.hits[2]?.status).toBe('onTime');
		const dot = after.hits[3]?.dot;
		const pace = after.pace;
		if (dot == null || pace == null) throw new Error('No dot after the gap');
		expect(Math.abs(dot.y - paceAt(pace, 2.25))).toBeLessThan(0.25);
		// Same result each time, and mirroring flips the first leg's direction
		const [, , again] = createSwitchbackForGap(project, result, 'lane-1', 'hit-1-3', 'hit-1-4', { simulate, id: 'switchback' });
		expect(again?.entity).toEqual(held.entity);
		const mirrored = copyLinkedPiece(held.entity, 'hit-1-3', true);
		expect(mirrored.components.hitLink?.angle).toBe(-(held.entity.components.hitLink?.angle ?? 0));
		expect(mirrored.components.hitLink?.contactAt).toBe(held.entity.components.hitLink?.contactAt);
	}, 20000);

	it('launches at half gravity with a hop that stays in its lane until it falls back', () => {
		// The hop rises as high as at full gravity but stays in the air √2 times as long, about 0.35 s
		const project = halfGravityRun([1, 1.5, 2, 4], 2);
		const [isPlacedOk, placedErr, placed] = autoPlace(project, simulate(project), 'lane-1', 'hit-1-3', {
			simulate,
			id: 'launch'
		});
		if (!isPlacedOk) throw placedErr;
		const after = simulate({ ...project, entities: [...project.entities, placed.entity] });
		expect(after.hits[2]?.status).toBe('onTime');
		const dot = after.hits[2]?.dot;
		if (dot == null) throw new Error('No launch dot');
		const band = frameBand(project, 'lane-1');
		const hop = after.marbles[0]?.samples.filter((sample) => sample.time > 2 && sample.time < 2.5) ?? [];
		expect(hop.some((sample) => sample.position.y < dot.y)).toBe(true);
		for (const sample of hop)
			expect(Math.abs(sample.position.x - band.centerX), sample.time.toFixed(3)).toBeLessThanOrEqual(band.halfWidth);
		expect(after.contacts.filter((contact) => contact.otherEntityId === 'launch' && contact.time > 2.05 && contact.time < 2.5)).toEqual([]);
	});

	it('holds the marble across a 2 s gap at half gravity in a switchback near the pace', () => {
		let project = halfGravityRun([1, 1.5, 2, 4, 4.5], 2);
		const [isLaunchOk, launchErr, launch] = autoPlace(project, simulate(project), 'lane-1', 'hit-1-3', {
			simulate,
			id: 'piece-1-3'
		});
		if (!isLaunchOk) throw launchErr;
		project = { ...project, entities: [...project.entities, launch.entity] };
		const [isHeldOk, heldErr, held] = createSwitchbackForGap(project, simulate(project), 'lane-1', 'hit-1-3', 'hit-1-4', {
			simulate,
			id: 'switchback'
		});
		if (!isHeldOk) throw heldErr;
		expect(held.check).toMatchObject({ pieceStatus: 'placed', isDotInFrame: true });
		expect(held.check?.leaveTime).toBeLessThan(4);
		expect(Math.abs(held.check?.paceError ?? Infinity)).toBeLessThan(0.25);
	}, 20000);

	it('stops Continue before the hit ahead of a launch into a long gap', () => {
		// hit-1-5 launches into the gap, and hit-1-4's piece sets how firmly it is struck
		const project = zigzagStart([0.15, 0.45, 0.75, 1.05, 1.35, 2.85]);
		const continued = continueSuggestions(project, simulate(project), 'lane-1', {
			simulate,
			idFor: (hitId) => `ghost-${hitId}`
		});
		expect(continued?.suggestions.map((s) => s.hitId)).toEqual(['hit-1-3']);
	});

	it('auto places the first strikes of two marbles with different rhythms on one descent pace', () => {
		let project = createBareRunProject({
		gravityScale: 1,
			id: 'duet',
			title: 'Duet',
			end: 3,
			marbles: [
				{ x: -LANE_SPACING / 2, y: 0.6, releaseTime: 0, hitTimes: evenTimes(9, 0.25, 1) },
				{ x: LANE_SPACING / 2, y: 0.6, releaseTime: 0, hitTimes: evenTimes(5, 0.5, 1) }
			]
		});
		// Both marbles arrive at 4.9 m/s after the first fall; the pace bounce sends each to its next dot
		const nextDots: { laneId: string; hitId: string }[] = [];
		for (const laneId of ['lane-1', 'lane-2']) {
			const hitId = laneId === 'lane-1' ? 'hit-1-1' : 'hit-2-1';
			const [isPlacedOk, placedErr, placed] = autoPlace(project, simulate(project), laneId, hitId, {
				simulate,
				id: hitId.replace('hit', 'piece')
			});
			if (!isPlacedOk) throw new Error(`${hitId}: ${placedErr.message}`);
			const [isAppliedOk, appliedErr, applied] = applyProjectCommands(project, placed.commands);
			if (!isAppliedOk) throw appliedErr;
			project = applied;
			nextDots.push({ laneId, hitId: hitId.replace(/1$/, '2') });
		}
		const result = simulate(project);
		const pace = result.pace;
		if (pace == null) throw new Error('No pace');
		for (const { laneId, hitId } of nextDots) {
			const hit = result.hits.find((item) => item.hitId === hitId);
			expect(Math.abs((hit?.dot?.y ?? Infinity) - paceAt(pace, hit?.targetTime ?? 0)), hitId).toBeLessThanOrEqual(pace.limit);
			const band = frameBand(project, laneId);
			expect(Math.abs((hit?.dot?.x ?? Infinity) - band.centerX), hitId).toBeLessThanOrEqual(band.halfWidth);
		}
		expect(result.hits.filter((hit) => hit.pieceEntityId != null).every((hit) => hit.status === 'onTime')).toBe(true);
		expect(result.contacts.filter((contact) => contact.kind === 'marble' && contact.time < 1.5)).toHaveLength(0);
	});
});

describe('crossesOtherLanes', () => {
	// Two lanes with a piece each; the new piece `piece-1-2` belongs to lane 1, the other marble's frontier is 2 s
	const project = createBareRunProject({
		id: 'cross',
		title: 'Cross',
		end: 4,
		marbles: [
			{ x: -0.1, y: 0.6, releaseTime: 0, hitTimes: [0.5, 1] },
			{ x: 0.1, y: 0.6, releaseTime: 0, hitTimes: [0.5, 1, 3] }
		]
	});
	project.entities.push(
		createLinkedPiece('platform', 'lane-1', 'hit-1-1', 0, { id: 'piece-1-1' }),
		createLinkedPiece('switchback', 'lane-2', 'hit-2-1', 0, { id: 'switchback-2-1' }),
		createLinkedPiece('platform', 'lane-2', 'hit-2-2', 0, { id: 'piece-2-2' })
	);
	const frontiers = new Map([['marble-2', 2]]);
	const hit = (laneId: string, hitId: string, targetTime: number, status: THitResult['status']): THitResult => ({
		laneId,
		hitId,
		targetTime,
		pieceEntityId: null,
		dot: null,
		velocity: null,
		actualTime: null,
		error: null,
		status
	});
	const onTime = [hit('lane-2', 'hit-2-2', 1, 'onTime'), hit('lane-2', 'hit-2-3', 3, 'onTime')];
	const run = (contacts: Partial<TContact>[], hits = onTime): TSimulationResult => ({
		revision: 0,
		duration: 4,
		marbles: [],
		pieces: [],
		contacts: contacts.map((contact) => ({ time: 0.8, marbleEntityId: 'marble-1', otherEntityId: '', kind: 'piece', position: { x: 0, y: 0 }, ...contact })),
		hits,
		stats: { computeMs: 0, reusedUntil: 0, steps: 0 }
	});
	const crosses = (trial: TSimulationResult): boolean =>
		crossesOtherLanes(run([]), trial, project, 'lane-1', 'piece-1-2', 0.5, 3.5, frontiers);

	it('should let the marble strike its own lane and free pieces', () => {
		expect(crosses(run([{ otherEntityId: 'piece-1-1' }, { otherEntityId: 'free-piece' }]))).toBe(false);
	});

	it("should refuse another lane's platforms and gap pieces and the other marble", () => {
		expect(crosses(run([{ otherEntityId: 'piece-2-2' }]))).toBe(true);
		expect(crosses(run([{ otherEntityId: 'switchback-2-1' }]))).toBe(true);
		expect(crosses(run([{ otherEntityId: 'marble-2', kind: 'marble' }]))).toBe(true);
	});

	it('should refuse the other marble striking the new piece before its frontier only', () => {
		expect(crosses(run([{ marbleEntityId: 'marble-2', otherEntityId: 'piece-1-2', time: 1.5 }]))).toBe(true);
		expect(crosses(run([{ marbleEntityId: 'marble-2', otherEntityId: 'piece-1-2', time: 2.5 }]))).toBe(false);
		expect(crosses(run([{ otherEntityId: 'marble-2', kind: 'marble', time: 2.5 }]))).toBe(false);
	});

	it("should refuse a piece that breaks another lane's built hits, not its unbuilt ones", () => {
		expect(crosses(run([], [hit('lane-2', 'hit-2-2', 1, 'missed'), onTime[1] as THitResult]))).toBe(true);
		expect(crosses(run([], [onTime[0] as THitResult, hit('lane-2', 'hit-2-3', 3, 'missed')]))).toBe(false);
	});
});
