import { beforeAll, describe, expect, it } from 'vitest';
import { createMarble, type TMarble, type TPiece, type TProject, tieOf } from '@/modules/project';
import { createStaircaseProject } from './fixture-projects';
import { resolvePieceParams } from './pieces';
import { createLinkedPiece } from './placement';
import { projectOnPath } from './shapes';
import { createSimulator, handOversOf, type TSimulator } from './simulate';
import { HIT_DRIFT, type TSimulationResult } from './types';
import { loadFixture } from '@/modules/project/test-helpers';

function createBareProject(end: number): TProject {
	const project = createStaircaseProject();
	project.length = end;
	project.marbles = [];
	project.track.pieces = [];
	return project;
}

function addMarble(
	project: TProject,
	index: number,
	start: TMarble['start']
): string {
	const marble: TMarble = { ...createMarble(index, start.position, `marble-${index + 1}`), radius: 0.008, start };
	project.marbles.push(marble);
	return marble.id;
}

function addLinkedHit(
	project: TProject,
	marbleId: string,
	time: number,
	angle: number,
	type = 'platform'
): string {
	const marble = project.marbles.find((l) => l.id === marbleId);
	if (marble == null) throw new Error('Missing marble');
	const hitId = `${marbleId}-hit-${marble.hits.length + 1}`;
	marble.hits.push({ id: hitId, time });
	const id = `piece-${hitId}`;
	project.track.pieces.push(
		createLinkedPiece(type, marbleId, hitId, angle, { pieces: project.track.pieces, id })
	);
	return id;
}

