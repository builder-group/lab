import { createState } from 'feature-state';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { applyProjectCommands, createHistory, createProject, pushHistory, type TEntity, type TProject, undoHistory } from '@/modules/project';
import { createLinkedPiece, createSimulator, type TAutoPlaceAnswer, type THitResult, type TSimulationResult } from '@/modules/simulation';
import { addNoteCommands } from '@/modules/studio/timeline/piano-roll';
import { stepHitTarget, toHitKey } from '@/modules/studio/selection';
import { deleteHitCommands, platformsOfHits } from '@/modules/studio/timeline/hand-notes';
import type { StudioCx } from '@/modules/studio/StudioCx';
import { AssistCx } from './AssistCx';
import { createStaircaseProject } from '@/modules/simulation/fixture-projects';
import { asPinned, displayPiece, KEEP_PLAYS_REACH, playsDrop, type TSnap } from './attach-edit';
import { replaceCommands, withCommands } from './fix-it';
import { ghostReducer, initialGhostState, type TPlaceAnswer } from './ghosts';
import { composeKeyAction } from './keys';
import { isOnGhost, pick, PLACED_DOT_PICK_RADIUS } from './picking';
import { dotClickAction } from './reachability';
import { firstHitsView, playheadSection } from './scene';
import { badgeStatus } from './status';
import { isBoundsVisible, worldToScreen } from './view';

const viewport = { width: 900, height: 600 };
const padding = { top: 56, right: 56, bottom: 72, left: 56 };

function openHit(laneId: string, time: number, y: number): THitResult {
	return { laneId, hitId: `h${time}`, targetTime: time, pieceEntityId: null, dot: { x: 0, y }, velocity: null, actualTime: null, error: null, status: 'open' };
}

describe('firstHitsView', () => {
	function tapped(y: number): { project: TProject; result: TSimulationResult } {
		const project = createProject();
		const laneId = project.music.lanes[0]?.id ?? '';
		return { project, result: { hits: [openHit(laneId, 0.6, y), openHit(laneId, 1.2, y - 2)], pieces: [], marbles: [] } as unknown as TSimulationResult };
	}

	it('should bring the first open dot on screen with room for the hint and the build bar', () => {
		const { project, result } = tapped(-3);
		const view = firstHitsView(project, result, { center: { x: 0, y: 0.4 }, scale: 900 }, viewport, padding, 267);
		if (view == null) throw new Error('expected a view');
		const dot = worldToScreen(view, viewport, { x: 0, y: -3 });
		expect(dot.y).toBeGreaterThan(0);
		// The build bar sits under the dot
		expect(dot.y).toBeLessThan(viewport.height - 72);
	});

	it('should leave out a release too far above to show the dot at a readable size', () => {
		const { project, result } = tapped(-30);
		const view = firstHitsView(project, result, { center: { x: 0, y: 0.4 }, scale: 900 }, viewport, padding, 267);
		expect(view?.scale).toBeGreaterThanOrEqual(267);
	});

	it('should stay put when the dot already shows, or when no dot is open', () => {
		const { project, result } = tapped(0.3);
		expect(firstHitsView(project, result, { center: { x: 0, y: 0.3 }, scale: 900 }, viewport, padding, 267)).toBeNull();
		expect(firstHitsView(project, { hits: [], pieces: [], marbles: [] } as unknown as TSimulationResult, { center: { x: 0, y: 0 }, scale: 900 }, viewport, padding, 267)).toBeNull();
	});
});

