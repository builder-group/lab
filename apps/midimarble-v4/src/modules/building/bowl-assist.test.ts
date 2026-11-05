import { beforeAll, describe, expect, it } from 'vitest';
import { NO_BLENDER_OBJECTS, preflightExport } from './export-preflight';
import { BOWL_TAIL, projectSongEnd } from '@/modules/music';
import { type TProject, tieOf } from '@/modules/project';
import { bowlCatch, bowlOfMarble, createSimulator, type TSimulator } from '@/modules/simulation';
import { findBowl, bowlFix, marblesWithoutBowl } from './bowl-assist';
import { asMarbleBowl } from '@/modules/track';
import { loadFixture } from '@/modules/project/test-helpers';

function withoutBowls(project: TProject): TProject {
	return { ...project, revision: project.revision + 1, track: { ...project.track, pieces: project.track.pieces.filter((entity) => entity.type !== 'bowl') } };
}

let simulator: TSimulator;
const deps = { simulate: (project: TProject) => simulator.simulate(project) };

beforeAll(async () => {
	simulator = await createSimulator();
});

describe('Add Bowl', () => {
	it('offers a Bowl for each marble that plays last and has none', () => {
		const duet = withoutBowls(loadFixture('two-marbles'));
		// Their last notes lie closer together than the Bowl's tail, so both play last
		expect(marblesWithoutBowl(duet)).toEqual(['marble-1', 'marble-2']);
		// With Marble 2's last note later than that, only it does
		expect(marblesWithoutBowl({ ...duet, marbles: duet.marbles.map((marble) => (marble.id === 'marble-2' ? { ...marble, hits: [...marble.hits, { id: 'late', time: 5 }] } : marble)) })).toEqual(['marble-2']);
		expect(marblesWithoutBowl(loadFixture('two-marbles'))).toEqual([]);
	});

	it('places a Bowl on the fall after the last note that catches the marble and breaks no hit', async () => {
		const zigzag = withoutBowls(loadFixture('zigzag'));
		const placed = await findBowl(zigzag, 'marble-1', deps);
		if ('error' in placed) throw new Error(placed.error);
		expect(placed.catch.status).toBe('caught');
		const link = tieOf(placed.entity);
		expect(link?.kind).toBe('follows');
		expect(link?.hitId).toBe('hit-1-16');
		const delay = placed.entity.params['entryDelay'] ?? 0;
		expect(delay).toBeGreaterThan(0.1);
		expect(delay).toBeLessThan(1.2);
		// The film that follows the song runs on until the catch shows
		const next = { ...zigzag, track: { ...zigzag.track, pieces: [...zigzag.track.pieces, placed.entity] } };
		expect(projectSongEnd(next)).toBeCloseTo(6.2 + BOWL_TAIL, 6);
		const run = simulator.simulate({ ...next, length: projectSongEnd(next) ?? next.length });
		expect(run.hits.filter((hit) => hit.status === 'onTime')).toHaveLength(16);
		expect(bowlCatch(run, placed.entity.id).status).toBe('caught');
	}, 20_000);

	it('keeps every hit with their Bowls, which catch both marbles', () => {
		const project = loadFixture('two-marbles');
		const result = simulator.simulate(project);
		expect(result.hits.filter((hit) => hit.status === 'onTime')).toHaveLength(6);
		for (const marble of project.marbles) {
			const bowl = bowlOfMarble(project, marble.id);
			expect(bowl, marble.name).toBeDefined();
			expect(bowlCatch(result, bowl?.id ?? '').status).toBe('caught');
		}
		expect(preflightExport(project, result, NO_BLENDER_OBJECTS).issues.filter((issue) => issue.id.startsWith('bowl:'))).toEqual([]);
	});

	it('reports a Bowl that misses its marble and places it again', async () => {
		const zigzag = withoutBowls(loadFixture('zigzag'));
		const found = await findBowl(zigzag, 'marble-1', deps);
		if ('error' in found) throw new Error(found.error);
		const bowl = found.entity;
		if (bowl.place.kind !== 'follows') throw new Error('No Bowl');
		// Pushed off to the side, the marble falls past it
		const missing: TProject = {
			...zigzag,
			length: projectSongEnd({ ...zigzag, track: { ...zigzag.track, pieces: [...zigzag.track.pieces, bowl] } }) ?? zigzag.length,
			revision: zigzag.revision + 1,
			track: { ...zigzag.track, pieces: [...zigzag.track.pieces, { ...bowl, place: { ...bowl.place, offset: { x: 0.25, y: 0 } } }] }
		};
		const result = simulator.simulate(missing);
		const issue = preflightExport(missing, result, NO_BLENDER_OBJECTS).issues.find((item) => item.id === `bowl:${bowl.id}`);
		expect(issue?.title).toBe('Marble 1 misses the Bowl');
		expect(issue?.severity).toBe('warning');
		const fix = await bowlFix(missing, result, bowl.id, deps);
		const placed = fix.commands?.[0];
		if (placed?.type !== 'addPiece') throw new Error(fix.message);
		expect(placed.piece.id).toBe(bowl.id);
		expect(placed.piece.place.kind === 'follows' ? placed.piece.place.offset : undefined).toBeUndefined();
		const fixed = { ...missing, track: { ...missing.track, pieces: missing.track.pieces.map((entity) => (entity.id === bowl.id ? placed.piece : entity)) } };
		expect(bowlCatch(simulator.simulate(fixed), bowl.id).status).toBe('caught');
	});

	it('keeps one Bowl per marble: a new one for a marble moves its own', () => {
		const duet = loadFixture('two-marbles');
		const own = bowlOfMarble(duet, 'marble-1');
		const dropped = asMarbleBowl(
			duet,
			{ id: 'piece-new', name: 'Bowl 3', type: 'bowl', params: { entryDelay: 0.5 }, angle: 0, place: { kind: 'follows', marbleId: 'marble-1', hitId: 'hit-1-2' } },
			{ x: -0.4, y: -1 }
		);
		expect(dropped.id).toBe(own?.id);
		expect(dropped.name).toBe(own?.name);
		expect(dropped.params['mirror']).toBe(1);
		expect(tieOf(dropped)?.kind).toBe('follows');
	});
});
