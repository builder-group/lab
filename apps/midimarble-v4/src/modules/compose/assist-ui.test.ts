import { describe, expect, it } from 'vitest';
import type { TContinueAnswer, TGapAnswer, TResolvedPiece } from '@/modules/simulation';
import { acceptableCount, ghostReducer, initialGhostState, type TGhostState } from './ghosts';
import { composeKeyAction, type TKeyContext, type TKeyInput } from './keys';
import { pickTrack } from './picking';
import { pathHandles, pathRun, pathToLocal, pathToWorld, pieceAngleAt, turnPathRun, withPathBend, withPathEnd, withPathRun } from './scene';

function continueAnswer(revision: number, okCount: number): TContinueAnswer {
	return {
		revision,
		laneId: 'lane-1',
		computeMs: 1,
		pattern: 'mirror',
		commands: [],
		suggestions: Array.from({ length: okCount + 1 }, (_, index) => ({
			hitId: `hit-${index}`,
			entity: { id: `ghost-${index}`, components: {} },
			piece: null,
			dot: { x: 0, y: 0 },
			status: index < okCount ? 'onTime' : 'missed',
			error: 0,
			isInFrame: true,
			isOk: index < okCount
		}))
	} as TContinueAnswer;
}

function gapAnswer(revision: number): TGapAnswer {
	return {
		revision,
		type: 'rail',
		laneId: 'lane-1',
		fromHitId: 'hit-3',
		toHitId: 'hit-4',
		entity: { id: 'rail', components: {} },
		commands: [],
		piece: null,
		track: [],
		check: null,
		computeMs: 1
	} as unknown as TGapAnswer;
}

describe('ghost state', () => {
	const at = (revision: number): TGhostState => ghostReducer(initialGhostState, { type: 'revision', revision });

	it('shows Continue ghosts for the current revision only', () => {
		const state = ghostReducer(at(3), { type: 'continueAnswer', revision: 3, answer: continueAnswer(3, 4) });
		expect(state.ghost?.kind).toBe('continue');
		expect(acceptableCount(state.ghost)).toBe(4);
		// An answer computed for an older edit is dropped
		expect(ghostReducer(at(4), { type: 'continueAnswer', revision: 3, answer: continueAnswer(3, 4) }).ghost).toBeNull();
		// Any edit clears ghosts until the worker answers again
		expect(ghostReducer(state, { type: 'revision', revision: 4 }).ghost).toBeNull();
	});

	it('offers nothing when no suggestion is on time', () => {
		expect(ghostReducer(at(1), { type: 'continueAnswer', revision: 1, answer: continueAnswer(1, 0) }).ghost).toBeNull();
	});

	it('keeps dismissed ghosts away until the next edit', () => {
		const shown = ghostReducer(at(2), { type: 'continueAnswer', revision: 2, answer: continueAnswer(2, 3) });
		const dismissed = ghostReducer(shown, { type: 'dismiss' });
		expect(dismissed.ghost).toBeNull();
		expect(ghostReducer(dismissed, { type: 'continueAnswer', revision: 2, answer: continueAnswer(2, 3) }).ghost).toBeNull();
		const edited = ghostReducer(dismissed, { type: 'revision', revision: 3 });
		expect(ghostReducer(edited, { type: 'continueAnswer', revision: 3, answer: continueAnswer(3, 3) }).ghost?.kind).toBe('continue');
	});

	it('lets a requested gap piece win over background Continue answers', () => {
		const pending = ghostReducer(at(5), { type: 'requestGap', revision: 5, laneId: 'lane-1', toHitId: 'hit-4' });
		expect(pending.pendingGap).not.toBeNull();
		expect(ghostReducer(pending, { type: 'continueAnswer', revision: 5, answer: continueAnswer(5, 2) }).ghost).toBeNull();
		const shown = ghostReducer(pending, { type: 'gapAnswer', answer: gapAnswer(5) });
		expect(shown.ghost?.kind).toBe('gap');
		expect(shown.pendingGap).toBeNull();
		expect(ghostReducer(shown, { type: 'continueAnswer', revision: 5, answer: continueAnswer(5, 2) }).ghost?.kind).toBe('gap');
		expect(ghostReducer(shown, { type: 'accepted' }).ghost).toBeNull();
	});

	it('drops a gap answer that arrives after Escape or an edit', () => {
		const pending = ghostReducer(at(5), { type: 'requestGap', revision: 5, laneId: 'lane-1', toHitId: 'hit-4' });
		expect(ghostReducer(ghostReducer(pending, { type: 'dismiss' }), { type: 'gapAnswer', answer: gapAnswer(5) }).ghost).toBeNull();
		expect(ghostReducer(ghostReducer(pending, { type: 'revision', revision: 6 }), { type: 'gapAnswer', answer: gapAnswer(5) }).ghost).toBeNull();
	});
});