describe('playheadSection', () => {
	const laneId = 'lane';
	const long = {
		hits: Array.from({ length: 200 }, (_, index) => ({ ...openHit(laneId, index * 0.5, -index), pieceEntityId: `p${index}`, status: 'onTime' as const })),
		pieces: [],
		marbles: []
	} as unknown as TSimulationResult;
	const project = createProject();

	it('should show the stretch around the playhead at a readable size, not the whole run', () => {
		const section = playheadSection(project, long, 50, viewport, padding, 267);
		if (section == null) throw new Error('expected a section');
		expect(section.maxY).toBeGreaterThanOrEqual(-100);
		expect(section.minY).toBeLessThanOrEqual(-100);
		expect(section.maxY - section.minY).toBeLessThanOrEqual((viewport.height - padding.top - padding.bottom) / 267 + 1e-9);
	});

	it('should fall back to the end of the run past the last hit, and to nothing without hits', () => {
		const section = playheadSection(project, long, 500, viewport, padding, 267);
		expect(section?.minY).toBeCloseTo(-199);
		expect(playheadSection(project, { hits: [], pieces: [], marbles: [] } as unknown as TSimulationResult, 0, viewport, padding, 267)).toBeNull();
	});
});

describe('Zoom to 100%', () => {
	it('should be ⌘0', () => {
		const action = composeKeyAction({ key: '0', code: 'Digit0', shiftKey: false, metaKey: true, ctrlKey: false, altKey: false }, { hasPieces: false, hasSelection: false, hasGhosts: false });
		expect(action).toEqual({ type: 'zoom100' });
	});
});

describe('dotClickAction', () => {
	const project = createStaircaseProject();

	it('should preview the platform for an open note, and the bridge for a long gap', async () => {
		const simulator = await createSimulator();
		const without = { ...project, entities: project.entities.filter((entity) => entity.id !== 'piece-1-5') };
		const result = simulator.simulate(without);
		const hit = result.hits.find((item) => item.status === 'open');
		if (hit == null) throw new Error('expected an open note');
		expect(dotClickAction(without, result, hit, undefined)).toEqual({ kind: 'preview', type: 'platform' });
		expect(dotClickAction(without, result, hit, { fromHitId: 'before' })).toEqual({ kind: 'bridge', fromHitId: 'before' });
	});
});

