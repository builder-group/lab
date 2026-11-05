import { beforeAll, describe, expect, it } from 'vitest';
import { createProject, type TProject } from '@/modules/project';
import { createSimulator, type THitResult, type TSimulationResult } from '@/modules/simulation';
import { canMakeBacking, hitReach, moveHitLaterFix, reachMessage, reachStatus, releaseFixFor } from './reachability';

let simulate: (project: TProject) => TSimulationResult;

beforeAll(async () => {
	const simulator = await createSimulator();
	simulate = (project) => simulator.simulate(project);
});

/** A new project whose marble is released at `releaseTime` and has open hits at `times` */
function tapped(times: number[], releaseTime = 0): { project: TProject; result: TSimulationResult; hits: THitResult[] } {
	const project = createProject();
	const marble = project.marbles[0];
	if (marble == null) throw new Error('A new project has a marble');
	marble.hits = times.map((time, index) => ({ id: `hit-${index + 1}`, time }));
	marble.start.time = releaseTime;
	const result = simulate(project);
	const hits = marble.hits.map((item) => result.hits.find((hit) => hit.hitId === item.id)).filter((hit) => hit != null);
	return { project, result, hits };
}

describe('hitReach function', () => {
	it('should find a note at 0:01 of a new project reachable', () => {
		const { project, result, hits } = tapped([1, 1.5]);

		expect(hitReach(project, result, hits[0] as THitResult)).toEqual({ kind: 'reachable' });
	});

	it('should call a note before the release Too Soon', () => {
		// Prepare
		const { project, result, hits } = tapped([1, 2.5], 1.5);

		// Act
		const reach = hitReach(project, result, hits[0] as THitResult);

		// Assert
		expect(reach.kind).toBe('tooSoon');
		expect(reachStatus(reach, { marble: 'Marble 1', time: '0:01.00' })).toEqual({ label: 'Too Soon', detail: "Marble 1 can't reach a platform by 0:01.00" });
	});

	it('should call a note right after the release Too Soon, before the marble falls its diameter', () => {
		const { project, result, hits } = tapped([0.02, 1]);

		expect(hitReach(project, result, hits[0] as THitResult).kind).toBe('tooSoon');
		expect(hitReach(project, result, hits[1] as THitResult).kind).toBe('reachable');
	});

	it('should call a note after the marble fell out of the run Out of Reach', () => {
		const { project, result, hits } = tapped([6]);

		expect(hits[0]?.dot).toBeNull();
		expect(hitReach(project, result, hits[0] as THitResult).kind).toBe('outOfReach');
	});

	it('should keep notes after an Open note of the same marble Open while that note waits for its platform', () => {
		// Prepare: a tapped project before any platform; the marble falls out of the run after Hit 1
		const { project, result, hits } = tapped([1, 3, 4, 5, 6]);

		// Act
		const kinds = hits.map((hit) => hitReach(project, result, hit).kind);

		// Assert
		expect(hits.slice(1).every((hit) => hit.dot == null)).toBe(true);
		expect(kinds).toEqual(['reachable', 'reachable', 'reachable', 'reachable', 'reachable']);
	});
});

describe('moveHitLaterFix function', () => {
	it('should move a Too Soon tapped hit to the first moment the marble can strike', () => {
		// Prepare: the release is at the start of the song, so it cannot move earlier
		const { project, result, hits } = tapped([0.02, 1]);
		const hit = hits[0] as THitResult;
		const reach = hitReach(project, result, hit);

		// Act
		const fix = moveHitLaterFix(project, hit, reach);

		// Assert
		expect(releaseFixFor(project, hit, reach)).toBeNull();
		expect(reach.kind === 'tooSoon' && fix != null && fix.time > reach.earliest && fix.time < 1).toBe(true);
		expect(fix?.label).toBe('Move Hit Later');
		expect(fix?.commands).toEqual([{ type: 'upsertHits', marbleId: hit.marbleId, hits: [{ id: 'hit-1', time: fix?.time }] }]);
	});

	it('should not move the notes of a song, which offer Make Backing instead', () => {
		const { project, result, hits } = tapped([0.02, 1]);
		project.songs = [{ id: 'song', kind: 'midi', path: 'song.mid', name: 'Song', start: 0, backing: [] }];
		const hit = hits[0] as THitResult;

		expect(canMakeBacking(project)).toBe(true);
		expect(moveHitLaterFix(project, hit, hitReach(project, result, hit))).toBeNull();
	});
});

describe('releaseFixFor function', () => {
	it('should move the release earlier for a Too Soon first note', () => {
		// Prepare
		const { project, result, hits } = tapped([1, 2.5], 1.5);
		const first = hits[0] as THitResult;
		const reach = hitReach(project, result, first);

		// Act
		const fix = releaseFixFor(project, first, reach);

		// Assert
		expect(fix?.label).toBe('Move Release Earlier');
		const command = fix?.commands[0];
		if (command?.type !== 'updateMarble' || command.patch.start == null) throw new Error('Expected a release change');
		expect(command.patch.start.time).toBe(0.5);
		expect(reachMessage(reach, { hit: 'Hit 1', marble: 'Marble 1' }, fix)).toBe('Hit 1 is too soon for Marble 1. Move the release earlier or make it Backing.');
	});

	it('should offer no release change for a note at the very start of the song', () => {
		const { project, result, hits } = tapped([0.02, 1]);
		const first = hits[0] as THitResult;
		const reach = hitReach(project, result, first);

		expect(releaseFixFor(project, first, reach)).toBeNull();
		expect(reachMessage(reach, { hit: 'Hit 1', marble: 'Marble 1' }, null)).toBe('Hit 1 is too soon for Marble 1. Make it Backing, or move the note later.');
	});

	it('should move the release later when the marble falls out of the run before its first note', () => {
		const { project, result, hits } = tapped([6]);
		const first = hits[0] as THitResult;

		expect(releaseFixFor(project, first, hitReach(project, result, first))?.label).toBe('Move Release Later');
	});
});
