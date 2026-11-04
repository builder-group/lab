import { describe, expect, it } from 'vitest';
import type { TProject } from '@/modules/project';
import { extraStrikes, MIN_PIECE_GAP, touchingPairs, visualShapes } from './track-look';
import type { TResolvedPiece, TSimulationResult } from './types';

function platform(entityId: string, x: number, y: number, hitTime = 1, angle = 0): TResolvedPiece {
	return { entityId, type: 'platform', position: { x, y }, angle, params: { length: 0.09, thickness: 0.012 }, status: 'placed', hitTime } as unknown as TResolvedPiece;
}

function project(hitIds: string[]): TProject {
	return {
		music: { lanes: [{ id: 'lane', name: 'Melody', hits: hitIds.map((id, index) => ({ id, time: index + 1 })) }] },
		entities: [
			{ id: 'marble', components: { marble: { laneId: 'lane', radius: 0.012 } } },
			...hitIds.map((id) => ({ id: `piece-${id}`, components: { piece: { type: 'platform', params: {} }, hitLink: { laneId: 'lane', hitId: id, angle: 0, contactAt: 0.5 } } }))
		]
	} as unknown as TProject;
}

function run(pieces: TResolvedPiece[], contacts: { time: number; other: string; speed?: number }[] = [], times: Record<string, number> = {}): TSimulationResult {
	return {
		duration: 10,
		pieces,
		marbles: [{ entityId: 'marble', laneId: 'lane', radius: 0.012, samples: [] }],
		contacts: contacts.map((contact) => ({ time: contact.time, marbleEntityId: 'marble', otherEntityId: contact.other, kind: 'piece', position: { x: 0, y: 0 }, speed: contact.speed ?? 1 })),
		hits: Object.entries(times).map(([hitId, time]) => ({ laneId: 'lane', hitId, targetTime: time, pieceEntityId: `piece-${hitId}`, dot: { x: 0, y: 0 }, velocity: null, actualTime: time, error: 0, status: 'onTime' }))
	} as unknown as TSimulationResult;
}

describe('visualShapes function', () => {
	it('should grow a platform below its top face to the deepest skin', () => {
		const [shape] = visualShapes(platform('a', 0, 0), 0.012);
		if (shape?.kind !== 'box') throw new Error('Not a box');
		// A Gift is 2.125 marble radii deep and the top face stays at the hitbox's
		expect(shape.box.halfThickness * 2).toBeGreaterThan(0.025);
		expect(shape.box.cy + shape.box.halfThickness).toBeCloseTo(0.006, 6);
		expect(shape.box.halfLength).toBeGreaterThan(0.045);
	});
});

describe('touchingPairs function', () => {
	it('should name two platforms whose skins touch though their hitboxes stand clear', () => {
		// The hitboxes are 1.8 cm apart, but the upper one's skin hangs about 1.4 cm below its hitbox
		const pieces = [platform('piece-a', 0, 0.03, 1), platform('piece-b', 0, 0, 2)];
		const pairs = touchingPairs(project(['a', 'b']), run(pieces));
		expect(pairs.map((pair) => [pair.a, pair.b])).toEqual([['piece-a', 'piece-b']]);
		expect(pairs[0]?.gap).toBeLessThan(MIN_PIECE_GAP);
	});

	it('should leave pieces apart by the least gap alone', () => {
		expect(touchingPairs(project(['a', 'b']), run([platform('piece-a', -0.1, 0), platform('piece-b', 0.1, 0)]))).toEqual([]);
	});
});

describe('extraStrikes function', () => {
	it('should count a second strike of a platform between notes', () => {
		const strikes = extraStrikes(project(['a', 'b']), run([platform('piece-a', 0, 0)], [{ time: 1, other: 'piece-a' }, { time: 1.2, other: 'piece-a' }], { a: 1, b: 2 }));
		expect(strikes).toMatchObject([{ entityId: 'piece-a', times: 2, time: 1.2 }]);
	});

	it('should read one bounce reported over a few steps as one strike', () => {
		expect(extraStrikes(project(['a', 'b']), run([platform('piece-a', 0, 0)], [{ time: 1, other: 'piece-a' }, { time: 1.01, other: 'piece-a' }], { a: 1, b: 2 }))).toEqual([]);
	});

	it('should let the marble roll to rest after its last note', () => {
		const contacts = [{ time: 2, other: 'piece-b' }, { time: 2.3, other: 'piece-b', speed: 0.05 }];
		expect(extraStrikes(project(['a', 'b']), run([platform('piece-b', 0, 0)], contacts, { a: 1, b: 2 }))).toEqual([]);
	});
});