describe('a dot click before it places', () => {
	const answer = { revision: 1, laneId: 'l', type: 'platform', isSolved: true, isOk: true } as unknown as TPlaceAnswer;
	const atOne = { ...initialGhostState, revision: 1 };

	it('should keep a preview over background Continue ghosts until an edit or a cancel', () => {
		const shown = ghostReducer(atOne, { type: 'preview', answer });
		expect(shown.ghost?.kind).toBe('place');
		expect(ghostReducer(shown, { type: 'continueAnswer', revision: 1, answer: { suggestions: [{ isOk: true }] } as never })).toBe(shown);
		expect(ghostReducer(shown, { type: 'revision', revision: 2 }).ghost).toBeNull();
	});

	it('should leave Continue on offer when a preview is cancelled, unlike Escape on Continue itself', () => {
		const cancelled = ghostReducer(ghostReducer(atOne, { type: 'preview', answer }), { type: 'previewCancelled' });
		expect(cancelled.ghost).toBeNull();
		expect(cancelled.dismissedRevision).toBeNull();
	});

	/** AssistCx on a small stand-in for the studio; `autoPlace` answers when the test says so */
	async function setup(): Promise<{ assist: AssistCx; cx: StudioCx; hit: THitResult; project: () => TProject; edits: () => number; answer: () => void; fail: () => void }> {
		const simulator = await createSimulator();
		const start = createStaircaseProject();
		const without = { ...start, entities: start.entities.filter((entity) => entity.id !== 'piece-1-5') };
		const result = simulator.simulate(without);
		const hit = result.hits.find((item) => item.status === 'open');
		if (hit == null) throw new Error('expected an open note');
		let project: TProject = without;
		let edits = 0;
		let settle: { resolve: (value: TAutoPlaceAnswer) => void; reject: (error: Error) => void; entityId: string } | null = null;
		const $history = createState<{ present: TProject } | null>({ present: project });
		const cx = {
			get project() {
				return project;
			},
			$history,
			$selection: createState<string[]>([]),
			$playing: createState(false),
			$playhead: createState(0),
			$notice: createState(null),
			$historyReveal: createState(null),
			simulation: {
				isPreviewing: false,
				$result: createState<TSimulationResult | null>(null),
				assists: {
					autoPlace: (request: { entityId: string }) => new Promise((resolve, reject) => (settle = { resolve, reject, entityId: request.entityId })),
					continueRun: () => Promise.resolve(null)
				}
			},
			execute: (commands: Parameters<typeof withCommands>[1]) => {
				project = { ...withCommands(project, commands), revision: project.revision + 1 };
				edits++;
				$history.set({ present: project });
				return true;
			},
			audition: vi.fn(),
			notify: vi.fn(),
			notifyEdit: vi.fn()
		} as unknown as StudioCx;
		const assist = new AssistCx(cx);
		assist.mount();
		return {
			assist,
			cx,
			hit,
			project: () => project,
			edits: () => edits,
			answer: () => {
				const pending = settle as { resolve: (value: TAutoPlaceAnswer) => void; entityId: string } | null;
				const entity = pieceEntity(project, hit, pending?.entityId ?? 'piece');
				pending?.resolve({ entity, angle: 0.2, nextDot: { x: 0.1, y: -1 }, computeMs: 1 });
			},
			fail: () => (settle as { reject: (error: Error) => void } | null)?.reject(new Error('No angle'))
		};
	}

	function pieceEntity(project: TProject, hit: THitResult, id: string): TEntity {
		return createLinkedPiece('platform', hit.laneId, hit.hitId, 0.2, { entities: project.entities, id });
	}

	const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

	it('should select the hit and show the platform without changing the project, then add it in one edit', async () => {
		const { assist, cx, hit, project, edits, answer } = await setup();
		const before = project();
		assist.preview(hit);
		expect(cx.$selection.get()).toEqual([toHitKey(hit.laneId, hit.hitId)]);
		expect(assist.$ghosts.get().ghost?.kind).toBe('place');
		expect(project()).toBe(before);

		answer();
		await flush();
		const { ghost } = assist.$ghosts.get();
		expect(ghost?.kind === 'place' && ghost.answer.nextDot).toEqual({ x: 0.1, y: -1 });
		expect(assist.isPreviewing(hit.laneId, hit.hitId)).toBe(true);

		// Return and N come through next(), a click on the ghost through acceptGhosts()
		assist.next();
		expect(edits()).toBe(1);
		expect(project().entities.some((entity) => entity.components.hitLink?.hitId === hit.hitId)).toBe(true);
		expect(assist.$ghosts.get().ghost).toBeNull();
		expect(cx.$selection.get()[0]).not.toBe(toHitKey(hit.laneId, hit.hitId));
	});

	it('should cancel on Escape and when anything else is selected, leaving the project alone', async () => {
		const { assist, cx, hit, edits, answer } = await setup();
		assist.preview(hit);
		answer();
		await flush();
		expect(assist.dismiss()).toBe(true);
		expect(assist.$ghosts.get().ghost).toBeNull();
		expect(cx.$selection.get()).toEqual([toHitKey(hit.laneId, hit.hitId)]);

		assist.preview(hit);
		cx.$selection.set([]);
		expect(assist.$ghosts.get().ghost).toBeNull();
		expect(edits()).toBe(0);
	});

	it('should drop an answer that arrives after a cancel', async () => {
		const { assist, cx, hit, answer } = await setup();
		assist.preview(hit);
		cx.$selection.set([]);
		answer();
		await flush();
		expect(assist.$ghosts.get().ghost).toBeNull();
	});

	it('should tint the default tilt when no tilt works and say so when it is added', async () => {
		const { assist, cx, hit, edits, fail } = await setup();
		assist.preview(hit);
		fail();
		await flush();
		const { ghost } = assist.$ghosts.get();
		expect(ghost?.kind === 'place' && ghost.answer.isOk).toBe(false);
		assist.acceptGhosts();
		expect(edits()).toBe(1);
		expect(cx.notify).toHaveBeenCalled();
	});

	it('should count a click on the ghost by its outline', () => {
		const corners = [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 4 }, { x: 0, y: 4 }];
		expect(isOnGhost({ x: 10, y: 2 }, corners)).toBe(true);
		expect(isOnGhost({ x: 10, y: 30 }, corners)).toBe(false);
	});
});

