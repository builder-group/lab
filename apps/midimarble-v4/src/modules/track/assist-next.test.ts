import { describe, expect, it } from 'vitest';
import { createHistory, createMarble, createProject, type TPiece, type TProject } from '@/modules/project';
import { createLinkedPiece, type THitResult, type TSimulationResult } from '@/modules/simulation';
import { type TAutoPlaceAnswer } from '@/modules/building';
import { StudioCx } from '@/modules/studio';
import { AssistCx } from './AssistCx';

function studio(assists: Record<string, unknown>): { cx: StudioCx; project: TProject; hit: THitResult } {
	const created = createProject({ title: 'Song' });
	const marble = { ...createMarble(0, { x: 0, y: 0 }), hits: [{ id: 'hit1', time: 1, pitch: 60 }] };
	const project: TProject = { ...created, marbles: [marble] };
	const hit = { marbleId: marble.id, hitId: 'hit1', targetTime: 1, pieceId: null, dot: { x: 0, y: -1 }, velocity: { x: 0, y: -3 }, actualTime: null, error: null, status: 'open' } as unknown as THitResult;
	const cx = new StudioCx();
	// Placing a note plays it, and tests have no audio
	cx.audition = () => undefined;
	cx.$history.set(createHistory(project));
	Object.defineProperty(cx.simulation, 'assists', { get: () => assists });
	cx.simulation.$result.set({ revision: project.revision, duration: project.length, marbles: [], pieces: [], contacts: [], hits: [hit], stats: { computeMs: 0, reusedUntil: 0, steps: 0 } } as unknown as TSimulationResult);
	return { cx, project, hit };
}

function solved(marbleId: string, hitId: string, pieceId: string): TAutoPlaceAnswer {
	const piece: TPiece = createLinkedPiece('platform', marbleId, hitId, 0.31, { id: pieceId });
	piece.params = { ...piece.params, bounce: 0.42 };
	return { piece, angle: 0.31, nextDot: null, computeMs: 1 };
}

describe('AssistCx place function', () => {
	it('adds the piece Auto place answers as one undo step, and nothing before the answer', async () => {
		let answer: (value: TAutoPlaceAnswer) => void = () => undefined;
		const { cx, hit } = studio({ autoPlace: () => new Promise((resolve) => (answer = resolve)) });
		const assist = new AssistCx(cx);
		const placing = assist.place(hit, 'platform');
		await Promise.resolve();
		expect(assist.isAnswering).toBe(true);
		expect(cx.project?.track.pieces).toEqual([]);
		answer(solved(hit.marbleId, hit.hitId, 'solved'));
		await placing;
		expect(assist.isAnswering).toBe(false);
		const placed = cx.project?.track.pieces[0];
		expect({ angle: placed?.angle, bounce: placed?.params['bounce'] }).toEqual({ angle: 0.31, bounce: 0.42 });
		expect(cx.$history.get()?.past).toHaveLength(1);
		expect(cx.$selection.get()).toEqual(['solved']);
	});

	it('places nothing when no tilt works, says why and offers what to do', async () => {
		const { cx, hit } = studio({ autoPlace: () => Promise.reject(new Error('No tilt works for this note: every tilt sends the marble out of the frame.')) });
		const assist = new AssistCx(cx);
		await assist.place(hit, 'platform');
		expect(cx.project?.track.pieces).toEqual([]);
		expect(cx.$history.get()?.past).toHaveLength(0);
		const notice = cx.$notice.get();
		expect(notice?.message).toContain('out of the frame');
		const anyway = notice?.actions?.find((action) => action.label === 'Place Anyway');
		anyway?.run();
		expect(cx.project?.track.pieces).toHaveLength(1);
		expect(cx.$history.get()?.past).toHaveLength(1);
	});
});
