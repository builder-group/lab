import { describe, expect, it } from 'vitest';
import { createProject, toHitKey, type TProject } from '@/modules/project';
import { createLinkedPiece, type TSimulationResult } from '@/modules/simulation';
import { barTargetOf, type TBarTarget } from './bar';
import { pastBuiltMark } from './past-built';

/** Notes a second apart from 1 s on one marble released at 0 s from (0, 0), the first `built` with a platform each */
function track(built: number): TProject {
	const base = createProject();
	const marble = { ...(base.marbles[0] ?? { id: 'm', name: 'Melody' }), id: 'm', start: { position: { x: 0, y: 0 }, time: 0 }, hits: [1, 2, 3, 4, 5, 6].map((time, index) => ({ id: `h${index + 1}`, time })) } as TProject['marbles'][number];
	const pieces = Array.from({ length: built }, (_, index) => createLinkedPiece('platform', 'm', `h${index + 1}`, 0.2, { id: `p${index + 1}` }));
	return { ...base, marbles: [marble], track: { pieces, groups: [] } };
}

/** A run whose built notes come down 0.2 m a second, and whose first open note is where the marble falls to */
function run(built: number, fallTo: number): TSimulationResult {
	const hits = [1, 2, 3, 4, 5, 6].map((time, index) => ({ marbleId: 'm', hitId: `h${index + 1}`, targetTime: time, dot: index < built ? { x: 0, y: -0.2 * time } : index === built ? { x: 0, y: fallTo } : null, status: index < built ? 'onTime' : 'open' }));
	return { hits, pieces: [], marbles: [], contacts: [] } as unknown as TSimulationResult;
}

function target(project: TProject, hitId: string): TBarTarget {
	const found = barTargetOf(project, [toHitKey('m', hitId)]);
	if (found == null) throw new Error('No target');
	return found;
}

describe('pastBuiltMark', () => {
	it('stands on the guide line below the first open note, at the pace of what is built, with the last built piece', () => {
		const project = track(2);
		// Built notes at 1 s and 2 s come down 0.2 m a second; the open note at 3 s is where the marble falls, 0.9 m down
		const mark = pastBuiltMark(project, run(2, -0.9), target(project, 'h5'));
		expect(mark?.words).toBe('Note 5 · build up to here');
		expect(mark?.lastPieceId).toBe('p2');
		// From the open note at 3 s, 0.9 m down, on at its pace from the release: 0.3 m a second for 2 s more
		expect(mark?.point.y).toBeCloseTo(-1.5);
	});

	it('is there only past what is built', () => {
		const project = track(2);
		expect(pastBuiltMark(project, run(2, -0.9), target(project, 'h3'))).toBeNull();
		expect(pastBuiltMark(project, run(2, -0.9), target(project, 'h1'))).toBeNull();
	});

	it('goes down from the release with nothing built yet', () => {
		const project = track(0);
		const mark = pastBuiltMark(project, run(0, -0.2), target(project, 'h3'));
		expect(mark?.lastPieceId).toBeNull();
		expect(mark?.point.y).toBeLessThan(-0.2);
	});
});