describe('hit dots', () => {
	const scene = {
		handles: [],
		dots: [{ laneId: 'l', hitId: 'placed', position: { x: 100, y: 100 }, radius: PLACED_DOT_PICK_RADIUS }, { laneId: 'l', hitId: 'open', position: { x: 300, y: 100 } }],
		pieces: [{ entityId: 'p', corners: [{ x: 70, y: 104 }, { x: 130, y: 104 }, { x: 130, y: 110 }, { x: 70, y: 110 }] }]
	};

	it('should give the nearer of a placed dot and its platform the click, a tie to the platform', () => {
		expect(pick({ x: 100, y: 99 }, scene)).toEqual({ kind: 'dot', laneId: 'l', hitId: 'placed' });
		expect(pick({ x: 100, y: 106 }, scene)).toEqual({ kind: 'piece', entityId: 'p' });
		// 2 px from the dot's centre but on the bar, as at low zoom
		const low = { ...scene, pieces: [{ entityId: 'p', corners: [{ x: 70, y: 98 }, { x: 130, y: 98 }, { x: 130, y: 104 }, { x: 70, y: 104 }] }] };
		expect(pick({ x: 101, y: 100 }, low)).toEqual({ kind: 'piece', entityId: 'p' });
	});

	it('should keep an open dot ahead of pieces within its wider reach', () => {
		expect(pick({ x: 307, y: 100 }, scene)).toEqual({ kind: 'dot', laneId: 'l', hitId: 'open' });
		const over = { ...scene, pieces: [{ entityId: 'q', corners: [{ x: 290, y: 95 }, { x: 310, y: 95 }, { x: 310, y: 105 }, { x: 290, y: 105 }] }] };
		expect(pick({ x: 305, y: 100 }, over)).toEqual({ kind: 'dot', laneId: 'l', hitId: 'open' });
	});

	it('should leave the status to the dot and keep the badge for what has no dot', () => {
		const hit = { dot: { x: 0, y: 0 }, status: 'onTime' } as THitResult;
		expect(badgeStatus('ok' as never, hit)).toBeNull();
		expect(badgeStatus('blocked', hit)).toBeNull();
		expect(badgeStatus('blocked', undefined)).toBe('blocked');
		expect(badgeStatus(undefined, { dot: null, status: 'missed' } as THitResult)).toBe('missed');
	});
});

describe('arrows in Compose', () => {
	const key = (code: string, shiftKey = false) => ({ key: code, code, shiftKey, metaKey: false, ctrlKey: false, altKey: false });
	const context = { hasPieces: true, hasSelection: true, hasGhosts: false, canTilt: true };

	it('should leave ← → to Previous and Next Hit whatever is selected, and tilt with ↑ ↓', () => {
		expect(composeKeyAction(key('ArrowRight'), context)).toBeNull();
		expect(composeKeyAction(key('ArrowLeft'), context)).toBeNull();
		expect(composeKeyAction(key('ArrowUp'), context)).toEqual({ type: 'nudge', degrees: 1 });
		expect(composeKeyAction(key('ArrowDown', true), context)).toEqual({ type: 'nudge', degrees: -5 });
		expect(composeKeyAction(key('ArrowUp'), { ...context, canTilt: false })).toBeNull();
	});
});

describe('stepping through hits', () => {
	const project = {
		entities: [{ id: 'platform', components: { piece: { type: 'platform' }, hitLink: { laneId: 'a', hitId: 'a2' } } }],
		music: {
			lanes: [
				{ id: 'a', hits: [{ id: 'a1', time: 1 }, { id: 'a2', time: 2 }, { id: 'a3', time: 3 }] },
				{ id: 'b', hits: [{ id: 'b1', time: 1.5 }, { id: 'b2', time: 2.5 }] }
			]
		}
	} as unknown as TProject;

	it('should stay on the marble of the selected hit and go on from it, not the playhead', () => {
		expect(stepHitTarget(project, ['hit:a:a1'], 9, 1, true)?.hitId).toBe('a2');
		expect(stepHitTarget(project, ['hit:a:a3'], 0, -1, true)?.hitId).toBe('a2');
		expect(stepHitTarget(project, ['hit:a:a3'], 0, 1, true)).toBeNull();
	});

	it('should step from a selected platform to the hits next to its own', () => {
		expect(stepHitTarget(project, ['platform'], 0, 1, true)?.hitId).toBe('a3');
	});

	it('should step every marble from the playhead with nothing selected and in Film', () => {
		expect(stepHitTarget(project, [], 1, 1, true)?.hitId).toBe('b1');
		expect(stepHitTarget(project, ['hit:a:a1'], 1, 1, false)?.hitId).toBe('b1');
	});
});

