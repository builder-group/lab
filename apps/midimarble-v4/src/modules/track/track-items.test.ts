import { beforeAll, describe, expect, it } from 'vitest';
import { applyProjectCommands, createHistory, createProject, pushHistory, type TProject, undoHistory, stepHitTarget, toHitKey, tieOf, backingOf } from '@/modules/project';
import { createSimulator, type THitResult, type TSimulationResult } from '@/modules/simulation';
import { displayPiece, KEEP_PLAYS_REACH, playsDrop, type TSnap, replaceCommands, withCommands, dotClickAction } from '@/modules/building';
import { addNoteCommands } from '@/modules/studio/timeline/piano-roll';
import { deleteHitCommands } from './hand-notes';
import { createStaircaseProject } from '@/modules/simulation/fixture-projects';
import { trackKeyAction } from './keys';
import { pick, PLACED_DOT_PICK_RADIUS, firstHitsView, isBoundsVisible, worldToScreen } from '@/modules/scene';
import { badgeStatus } from './status';

const viewport = { width: 900, height: 600 };
const padding = { top: 56, right: 56, bottom: 72, left: 56 };

function openHit(marbleId: string, time: number, y: number): THitResult {
	return { marbleId, hitId: `h${time}`, targetTime: time, pieceId: null, dot: { x: 0, y }, velocity: null, actualTime: null, error: null, status: 'open' };
}

