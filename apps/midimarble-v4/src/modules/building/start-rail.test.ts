import { describe, expect, it } from 'vitest';
import { createBareRunProject } from '@/modules/simulation/fixture-projects';
import { startRailId, createSimulator } from '@/modules/simulation';
import { startRailPlan, withStartRails } from './start-rail';

const G = 9.81 * 0.5;

function project(first = 1, velocity?: { x: number; y: number }) {
	return createBareRunProject({ id: 'start', title: 'Start', end: 2.5, gravityScale: 0.5, marbles: [{ x: -0.1, y: 0.6, releaseTime: first - 0.5, ...(velocity != null ? { velocity } : {}), hitTimes: [first, first + 0.5] }] });
}

describe('startRailPlan function', () => {
	it('should keep at least 10°, steepen for a short lead, then cut the fall and give up last', () => {
		const roomy = startRailPlan(2, G, 0.3);
		expect(roomy?.slope).toBeCloseTo((10 * Math.PI) / 180, 6);
		const tight = startRailPlan(0.65, G, 0.3);
		expect(tight?.slope ?? 0).toBeGreaterThan((10 * Math.PI) / 180);
		expect(tight?.fall).toBe(0.3);
		const cut = startRailPlan(0.45, G, 0.3);
		expect(cut?.slope).toBeCloseTo((25 * Math.PI) / 180, 6);
		expect(cut?.fall ?? 1).toBeLessThan(0.3);
		expect(startRailPlan(0.3, G, 0.3)).toBeNull();
	});
});

describe('withStartRails function', () => {
	it('should add a normal Rail under the marble at each release it can start on', () => {
		const start = project();
		const marbleId = start.music.lanes[0]?.id ?? '';
		const built = withStartRails(start, new Set([marbleId]));
		const rail = built.entities.find((entity) => entity.id === startRailId(marbleId));
		expect(rail?.components.piece?.type).toBe('rail');
		expect(rail?.components.hitLink).toBeUndefined();
		expect(rail?.name).toBe('Rail 1');
		// Once only
		expect(withStartRails(built, new Set([marbleId]))).toBe(built);
	});

	it('should leave a marble with a speed of its own, or a note too soon, as it is', () => {
		const moving = project(1, { x: 0.3, y: 0 });
		expect(withStartRails(moving, new Set([moving.music.lanes[0]?.id ?? '']))).toBe(moving);
		const soon = project(0.25);
		expect(withStartRails(soon, new Set([soon.music.lanes[0]?.id ?? '']))).toBe(soon);
	});

	it('should roll the marble off the rail and against its stop before its first note', async () => {
		const simulator = await createSimulator();
		const start = project();
		const marbleId = start.music.lanes[0]?.id ?? '';
		const built = withStartRails(start, new Set([marbleId]));
		const result = simulator.simulate(built);
		const samples = result.marbles[0]?.samples ?? [];
		const contacts = result.contacts.filter((contact) => contact.otherEntityId === startRailId(marbleId));
		expect(contacts.length).toBeGreaterThan(0);
		// Rolling down the rail, then in the air with room to spare at the note
		const release = built.entities.find((entity) => entity.components.marble != null)?.components.release;
		expect(release?.time).toBeLessThan(0.5);
		const leaving = samples.find((sample) => sample.time >= 0.4);
		expect(Math.abs(leaving?.velocity.x ?? 0)).toBeGreaterThan(0.1);
		const dot = result.hits[0]?.dot;
		expect(dot).not.toBeNull();
		// Where it would have landed, falling almost straight: the stop took its sideways speed
		expect(Math.abs((dot?.x ?? 0) + 0.1)).toBeLessThan(0.02);
		expect(Math.abs(result.hits[0]?.velocity?.x ?? 1)).toBeLessThan(0.1);
		// Struck firmly, as after a plain drop
		const before = samples.filter((sample) => sample.time < 1).at(-1);
		expect(Math.abs(before?.velocity.y ?? 0)).toBeGreaterThan(2);
		simulator.dispose();
	}, 20_000);
});