describe('⌫ on hits', () => {
	async function played(): Promise<{ project: TProject; result: TSimulationResult; key: string; pieceId: string; hitId: string; laneId: string }> {
		const simulator = await createSimulator();
		const project = createStaircaseProject();
		const result = simulator.simulate(project);
		const piece = project.entities.find((entity) => entity.id === 'piece-1-5');
		const link = piece?.components.hitLink;
		if (link == null) throw new Error('expected a platform');
		return { project, result, key: toHitKey(link.laneId, link.hitId), pieceId: 'piece-1-5', hitId: link.hitId, laneId: link.laneId };
	}

	it('should find the platform of a hit, which ⌫ takes first', async () => {
		const { project, key, pieceId } = await played();
		expect(platformsOfHits(project, [key]).map((entity) => entity.id)).toEqual([pieceId]);
		expect(platformsOfHits(project, ['hit:other:nope'])).toEqual([]);
	});

	it('should leave nothing tied to the hit when Delete Hit removes it, as one edit', async () => {
		const { project, result, key, hitId, laneId, pieceId } = await played();
		const [isOk, error, next] = applyProjectCommands(project, deleteHitCommands(project, result, [key]));
		if (!isOk) throw error;
		expect(next.music.lanes.find((lane) => lane.id === laneId)?.hits.some((hit) => hit.id === hitId)).toBe(false);
		expect(next.music.backing.some((hit) => hit.id === hitId)).toBe(false);
		expect(next.entities.some((entity) => entity.id === pieceId)).toBe(false);
		expect(next.entities.some((entity) => entity.components.hitLink?.hitId === hitId)).toBe(false);
	});
});

describe('an added note', () => {
	it('should give the marble a hit with a dot, as one undo step', async () => {
		const simulator = await createSimulator();
		const project = createStaircaseProject();
		const lane = project.music.lanes[0];
		if (lane == null) throw new Error('expected a marble');
		const last = Math.max(...lane.hits.map((hit) => hit.time));
		const { hit, commands } = addNoteCommands(lane.id, { time: last + 0.5, pitch: 67, duration: 0.25 });
		const [isOk, error, added] = applyProjectCommands(project, commands);
		if (!isOk) throw error;
		const history = pushHistory(createHistory(project), added);
		const result = simulator.simulate({ ...added, end: last + 2 });

		expect(history.present.music.lanes[0]?.hits.find((item) => item.id === hit.id)?.pitch).toBe(67);
		expect(result.hits.find((item) => item.hitId === hit.id)?.status).toBe('open');
		expect(undoHistory(history).present.music.lanes[0]?.hits.some((item) => item.id === hit.id)).toBe(false);
	});
});

