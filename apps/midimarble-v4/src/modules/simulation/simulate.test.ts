import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { createLane, parseProject, type TEntity, type TProject } from '@/modules/project';
import { createStaircaseProject } from './fixture-projects';
import { createLinkedPiece } from './placement';
import { createSimulator, type TSimulator } from './simulate';
import { HIT_DRIFT, type TSimulationResult } from './types';

function loadFixture(name: string): TProject {
	const json = readFileSync(new URL(`../../../fixtures/${name}`, import.meta.url), 'utf8');
	const [isProjectOk, projectErr, project] = parseProject(json);
	if (!isProjectOk) throw projectErr;
	return project;
}

function createBareProject(end: number): TProject {
	const project = createStaircaseProject();
	project.end = end;
	project.music.lanes = [];
	project.entities = [];
	return project;
}

function addMarble(
	project: TProject,
	index: number,
	release: TEntity['components']['release']
): string {
	const lane = createLane(index, `lane-${index + 1}`);
	project.music.lanes.push(lane);
	project.entities.push({
		id: `marble-${index + 1}`,
		components: { marble: { laneId: lane.id, radius: 0.008, color: lane.color }, release }
	});
	return lane.id;
}

function addLinkedHit(project: TProject, laneId: string, time: number, angle: number): string {
	const lane = project.music.lanes.find((l) => l.id === laneId);
	if (lane == null) throw new Error('Missing lane');
	const hitId = `${laneId}-hit-${lane.hits.length + 1}`;
	lane.hits.push({ id: hitId, time });
	const id = `piece-${hitId}`;
	project.entities.push(
		createLinkedPiece('platform', laneId, hitId, angle, { entities: project.entities, id })
	);
	return id;
}

function setAngle(project: TProject, entityId: string, angle: number): void {
	const hitLink = project.entities.find((entity) => entity.id === entityId)?.components.hitLink;
	if (hitLink == null) throw new Error(`Missing linked piece ${entityId}`);
	hitLink.angle = angle;
}

function withoutStats(result: TSimulationResult): Omit<TSimulationResult, 'stats'> {
	const { stats: _stats, ...rest } = result;
	return rest;
}

let simulator: TSimulator;

beforeAll(async () => {
	simulator = await createSimulator();
});

