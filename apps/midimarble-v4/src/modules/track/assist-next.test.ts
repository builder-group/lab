import { describe, expect, it, vi } from 'vitest';
import { createHistory, createMarble, createProject, type TPiece, type TProject } from '@/modules/project';
import { createLinkedPiece, type TAutoPlaceAnswer, type THitResult, type TSimulationResult } from '@/modules/simulation';
import { StudioCx } from '@/modules/studio';
import { AssistCx, AUTO_PLACE_WAIT_MS } from './AssistCx';

function studio(assists: Record<string, unknown>): { cx: StudioCx; project: TProject; hit: THitResult } {
	const created = createProject({ title: 'Song' });
	const marble = { ...createMarble(0, { x: 0, y: 0 }), hits: [{ id: 'hit1', time: 1, pitch: 60 }] };
	const project: TProject = { ...created, marbles: [marble] };
	const hit = { marbleId: marble.id, hitId: 'hit1', targetTime: 1, pieceId: null, dot: { x: 0, y: -1 }, velocity: { x: 0, y: -3 }, actualTime: null, error: null, status: 'open' } as unknown as THitResult;
	const cx = new StudioCx();
	cx.$history.set(createHistory(project));
	Object.defineProperty(cx.simulation, 'assists', { get: () => assists });
	cx.simulation.$result.set({ revision: project.revision, duration: project.length, marbles: [], pieces: [], contacts: [], hits: [hit], stats: { computeMs: 0, reusedUntil: 0, steps: 0 } } as unknown as TSimulationResult);
	return { cx, project, hit };
}

function solved(marbleId: string, hitId: string, entityId: string): TAutoPlaceAnswer {
	const piece: TPiece = createLinkedPiece('platform', marbleId, hitId, 0.31, { id: entityId });
	piece.params = { ...piece.params, bounce: 0.42 };
	return { piece, angle: 0.31, nextDot: null, computeMs: 1 };
}

describe('AssistCx place function', () => {
	it('gives a piece the same tilt and bounce whether Auto place answers quickly or slowly', async () => {
		const pieces: unknown[] = [];
		for (const delay of [0, AUTO_PLACE_WAIT_MS * 2]) {
			const autoPlace = (request: { marbleId: string; hitId: string; entityId: string }): Promise<TAutoPlaceAnswer> => new Promise((resolve) => setTimeout(() => resolve(solved(request.marbleId, request.hitId, request.entityId)), delay));
			const { cx, hit } = studio({ autoPlace });
			const assist = new AssistCx(cx);
			await assist.place(hit, 'platform');
			const placed = cx.project?.track.pieces[0];
			pieces.push({ angle: placed?.angle, bounce: placed?.params['bounce'] });
			expect(cx.$history.get()?.past).toHaveLength(1);
		}
		expect(pieces[1]).toEqual(pieces[0]);
		expect(pieces[0]).toEqual({ angle: 0.31, bounce: 0.42 });
	});

	it('stays busy until a slow answer has landed, so a queued press and an agent see the final piece', async () => {
		let answer: (value: TAutoPlaceAnswer) => void = () => undefined;
		const { cx, hit } = studio({ autoPlace: () => new Promise((resolve) => (answer = resolve)) });
		const assist = new AssistCx(cx);
		const placing = assist.place(hit, 'platform');
		await vi.waitFor(() => expect(cx.project?.track.pieces.length).toBeGreaterThan(0));
		expect(assist.isAnswering).toBe(true);
		const placed = cx.project?.track.pieces[0];
		answer(solved(hit.marbleId, hit.hitId, placed?.id ?? ''));
		await placing;
		expect(assist.isAnswering).toBe(false);
		expect(cx.project?.track.pieces.find((piece) => piece.id === placed?.id)?.params['bounce']).toBe(0.42);
	});
});
