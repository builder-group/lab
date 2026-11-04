import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { parseProject, type TEntity, type TProject } from '@/modules/project';
import type { THitResult, TResolvedPiece, TSimulationResult } from '@/modules/simulation';
import { createSimulator, type TSimulator } from '@/modules/simulation/simulate';
import { framingFix, framingProblemAt, lookProblems, preflightExport, problemSummary, struckPieces, workspaceProblems, type TExportPreflight, type TPreflightIssue } from './export-preflight';

function loadFixture(name: string): TProject {
	const json = readFileSync(new URL(`../../../fixtures/${name}.marble.json`, import.meta.url), 'utf8');
	const [isProjectOk, projectErr, project] = parseProject(json);
	if (!isProjectOk) throw projectErr;
	// A Song, so the checks here are about the run and not about the missing Song
	return { ...project, music: { ...project.music, sources: [{ id: 'song', kind: 'midi', path: 'song.mid', name: 'Song', offset: 0 }] } };
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
		$schema: 'marble-project@4',
		physics: { gravityScale: 1 },
		id: 'preflight',
		title: 'Preflight',
		revision: 3,
		frame: { width: 9, height: 16 },
		end: 4,
		music: {
			sources: [{ id: 'song', kind: 'midi', path: 'audio/song.mid', name: 'Song', offset: 0 }],
			lanes: [
				{
					id: 'lane-a',
					name: 'Melody',
					color: '#3478f6',
					instrument: 9,
					hits: [
						{ id: 'a1', time: 1 },
						{ id: 'a2', time: 2 },
						{ id: 'a3', time: 3 }
					]
				},
				{ id: 'lane-b', name: 'Bass', color: '#ff9f0a', instrument: 9, hits: [{ id: 'b1', time: 1.5 }] }
			],
			backing: []
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

let pieceCount = 0;

/** A piece well away from the others */
function piece(entityId: string, type = 'platform'): TResolvedPiece {
	pieceCount++;
	return { entityId, type, position: { x: pieceCount, y: 0 }, angle: 0, params: {}, contactPoint: null, contactNormal: null, hitTime: null, status: 'placed' };
}

/** The issues of zigzag, whose track is older than the checks of how a track looks, as are long-gap, reference-20, two-marbles and windmill */
function besidesLook(preflight: TExportPreflight): TPreflightIssue[] {
	return preflight.issues.filter((issue) => issue.kind !== 'strike' && issue.kind !== 'touching');
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

describe('problem workspaces', () => {
	const issue = (kind: TPreflightIssue['kind'], id: string): TPreflightIssue => ({ id, kind, severity: 'warning', title: id, detail: '', target: null });
	const preflight: TExportPreflight = { state: 'checked', issues: [issue('hit', 'a'), issue('framing', 'b'), issue('decor', 'c'), issue('song', 'd')], summary: '', warnings: 4, notes: 0, hitCount: 2, onTimeCount: 1 };

	it('should count hits in Compose and camera and Decor problems in Film, without the Song', () => {
		expect(workspaceProblems(preflight)).toEqual({ compose: 1, film: 2 });
	});

	it('should summarize only the workspace it is asked for', () => {
		expect(problemSummary(preflight, 'compose').label).toBe('1 hit needs attention');
		expect(problemSummary(preflight, 'film').label).toBe('1 of 2 hits on time · 2 other problems');
		expect(problemSummary(preflight).problems).toHaveLength(3);
	});
});

describe('preflightExport function', () => {
	let simulator: TSimulator;

	beforeAll(async () => {
		simulator = await createSimulator();
	});

	it('should pass clean fixtures with every hit on time', () => {
		const project = loadFixture('zigzag');

		const preflight = preflightExport(project, simulator.simulate(project));

		expect(besidesLook(preflight)).toEqual([]);
		expect(preflight.onTimeCount).toBe(16);
	}, 20_000);

	it('should pass Jingle Bells, whose camera keeps both marbles in frame, and report a marble the camera leaves out once the bass moves sideways', () => {
		const project = loadFixture('jingle-bells');
		expect(preflightExport(project, simulator.simulate(project)).issues).toEqual([]);

		// The bass pieces follow their marble, so moving its release 20 cm moves its whole run away from the melody
		const bass = project.entities.find((entity) => entity.name === 'Bass' && entity.components.release != null);
		if (bass?.components.release == null) throw new Error('No bass release');
		bass.components.release.position.x += 0.2;
		const result = simulator.simulate(project);
		const preflight = preflightExport(project, result);
		const framing = preflight.issues.filter((issue) => issue.kind === 'framing');
		const first = framing.find((issue) => issue.laneId === 'lane-2');

		expect(first).toEqual(
			expect.objectContaining({
				id: 'frame:lane-2:1',
				severity: 'warning',
				title: expect.stringMatching(/^Bass leaves the frame at 0:09\.\d\d \(\d+ hits\)$/),
				detail: expect.stringMatching(/^Out of frame for \d\.\d s while it plays, until 0:1\d\.\d\d\. The camera follows Melody there\.$/),
				// Framing problems open Film at their time with the Camera selected, with a span for the Camera track
				target: { ids: ['camera'], time: first?.span?.from, workspace: 'design' }
			})
		);
		// The jump lands inside the span, where the Camera panel shows the problem
		if (first?.span == null) throw new Error('No framing span');
		expect(framingProblemAt(preflight, first.span.from)?.id).toBe(first.id);

		// Add Wide Shot Here is offered only after a what-if of the camera with it keeps Bass in frame there
		const fix = framingFix(project, result, first);
		expect(fix).toEqual(expect.objectContaining({ label: 'Add Wide Shot Here', detail: expect.stringMatching(/^Adds a Wide shot at 0:0\d\.\d\d that holds \d\.\d s, so Bass stays in frame\.$/) }));
		const command = fix?.commands[0];
		if (command?.type !== 'setDesign' || command.design.camera == null) throw new Error('No camera edit');
		const fixed = { ...project, design: { ...project.design, camera: command.design.camera } };
		const after = preflightExport(fixed, result).issues.filter((issue) => issue.kind === 'framing');
		expect(after.length).toBeLessThan(framing.length);
		const { from, to } = first.span;
		expect(after.some((issue) => issue.laneId === first.laneId && (issue.span?.from ?? 0) < to && (issue.span?.to ?? 0) > from)).toBe(false);
	}, 20_000);

	it('should report blocked hits and drifting dots after a platform is turned', () => {
		const project = loadFixture('zigzag');
		const turned = project.entities.find((entity) => entity.components.hitLink?.hitId === project.music.lanes[0]?.hits[4]?.id);
		if (turned?.components.hitLink == null) throw new Error('No linked platform');
		turned.components.hitLink.angle += 0.9;

		const preflight = preflightExport(project, simulator.simulate(project));

		expect(preflight.summary).toMatch(/^\d+ hits? needs? attention( · \d+ other problems?)?$/);
		expect(preflight.issues[0]).toEqual(expect.objectContaining({ severity: 'warning', title: expect.stringMatching(/^Hit \d+ of Marble 1 is Blocked$/) }));
		// The camera follows a single marble, so it never leaves the frame
		expect(preflight.issues.filter((issue) => issue.kind === 'framing')).toEqual([]);
	});

	it('should not report a single marble the camera follows, even with dots past the old lane band', () => {
		const project = loadFixture('loop');

		const preflight = preflightExport(project, simulator.simulate(project));

		expect(preflight.warnings).toBe(0);
		expect(preflight.summary).toBe('21 of 21 hits on time');
	});

	it('should be pending without a result for the current revision', () => {
		const project = createTwoLaneProject();

		expect(preflightExport(project, null).state).toBe('pending');
		expect(preflightExport(project, createResult({ revision: 2 })).summary).toBe('Checking the track…');
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
			['Hit 1 of Melody is Missed', 'Lands 50 ms after the note.'],
			['Hit 1 of Bass is Blocked', 'Bass already passes through this spot earlier in its run, so the platform is left out.'],
			['Hit 2 of Melody is Stopped', 'The marble stops on the platform instead of striking it.'],
			['Hit 3 of Melody is Early', 'Lands 12 ms before the note.']
		]);
		expect(preflight.summary).toBe('4 hits need attention');
		expect(preflight.issues[0]?.target).toEqual({ ids: ['pa1'], point: { x: -0.1, y: 0.2 }, time: 1 });
	});

	it('should note open hits per lane and select the first one', () => {
		const project = createTwoLaneProject();

		const preflight = preflightExport(project, createResult());

		expect(preflight.warnings).toBe(0);
		expect(preflight.issues).toEqual([expect.objectContaining({ severity: 'info', title: 'Open note, Melody at 0:03.00', target: { ids: ['hit:lane-a:a3'], time: 3 } })]);
		expect(preflight.summary).toBe('3 of 4 hits on time · 1 tip');
	});

	it('should not report framing from dots alone: the run without marble motion has no camera', () => {
		const project = createTwoLaneProject();
		const result = createResult({ hits: [hit('lane-a', 'a1', 1, { pieceEntityId: 'pa1', dot: { x: 1.2, y: 0 } })] });

		expect(preflightExport(project, result).issues).toEqual([]);
	});

	it('should flag stray contacts but not contacts with the marble own pieces, scenery or free pieces', () => {
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
				// Hit contact, a ride on a free rail and a strike on a free platform, which is environment: expected.
				// The second bounce on its own platform is its own problem
				contact(1, 'marble-a', 'pa1'),
				contact(1.2, 'marble-a', 'pa1'),
				contact(1.4, 'marble-a', 'rail'),
				// Bass strikes the melody's platform twice and the marbles collide
				contact(2.1, 'marble-b', 'pa2'),
				contact(2.3, 'marble-b', 'pa2'),
				contact(2.5, 'marble-a', 'loose'),
				contact(2.7, 'marble-a', 'marble-b', 'marble'),
				contact(2.7, 'marble-b', 'marble-a', 'marble')
			],
			hits: createResult().hits.filter((item) => item.status !== 'open')
		});

		const preflight = preflightExport(project, result);

		expect(preflight.issues.map((issue) => issue.title)).toEqual(['Melody hits pa1 twice', 'Bass hits pa2 of Melody', 'Melody collides with Bass']);
		expect(preflight.issues[1]?.detail).toBe('Hits it 2 times from 0:02.10, without a note.');
		expect(preflight.issues[2]?.target?.ids).toEqual(['marble-a', 'marble-b']);
	});

	it('should count a platform its own marble strikes twice as a problem, with a tip for pieces that touch', () => {
		const project = createTwoLaneProject();
		const at = (entityId: string, y: number): TResolvedPiece => ({ ...piece(entityId), position: { x: 0, y }, params: { length: 0.09, thickness: 0.012 } });
		const strike = (time: number) => ({ time, marbleEntityId: 'marble-a', otherEntityId: 'pa1', kind: 'piece' as const, position: { x: 0, y: 0.03 }, speed: 1.5 });
		const result = createResult({
			pieces: [at('pa1', 0.03), at('pa2', 0)],
			contacts: [strike(1), strike(1.2)],
			hits: createResult().hits.filter((item) => item.hitId === 'a1')
		});

		const preflight = preflightExport(project, result);

		expect(preflight.issues.find((issue) => issue.kind === 'strike')).toMatchObject({ title: 'Melody hits pa1 twice', severity: 'warning', label: 'Hit Twice', detail: 'Hits it 2 times from 0:01.20, with one note.' });
		expect(preflight.issues.find((issue) => issue.kind === 'touching')).toMatchObject({ title: 'pa1 touches pa2', severity: 'info', label: 'Touching' });
		expect(lookProblems(preflight).get('pa1')?.map((issue) => issue.kind)).toEqual(['strike', 'touching']);
	});

	it('should report loop mismatches when loop mode is on', () => {
		const project = loadFixture('loop');
		project.end -= 0.5;

		const preflight = preflightExport(project, simulator.simulate(project));

		expect(preflight.issues.find((issue) => issue.id === 'loop')?.detail).toContain('than whole bars');
	});
});