describe('firstHitsView', () => {
	function tapped(y: number): { project: TProject; result: TSimulationResult } {
		const project = createProject();
		const marbleId = project.marbles[0]?.id ?? '';
		return { project, result: { hits: [openHit(marbleId, 0.6, y), openHit(marbleId, 1.2, y - 2)], pieces: [], marbles: [] } as unknown as TSimulationResult };
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

describe('Zoom to 100%', () => {
	it('should be ⌘0', () => {
		const action = trackKeyAction({ key: '0', code: 'Digit0', shiftKey: false, metaKey: true, ctrlKey: false, altKey: false }, { hasPieces: false, hasSelection: false, hasGhosts: false });
		expect(action).toEqual({ type: 'zoom100' });
	});
});

describe('dotClickAction', () => {
	const project = createStaircaseProject();

	it('should preview the platform for an open note, and the bridge for a long gap', async () => {
		const simulator = await createSimulator();
		const without = { ...project, track: { ...project.track, pieces: project.track.pieces.filter((piece) => piece.id !== 'piece-1-5') } };
		const result = simulator.simulate(without);
		const hit = result.hits.find((item) => item.status === 'open');
		if (hit == null) throw new Error('expected an open note');
		expect(dotClickAction(without, result, hit, undefined)).toEqual({ kind: 'preview', type: 'platform' });
		expect(dotClickAction(without, result, hit, { fromHitId: 'before' })).toEqual({ kind: 'bridge', fromHitId: 'before' });
	});
});

describe('hit dots', () => {
	const scene = {
		handles: [],
		dots: [{ marbleId: 'l', hitId: 'placed', position: { x: 100, y: 100 }, radius: PLACED_DOT_PICK_RADIUS }, { marbleId: 'l', hitId: 'open', position: { x: 300, y: 100 } }],
		pieces: [{ pieceId: 'p', corners: [{ x: 70, y: 104 }, { x: 130, y: 104 }, { x: 130, y: 110 }, { x: 70, y: 110 }] }]
	};

	it('should give the nearer of a placed dot and its platform the click, a tie to the platform', () => {
		expect(pick({ x: 100, y: 99 }, scene)).toEqual({ kind: 'dot', marbleId: 'l', hitId: 'placed' });
		expect(pick({ x: 100, y: 106 }, scene)).toEqual({ kind: 'piece', pieceId: 'p' });
		// 2 px from the dot's center but on the bar, as at low zoom
		const low = { ...scene, pieces: [{ pieceId: 'p', corners: [{ x: 70, y: 98 }, { x: 130, y: 98 }, { x: 130, y: 104 }, { x: 70, y: 104 }] }] };
		expect(pick({ x: 101, y: 100 }, low)).toEqual({ kind: 'piece', pieceId: 'p' });
	});

	it('should keep an open dot ahead of pieces within its wider reach', () => {
		expect(pick({ x: 307, y: 100 }, scene)).toEqual({ kind: 'dot', marbleId: 'l', hitId: 'open' });
		const over = { ...scene, pieces: [{ pieceId: 'q', corners: [{ x: 290, y: 95 }, { x: 310, y: 95 }, { x: 310, y: 105 }, { x: 290, y: 105 }] }] };
		expect(pick({ x: 305, y: 100 }, over)).toEqual({ kind: 'dot', marbleId: 'l', hitId: 'open' });
	});

	it('should leave the status to the dot and keep the badge for what has no dot', () => {
		const hit = { dot: { x: 0, y: 0 }, status: 'onTime' } as THitResult;
		expect(badgeStatus('ok' as never, hit)).toBeNull();
		expect(badgeStatus('blocked', hit)).toBeNull();
		expect(badgeStatus('blocked', undefined)).toBe('blocked');
		expect(badgeStatus(undefined, { dot: null, status: 'missed' } as THitResult)).toBe('missed');
	});
});

describe('arrows in Track', () => {
	const key = (code: string, shiftKey = false) => ({ key: code, code, shiftKey, metaKey: false, ctrlKey: false, altKey: false });
	const context = { hasPieces: true, hasSelection: true, hasGhosts: false, canTilt: true };

	it('should leave ← → to Previous and Next Hit whatever is selected, and tilt with ↑ ↓', () => {
		expect(trackKeyAction(key('ArrowRight'), context)).toBeNull();
		expect(trackKeyAction(key('ArrowLeft'), context)).toBeNull();
		expect(trackKeyAction(key('ArrowUp'), context)).toEqual({ type: 'nudge', degrees: 1 });
		expect(trackKeyAction(key('ArrowDown', true), context)).toEqual({ type: 'nudge', degrees: -5 });
		expect(trackKeyAction(key('ArrowUp'), { ...context, canTilt: false })).toBeNull();
	});
});

describe('stepping through hits', () => {
	const project = {
		track: { pieces: [{ id: 'platform', type: 'platform', params: {}, angle: 0, place: { kind: 'plays', marbleId: 'a', hitId: 'a2', contactAt: 0.5 } }], groups: [] },
		marbles: [
			{ id: 'a', hits: [{ id: 'a1', time: 1 }, { id: 'a2', time: 2 }, { id: 'a3', time: 3 }] },
			{ id: 'b', hits: [{ id: 'b1', time: 1.5 }, { id: 'b2', time: 2.5 }] }
		]
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
	async function played(): Promise<{ project: TProject; result: TSimulationResult; key: string; pieceId: string; hitId: string; marbleId: string }> {
		const simulator = await createSimulator();
		const project = createStaircaseProject();
		const result = simulator.simulate(project);
		const piece = project.track.pieces.find((piece) => piece.id === 'piece-1-5');
		const link = tieOf(piece);
		if (link == null) throw new Error('expected a platform');
		return { project, result, key: toHitKey(link.marbleId, link.hitId), pieceId: 'piece-1-5', hitId: link.hitId, marbleId: link.marbleId };
	}

	it('should leave nothing tied to the hit when Delete Hit removes it, as one edit', async () => {
		const { project, result, key, hitId, marbleId, pieceId } = await played();
		const [isOk, error, next] = applyProjectCommands(project, deleteHitCommands(project, result, [key]));
		if (!isOk) throw error;
		expect(next.marbles.find((marble) => marble.id === marbleId)?.hits.some((hit) => hit.id === hitId)).toBe(false);
		expect(backingOf(next).some((hit) => hit.id === hitId)).toBe(false);
		expect(next.track.pieces.some((piece) => piece.id === pieceId)).toBe(false);
		expect(next.track.pieces.some((piece) => tieOf(piece)?.hitId === hitId)).toBe(false);
	});
});

describe('an added note', () => {
	it('should give the marble a hit with a dot, as one undo step', async () => {
		const simulator = await createSimulator();
		const project = createStaircaseProject();
		const marble = project.marbles[0];
		if (marble == null) throw new Error('expected a marble');
		const last = Math.max(...marble.hits.map((hit) => hit.time));
		const { hit, commands } = addNoteCommands(marble.id, 'song', { time: last + 0.5, pitch: 67, duration: 0.25 });
		const [isOk, error, added] = applyProjectCommands(project, commands);
		if (!isOk) throw error;
		const history = pushHistory(createHistory(project), added);
		const result = simulator.simulate({ ...added, length: last + 2 });

		expect(history.present.marbles[0]?.hits.find((item) => item.id === hit.id)?.pitch).toBe(67);
		expect(result.hits.find((item) => item.hitId === hit.id)?.status).toBe('open');
		expect(undoHistory(history).present.marbles[0]?.hits.some((item) => item.id === hit.id)).toBe(false);
	});
});

describe('dragging a platform that plays a note', () => {
	const note = { marbleId: 'l', hitId: 'h', dot: { x: 0, y: 0 } };
	const options = { isFree: false, reach: KEEP_PLAYS_REACH };

	it('should keep the note near it, free it only far away or with ⌥', () => {
		expect(playsDrop(note, { x: 0, y: 0 }, { x: 0.1, y: 0.1 }, null, options)).toBe('keeps');
		expect(playsDrop(note, { x: 0, y: 0 }, { x: 1, y: 0 }, null, options)).toBe('frees');
		expect(playsDrop(note, { x: 0, y: 0 }, { x: 0.1, y: 0 }, null, { ...options, isFree: true })).toBe('frees');
	});

	it('should follow the note again on its own dot and take another open note on its dot', () => {
		const own: TSnap = { kind: 'link', marbleId: 'l', hitId: 'h', dot: { x: 0, y: 0 }, velocity: null };
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
		const piece = project.track.pieces.find((item) => item.id === 'piece-1-5');
		const resolved = before.pieces.find((piece) => piece.pieceId === 'piece-1-5');
		if (piece == null || resolved == null) throw new Error('missing piece');

		// Turned away, it no longer plays
		const waiting = { ...piece, angle: piece.angle + 0.8 };
		const lowerProject = withCommands(project, [{ type: 'addPiece', piece: waiting }]);

		// Placed again, it follows its note once more
		const commands = replaceCommands(lowerProject, piece);
		expect(commands.length).toBeGreaterThan(0);
		const back = withCommands(lowerProject, commands);
		expect(simulate(back).hits.every((item) => item.status === 'onTime')).toBe(true);
	});

	it('should show the dragged platform where the pointer holds it', () => {
		const project = createStaircaseProject();
		const piece = project.track.pieces.find((item) => item.id === 'piece-1-5');
		if (piece == null) throw new Error('missing piece');
		const shown = displayPiece(piece, { pose: { position: { x: 0.3, y: 0.2 }, angle: 0.1 } });
		expect(shown.position.x).toBeCloseTo(0.3);
		expect(shown.position.y).toBeCloseTo(0.2);
		expect(isBoundsVisible({ center: { x: 0.3, y: 0.2 }, scale: 900 }, viewport, { minX: 0.29, maxX: 0.31, minY: 0.19, maxY: 0.21 })).toBe(true);
	});
});
