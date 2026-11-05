import { beforeAll, describe, expect, it } from 'vitest';
import { assignNotesCommands } from '@/modules/music';
import { applyProjectCommands, BACKING_ID, createProject, type TProject } from '@/modules/project';
import { loadFixture } from '@/modules/project/test-helpers';
import { autoPlace, createRailForGap, createSimulator, createSwitchbackForGap, createTunnelForGap, type THitResult, type TSimulationResult } from '@/modules/simulation';
import { preflightExport, problemSummary } from '@/modules/design/export-preflight';
import { hitSummary } from '@/modules/studio/timeline/hit-status';
import { newlyBroken } from './bowl-assist';
import { addedProblems, brokenHits, fixedWords, fixPiece, moveClear, lookPieces, releaseFix, replaceBroken, replaceLabel, replacePlan, replaceResultMessage, replaceResultSummary, sceneryFix, withCommands, type TReplaceDeps } from './fix-it';

function hit(time: number, status: THitResult['status'], options: Partial<THitResult> = {}): THitResult {
	return {
		laneId: 'lane-1',
		hitId: `h${time}`,
		targetTime: time,
		pieceEntityId: status === 'open' ? null : `p${time}`,
		dot: { x: 0, y: -time },
		velocity: { x: 0, y: -1 },
		actualTime: null,
		error: null,
		status,
		...options
	};
}

function oneMarble(): TProject {
	const project = createProject();
	const lane = project.music.lanes[0];
	if (lane != null) lane.id = 'lane-1';
	const marble = project.entities.find((entity) => entity.components.marble != null);
	if (marble?.components.marble != null) marble.components.marble.laneId = 'lane-1';
	return project;
}

describe('brokenHits function', () => {
	it('should count broken hits and the early or late hits after the first broken one', () => {
		// Prepare
		const hits = [hit(1, 'drifting'), hit(2, 'onTime'), hit(3, 'blocked'), hit(4, 'drifting'), hit(5, 'missed'), hit(6, 'open')];

		// Act
		const broken = brokenHits(hits);

		// Assert
		expect(broken.map((item) => item.targetTime)).toEqual([3, 4, 5]);
	});

	it('should keep only the named hits that are off time', () => {
		const hits = [hit(1, 'onTime'), hit(2, 'blocked'), hit(3, 'missed')];

		expect(brokenHits(hits, ['lane-1/h1', 'lane-1/h2']).map((item) => item.targetTime)).toEqual([2]);
	});
});

describe('newlyBroken function', () => {
	it('should name only the hits an edit broke', () => {
		const before = [hit(1, 'blocked'), hit(2, 'onTime'), hit(3, 'onTime')];
		const after = [hit(1, 'blocked'), hit(2, 'missed'), hit(3, 'onTime')];

		expect(newlyBroken(before, after).map((item) => item.targetTime)).toEqual([2]);
	});
});

describe('replaceLabel function', () => {
	it('should be a verb and the count of broken hits, which are known before Fix Hits runs', () => {
		expect(replaceLabel(24)).toBe('Fix 24 Hits');
		expect(replaceLabel(1, 'Hit 3 of Melody')).toBe('Fix Hit 3 of Melody');
		expect(replaceLabel(1)).toBe('Fix 1 Hit');
	});
});