describe('a project with hits and no Song', () => {
	function noSong(): TProject {
		const project = createTwoLaneProject();
		return { ...project, music: { ...project.music, sources: [] } };
	}

	it('should warn in the sheet and ask for a Song beside the summary, without counting a problem', () => {
		const project = noSong();
		const hits = project.music.lanes.flatMap((lane) => lane.hits.map((item) => hit(lane.id, item.id, item.time)));

		const preflight = preflightExport(project, createResult({ hits, revision: project.revision }));
		const summary = problemSummary(preflight);

		expect(preflight.issues.find((issue) => issue.kind === 'song')).toMatchObject({ severity: 'warning', title: 'Add a Song' });
		expect(preflight.warnings).toBeGreaterThan(0);
		expect(preflight.summary).toContain('Add a Song');
		expect(summary.needsSong).toBe(true);
		expect(summary.problems.some((issue) => issue.kind === 'song')).toBe(false);
	});

	it('should not ask for a Song with no hits to play', () => {
		const empty = noSong();
		const project = { ...empty, music: { ...empty.music, lanes: empty.music.lanes.map((lane) => ({ ...lane, hits: [] })) } };

		const preflight = preflightExport(project, createResult({ hits: [], revision: project.revision }));

		expect(problemSummary(preflight).needsSong).toBe(false);
	});
});

