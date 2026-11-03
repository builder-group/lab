import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { parseProject, type TEntity, type TProject } from '@/modules/project';
import { createSimulator, type TSimulator } from '@/modules/simulation/simulate';
import type { THitResult, TResolvedPiece, TSimulationResult } from '@/modules/simulation';
import { preflightExport } from './export-preflight';

function loadFixture(name: string): TProject {
	const json = readFileSync(new URL(`../../../fixtures/${name}.marble.json`, import.meta.url), 'utf8');
	const [isProjectOk, projectErr, project] = parseProject(json);
	if (!isProjectOk) throw projectErr;
	return project;
}

// Two lanes side by side with one platform each, a free rail and a free platform
function createTwoLaneProject(): TProject {
	const marble = (id: string, laneId: string, x: number): TEntity => ({
		id,
		name: id === 'marble-a' ? 'Melody' : 'Bass',
		components: { marble: { laneId, radius: 0.008, color: '#fff' }, release: { position: { x, y: 0.6 }, time: 0 } }
	});
	const platform = (id: string, laneId: string | null, hitId: string): TEntity => ({
		id,
		name: id,
		components: {
			piece: { type: 'platform', params: {} },
			transform: { position: { x: 0, y: 0 }, angle: 0 },
			...(laneId != null ? { hitLink: { laneId, hitId, angle: 0, contactAt: 0.5, pinned: false } } : {})
		}
	});
	return {
		$schema: 'marble-project@2',
		id: 'preflight',
		title: 'Preflight',
		revision: 3,
		frame: { width: 9, height: 16 },
		end: 4,
		music: {
			sources: [],
			lanes: [
				{ id: 'lane-a', name: 'Melody', color: '#3478f6', instrument: 9, hits: [{ id: 'a1', time: 1 }, { id: 'a2', time: 2 }, { id: 'a3', time: 3 }] },
				{ id: 'lane-b', name: 'Bass', color: '#ff9f0a', instrument: 9, hits: [{ id: 'b1', time: 1.5 }] }
			]
		},
		entities: [
			marble('marble-a', 'lane-a', -0.1),
			marble('marble-b', 'lane-b', 0.1),
			platform('pa1', 'lane-a', 'a1'),
			platform('pa2', 'lane-a', 'a2'),
			platform('pb1', 'lane-b', 'b1'),
			platform('loose', null, ''),
			{ id: 'rail', name: 'rail', components: { piece: { type: 'rail', params: {} }, transform: { position: { x: 0, y: 0 }, angle: 0 } } }
		],
		design: { theme: 'pegboard', renderPreset: 'balanced', loop: false, camera: { mode: 'rig', distance: 0.85, pitch: 1, lead: 0.15, smoothing: 0.6, shots: [] } }
	};
}

function hit(laneId: string, hitId: string, targetTime: number, patch: Partial<THitResult> = {}): THitResult {
	const x = laneId === 'lane-a' ? -0.1 : 0.1;
	return { laneId, hitId, targetTime, pieceEntityId: null, dot: { x, y: 0.5 - targetTime * 0.3 }, velocity: null, actualTime: targetTime, error: 0, status: 'onTime', ...patch };
}

function piece(entityId: string, type = 'platform'): TResolvedPiece {
	return { entityId, type, position: { x: 0, y: 0 }, angle: 0, params: {}, contactPoint: null, contactNormal: null, hitTime: null, status: 'placed' };
}

function createResult(patch: Partial<TSimulationResult> = {}): TSimulationResult {
	return {
		revision: 3,
		duration: 4,
		marbles: [
			{ entityId: 'marble-a', laneId: 'lane-a', radius: 0.008, samples: [] },
			{ entityId: 'marble-b', laneId: 'lane-b', radius: 0.008, samples: [] }
		],
		pieces: [piece('pa1'), piece('pa2'), piece('pb1'), piece('loose'), piece('rail', 'rail')],
		contacts: [],
		hits: [
			hit('lane-a', 'a1', 1, { pieceEntityId: 'pa1' }),
			hit('lane-a', 'a2', 2, { pieceEntityId: 'pa2' }),
			hit('lane-a', 'a3', 3, { pieceEntityId: null, actualTime: null, error: null, status: 'open' }),
			hit('lane-b', 'b1', 1.5, { pieceEntityId: 'pb1' })
		],
		stats: { computeMs: 0, reusedUntil: 0, steps: 0 },
		...patch
	};
}