describe('simulate', () => {
	it('lands a single linked platform on its hit time', () => {
		const project = createBareProject(1.5);
		const laneId = addMarble(project, 0, { position: { x: 0, y: 0.5 }, time: 0.1 });
		const pieceId = addLinkedHit(project, laneId, 0.55, 0.1);
		const result = simulator.simulate(project);
		const [hit] = result.hits;
		expect(hit?.pieceEntityId).toBe(pieceId);
		expect(hit?.status).toBe('onTime');
		expect(Math.abs(hit?.error ?? Infinity)).toBeLessThanOrEqual(HIT_DRIFT);
		expect(result.pieces[0]?.status).toBe('placed');
		expect(result.pieces[0]?.angle).toBe(0.1);
		const firstSample = result.marbles[0]?.samples[0];
		expect(firstSample?.time).toBeCloseTo(0.1, 10);
		// The marble bounces back up after the hit
		const after = result.marbles[0]?.samples.find((sample) => sample.time > 0.6);
		expect(after?.velocity.y).toBeGreaterThan(0);
	});

	it('puts every staircase hit on time', () => {
		const project = loadFixture('staircase.marble.json');
		const result = simulator.simulate(project);
		expect(result.hits).toHaveLength(8);
		for (const hit of result.hits) {
			expect(hit.status).toBe('onTime');
			expect(Math.abs(hit.error ?? Infinity)).toBeLessThanOrEqual(HIT_DRIFT);
			expect(hit.dot).not.toBeNull();
		}
		expect(result.pieces.every((piece) => piece.status === 'placed')).toBe(true);
		expect(result.contacts.filter((contact) => contact.kind === 'piece')).toHaveLength(8);
	});

	it('reflows later platforms after a rotation and keeps pinned pieces in place', () => {
		const project = loadFixture('staircase.marble.json');
		const before = simulator.simulate(project);

		const rotated = structuredClone(project);
		setAngle(rotated, 'piece-1-2', 0.1);
		const after = simulator.simulate(rotated);
		for (let i = 3; i <= 8; i++) {
			const id = `piece-1-${i}`;
			const old = before.pieces.find((piece) => piece.entityId === id);
			const now = after.pieces.find((piece) => piece.entityId === id);
			expect(now?.position).not.toEqual(old?.position);
			expect(now?.angle).toBe(old?.angle);
		}
		expect(after.hits.every((hit) => hit.status === 'onTime')).toBe(true);

		// Pin the fifth platform at its current contact point
		const pinned = structuredClone(project);
		const fifth = before.pieces.find((piece) => piece.entityId === 'piece-1-5');
		const link = pinned.entities.find((entity) => entity.id === 'piece-1-5')?.components.hitLink;
		if (fifth?.contactPoint == null || link == null) throw new Error('Missing fifth platform');
		link.pinned = true;
		link.pinnedPosition = fifth.contactPoint;
		const pinnedResult = simulator.simulate(pinned);
		const pinnedPiece = pinnedResult.pieces.find((piece) => piece.entityId === 'piece-1-5');
		expect(pinnedPiece?.status).toBe('pinned');
		expect(pinnedPiece?.position.x).toBeCloseTo(fifth.position.x, 9);
		expect(pinnedPiece?.position.y).toBeCloseTo(fifth.position.y, 9);
		expect(pinnedResult.hits.every((hit) => hit.status === 'onTime')).toBe(true);

		setAngle(pinned, 'piece-1-2', 0.1);
		const pinnedAfter = simulator.simulate(pinned);
		expect(pinnedAfter.pieces.find((piece) => piece.entityId === 'piece-1-5')?.position).toEqual(
			pinnedPiece?.position
		);
		const pinnedHit = pinnedAfter.hits.find((hit) => hit.pieceEntityId === 'piece-1-5');
		expect(pinnedHit?.status).not.toBe('onTime');
		if (pinnedHit?.actualTime != null)
			expect(pinnedHit.error).toBeCloseTo(pinnedHit.actualTime - pinnedHit.targetTime, 12);
		else expect(pinnedHit?.status).toBe('missed');
		// Hits before the rotated platform are unaffected
		expect(pinnedAfter.hits[0]?.status).toBe('onTime');
	});

	it('returns the same result incrementally as a full run', async () => {
		const project = loadFixture('staircase.marble.json');
		simulator.simulate(project);
		for (const [entityId, angle] of [
			['piece-1-7', 0.2],
			['piece-1-3', -0.3],
			['piece-1-1', 0.05]
		] as const) {
			setAngle(project, entityId, angle);
			const incremental = simulator.simulate(project);
			const fresh = await createSimulator();
			const full = fresh.simulate(project);
			fresh.dispose();
			expect(full.stats.reusedUntil).toBe(0);
			expect(incremental.stats.reusedUntil).toBeGreaterThan(0);
			expect(incremental.stats.steps).toBeLessThan(full.stats.steps);
			expect(withoutStats(incremental)).toEqual(withoutStats(full));
		}
	});

	it('marks a piece blocked when the earlier trajectory passes through it', () => {
		const project = createBareProject(1.2);
		const laneId = addMarble(project, 0, { position: { x: 0, y: 0.5 }, time: 0 });
		addLinkedHit(project, laneId, 0.4, 0);
		// On the way back up the platform faces down onto the path the marble just fell along
		const blockedId = addLinkedHit(project, laneId, 0.45, 0);
		const result = simulator.simulate(project);
		expect(result.pieces.find((piece) => piece.entityId === blockedId)?.status).toBe('blocked');
		expect(result.hits[1]?.status).toBe('blocked');
		expect(result.hits[0]?.status).toBe('onTime');
		expect(result.contacts.some((contact) => contact.otherEntityId === blockedId)).toBe(false);
	});

	it('runs several marbles in one world and records marble contacts', () => {
		const project = createBareProject(3);
		const laneA = addMarble(project, 0, { position: { x: -0.2, y: 0.5 }, time: 0 });
		const laneB = addMarble(project, 1, { position: { x: 0.2, y: 0.5 }, time: 0.15 });
		for (const time of [0.5, 0.9, 1.3]) addLinkedHit(project, laneA, time, -0.1);
		for (const time of [0.7, 1.1, 1.5]) addLinkedHit(project, laneB, time, 0.1);
		const result = simulator.simulate(project);
		expect(result.marbles).toHaveLength(2);
		expect(result.hits).toHaveLength(6);
		expect(result.hits.every((hit) => hit.status === 'onTime')).toBe(true);
		expect(result.contacts.some((contact) => contact.kind === 'marble')).toBe(false);

		const crossing = createBareProject(1);
		addMarble(crossing, 0, { position: { x: -0.1, y: 0.5 }, time: 0, velocity: { x: 1, y: 0 } });
		addMarble(crossing, 1, { position: { x: 0.1, y: 0.5 }, time: 0, velocity: { x: -1, y: 0 } });
		const crossed = simulator.simulate(crossing);
		const marbleContacts = crossed.contacts.filter((contact) => contact.kind === 'marble');
		expect(marbleContacts).toHaveLength(2);
		expect(marbleContacts[0]?.marbleEntityId).toBe('marble-1');
		expect(marbleContacts[0]?.otherEntityId).toBe('marble-2');
		// Head-on at 2 m/s closing speed, touching when the centres are 16 mm apart
		expect(marbleContacts[0]?.time).toBeCloseTo((0.2 - 0.016) / 2, 3);
		expect(marbleContacts[0]?.position.x).toBeCloseTo(0, 6);
	});

	it('reports open hits with dots on the free-fall path', () => {
		const project = createBareProject(1);
		const laneId = addMarble(project, 0, {
			position: { x: 0, y: 0.5 },
			time: 0,
			velocity: { x: 0.2, y: 0 }
		});
		project.music.lanes[0]?.hits.push({ id: 'open', time: 0.3 });
		const result = simulator.simulate(project);
		const hit = result.hits.find((h) => h.laneId === laneId);
		expect(hit?.status).toBe('open');
		expect(hit?.dot?.x).toBeCloseTo(0.06, 6);
		// Rapier integrates with semi-implicit Euler, which falls slightly ahead of the exact parabola
		expect(Math.abs((hit?.dot?.y ?? 0) - (0.5 - 0.5 * 9.81 * 0.09))).toBeLessThan(0.003);
		expect(hit?.velocity?.y).toBeCloseTo(-9.81 * 0.3, 4);
	});
});
