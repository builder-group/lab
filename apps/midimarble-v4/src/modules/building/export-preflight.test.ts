import { beforeAll, describe, expect, it } from 'vitest';
import { backingOf, type TMarble, type TPiece, type TProject, tieOf } from '@/modules/project';
import type { THitResult, TResolvedPiece, TSimulationResult } from '@/modules/simulation';
import { createSimulator, type TSimulator } from '@/modules/simulation';
import { NO_BLENDER_OBJECTS, pendingPreflight, pieceProblems, checkRun, problemSummary, selectionProblems, struckPieces, workspaceProblems, type TExportPreflight, type TPreflightIssue } from './export-preflight';
import { loadFixture } from '@/modules/project/test-helpers';

function withSongFixture(name: string): TProject {
	const project = loadFixture(name);
	// A Song, so the checks here are about the run and not about the missing Song
	return { ...project, songs: [{ id: 'song', kind: 'midi', path: 'song.mid', name: 'Song', start: 0, backing: backingOf(project) }] };
}

// Two marbles side by side with one platform each, a free rail and a free platform
function createTwoMarbleProject(): TProject {
	const marble = (id: string, name: string, labelColor: string, x: number, hits: TMarble['hits']): TMarble => ({
		id,
		name,
		labelColor,
		sound: 9,
		radius: 0.008,
		start: { position: { x, y: 0.6 }, time: 0 },
		hits
	});
	const platform = (id: string, marbleId: string | null, hitId: string): TPiece => ({
		id,
		name: id,
		type: 'platform',
		params: {},
		angle: 0,
		place: marbleId != null ? { kind: 'plays', marbleId, hitId, contactAt: 0.5 } : { kind: 'free', position: { x: 0, y: 0 } }
	});
	return {
		$schema: 'marble-project@6',
		gravity: 1,
		id: 'preflight',
		title: 'Preflight',
		revision: 3,
		format: { width: 9, height: 16 },
		length: 4,
		songs: [{ id: 'song', kind: 'midi', path: 'audio/song.mid', name: 'Song', start: 0, backing: [] }],
		marbles: [
			marble('marble-a', 'Melody', '#3478f6', -0.1, [
				{ id: 'a1', time: 1 },
				{ id: 'a2', time: 2 },
				{ id: 'a3', time: 3 }
			]),
			marble('marble-b', 'Bass', '#ff9f0a', 0.1, [{ id: 'b1', time: 1.5 }])
		],
		track: {
			pieces: [
				platform('pa1', 'marble-a', 'a1'),
				platform('pa2', 'marble-a', 'a2'),
				platform('pb1', 'marble-b', 'b1'),
				platform('loose', null, ''),
				{ id: 'rail', name: 'rail', type: 'rail', params: {}, angle: 0, place: { kind: 'free', position: { x: 0, y: 0 } } }
			],
			groups: []
		},
		film: { theme: { base: 'pegboard' }, wall: {}, lights: { added: [] }, decor: [], madeInBlender: [], titles: [], quality: 'final', camera: { auto: true, distance: 0.85, tilt: 1, sway: 1, shots: [] } }
	};
}

function hit(marbleId: string, hitId: string, targetTime: number, patch: Partial<THitResult> = {}): THitResult {
	const x = marbleId === 'marble-a' ? -0.1 : 0.1;
	return { marbleId, hitId, targetTime, pieceId: null, dot: { x, y: 0.5 - targetTime * 0.3 }, velocity: null, actualTime: targetTime, error: 0, status: 'onTime', ...patch };
}

let pieceCount = 0;

/** A piece well away from the others */
function piece(entityId: string, type = 'platform'): TResolvedPiece {
	pieceCount++;
	return { pieceId: entityId, type, position: { x: pieceCount, y: 0 }, angle: 0, params: {}, contactPoint: null, contactNormal: null, hitTime: null, status: 'placed' };
}