function setAngle(project: TProject, pieceId: string, angle: number): void {
	const piece = project.track.pieces.find((piece) => piece.id === pieceId);
	if (piece == null || tieOf(piece) == null) throw new Error(`Missing linked piece ${pieceId}`);
	piece.angle = angle;
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
		const marbleId = addMarble(project, 0, { position: { x: 0, y: 0.5 }, time: 0.1 });
		const pieceId = addLinkedHit(project, marbleId, 0.55, 0.1);
		const result = simulator.simulate(project);
		const [hit] = result.hits;
		expect(hit?.pieceId).toBe(pieceId);
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

	it('leaves every hit and sample unchanged with a windmill no marble comes near', () => {
		const project = loadFixture('zigzag');
		const base = simulator.simulate(project);
		for (const motorSpeed of [0, 3]) {
			const windmill: TPiece = { id: 'windmill-far', name: 'Windmill', type: 'windmill', params: { motorSpeed }, angle: 0.3, place: { kind: 'free', position: { x: 5, y: 5 } } };
			const result = simulator.simulate({ ...project, revision: project.revision + 1, track: { ...project.track, pieces: [...project.track.pieces, windmill] } });
			expect(result.hits).toEqual(base.hits);
			expect(result.marbles).toEqual(base.marbles);
			expect(result.contacts).toEqual(base.contacts);
		}
	});

	it('changes nothing before a marble first strikes a free windmill', () => {
		const project = loadFixture('zigzag');
		const base = simulator.simulate(project);
		const marble = base.marbles[0];
		// Just below the marble's path at 3 s
		const at = marble?.samples.find((sample) => sample.time >= 3)?.position;
		if (marble == null || at == null) throw new Error('Missing sample');
		const windmill: TPiece = { id: 'windmill-near', name: 'Windmill', type: 'windmill', params: { motorSpeed: 0 }, angle: 0.3, place: { kind: 'free', position: { x: at.x + 0.02, y: at.y - 0.12 } } };
		const result = simulator.simulate({ ...project, revision: project.revision + 1, track: { ...project.track, pieces: [...project.track.pieces, windmill] } });
		const strike = result.contacts.find((contact) => contact.otherId === 'windmill-near');
		if (strike == null) throw new Error('The marble misses the windmill');
		expect(result.marbles[0]?.samples.filter((sample) => sample.time < strike.time)).toEqual(marble.samples.filter((sample) => sample.time < strike.time));
		expect(result.hits.filter((hit) => hit.targetTime < strike.time)).toEqual(base.hits.filter((hit) => hit.targetTime < strike.time));
	});

	it('puts every staircase hit on time', () => {
		const project = loadFixture('staircase');
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

	it('reflows later platforms after a rotation and keeps waiting pieces in place', () => {
		const project = loadFixture('staircase');
		const before = simulator.simulate(project);

		const rotated = structuredClone(project);
		setAngle(rotated, 'piece-1-2', 0.1);
		const after = simulator.simulate(rotated);
		for (let i = 3; i <= 8; i++) {
			const id = `piece-1-${i}`;
			const old = before.pieces.find((piece) => piece.pieceId === id);
			const now = after.pieces.find((piece) => piece.pieceId === id);
			expect(now?.position).not.toEqual(old?.position);
			expect(now?.angle).toBe(old?.angle);
		}
		expect(after.hits.every((hit) => hit.status === 'onTime')).toBe(true);

		// From the fifth note on the marble flies free and the pieces wait where the hand-overs have them
		const walk = simulator.walk(project);
		const fifth = before.pieces.find((piece) => piece.pieceId === 'piece-1-5');
		const fifthHit = before.hits.find((hit) => hit.pieceId === 'piece-1-5');
		if (fifth == null || fifthHit == null) throw new Error('Missing fifth platform');
		const waiting: TProject = { ...structuredClone(project), marbles: project.marbles.map((marble, index) => ({ ...marble, handOvers: handOversOf(walk, index), waitsFrom: fifthHit.hitId })) };
		const waitingResult = simulator.simulate(waiting);
		const waitingPiece = waitingResult.pieces.find((piece) => piece.pieceId === 'piece-1-5');
		expect(waitingPiece?.status).toBe('held');
		expect(waitingPiece?.position.x).toBeCloseTo(fifth.position.x, 9);
		expect(waitingPiece?.position.y).toBeCloseTo(fifth.position.y, 9);
		expect(waitingResult.hits.every((hit) => hit.status === 'onTime')).toBe(true);

		setAngle(waiting, 'piece-1-2', 0.1);
		const waitingAfter = simulator.simulate(waiting);
		expect(waitingAfter.pieces.find((piece) => piece.pieceId === 'piece-1-5')?.position).toEqual(waitingPiece?.position);
		expect(waitingAfter.hits.find((hit) => hit.pieceId === 'piece-1-5')?.status).not.toBe('onTime');
		// Hits before the rotated platform are unaffected
		expect(waitingAfter.hits[0]?.status).toBe('onTime');
	});

	it('returns the same result incrementally as a full run', async () => {
		const project = loadFixture('staircase');
		simulator.simulate(project);
		for (const [pieceId, angle] of [
			['piece-1-7', 0.2],
			['piece-1-3', -0.3],
			['piece-1-1', 0.05]
		] as const) {
			setAngle(project, pieceId, angle);
			const incremental = simulator.simulate(project);
			const fresh = await createSimulator();
			const full = fresh.simulate(project);
			fresh.dispose();
			expect(full.stats.reusedUntil).toBe(0);
			expect(incremental.stats.reusedUntil).toBeGreaterThan(0);
			expect(incremental.stats.steps).toBeLessThan(full.stats.steps);
			expect(withoutStats(incremental)).toEqual(withoutStats(full));
		}

		// Rails, tunnels and windmills resume from snapshots too, including the windmill's motion
		for (const name of ['windmill', 'long-gap']) {
			const fixture = loadFixture(name);
			simulator.simulate(fixture);
			for (const [pieceId, angle] of [
				['piece-1-5', 0.25],
				['piece-1-2', 0.28]
			] as const) {
				setAngle(fixture, pieceId, angle);
				const incremental = simulator.simulate(fixture);
				const fresh = await createSimulator();
				const full = fresh.simulate(fixture);
				fresh.dispose();
				expect(incremental.stats.reusedUntil).toBeGreaterThan(0);
				expect(withoutStats(incremental)).toEqual(withoutStats(full));
			}
		}
	}, 20_000);

	it('resumes past a dragged free piece until a marble could reach it', async () => {
		const project = loadFixture('zigzag');
		const free = (x: number, y: number): TPiece => ({
			id: 'dragged',
			type: 'platform', params: {}, angle: 0.3, place: { kind: 'free', position: { x, y } }
		});
		const base = simulator.simulate(project);
		const late = base.marbles[0]?.samples.find((sample) => sample.time >= 4.5)?.position;
		if (late == null) throw new Error('No late sample');
		// Far away, then onto the trajectory late in the run, then away again, which resumes before the run
		// that touched it
		for (const [index, position] of [
			{ x: 1.5, y: 0 },
			{ x: 1.4, y: -0.2 },
			{ x: late.x, y: late.y - 0.02 },
			{ x: late.x + 0.01, y: late.y - 0.02 },
			{ x: 1.5, y: 0 }
		].entries()) {
			const dragged = { ...project, revision: project.revision + 1, track: { ...project.track, pieces: [...project.track.pieces, free(position.x, position.y)] } };
			const incremental = simulator.simulate(dragged);
			const fresh = await createSimulator();
			const full = fresh.simulate(dragged);
			fresh.dispose();
			expect(incremental.stats.reusedUntil).toBeGreaterThan(index < 2 ? 6 : 3);
			expect(withoutStats(incremental)).toEqual(withoutStats(full));
		}
		// The free piece far away leaves the run exactly as without it
		const away = simulator.simulate({ ...project, track: { ...project.track, pieces: [...project.track.pieces, free(1.5, 0)] } });
		expect(away.marbles).toEqual(base.marbles);
		expect(away.hits).toEqual(base.hits);
	});

	it('marks a piece blocked when the earlier trajectory passes through it', () => {
		const project = createBareProject(1.2);
		const marbleId = addMarble(project, 0, { position: { x: 0, y: 0.5 }, time: 0 });
		addLinkedHit(project, marbleId, 0.4, 0);
		// On the way back up the platform faces down onto the path the marble just fell along
		const blockedId = addLinkedHit(project, marbleId, 0.45, 0);
		const result = simulator.simulate(project);
		expect(result.pieces.find((piece) => piece.pieceId === blockedId)?.status).toBe('blocked');
		expect(result.hits[1]?.status).toBe('blocked');
		expect(result.hits[0]?.status).toBe('onTime');
		expect(result.contacts.some((contact) => contact.otherId === blockedId)).toBe(false);
	});

	it('runs several marbles in one world and records marble contacts', () => {
		const project = createBareProject(3);
		const marbleA = addMarble(project, 0, { position: { x: -0.2, y: 0.5 }, time: 0 });
		const marbleB = addMarble(project, 1, { position: { x: 0.2, y: 0.5 }, time: 0.15 });
		for (const time of [0.5, 0.9, 1.3]) addLinkedHit(project, marbleA, time, -0.1);
		for (const time of [0.7, 1.1, 1.5]) addLinkedHit(project, marbleB, time, 0.1);
		// After the long first falls, a lower bounce than the default keeps the marbles falling at each hit
		for (const piece of project.track.pieces) piece.params['bounce'] = 0.55;
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
		expect(marbleContacts[0]?.marbleId).toBe('marble-1');
		expect(marbleContacts[0]?.otherId).toBe('marble-2');
		// Head-on at 2 m/s closing speed, touching when the centers are 16 mm apart
		expect(marbleContacts[0]?.time).toBeCloseTo((0.2 - 0.016) / 2, 3);
		expect(marbleContacts[0]?.position.x).toBeCloseTo(0, 6);
	});

	it('anchors a rail at its hit time as scenery and rolls the marble along it', () => {
		const project = createBareProject(1.5);
		const marbleId = addMarble(project, 0, {
			position: { x: 0, y: 0.5 },
			time: 0,
			velocity: { x: 0.2, y: 0 }
		});
		const railId = addLinkedHit(project, marbleId, 0.3, -0.1, 'rail');
		const result = simulator.simulate(project);
		// Scenery never sounds a hit: the hit stays open and the rail is a plain contact at its anchor time
		expect(result.hits[0]?.status).toBe('open');
		expect(result.hits[0]?.pieceId).toBeNull();
		expect(result.pieces.find((piece) => piece.pieceId === railId)?.entryTime).toBe(0.3);
		expect(result.contacts.find((contact) => contact.otherId === railId)?.time).toBeCloseTo(0.3, 2);
		const rail = result.pieces.find((piece) => piece.pieceId === railId);
		expect(rail?.status).toBe('placed');
		expect(rail?.shapes?.every((shape) => shape.kind === 'capsule')).toBe(true);
		// Rolling on the support: the center stays one marble and wire radius above the path
		const path = rail?.path ?? [];
		const end = path[path.length - 1];
		const onRail = result.marbles[0]?.samples.filter(
			(sample) => sample.time > 0.4 && sample.position.x < (end?.x ?? 0) - 0.02
		);
		expect(onRail?.length).toBeGreaterThan(20);
		for (const sample of onRail ?? []) {
			const gap = projectOnPath(path, sample.position.x, sample.position.y).distance;
			expect(Math.abs(gap - 0.008 - (resolvePieceParams('rail', {})['radius'] ?? 0))).toBeLessThan(0.002);
		}
		expect(result.contacts.filter((contact) => contact.otherId === railId)).toHaveLength(1);
	});

	it('keeps the marble inside a tunnel', () => {
		const project = createBareProject(1.2);
		const marbleId = addMarble(project, 0, {
			position: { x: 0, y: 0.5 },
			time: 0,
			velocity: { x: 0.2, y: 0 }
		});
		const tunnelId = addLinkedHit(project, marbleId, 0.3, -0.15, 'tunnel');
		const result = simulator.simulate(project);
		expect(result.hits[0]?.status).toBe('open');
		expect(result.pieces.find((piece) => piece.pieceId === tunnelId)?.status).toBe('placed');
		const tunnel = result.pieces.find((piece) => piece.pieceId === tunnelId);
		const floor = (tunnel?.path?.length ?? 0) - 1;
		expect(tunnel?.shapes?.length).toBeGreaterThan(floor);
		const path = tunnel?.path ?? [];
		const end = path[path.length - 1];
		for (const sample of result.marbles[0]?.samples ?? []) {
			if (sample.time < 0.35 || sample.position.x > (end?.x ?? 0) - 0.03) continue;
			const gap = projectOnPath(path, sample.position.x, sample.position.y).distance;
			// Never higher than the bore allows
			expect(gap).toBeLessThan(0.0025 + 0.016 + 0.004 + 0.001);
		}
	});

	it('turns a motor windmill before and after the moment it is anchored at', () => {
		const project = createBareProject(1.2);
		const marbleId = addMarble(project, 0, { position: { x: 0, y: 0.5 }, time: 0 });
		const windmillId = addLinkedHit(project, marbleId, 0.4, 0.2, 'windmill');
		const piece = project.track.pieces.find((item) => item.id === windmillId);
		if (piece == null) throw new Error('Missing windmill');
		piece.params['motorSpeed'] = 2;
		const result = simulator.simulate(project);
		// The windmill is scenery: the marble strikes it at 0.4 s, but the hit there stays open
		expect(result.hits[0]?.status).toBe('open');
		expect(result.contacts.find((contact) => contact.otherId === windmillId)?.time).toBeCloseTo(0.4, 2);
		const motion = result.pieces.find((piece) => piece.pieceId === windmillId)?.motion ?? [];
		expect(motion[0]?.time).toBe(0);
		expect(motion[0]?.angle).toBeCloseTo(0.2 - 2 * 0.4, 9);
		const last = motion[motion.length - 1];
		// A kinematic motor keeps its speed through the strike
		expect(last?.angle).toBeCloseTo(0.2 + 2 * (1.2 - 0.4), 3);
	});

	it('builds free rails and windmills from their transform', () => {
		const project = createBareProject(0.5);
		addMarble(project, 0, { position: { x: 0, y: 0.5 }, time: 0 });
		project.track.pieces.push(
			{
				id: 'free-rail',
				type: 'rail', params: {}, angle: 0, place: { kind: 'free', position: { x: 0.1, y: 0.2 } }, path: {
						points: [
							{ x: 0, y: 0 },
							{ x: 0.1, y: -0.01 }
						]
					}
			},
			{
				id: 'free-windmill',
				type: 'windmill', params: { bladeCount: 3 }, angle: 0.5, place: { kind: 'free', position: { x: -0.2, y: 0.2 } }
			}
		);
		const result = simulator.simulate(project);
		const rail = result.pieces.find((piece) => piece.pieceId === 'free-rail');
		expect(rail?.status).toBe('free');
		expect(rail?.path?.[0]).toEqual({ x: 0.1, y: 0.2 });
		expect(rail?.path?.[1]?.x).toBeCloseTo(0.2, 12);
		const windmill = result.pieces.find((piece) => piece.pieceId === 'free-windmill');
		expect(windmill?.shapes).toHaveLength(4);
		expect(windmill?.motion?.[0]).toEqual({ time: 0, angle: 0.5 });
		// Untouched, so it rests
		for (const sample of windmill?.motion ?? []) expect(sample.angle).toBeCloseTo(0.5, 6);
	});

	it('counts a first contact without impact as a resting miss', () => {
		const project = createBareProject(0.7);
		// The marble starts at rest on a free bar, so the linked piece that appears under it at its hit is
		// touched without being struck
		const shelfTop = 0.4 + (resolvePieceParams('platform', {})['thickness'] ?? 0) / 2;
		const marbleId = addMarble(project, 0, { position: { x: 0, y: shelfTop + 0.0085 }, time: 0 });
		project.track.pieces.push({
			id: 'shelf',
			type: 'platform', params: { length: 0.2 }, angle: 0, place: { kind: 'free', position: { x: 0, y: 0.4 } }
		});
		const pieceId = addLinkedHit(project, marbleId, 0.5, 0);
		const result = simulator.simulate(project);
		const hit = result.hits.find((item) => item.pieceId === pieceId);
		expect(hit?.status).toBe('missed');
		expect(hit?.reason).toBe('resting');
		const contact = result.contacts.find((item) => item.otherId === pieceId);
		expect(contact?.speed ?? Infinity).toBeLessThan(0.3);
	});

	it('records the approach speed of a strike and the shared pace', () => {
		const project = createBareProject(0.6);
		const marbleId = addMarble(project, 0, { position: { x: 0, y: 0.5 }, time: 0 });
		const pieceId = addLinkedHit(project, marbleId, 0.3, 0);
		const result = simulator.simulate(project);
		expect(result.hits[0]?.status).toBe('onTime');
		const contact = result.contacts.find((item) => item.otherId === pieceId);
		expect(contact?.speed).toBeCloseTo(9.81 * 0.3, 1);
		expect(result.pace?.anchorTime).toBe(0.3);
		expect(result.pace?.anchorY).toBeCloseTo(result.hits[0]?.dot?.y ?? 0, 12);
	});

	it('reports open hits with dots on the free-fall path', () => {
		const project = createBareProject(1);
		const marbleId = addMarble(project, 0, {
			position: { x: 0, y: 0.5 },
			time: 0,
			velocity: { x: 0.2, y: 0 }
		});
		project.marbles[0]?.hits.push({ id: 'open', time: 0.3 });
		const result = simulator.simulate(project);
		const hit = result.hits.find((h) => h.marbleId === marbleId);
		expect(hit?.status).toBe('open');
		expect(hit?.dot?.x).toBeCloseTo(0.06, 6);
		// Rapier integrates with semi-implicit Euler, which falls slightly ahead of the exact parabola
		expect(Math.abs((hit?.dot?.y ?? 0) - (0.5 - 0.5 * 9.81 * 0.09))).toBeLessThan(0.003);
		expect(hit?.velocity?.y).toBeCloseTo(-9.81 * 0.3, 4);
	});

	it('should leave out a piece tied to a hit that is gone', () => {
		// Prepare
		const project = createBareProject(0.6);
		const marbleId = addMarble(project, 0, { position: { x: 0, y: 0.5 }, time: 0 });
		const kept = addLinkedHit(project, marbleId, 0.3, 0);
		project.track.pieces.push({ id: 'left-behind', type: 'platform', params: {}, angle: 0, place: { kind: 'plays', marbleId: 'gone', hitId: 'gone', contactAt: 0.5 } });

		// Act
		const result = simulator.simulate(project);

		// Assert
		expect(result.pieces.map((piece) => piece.pieceId)).toEqual([kept]);
	});
});