describe('compose keys', () => {
	const none: TKeyContext = { hasPieces: false, hasSelection: false, hasGhosts: false };
	const press = (key: string, extra: Partial<TKeyInput> = {}, context: TKeyContext = none): ReturnType<typeof composeKeyAction> =>
		composeKeyAction({ key, code: extra.code ?? `Key${key.toUpperCase()}`, shiftKey: false, metaKey: false, ctrlKey: false, altKey: false, ...extra }, context);

	it('should map the tool rail letters and leave ⇧1 and ⇧2 for framing', () => {
		expect(press('v')).toEqual({ type: 'tool', tool: 'select' });
		expect(press('o')).toEqual({ type: 'tool', tool: 'marble' });
		expect(press('p')).toEqual({ type: 'tool', tool: 'platform' });
		expect(press('b')).toEqual({ type: 'tool', tool: 'path', pathType: 'rail' });
		expect(press('u')).toEqual({ type: 'tool', tool: 'path', pathType: 'tunnel' });
		expect(press('w')).toEqual({ type: 'tool', tool: 'windmill' });
		expect(press('!', { code: 'Digit1', shiftKey: true })).toEqual({ type: 'fit', target: 'all' });
		expect(press('I', { code: 'KeyI', shiftKey: true })).toEqual({ type: 'library' });
		expect(press('v', { metaKey: true })).toBeNull();
	});

	it('should finish and step back a rail being drawn', () => {
		const drawing = { ...none, isDrawing: true };
		expect(press('Enter', { code: 'Enter' }, drawing)).toEqual({ type: 'finishPath' });
		expect(press('Backspace', { code: 'Backspace' }, drawing)).toEqual({ type: 'undoPathPoint' });
	});

	it('maps the step loop keys', () => {
		expect(press('n')).toEqual({ type: 'next' });
		expect(press('N', { code: 'KeyN', shiftKey: true })).toEqual({ type: 'buildTrack' });
		expect(press('a')).toEqual({ type: 'placeAgain' });
		expect(press('r')).toEqual({ type: 'repeat' });
		expect(press('m')).toEqual({ type: 'mirror' });
		expect(press('Escape', { code: 'Escape' })).toEqual({ type: 'escape' });
		// T stays with the studio for tapping hits
		expect(press('t')).toBeNull();
	});

	it('uses Return and Tab only when there is something to act on', () => {
		expect(press('Enter', { code: 'Enter' })).toBeNull();
		expect(press('Enter', { code: 'Enter' }, { ...none, hasSelection: true })).toEqual({ type: 'next' });
		expect(press('Enter', { code: 'Enter' }, { ...none, hasGhosts: true })).toEqual({ type: 'next' });
		expect(press('Tab', { code: 'Tab' })).toBeNull();
		expect(press('Tab', { code: 'Tab' }, { ...none, hasGhosts: true })).toEqual({ type: 'acceptGhosts' });
		expect(press('P', { code: 'KeyP', shiftKey: true })).toBeNull();
		expect(press('P', { code: 'KeyP', shiftKey: true }, { ...none, hasPieces: true })).toBeNull();
	});
});

describe('rail editing', () => {
	const controls = [
		{ x: -0.006, y: 0 },
		{ x: 0, y: 0 },
		{ x: 0.15, y: -0.012 }
	];
	const piece = { position: { x: 0.1, y: 0.3 }, angle: 0.2 } as TResolvedPiece;

	it('maps control points to the wall and back', () => {
		const world = pathToWorld(piece, controls, { x: 0.05, y: 0.01 });
		const local = pathToLocal(piece, controls, world);
		expect(local.x).toBeCloseTo(0.05, 9);
		expect(local.y).toBeCloseTo(0.01, 9);
		// The entry sits at the piece position
		const entry = pathToWorld(piece, controls, { x: 0, y: 0 });
		expect(entry.x).toBeCloseTo(0.1, 6);
		expect(entry.y).toBeCloseTo(0.3, 6);
	});

	it('moves the end, adds a bend and keeps the bend on the run', () => {
		expect(pathHandles(controls)?.bend).toEqual({ x: 0.075, y: -0.006 });
		const bent = withPathBend(controls, { x: 0.07, y: -0.03 });
		expect(bent).toHaveLength(4);
		expect(pathHandles(bent)?.bend).toEqual({ x: 0.07, y: -0.03 });
		const longer = withPathEnd(bent, { x: 0.3, y: -0.024 });
		expect(longer.at(-1)).toEqual({ x: 0.3, y: -0.024 });
		// Doubling the run doubles the bend with it
		expect(longer[2]?.x).toBeCloseTo(0.14, 6);
		expect(longer[2]?.y).toBeCloseTo(-0.06, 6);
		expect(longer[0]).toEqual(controls[0]);
	});

	it('sets length and slope around the entry', () => {
		const run = pathRun(withPathRun(controls, 0.2, 0.1));
		expect(run.length).toBeCloseTo(0.2, 9);
		expect(run.slope).toBeCloseTo(0.1, 9);
		const turned = turnPathRun(controls, -0.1);
		expect(pathRun(turned).length).toBeCloseTo(pathRun(controls).length, 9);
		expect(turned[0]).toEqual(controls[0]);
	});
});

describe('canvas helpers', () => {
	it('interpolates windmill motion at the playhead', () => {
		const piece = {
			angle: 0.5,
			motion: [
				{ time: 0, angle: 0.5 },
				{ time: 1, angle: 0.5 },
				{ time: 1.5, angle: 1.5 }
			]
		} as TResolvedPiece;
		expect(pieceAngleAt(piece, 0.4)).toBe(0.5);
		expect(pieceAngleAt(piece, 1.25)).toBeCloseTo(1, 9);
		expect(pieceAngleAt(piece, 9)).toBe(1.5);
		expect(pieceAngleAt({ angle: 0.2 } as TResolvedPiece, 3)).toBe(0.2);
	});

	it('picks a trajectory point with its time', () => {
		const tracks = [{ laneId: 'lane-1', points: [{ x: 0, y: 0 }, { x: 100, y: 0 }], times: [1, 2] }];
		const picked = pickTrack({ x: 25, y: 3 }, tracks);
		expect(picked).toMatchObject({ kind: 'track', laneId: 'lane-1' });
		expect(picked?.kind === 'track' ? picked.time : null).toBeCloseTo(1.25, 9);
		expect(pickTrack({ x: 25, y: 30 }, tracks)).toBeNull();
	});
});