function createResult(patch: Partial<TSimulationResult> = {}): TSimulationResult {
	return {
		revision: 3,
		duration: 4,
		marbles: [
			{ marbleId: 'marble-a', radius: 0.008, samples: [] },
			{ marbleId: 'marble-b', radius: 0.008, samples: [] }
		],
		pieces: [piece('pa1'), piece('pa2'), piece('pb1'), piece('loose'), piece('rail', 'rail')],
		contacts: [],
		hits: [
			hit('marble-a', 'a1', 1, { pieceId: 'pa1' }),
			hit('marble-a', 'a2', 2, { pieceId: 'pa2' }),
			hit('marble-a', 'a3', 3, { pieceId: null, actualTime: null, error: null, status: 'open' }),
			hit('marble-b', 'b1', 1.5, { pieceId: 'pb1' })
		],
		stats: { computeMs: 0, reusedUntil: 0, steps: 0 },
		...patch
	};
}

describe('problem workspaces', () => {
	const issue = (kind: TPreflightIssue['kind'], id: string): TPreflightIssue => ({ id, kind, severity: 'warning', title: id, detail: '', target: null });
	const preflight: TExportPreflight = { state: 'checked', issues: [issue('hit', 'a'), issue('framing', 'b'), issue('decor', 'c'), issue('song', 'd')], summary: '', warnings: 4, notes: 0, hitCount: 2, onTimeCount: 1 };

	it('should count hits in Track and camera and Decor problems in Film, without the Song', () => {
		expect(workspaceProblems(preflight)).toEqual({ track: 1, film: 2 });
	});

	it('should summarize only the workspace it is asked for', () => {
		expect(problemSummary(preflight, 'track').label).toBe('1 hit needs attention');
		expect(problemSummary(preflight, 'film').label).toBe('1 of 2 hits on time · 2 other problems');
		expect(problemSummary(preflight).problems).toHaveLength(3);
	});
});