describe('preflightExport function', () => {
	let simulator: TSimulator;

	beforeAll(async () => {
		simulator = await createSimulator();
	});

	it('should pass clean fixtures with every hit on time', () => {
		for (const [name, count] of [
			['zigzag', 16],
			['jingle-bells', 115]
		] as const) {
			const project = loadFixture(name);

			const preflight = preflightExport(project, simulator.simulate(project));

			expect(preflight.issues, name).toEqual([]);
			expect(preflight.summary).toBe(`All ${count} hits on time`);
		}
	});

	it('should report blocked hits and drifting dots after a platform is turned', () => {
		const project = loadFixture('zigzag');
		const turned = project.entities.find((entity) => entity.components.hitLink?.hitId === project.music.lanes[0]?.hits[4]?.id);
		if (turned?.components.hitLink == null) throw new Error('No linked platform');
		turned.components.hitLink.angle += 0.9;

		const preflight = preflightExport(project, simulator.simulate(project));

		expect(preflight.summary).toMatch(/^\d+ issues? · 1 note$/);
		expect(preflight.issues[0]).toEqual(expect.objectContaining({ severity: 'warning', title: expect.stringMatching(/^Blocked hit/) }));
		expect(preflight.issues.at(-1)).toEqual(expect.objectContaining({ severity: 'info', title: expect.stringMatching(/dots outside the frame on Marble 1$/) }));
	});

	it('should keep a single-marble dot just outside the frame a note', () => {
		const project = loadFixture('loop');

		const preflight = preflightExport(project, simulator.simulate(project));

		expect(preflight.warnings).toBe(0);
		expect(preflight.summary).toBe('All 21 hits on time · 1 note');
	});

	it('should be pending without a result for the current revision', () => {
		const project = createTwoLaneProject();

		expect(preflightExport(project, null).state).toBe('pending');
		expect(preflightExport(project, createResult({ revision: 2 })).summary).toBe('Checking the run…');
	});

	it('should explain missed, resting, blocked and drifting hits', () => {
		const project = createTwoLaneProject();
		const result = createResult({
			hits: [
				hit('lane-a', 'a1', 1, { pieceEntityId: 'pa1', status: 'missed', actualTime: 1.05, error: 0.05 }),
				hit('lane-a', 'a2', 2, { pieceEntityId: 'pa2', status: 'missed', reason: 'resting' }),
				hit('lane-a', 'a3', 3, { pieceEntityId: 'loose', status: 'drifting', error: -0.012 }),
				hit('lane-b', 'b1', 1.5, { pieceEntityId: 'pb1', status: 'blocked', actualTime: null, error: null })
			]
		});

		const preflight = preflightExport(project, result);

		expect(preflight.issues.map((issue) => [issue.title, issue.detail])).toEqual([
			['Missed hit, Melody at 0:01.00', 'Lands 50 ms late.'],
			['Blocked hit, Bass at 0:01.50', 'The marble passes through the piece earlier in the run, so it is left out.'],
			['Missed hit, Melody at 0:02.00', 'The marble rolls onto the piece instead of striking it.'],
			['Drifting hit, Melody at 0:03.00', 'Lands 12 ms early.']
		]);
		expect(preflight.summary).toBe('4 issues');
		expect(preflight.issues[0]?.target).toEqual({ ids: ['pa1'], time: 1 });
	});

	it('should note open hits per lane and select the first one', () => {
		const project = createTwoLaneProject();

		const preflight = preflightExport(project, createResult());

		expect(preflight.warnings).toBe(0);
		expect(preflight.issues).toEqual([
			expect.objectContaining({ severity: 'info', title: 'Open hit, Melody at 0:03.00', target: { ids: ['hit:lane-a:a3'], time: 3 } })
		]);
		expect(preflight.summary).toBe('3 of 4 hits on time · 1 note');
	});

	it('should flag dots outside the lane band when marbles share the frame', () => {
		const project = createTwoLaneProject();
		const result = createResult({ hits: [hit('lane-a', 'a1', 1, { pieceEntityId: 'pa1', dot: { x: 1.2, y: 0 } })] });

		const preflight = preflightExport(project, result);

		expect(preflight.issues).toEqual([expect.objectContaining({ severity: 'warning', title: 'Dot outside the lane band, Melody at 0:01.00' })]);
	});

	it('should flag stray contacts but not contacts with the marble own pieces or scenery', () => {
		const project = createTwoLaneProject();
		const contact = (time: number, marbleEntityId: string, otherEntityId: string, kind: 'piece' | 'marble' = 'piece') => ({
			time,
			marbleEntityId,
			otherEntityId,
			kind,
			position: { x: 0, y: 0 },
			speed: 1
		});
		const result = createResult({
			contacts: [
				// Hit contact, second bounce on its own platform and a ride on a free rail: expected
				contact(1, 'marble-a', 'pa1'),
				contact(1.2, 'marble-a', 'pa1'),
				contact(1.4, 'marble-a', 'rail'),
				// Bass strikes the melody's platform twice, the melody a loose platform, and the marbles collide
				contact(2.1, 'marble-b', 'pa2'),
				contact(2.3, 'marble-b', 'pa2'),
				contact(2.5, 'marble-a', 'loose'),
				contact(2.7, 'marble-a', 'marble-b', 'marble'),
				contact(2.7, 'marble-b', 'marble-a', 'marble')
			],
			hits: createResult().hits.filter((item) => item.status !== 'open')
		});

		const preflight = preflightExport(project, result);

		expect(preflight.issues.map((issue) => issue.title)).toEqual(['Bass strikes pa2 of Melody', 'Melody strikes the free loose', 'Melody collides with Bass']);
		expect(preflight.issues[0]?.detail).toBe('An extra strike 2 times from 0:02.10, without a note.');
		expect(preflight.issues[2]?.target?.ids).toEqual(['marble-a', 'marble-b']);
	});

	it('should flag a lane far off the shared descent pace', () => {
		const project = createTwoLaneProject();
		const base = createResult();
		const result = createResult({
			pace: { rate: 0.3, anchorTime: 1, anchorY: 0.2, limit: 0.25 },
			descent: [{ time: 0, y: 0.5 }],
			hits: [...base.hits.slice(0, 3), hit('lane-b', 'b1', 1.5, { pieceEntityId: 'pb1', dot: { x: 0.1, y: -0.9 } })]
		});

		const preflight = preflightExport(project, result);

		expect(preflight.issues.filter((issue) => issue.id.startsWith('pace'))).toEqual([
			expect.objectContaining({ title: 'Bass leaves the shared pace', detail: '0.95 m below the other marbles at 0:01.50, so the camera may lose it.' })
		]);
	});

	it('should report loop mismatches when loop mode is on', () => {
		const project = loadFixture('loop');
		project.end -= 0.5;

		const preflight = preflightExport(project, simulator.simulate(project));

		expect(preflight.issues.find((issue) => issue.id === 'loop')?.detail).toContain('than whole bars');
	});
});
