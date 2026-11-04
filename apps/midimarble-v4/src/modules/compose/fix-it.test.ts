import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { assignNotesCommands } from '@/modules/music';
import { applyProjectCommands, BACKING_ID, createProject, parseProject, type TProject } from '@/modules/project';
import { autoPlace, createRailForGap, createSimulator, createSwitchbackForGap, createTunnelForGap, type THitResult, type TSimulationResult } from '@/modules/simulation';
import { hitSummary } from '@/modules/studio/timeline/hit-status';
import { brokenHits, moveClear, newlyBroken, releaseFix, replaceBroken, replaceLabel, replacePlan, replaceResultMessage, replaceTargets, type TReplaceDeps } from './fix-it';

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

describe('replaceTargets function', () => {
	it('should start at the platform before the first broken hit and take every platform before a problem', () => {
		// Prepare
		const project = oneMarble();
		const hits = [hit(1, 'onTime'), hit(2, 'onTime'), hit(3, 'onTime'), hit(4, 'blocked'), hit(5, 'onTime'), hit(6, 'onTime'), hit(7, 'missed')];

		// Act
		const targets = replaceTargets(project, hits);

		// Assert
		expect(targets.map((item) => item.targetTime)).toEqual([3, 4, 6, 7]);
	});

	it('should start where an on-time run left the frame before it broke', () => {
		const project = oneMarble();
		const hits = [hit(1, 'onTime'), hit(2, 'onTime', { dot: { x: 2, y: -2 } }), hit(3, 'blocked')];

		expect(replaceTargets(project, hits).map((item) => item.targetTime)).toEqual([1, 2, 3]);
	});

	it('should leave a marble without broken hits alone', () => {
		const project = oneMarble();

		expect(replaceTargets(project, [hit(1, 'drifting'), hit(2, 'onTime')])).toEqual([]);
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
	it('should count platforms in Title Case', () => {
		expect(replaceLabel(24)).toBe('Re-place 24 Platforms');
		expect(replaceLabel(1, 'Platform 3')).toBe('Re-place Platform 3');
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
		const [isProjectOk, projectErr, project] = parseProject(readFileSync(new URL(`../../../fixtures/${name}.marble.json`, import.meta.url), 'utf8'));
		if (!isProjectOk) throw projectErr;
		const before = simulate(project);
		const lane = project.music.lanes[0];
		if (lane == null) throw new Error(`${name} has a track`);
		const notes = lane.hits.slice(from, from + count).map((item) => item.id);
		const [isEditOk, editErr, edited] = applyProjectCommands(project, assignNotesCommands(project, before, notes, BACKING_ID));
		if (!isEditOk) throw editErr;
		return { before, edited, broken: simulate(edited), laneId: lane.id };
	}

	it('should recover Jingle Bells after its first 6 Melody notes become Backing', async () => {
		// Prepare
		const { before, edited, broken, laneId } = handToBacking('jingle-bells', 0, 6);
		expect(brokenHits(broken.hits).length).toBeGreaterThan(0);

		// Act
		const outcome = await replaceBroken(edited, broken, deps(), { before: before.hits });

		// Assert
		expect(outcome.releases).toEqual([laneId]);
		expect(hitSummary(outcome.result.hits).problems).toEqual([]);
		const summary = hitSummary(outcome.result.hits);
		expect(replaceResultMessage(outcome.project, broken.hits, outcome, summary.label, 0)).toMatch(
			new RegExp(`^Melody now starts just before its first note\\. Re-placed \\d+ platforms? and fixed all ${brokenHits(broken.hits).length} broken hits: ${summary.label}`)
		);
	}, 120_000);

	it('should recover Brass Sections after 3 notes in its first section become Backing', async () => {
		// Prepare
		const { before, edited, broken } = handToBacking('reference-20', 20, 3);
		expect(brokenHits(broken.hits).length).toBeGreaterThan(0);

		// Act
		const outcome = await replaceBroken(edited, broken, deps(), { before: before.hits });

		// Assert: the release stays, since the marble's first notes still play
		expect(outcome.releases).toEqual([]);
		const summary = hitSummary(outcome.result.hits);
		expect(summary.problems).toEqual([]);
		expect(replaceResultMessage(outcome.project, broken.hits, outcome, summary.label, 0)).toMatch(
			new RegExp(`^Re-placed \\d+ platforms? and fixed all ${brokenHits(broken.hits).length} broken hits: ${summary.label}`)
		);
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
						hitLink: { laneId: lane.id, hitId: 'h1', angle: 0, contactAt: 0.5, pinned: false, anchored: true, offset: { x: 0.1, y: 0.2 } }
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

	it('should name Move Clear in the Re-place plan for Blocked scenery', () => {
		const { project, result } = createBlocked();

		const plan = replacePlan(project, result);

		expect(plan).toEqual(expect.objectContaining({ label: 'Move Windmill 1 Clear', platforms: 0, scenery: ['Windmill 1'], isEmpty: false }));
	});

	it('should leave pieces that are not Blocked alone', () => {
		const { project, result } = createBlocked();
		const placed = { ...result, pieces: result.pieces.map((piece) => ({ ...piece, status: 'placed' as const })) };

		expect(moveClear(project, placed, 'windmill')).toBeNull();
	});
});