describe('checkRun function', () => {
	let simulator: TSimulator;

	beforeAll(async () => {
		simulator = await createSimulator();
	});

	it('should tip about a long free fall in plain words, without counting it as a problem', () => {
		const project = createTwoMarbleProject();
		const marble = project.marbles[0];
		const result = simulator.simulate(project);
		const dots = [0.4, -1.7];
		const hits = (marble?.hits ?? []).slice(0, 2).map((hit, index) => ({ marbleId: marble?.id ?? '', hitId: hit.id, targetTime: 9 + index, pieceId: null, dot: { x: 0, y: dots[index] ?? 0 }, velocity: null, actualTime: null, error: null, status: 'open' as const }));

		const preflight = checkRun(project, { ...result, hits }, []);
		const tip = preflight.issues.find((issue) => issue.kind === 'fall');

		expect(tip?.title).toBe(`${marble?.name} falls 2.1 m at 0:09: a Long Rail fills that gap`);
		expect(tip?.severity).toBe('info');
		expect(problemSummary(preflight).problems.some((issue) => issue.kind === 'fall')).toBe(false);
	});

	it('should pass clean fixtures with every hit on time', () => {
		const project = withSongFixture('zigzag');

		const preflight = checkRun(project, simulator.simulate(project), NO_BLENDER_OBJECTS);

		expect(preflight.issues).toEqual([]);
		expect(preflight.onTimeCount).toBe(16);
	}, 20_000);


	it('should report blocked hits and drifting dots after a platform is turned', () => {
		const project = withSongFixture('zigzag');
		const turned = project.track.pieces.find((piece) => tieOf(piece)?.hitId === project.marbles[0]?.hits[4]?.id);
		if (turned == null || tieOf(turned) == null) throw new Error('No linked platform');
		turned.angle += 0.9;

		const preflight = checkRun(project, simulator.simulate(project), NO_BLENDER_OBJECTS);

		expect(preflight.summary).toMatch(/^\d+ hits? needs? attention( · \d+ other problems?)?$/);
		expect(preflight.issues[0]).toEqual(expect.objectContaining({ severity: 'warning', title: expect.stringMatching(/^Hit \d+ of Marble 1 is Blocked$/) }));
		// The camera follows a single marble, so it never leaves the frame
		expect(preflight.issues.filter((issue) => issue.kind === 'framing')).toEqual([]);
	});

	it('should not report a single marble the camera follows, even with dots past the old marble band', () => {
		const project = withSongFixture('tap-along');

		const preflight = checkRun(project, simulator.simulate(project), NO_BLENDER_OBJECTS);

		expect(preflight.warnings).toBe(0);
		expect(preflight.summary).toBe('16 of 16 hits on time');
	});

	it('should say it is checking while pending', () => {
		const preflight = pendingPreflight(createTwoMarbleProject());

		expect(preflight.state).toBe('pending');
		expect(preflight.summary).toBe('Checking the track…');
	});

	it('should explain missed, resting, blocked and drifting hits', () => {
		const project = createTwoMarbleProject();
		const result = createResult({
			hits: [
				hit('marble-a', 'a1', 1, { pieceId: 'pa1', status: 'missed', actualTime: 1.05, error: 0.05 }),
				hit('marble-a', 'a2', 2, { pieceId: 'pa2', status: 'missed', reason: 'resting' }),
				hit('marble-a', 'a3', 3, { pieceId: 'loose', status: 'drifting', error: -0.012 }),
				hit('marble-b', 'b1', 1.5, { pieceId: 'pb1', status: 'blocked', actualTime: null, error: null })
			]
		});

		const preflight = checkRun(project, result, NO_BLENDER_OBJECTS);

		expect(preflight.issues.map((issue) => [issue.title, issue.detail])).toEqual([
			['Hit 1 of Melody is Missed', 'Lands 50 ms after the note.'],
			['Hit 1 of Bass is Blocked', 'Bass already passes through this spot earlier in its run, so the platform is left out.'],
			['Hit 2 of Melody is Stopped', 'The marble stops on the platform instead of striking it.'],
			['Hit 3 of Melody is Early', 'Lands 12 ms before the note.']
		]);
		expect(preflight.summary).toBe('4 hits need attention');
		expect(preflight.issues[0]?.target).toEqual({ ids: ['pa1'], point: { x: -0.1, y: 0.2 }, time: 1 });
	});

	it('should note open hits per marble and select the first one', () => {
		const project = createTwoMarbleProject();

		const preflight = checkRun(project, createResult(), NO_BLENDER_OBJECTS);

		expect(preflight.warnings).toBe(0);
		expect(preflight.issues).toEqual([expect.objectContaining({ severity: 'info', title: 'Open note, Melody at 0:03.00', target: { ids: ['hit:marble-a:a3'], time: 3 } })]);
		expect(preflight.summary).toBe('3 of 4 hits on time · 1 tip');
	});

	it('should not report framing from dots alone: the run without marble motion has no camera', () => {
		const project = createTwoMarbleProject();
		const result = createResult({ hits: [hit('marble-a', 'a1', 1, { pieceId: 'pa1', dot: { x: 1.2, y: 0 } })] });

		expect(checkRun(project, result, NO_BLENDER_OBJECTS).issues).toEqual([]);
	});

	it('should flag stray contacts but not contacts with the marble own pieces, scenery or free pieces', () => {
		const project = createTwoMarbleProject();
		const contact = (time: number, marbleId: string, otherId: string, kind: 'piece' | 'marble' = 'piece') => ({
			time,
			marbleId,
			otherId,
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

		const preflight = checkRun(project, result, NO_BLENDER_OBJECTS);

		expect(preflight.issues.map((issue) => issue.title)).toEqual(['Melody hits pa1 twice', 'Bass hits pa2 of Melody', 'Melody collides with Bass']);
		expect(preflight.issues[1]?.detail).toBe('Hits it 2 times from 0:02.10, without a note.');
		expect(preflight.issues[2]?.target?.ids).toEqual(['marble-a', 'marble-b']);
	});

	it('should count a platform its own marble strikes twice as a problem, and pieces that touch', () => {
		const project = createTwoMarbleProject();
		const at = (entityId: string, y: number): TResolvedPiece => ({ ...piece(entityId), position: { x: 0, y }, params: { length: 0.09, thickness: 0.012 } });
		const strike = (time: number) => ({ time, marbleId: 'marble-a', otherId: 'pa1', kind: 'piece' as const, position: { x: 0, y: 0.03 }, speed: 1.5 });
		const result = createResult({
			pieces: [at('pa1', 0.03), at('pa2', 0)],
			contacts: [strike(1), strike(1.2)],
			hits: createResult().hits.filter((item) => item.hitId === 'a1')
		});

		const preflight = checkRun(project, result, NO_BLENDER_OBJECTS);

		expect(preflight.issues.find((issue) => issue.kind === 'strike')).toMatchObject({ title: 'Melody hits pa1 twice', severity: 'warning', label: 'Hit Twice', detail: 'Hits it 2 times from 0:01.20, with one note.' });
		expect(preflight.issues.find((issue) => issue.kind === 'touching')).toMatchObject({ title: 'pa1 touches pa2', severity: 'warning', label: 'Touching' });
		expect(pieceProblems(preflight).get('pa1')?.map((issue) => issue.kind)).toEqual(['touching', 'strike']);
	});

	it('should count a platform its marble rolls on as a problem, in plain words', () => {
		const project = createTwoMarbleProject();
		// Melody stays on pa1 for the whole half second after its note at 1 s
		const samples = Array.from({ length: 300 }, (_, index) => ({ time: index / 120, position: { x: 0, y: 0.015 }, angle: 0, velocity: { x: 0, y: 0 } }));
		const result = createResult({
			pieces: [{ ...piece('pa1'), position: { x: 0, y: 0 }, params: { length: 0.09, thickness: 0.012 } }],
			marbles: [{ marbleId: 'marble-a', radius: 0.008, samples }],
			hits: [hit('marble-a', 'a1', 1, { pieceId: 'pa1' })]
		});

		const preflight = checkRun(project, result, NO_BLENDER_OBJECTS);

		expect(preflight.issues.find((issue) => issue.kind === 'roll')).toMatchObject({ title: 'Melody rolls on pa1', severity: 'warning', label: 'Rolls', target: { ids: ['pa1'], time: 1 } });
		expect(pieceProblems(preflight).get('pa1')?.map((issue) => issue.kind)).toEqual(['roll']);
	});
});

describe('a project with hits and no Song', () => {
	function noSong(): TProject {
		const project = createTwoMarbleProject();
		return { ...project, songs: [] };
	}

	it('should warn in the sheet and ask for a Song beside the summary, without counting a problem', () => {
		const project = noSong();
		const hits = project.marbles.flatMap((marble) => marble.hits.map((item) => hit(marble.id, item.id, item.time)));

		const preflight = checkRun(project, createResult({ hits, revision: project.revision }), NO_BLENDER_OBJECTS);
		const summary = problemSummary(preflight);

		expect(preflight.issues.find((issue) => issue.kind === 'song')).toMatchObject({ severity: 'warning', title: 'Add a Song' });
		expect(preflight.warnings).toBeGreaterThan(0);
		expect(preflight.summary).toContain('Add a Song');
		expect(summary.needsSong).toBe(true);
		expect(summary.problems.some((issue) => issue.kind === 'song')).toBe(false);
	});

	it('should not ask for a Song with no hits to play', () => {
		const empty = noSong();
		const project = { ...empty, marbles: empty.marbles.map((marble) => ({ ...marble, hits: [] })) };

		const preflight = checkRun(project, createResult({ hits: [], revision: project.revision }), NO_BLENDER_OBJECTS);

		expect(problemSummary(preflight).needsSong).toBe(false);
	});
});

describe('problemSummary function', () => {
	// Melody's windmill follows the marble at 0:02.50 and sits in its earlier run
	function withWindmill(project: TProject): TProject {
		const windmill: TPiece = {
			id: 'windmill',
			name: 'Windmill 1',
			type: 'windmill', params: { entryDelay: 0.5 }, angle: 0, place: { kind: 'follows', marbleId: 'marble-a', hitId: 'a2', offset: { x: 0, y: 0 } }
		};
		return { ...project, track: { ...project.track, pieces: [...project.track.pieces, windmill] } };
	}

	it('should read Checking until the run for the current revision arrives', () => {
		const summary = problemSummary(pendingPreflight(createTwoMarbleProject()));

		expect(summary).toEqual(expect.objectContaining({ state: 'pending', label: 'Checking…', problems: [] }));
	});

	it('should count hits on time and other problems such as Blocked scenery and extra strikes', () => {
		// Prepare
		const project = withWindmill(createTwoMarbleProject());
		const result = createResult({
			pieces: [...createResult().pieces, { ...piece('windmill', 'windmill'), status: 'blocked', entryTime: 2.5 }],
			contacts: [{ time: 2.2, marbleId: 'marble-a', otherId: 'pb1', kind: 'piece', position: { x: 0, y: 0 } }]
		});

		// Act
		const summary = problemSummary(checkRun(project, result, NO_BLENDER_OBJECTS));

		// Assert
		expect(summary.label).toBe('3 of 4 hits on time · 2 other problems');
		expect(summary.problems.map((issue) => issue.title)).toEqual(['Melody hits pb1 of Bass', 'Windmill 1 of Melody is Blocked']);
	});

	it('should list the pieces another marble hits, for the Layers badge and the inspector pill', () => {
		// Prepare: Melody's marble hits Bass's platform twice, and the two marbles touch once
		const project = createTwoMarbleProject();
		const result = createResult({
			contacts: [
				{ time: 2.2, marbleId: 'marble-a', otherId: 'pb1', kind: 'piece', position: { x: 0, y: 0 } },
				{ time: 2.4, marbleId: 'marble-a', otherId: 'pb1', kind: 'piece', position: { x: 0, y: 0 } },
				{ time: 2.6, marbleId: 'marble-a', otherId: 'marble-b', kind: 'marble', position: { x: 0, y: 0 } }
			]
		});

		// Act
		const struck = struckPieces(checkRun(project, result, NO_BLENDER_OBJECTS));

		// Assert: only the piece, named by the marble that hits it
		expect([...struck.keys()]).toEqual(['pb1']);
		expect(struck.get('pb1')).toEqual([expect.objectContaining({ title: 'Melody hits pb1 of Bass', by: 'Melody', marbleId: 'marble-b', detail: 'Hits it 2 times from 0:02.20, without a note.' })]);
	});

	it('should order problems by their time, a framing span or their target, with timeless ones last', () => {
		// Prepare
		const project = withWindmill(createTwoMarbleProject());
		const result = createResult({
			pieces: [...createResult().pieces, { ...piece('windmill', 'windmill'), status: 'blocked', entryTime: 2.5 }],
			contacts: [{ time: 2.2, marbleId: 'marble-a', otherId: 'pb1', kind: 'piece', position: { x: 0, y: 0 } }]
		});

		// Act
		const summary = problemSummary(checkRun(project, result, NO_BLENDER_OBJECTS));

		// Assert
		const times = summary.problems.map((issue) => issue.time ?? issue.span?.from ?? issue.target?.time ?? Infinity);
		expect(times).toEqual([...times].sort((a, b) => a - b));
	});

	it('should put hit problems first in the label and every problem in time order', () => {
		const project = withWindmill(createTwoMarbleProject());
		const base = createResult();
		const result = createResult({
			pieces: [...base.pieces, { ...piece('windmill', 'windmill'), status: 'blocked', entryTime: 0.5 }],
			hits: [hit('marble-a', 'a1', 1, { pieceId: 'pa1', status: 'drifting', error: 0.012 }), ...base.hits.slice(1)]
		});

		const summary = problemSummary(checkRun(project, result, NO_BLENDER_OBJECTS));

		expect(summary.label).toBe('1 hit needs attention · 1 other problem');
		expect(summary.problems.map((issue) => issue.kind)).toEqual(['scenery', 'hit']);
	});

	it('should keep a note after an Open note of the same marble Open rather than Out of Reach', () => {
		// Prepare: no platforms after Hit 1, so the marble falls out of the run before Hits 2 and 3
		const project = createTwoMarbleProject();
		const base = createResult();
		const open = { pieceId: null, dot: null, actualTime: null, error: null, status: 'open' as const };
		const result = createResult({
			hits: [base.hits[0] ?? hit('marble-a', 'a1', 1), hit('marble-a', 'a2', 2, open), hit('marble-a', 'a3', 3, open), base.hits[3] ?? hit('marble-b', 'b1', 1.5)]
		});

		// Act
		const preflight = checkRun(project, result, NO_BLENDER_OBJECTS);

		// Assert
		expect(preflight.issues.filter((issue) => issue.severity === 'warning').map((issue) => issue.title)).toEqual(['Hit 2 of Melody is Out of Reach']);
		expect(problemSummary(preflight).label).toBe('1 hit needs attention');
	});
	describe('a recording that is missing', () => {
		let simulator: TSimulator;

		beforeAll(async () => {
			simulator = await createSimulator();
		});

		const withRecording = (): TProject => ({ ...loadFixture('zigzag'), songs: [{ id: 'song-take', kind: 'audio', path: 'audio/take.wav', name: 'take.wav', start: 0, backing: [] }] });

		it('should be a problem naming the file', () => {
			// Prepare
			const project = withRecording();

			// Act
			const preflight = checkRun(project, simulator.simulate(project), NO_BLENDER_OBJECTS, ['song-take']);

			// Assert
			const issue = preflight.issues.find((item) => item.title.includes('take.wav'));
			expect(issue?.severity).toBe('warning');
			expect(problemSummary(preflight).problems).toContain(issue);
		});

		it('should say nothing while the file loads', () => {
			// Prepare
			const project = withRecording();

			// Act
			const preflight = checkRun(project, simulator.simulate(project), NO_BLENDER_OBJECTS, []);

			// Assert
			expect(preflight.issues.some((item) => item.title.includes('take.wav'))).toBe(false);
		});

		it('should not check again what it already checked with the same files', () => {
			// Prepare
			const project = withRecording();
			const result = simulator.simulate(project);
			const missing = ['song-take'];

			// Act
			const first = checkRun(project, result, NO_BLENDER_OBJECTS, missing);

			// Assert
			expect(checkRun(project, result, NO_BLENDER_OBJECTS, missing)).toBe(first);
			expect(checkRun(project, result, NO_BLENDER_OBJECTS, [])).not.toBe(first);
		});
	});
});

describe('selectionProblems function', () => {
	const issue = (id: string, ids: string[], kind: TPreflightIssue['kind'] = 'touching'): TPreflightIssue => ({ id, kind, severity: 'warning', title: id, target: { ids } });
	const preflight = (issues: TPreflightIssue[]): TExportPreflight => ({ state: 'checked', issues, summary: '', warnings: issues.length, notes: 0, hitCount: 0, onTimeCount: 0 });

	it('should name what is wrong with two pieces a problem selected, and with either alone', () => {
		const shown = preflight([issue('touching:a:b', ['b', 'a']), issue('other', ['c'])]);
		expect(selectionProblems(shown, ['a', 'b']).map((item) => item.id)).toEqual(['touching:a:b']);
		expect(selectionProblems(shown, ['a']).map((item) => item.id)).toEqual(['touching:a:b']);
		expect(selectionProblems(shown, ['a', 'c'])).toEqual([]);
		expect(selectionProblems(shown, [])).toEqual([]);
	});

	it('should find a broken hit from its hit key, and leave framing to the Camera', () => {
		const shown = preflight([issue('hit:marble-1:h1', ['piece-1'], 'hit'), issue('frame:marble-1:1', ['camera'], 'framing')]);
		expect(selectionProblems(shown, ['hit:marble-1:h1']).map((item) => item.id)).toEqual(['hit:marble-1:h1']);
		expect(selectionProblems(shown, ['camera'])).toEqual([]);
	});
});