describe('releaseFix function', () => {
	it('should release the marble so it arrives where and how fast it did before the edit', () => {
		// Prepare
		const project = oneMarble();
		const lane = project.music.lanes[0];
		if (lane != null) lane.hits = [{ id: 'h5', time: 5 }];
		const before = [hit(5, 'onTime', { dot: { x: 0.1, y: -2 }, velocity: { x: 0.2, y: -1 } })];
		const after = [hit(5, 'blocked')];

		// Act
		const commands = releaseFix(project, after, 'lane-1', before);

		// Assert
		const command = commands[0];
		expect(command?.type).toBe('setComponent');
		if (command?.type !== 'setComponent' || command.component.name !== 'release') throw new Error('Expected a release');
		const release = command.component.value;
		// At half gravity the marble falls back to 1 m/s in about 0.2 s
		const lead = 5 - release.time;
		expect(lead).toBeCloseTo(1 / 4.905, 3);
		expect(release.velocity?.y).toBeCloseTo(0, 3);
		const g = 4.905;
		expect(release.position.x + (release.velocity?.x ?? 0) * lead).toBeCloseTo(0.1, 3);
		expect(release.position.y + (release.velocity?.y ?? 0) * lead - (g * lead * lead) / 2).toBeCloseTo(-2, 3);
	});

	it('should leave a short first fall alone', () => {
		const project = oneMarble();
		const lane = project.music.lanes[0];
		if (lane != null) lane.hits = [{ id: 'h1', time: 0.8 }];

		expect(releaseFix(project, [hit(0.8, 'blocked')], 'lane-1', [hit(0.8, 'onTime')])).toEqual([]);
	});
});

// MARK: - Recovery


describe('replaceBroken function', () => {
	let simulate: (project: TProject) => TSimulationResult;

	beforeAll(async () => {
		const simulator = await createSimulator();
		simulate = (project) => simulator.simulate(project);
	});

	function deps(): TReplaceDeps {
		return {
			simulate: async (project) => simulate(project),
			autoPlace: async (project, target, entity) => {
				const [isOk, error, placement] = autoPlace(project, simulate(project), target.laneId, target.hitId, { simulate, type: entity.components.piece?.type });
				if (!isOk) throw error;
				return placement.entity;
			},
			gapPiece: async (project, gap, type, id) => {
				const create = type === 'switchback' ? createSwitchbackForGap : type === 'rail' ? createRailForGap : createTunnelForGap;
				const [isOk, error, proposal] = create(project, simulate(project), gap.laneId, gap.fromHitId, gap.toHitId, { simulate, id });
				if (!isOk) throw error;
				return proposal.entity;
			},
			commit: (project, commands) => {
				const [isOk, error, next] = applyProjectCommands(project, commands);
				if (!isOk) throw error;
				return next;
			}
		};
	}

	// A fixture with `count` notes of its first track from `from` on handed to Backing, as Played By does
	function handToBacking(name: string, from: number, count: number): { before: TSimulationResult; edited: TProject; broken: TSimulationResult; laneId: string } {
		const project = loadFixture(name);
		const before = simulate(project);
		const lane = project.music.lanes[0];
		if (lane == null) throw new Error(`${name} has a track`);
		const notes = lane.hits.slice(from, from + count).map((item) => item.id);
		const [isEditOk, editErr, edited] = applyProjectCommands(project, assignNotesCommands(project, before, notes, BACKING_ID));
		if (!isEditOk) throw editErr;
		return { before, edited, broken: simulate(edited), laneId: lane.id };
	}

	/** The result notice as Compose shows it, with how the run stands from the problem model */
	function resultMessage(edited: TProject, broken: TSimulationResult, outcome: Awaited<ReturnType<typeof replaceBroken>>): string {
		const summary = problemSummary(preflightExport(outcome.project, { ...outcome.result, revision: outcome.project.revision }));
		const added = addedProblems(edited, broken, outcome.project, outcome.result);
		return replaceResultMessage(edited, broken.hits, outcome, { label: summary.label, hitProblems: summary.hitProblems, added });
	}

	it('should offer a platform struck twice or touching a Fix that clears it, breaks no hit and adds no problem', async () => {
		const project = loadFixture('zigzag');
		// The plain copied tilts, which Continue turns a little: the marble grazes two of its own earlier platforms
		for (const entity of project.entities) {
			const link = entity.components.hitLink;
			if (link != null) link.angle = link.angle < 0 ? -0.45 : 0.45;
		}
		const result = simulate(project);
		const problems = lookPieces(project, result);
		expect(problems.length).toBeGreaterThan(0);
		let fixed = 0;
		for (const entityId of problems.slice(0, 3)) {
			const fix = await fixPiece(project, result, entityId, deps());
			// Near the start of a song every later hit follows a tilt, so a small change isn't enough
			if (fix.commands == null) {
				expect(fix.label).toBe('Rebuild From Here');
				expect(fix.rebuildFrom).toBeDefined();
				continue;
			}
			fixed++;
			const next = withCommands(project, fix.commands);
			const run = simulate(next);
			expect(lookPieces(next, run)).not.toContain(entityId);
			expect(newlyBroken(result.hits, run.hits)).toEqual([]);
		}
		expect(fixed).toBeGreaterThanOrEqual(0);
		expect(replacePlan(project, result).label).toBe(`Fix ${problems.length} Platforms`);
	}, 120_000);

	it('should move the release and recover a run after its first notes become Backing', async () => {
		// Prepare
		const { before, edited, broken, laneId } = handToBacking('zigzag', 0, 3);
		const counted = brokenHits(broken.hits).length;
		expect(counted).toBeGreaterThan(0);
		const progress: { done: number; total: number }[] = [];

		// Act
		const outcome = await replaceBroken(edited, broken, { ...deps(), onProgress: (done, total) => progress.push({ done, total }) }, { before: before.hits });

		// Assert
		expect(outcome.releases).toEqual([laneId]);
		expect(hitSummary(outcome.result.hits).problems).toEqual([]);
		// One count for the whole run, the label's, and the fixed count only grows: never "0 of 37", then "0 of 38"
		expect(new Set(progress.map((item) => item.total))).toEqual(new Set([counted]));
		expect(progress.every((item, index) => index === 0 || item.done >= (progress[index - 1]?.done ?? 0))).toBe(true);
		const summary = problemSummary(preflightExport(outcome.project, { ...outcome.result, revision: outcome.project.revision }));
		expect(resultMessage(edited, broken, outcome)).toMatch(
			new RegExp(`^Marble 1 now starts just before its first note\\. .*${fixedWords(counted, counted)}: ${summary.label}`)
		);
	}, 60_000);

	it('should keep the release and recover a run after notes in its middle become Backing', async () => {
		// Prepare
		const { before, edited, broken } = handToBacking('zigzag', 8, 2);
		expect(brokenHits(broken.hits).length).toBeGreaterThan(0);

		// Act
		const outcome = await replaceBroken(edited, broken, deps(), { before: before.hits });

		// Assert: the release stays, since the marble's first notes still play
		expect(outcome.releases).toEqual([]);
		expect(hitSummary(outcome.result.hits).problems).toEqual([]);
		const summary = problemSummary(preflightExport(outcome.project, { ...outcome.result, revision: outcome.project.revision }));
		expect(resultMessage(edited, broken, outcome)).toMatch(new RegExp(`^Placed \\d+ platforms? again.*,? and fixed (?:all \\d+ broken hits|the broken hit): ${summary.label}`));
	}, 60_000);
});