describe('problemSummary function', () => {
	// Melody's windmill follows the marble at 0:02.50 and sits in its earlier run
	function withWindmill(project: TProject): TProject {
		const windmill: TEntity = {
			id: 'windmill',
			name: 'Windmill 1',
			components: {
				piece: { type: 'windmill', params: { entryDelay: 0.5 } },
				transform: { position: { x: 0, y: 0 }, angle: 0 },
				hitLink: { laneId: 'lane-a', hitId: 'a2', angle: 0, contactAt: 0.5, pinned: false, anchored: true, offset: { x: 0, y: 0 } }
			}
		};
		return { ...project, entities: [...project.entities, windmill] };
	}

	it('should read Checking until the run for the current revision arrives', () => {
		const summary = problemSummary(preflightExport(createTwoLaneProject(), createResult({ revision: 2 })));

		expect(summary).toEqual(expect.objectContaining({ state: 'pending', label: 'Checking…', problems: [] }));
	});

	it('should count hits on time and other problems such as Blocked scenery and extra strikes', () => {
		// Prepare
		const project = withWindmill(createTwoLaneProject());
		const result = createResult({
			pieces: [...createResult().pieces, { ...piece('windmill', 'windmill'), status: 'blocked', entryTime: 2.5 }],
			contacts: [{ time: 2.2, marbleEntityId: 'marble-a', otherEntityId: 'pb1', kind: 'piece', position: { x: 0, y: 0 } }]
		});

		// Act
		const summary = problemSummary(preflightExport(project, result));

		// Assert
		expect(summary.label).toBe('3 of 4 hits on time · 2 other problems');
		expect(summary.problems.map((issue) => issue.title)).toEqual(['Melody hits pb1 of Bass', 'Windmill 1 of Melody is Blocked']);
	});

	it('should list the pieces another marble hits, for the Layers badge and the inspector pill', () => {
		// Prepare: Melody's marble hits Bass's platform twice, and the two marbles touch once
		const project = createTwoLaneProject();
		const result = createResult({
			contacts: [
				{ time: 2.2, marbleEntityId: 'marble-a', otherEntityId: 'pb1', kind: 'piece', position: { x: 0, y: 0 } },
				{ time: 2.4, marbleEntityId: 'marble-a', otherEntityId: 'pb1', kind: 'piece', position: { x: 0, y: 0 } },
				{ time: 2.6, marbleEntityId: 'marble-a', otherEntityId: 'marble-b', kind: 'marble', position: { x: 0, y: 0 } }
			]
		});

		// Act
		const struck = struckPieces(preflightExport(project, result));

		// Assert: only the piece, named by the marble that hits it
		expect([...struck.keys()]).toEqual(['pb1']);
		expect(struck.get('pb1')).toEqual([expect.objectContaining({ title: 'Melody hits pb1 of Bass', by: 'Melody', laneId: 'lane-b', detail: 'Hits it 2 times from 0:02.20, without a note.' })]);
	});

	it('should order problems by their time, a framing span or their target, with timeless ones last', () => {
		// Prepare: the loop problem has no time
		const project = { ...withWindmill(createTwoLaneProject()), design: { ...createTwoLaneProject().design, loop: true } };
		const result = createResult({
			pieces: [...createResult().pieces, { ...piece('windmill', 'windmill'), status: 'blocked', entryTime: 2.5 }],
			contacts: [{ time: 2.2, marbleEntityId: 'marble-a', otherEntityId: 'pb1', kind: 'piece', position: { x: 0, y: 0 } }]
		});

		// Act
		const summary = problemSummary(preflightExport(project, result));

		// Assert
		const times = summary.problems.map((issue) => issue.time ?? issue.span?.from ?? issue.target?.time ?? Infinity);
		expect(times).toEqual([...times].sort((a, b) => a - b));
		expect(summary.problems.at(-1)?.kind).toBe('loop');
	});

	it('should put hit problems first in the label and every problem in time order', () => {
		const project = withWindmill(createTwoLaneProject());
		const base = createResult();
		const result = createResult({
			pieces: [...base.pieces, { ...piece('windmill', 'windmill'), status: 'blocked', entryTime: 0.5 }],
			hits: [hit('lane-a', 'a1', 1, { pieceEntityId: 'pa1', status: 'drifting', error: 0.012 }), ...base.hits.slice(1)]
		});

		const summary = problemSummary(preflightExport(project, result));

		expect(summary.label).toBe('1 hit needs attention · 1 other problem');
		expect(summary.problems.map((issue) => issue.kind)).toEqual(['scenery', 'hit']);
	});

	it('should keep a note after an Open note of the same marble Open rather than Out of Reach', () => {
		// Prepare: no platforms after Hit 1, so the marble falls out of the run before Hits 2 and 3
		const project = createTwoLaneProject();
		const base = createResult();
		const open = { pieceEntityId: null, dot: null, actualTime: null, error: null, status: 'open' as const };
		const result = createResult({
			hits: [base.hits[0] ?? hit('lane-a', 'a1', 1), hit('lane-a', 'a2', 2, open), hit('lane-a', 'a3', 3, open), base.hits[3] ?? hit('lane-b', 'b1', 1.5)]
		});

		// Act
		const preflight = preflightExport(project, result);

		// Assert
		expect(preflight.issues.filter((issue) => issue.severity === 'warning').map((issue) => issue.title)).toEqual(['Hit 2 of Melody is Out of Reach']);
		expect(problemSummary(preflight).label).toBe('1 hit needs attention');
	});
});