describe('dragging a platform that plays a note', () => {
	const note = { laneId: 'l', hitId: 'h', dot: { x: 0, y: 0 } };
	const options = { isFree: false, reach: KEEP_PLAYS_REACH };

	it('should keep the note near it, free it only far away or with ⌥', () => {
		expect(playsDrop(note, { x: 0, y: 0 }, { x: 0.1, y: 0.1 }, null, options)).toBe('keeps');
		expect(playsDrop(note, { x: 0, y: 0 }, { x: 1, y: 0 }, null, options)).toBe('frees');
		expect(playsDrop(note, { x: 0, y: 0 }, { x: 0.1, y: 0 }, null, { ...options, isFree: true })).toBe('frees');
	});

	it('should follow the note again on its own dot and take another open note on its dot', () => {
		const own: TSnap = { kind: 'link', laneId: 'l', hitId: 'h', dot: { x: 0, y: 0 }, velocity: null };
		expect(playsDrop(note, { x: 0, y: 0 }, { x: 0, y: 0 }, own, options)).toBe('onNote');
		expect(playsDrop(note, { x: 0, y: 0 }, { x: 2, y: 0 }, { ...own, hitId: 'other' }, options)).toBe('otherNote');
	});

	it('should measure from where the drag began when the note has no dot', () => {
		expect(playsDrop({ ...note, dot: null }, { x: 5, y: 5 }, { x: 5.1, y: 5 }, null, options)).toBe('keeps');
	});

	let simulate: (project: TProject) => TSimulationResult;
	beforeAll(async () => {
		const simulator = await createSimulator();
		simulate = (project) => simulator.simulate(project);
	});

	it('should keep Plays where it lies, report the timing there, and go back on time when placed again', () => {
		const project = createStaircaseProject();
		const before = simulate(project);
		const entity = project.entities.find((item) => item.id === 'piece-1-5');
		const resolved = before.pieces.find((piece) => piece.entityId === 'piece-1-5');
		if (entity == null || resolved == null) throw new Error('missing piece');
		const radius = before.marbles[0]?.radius;

		// In place, the run keeps it exactly there and still on time
		const inPlace = asPinned(entity, { position: resolved.position, angle: resolved.angle }, radius);
		const pinnedRun = simulate(withCommands(project, [{ type: 'upsertEntity', entity: inPlace }]));
		const pinned = pinnedRun.pieces.find((piece) => piece.entityId === 'piece-1-5');
		expect(pinned?.status).toBe('pinned');
		expect(pinned?.position.x).toBeCloseTo(resolved.position.x, 6);
		expect(pinned?.position.y).toBeCloseTo(resolved.position.y, 6);
		expect(pinnedRun.hits.find((hit) => hit.pieceEntityId === 'piece-1-5')?.status).toBe('onTime');

		// A little lower the marble lands later on the same note; the tie stays
		const lower = asPinned(entity, { position: { x: resolved.position.x, y: resolved.position.y - 0.1 }, angle: resolved.angle }, radius);
		expect(lower.components.hitLink?.hitId).toBe(entity.components.hitLink?.hitId);
		const lowerProject = withCommands(project, [{ type: 'upsertEntity', entity: lower }]);
		const lowerRun = simulate(lowerProject);
		const hit = lowerRun.hits.find((item) => item.hitId === entity.components.hitLink?.hitId);
		expect(hit?.pieceEntityId).toBe('piece-1-5');
		expect(hit?.status).not.toBe('onTime');
		expect(hit?.error ?? 0).toBeGreaterThan(0);

		// Placed again, it follows its note once more
		const commands = replaceCommands(lowerProject, entity);
		expect(commands.length).toBeGreaterThan(0);
		const back = withCommands(lowerProject, commands);
		expect(back.entities.find((item) => item.id === 'piece-1-5')?.components.hitLink?.pinned).toBe(false);
		expect(back.entities.find((item) => item.id === 'piece-1-5')?.components.hitLink?.pinnedPosition).toBeUndefined();
		expect(simulate(back).hits.every((item) => item.status === 'onTime')).toBe(true);
	});

	it('should show the dragged platform where the pointer holds it', () => {
		const project = createStaircaseProject();
		const entity = project.entities.find((item) => item.id === 'piece-1-5');
		if (entity == null) throw new Error('missing piece');
		const shown = displayPiece(asPinned(entity, { position: { x: 0.3, y: 0.2 }, angle: 0.1 }), { pose: { position: { x: 0.3, y: 0.2 }, angle: 0.1 } });
		expect(shown.position.x).toBeCloseTo(0.3);
		expect(shown.position.y).toBeCloseTo(0.2);
		expect(isBoundsVisible({ center: { x: 0.3, y: 0.2 }, scale: 900 }, viewport, { minX: 0.29, maxX: 0.31, minY: 0.19, maxY: 0.21 })).toBe(true);
	});
});