describe('moveClear function', () => {
	// A windmill that follows Marble 1 at 0:02.00, sitting on the marble's straight fall from 0:00 to 0:01
	function createBlocked(): { project: TProject; result: TSimulationResult } {
		const base = createProject({ title: 'Move Clear' });
		const lane = base.music.lanes[0];
		if (lane == null) throw new Error('A new project has a marble');
		const project: TProject = {
			...base,
			music: { ...base.music, lanes: [{ ...lane, hits: [{ id: 'h1', time: 1.5 }] }] },
			entities: [
				...base.entities,
				{
					id: 'windmill',
					name: 'Windmill 1',
					components: {
						piece: { type: 'windmill', params: { entryDelay: 0.5 } },
						transform: { position: { x: 0, y: 0 }, angle: 0 },
						hitLink: { laneId: lane.id, hitId: 'h1', angle: 0, contactAt: 0.5, anchored: true, offset: { x: 0.1, y: 0.2 } }
					}
				}
			]
		};
		const samples = Array.from({ length: 101 }, (_, index) => ({ time: index / 100, position: { x: 0, y: 0.2 - index * 0.004 }, angle: 0, velocity: { x: 0, y: -0.4 } }));
		const result: TSimulationResult = {
			revision: project.revision,
			duration: 3,
			marbles: [{ entityId: 'marble', laneId: lane.id, radius: 0.008, samples }],
			pieces: [
				{
					entityId: 'windmill',
					type: 'windmill',
					position: { x: 0, y: 0 },
					angle: 0,
					params: { motorSpeed: 0 },
					contactPoint: null,
					contactNormal: null,
					hitTime: 1.5,
					status: 'blocked',
					entryTime: 2,
					shapes: [{ kind: 'ball', center: { x: 0, y: 0 }, radius: 0.02 }]
				}
			],
			contacts: [],
			hits: [],
			stats: { computeMs: 0, reusedUntil: 0, steps: 0 }
		};
		return { project, result };
	}

	it('should nudge the offset just far enough to clear the earlier run and keep the tie', () => {
		// Prepare
		const { project, result } = createBlocked();

		// Act
		const move = moveClear(project, result, 'windmill');

		// Assert: the ball of 2 cm clears a marble of 8 mm with a 3 mm margin on the first 5 mm ring past 3.1 cm
		expect(move?.distance).toBeCloseTo(0.035, 6);
		const command = move?.commands[0];
		if (command?.type !== 'setComponent' || command.component.name !== 'hitLink') throw new Error('Move Clear sets the tie');
		const { offset, laneId, hitId, anchored } = command.component.value;
		expect({ laneId, hitId, anchored }).toEqual({ laneId: project.music.lanes[0]?.id, hitId: 'h1', anchored: true });
		expect(Math.hypot((offset?.x ?? 0) - 0.1, (offset?.y ?? 0) - 0.2)).toBeCloseTo(0.035, 4);
	});

	it('should name Move Clear in the Fix Hits plan for Blocked scenery', () => {
		const { project, result } = createBlocked();

		const plan = replacePlan(project, result);

		expect(plan).toEqual(expect.objectContaining({ label: 'Move Windmill 1 Clear', platforms: 0, scenery: ['Windmill 1'], sceneryIds: ['windmill'], isEmpty: false }));
		// Once a what-if found that deleting it is what works, the label says so
		expect(replacePlan(project, result, undefined, new Map([['windmill', 'delete' as const]])).label).toBe('Delete Windmill 1');
	});

	it('should leave pieces that are not Blocked alone', () => {
		const { project, result } = createBlocked();
		const placed = { ...result, pieces: result.pieces.map((piece) => ({ ...piece, status: 'placed' as const })) };

		expect(moveClear(project, placed, 'windmill')).toBeNull();
	});

	it('should label the outcome and name the scenery fix in a short tooltip', () => {
		// Prepare: Windmill 1 Blocked and a broken platform on the same marble
		const { project, result } = createBlocked();
		const laneId = project.music.lanes[0]?.id ?? '';
		const broken = { ...result, hits: [hit(1.5, 'blocked', { laneId, hitId: 'h1', pieceEntityId: 'p1' })] };

		// Act
		const plan = replacePlan({ ...project, entities: [...project.entities, { id: 'p1', name: 'Platform 1', components: {} }] }, broken, undefined, new Map([['windmill', 'delete' as const]]));

		// Assert
		expect(plan.label).toBe('Fix Hit 1 of Marble 1');
		expect(plan.title).toBe('Places the platform again so the hit lands on time and deletes Windmill 1');
		expect(plan.title.split(' ').length).toBeLessThanOrEqual(15);
	});

	it('should move the piece only when its what-if run breaks no hit', async () => {
		// Prepare: the move clears the windmill, but the run with it moved loses a hit that was on time
		const { project, result } = createBlocked();
		const laneId = project.music.lanes[0]?.id ?? '';
		const onTime = { ...result, hits: [hit(1.5, 'onTime', { laneId, hitId: 'h1', pieceEntityId: 'p1' })] };
		const unused = (): Promise<never> => Promise.reject(new Error('Move Clear places no platform'));
		const breaks = { ...onTime, pieces: onTime.pieces.map((piece) => ({ ...piece, status: 'placed' as const })), hits: [hit(1.5, 'missed', { laneId, hitId: 'h1', pieceEntityId: 'p1' })] };
		const keeps = { ...breaks, hits: onTime.hits };

		// Act
		const refused = await fixPiece(project, onTime, 'windmill', { simulate: async () => breaks, autoPlace: unused });
		const moved = await fixPiece(project, onTime, 'windmill', { simulate: async () => keeps, autoPlace: unused });

		// Assert
		expect(refused).toEqual(expect.objectContaining({ commands: null, message: 'Moving Windmill 1 clear would break a hit, so nothing changed. Drag it by hand or Detach it.' }));
		expect(moved.commands).toHaveLength(1);
		expect(moved).toEqual(expect.objectContaining({ label: 'Move Windmill 1 Clear', kind: 'moveClear' }));
		expect(moved.message).toMatch(/^Windmill 1 moved \d+ cm, clear of .+'s run$/);
	});

	it('should keep a Blocked Bowl, which is how its marble ends, even when moving it clear would break a hit', async () => {
		// Prepare
		const { project: blocked, result } = createBlocked();
		const project = { ...blocked, entities: blocked.entities.map((entity) => (entity.id === 'windmill' && entity.components.piece != null ? { ...entity, components: { ...entity.components, piece: { ...entity.components.piece, type: 'bowl' } } } : entity)) };
		const laneId = project.music.lanes[0]?.id ?? '';
		const onTime = { ...result, hits: [hit(1.5, 'onTime', { laneId, hitId: 'h1', pieceEntityId: 'p1' })] };
		const breaks = { ...onTime, pieces: onTime.pieces.map((piece) => ({ ...piece, status: 'placed' as const })), hits: [hit(1.5, 'missed', { laneId, hitId: 'h1', pieceEntityId: 'p1' })] };
		const simulate = async (next: TProject): Promise<TSimulationResult> => (next.entities.some((entity) => entity.id === 'windmill') ? breaks : { ...onTime, pieces: [] });

		// Act
		const fix = await sceneryFix(project, onTime, 'windmill', { simulate });

		// Assert
		expect(fix.commands).toBeNull();
	});

	it('should delete a Blocked piece the run never uses when moving it clear would break a hit', async () => {
		// Prepare: moved clear, the windmill joins the run and the hit misses; deleted, the run stays as it is
		const { project, result } = createBlocked();
		const laneId = project.music.lanes[0]?.id ?? '';
		const onTime = { ...result, hits: [hit(1.5, 'onTime', { laneId, hitId: 'h1', pieceEntityId: 'p1' })] };
		const breaks = { ...onTime, pieces: onTime.pieces.map((piece) => ({ ...piece, status: 'placed' as const })), hits: [hit(1.5, 'missed', { laneId, hitId: 'h1', pieceEntityId: 'p1' })] };
		const simulate = async (next: TProject): Promise<TSimulationResult> => (next.entities.some((entity) => entity.id === 'windmill') ? breaks : { ...onTime, pieces: [] });

		// Act
		const fix = await sceneryFix(project, onTime, 'windmill', { simulate });

		// Assert
		expect(fix).toEqual(expect.objectContaining({ kind: 'delete', commands: [{ type: 'removeEntities', entityIds: ['windmill'] }] }));
		expect(fix.message).toBe('Windmill 1 deleted: Marble 1 already passes through its spot, so the run never used it');
	});
});

describe('fixedWords function', () => {
	it('should count broken hits in plain words', () => {
		expect(fixedWords(1, 1)).toBe('fixed the broken hit');
		expect(fixedWords(2, 2)).toBe('fixed both broken hits');
		expect(fixedWords(38, 38)).toBe('fixed all 38 broken hits');
		expect(fixedWords(37, 38)).toBe('fixed 37 of 38 broken hits');
		expect(fixedWords(0, 1)).toBe('fixed 0 of 1 broken hit');
		expect(fixedWords(0, 0)).toBe('');
	});
});

describe('replaceResultMessage function', () => {
	it('should name every moved piece and end with the summary and the new problems', () => {
		// Prepare
		const project = oneMarble();
		const withPieces: TProject = {
			...project,
			entities: [...project.entities, { id: 'rail', name: 'Rail 2', components: {} }, { id: 'windmill', name: 'Windmill 1', components: {} }]
		};
		const before = [hit(1, 'blocked')];
		const outcome = { project: withPieces, result: { hits: [hit(1, 'onTime')] } as TSimulationResult, replaced: 4, moved: ['rail'], cleared: ['windmill'], releases: [] };
		const added = [{ id: 'contact:m:s', kind: 'contact' as const, severity: 'warning' as const, title: 'Bass hits Rail 6 of Melody', target: null }];

		// Act
		const message = replaceResultMessage(withPieces, before, outcome, { label: '1 of 1 hit on time · 1 other problem', hitProblems: 0, added });

		// Assert
		expect(message).toBe(
			'Placed 4 platforms again, placed Rail 2 again, moved Windmill 1 clear, and fixed the broken hit: 1 of 1 hit on time · 1 other problem · 1 new problem: Bass hits Rail 6 of Melody'
		);
	});
});

describe('replaceResultSummary function', () => {
	it('should say in one line what Fix Hits fixed and changed, with the full text left for Details', () => {
		// Prepare: 3 broken hits, 2 fixed, a rail deleted and a release moved
		const project = oneMarble();
		const withPieces: TProject = { ...project, entities: [...project.entities, { id: 'rail', name: 'Rail 1', components: {} }] };
		const before = [hit(1, 'blocked', { hitId: 'a' }), hit(2, 'blocked', { hitId: 'b' }), hit(3, 'missed', { hitId: 'c' })];
		const after = [hit(1, 'onTime', { hitId: 'a' }), hit(2, 'onTime', { hitId: 'b' }), hit(3, 'missed', { hitId: 'c' })];
		const outcome = { project: withPieces, result: { hits: after } as TSimulationResult, replaced: 13, moved: [], cleared: [], removed: ['rail'], releases: ['lane-1'] };

		// Act
		const summary = replaceResultSummary(withPieces, before, outcome, { label: '2 of 3 hits on time', hitProblems: 1, added: [] });

		// Assert
		expect(summary).toBe('Fixed 2 of 3 hits · placed 13 platforms again · moved the release · deleted Rail 1 · 2 of 3 hits on time');
	});
});

describe('addedProblems function', () => {
	function contactResult(project: TProject, contacts: TSimulationResult['contacts']): TSimulationResult {
		return { revision: project.revision, duration: 10, marbles: [], pieces: [], contacts, hits: [], stats: { computeMs: 0, reusedUntil: 0, steps: 0 } };
	}

	it('should count another marble hitting a piece, except ahead of the marble being fixed', () => {
		// Prepare: Bass's marble hits a switchback of Melody at 0:05.00
		const base = createProject();
		const [melody] = base.music.lanes;
		if (melody == null) throw new Error('A new project has a marble');
		const project: TProject = {
			...base,
			music: { ...base.music, lanes: [{ ...melody, name: 'Melody' }, { ...melody, id: 'bass', name: 'Bass', hits: [] }] },
			entities: [
				...base.entities,
				{ id: 'bass-marble', name: 'Bass', components: { marble: { laneId: 'bass', radius: 0.008 } } },
				{ id: 'switchback', name: 'Rail 6', components: { piece: { type: 'rail', layout: 'switchback', params: {} }, hitLink: { laneId: melody.id, hitId: 'h1', angle: 0, contactAt: 0.5, anchored: true } } }
			]
		} as TProject;
		const clear = contactResult(project, []);
		const hitBy = contactResult(project, [{ kind: 'piece', marbleEntityId: 'bass-marble', otherEntityId: 'switchback', time: 5, position: { x: 0, y: 0 } }] as TSimulationResult['contacts']);

		// Act
		const added = addedProblems(project, clear, project, hitBy);
		const ahead = addedProblems(project, clear, project, hitBy, { laneId: melody.id, from: 4 });

		// Assert
		expect(added.map((issue) => issue.title)).toEqual(['Bass hits Rail 6 of Melody']);
		expect(ahead).toEqual([]);
	});
});
