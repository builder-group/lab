import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHistory, createMarble, createProject, type TProject, type TProjectCommand } from '@/modules/project';
import { createLinkedPiece, type TAutoPlaceAnswer, type THitResult, type TSimulationResult } from '@/modules/simulation';
import { StudioCx } from '@/modules/studio';
import { AssistCx } from './AssistCx';

const stubs = vi.hoisted(() => ({ gate: Promise.resolve() as Promise<void> }));

const BUILT: TProjectCommand[] = [{ type: 'updateProject', patch: { title: 'Built' } }];

// The builds and fixes here only wait, then land one edit: what's checked is whether it may land
vi.mock('@/modules/building', async (original) => ({
	...(await original<typeof import('@/modules/building/index')>()),
	buildTrack: async (project: TProject, deps: { commit: (commands: TProjectCommand[], isFirst: boolean, hit: unknown) => boolean }) => {
		await stubs.gate;
		const isCommitted = deps.commit(BUILT, true, { marbleId: 'marble', hitId: 'hit1', targetTime: 1 });
		return { project, result: { hits: [], pieces: [], contacts: [], marbles: [] }, added: 1, turned: [], releaseShift: 0, bowls: [], attention: [], isStopped: !isCommitted };
	},
	hasFixes: () => true,
	fixHelps: () => true,
	fixMessage: () => 'Fixed',
	addedProblems: () => [],
	fixTrack: async (project: TProject, result: TSimulationResult, deps: { commit: (next: TProject, step: TProjectCommand[]) => TProject | null }) => {
		await stubs.gate;
		return { project: deps.commit(project, BUILT) ?? project, result, isStopped: false };
	}
}));

function project(id: string): TProject {
	const created = createProject({ id, title: id });
	return { ...created, marbles: [{ ...createMarble(0, { x: 0, y: 0.6 }, 'marble'), hits: [{ id: 'hit1', time: 1, pitch: 60 }] }] };
}

const HIT = { marbleId: 'marble', hitId: 'hit1', targetTime: 1, pieceId: null, dot: { x: 0, y: -1 }, velocity: { x: 0, y: -3 }, actualTime: null, error: null, status: 'open' } as unknown as THitResult;

function studio(assists: Record<string, unknown> = {}): { cx: StudioCx; assist: AssistCx; open: () => void; project: TProject } {
	const first = project('first');
	const cx = new StudioCx();
	cx.audition = () => undefined;
	cx.$history.set(createHistory(first));
	Object.defineProperty(cx.simulation, 'assists', { get: () => assists });
	cx.simulation.$result.set({ revision: first.revision, duration: first.length, marbles: [], pieces: [], contacts: [], hits: [HIT], stats: { computeMs: 0, reusedUntil: 0, steps: 0 } } as unknown as TSimulationResult);
	// Another project at the same revision
	return { cx, assist: new AssistCx(cx), project: first, open: () => cx.$history.set(createHistory(project('second'))) };
}

function holdGate(): () => void {
	let release: () => void = () => undefined;
	stubs.gate = new Promise((resolve) => (release = resolve));
	return release;
}

describe('AssistCx class', () => {
	afterEach(() => {
		stubs.gate = Promise.resolve();
	});

	describe('buildTrack method', () => {
		it('should stop when another project opens at the same revision, and leave that project alone', async () => {
			// Prepare
			const release = holdGate();
			const { cx, assist, open } = studio();
			const lengthen = vi.spyOn(cx, 'lengthenForCatch');
			const building = assist.buildTrack();

			// Act
			open();
			release();
			await building;

			// Assert
			expect(cx.project?.title).toBe('second');
			expect(cx.$playhead.get()).toBe(0);
			expect(lengthen).not.toHaveBeenCalled();
			expect(assist.$lastBuild.get()).toBeNull();
			expect(cx.$notice.get()?.message).not.toContain('Stopped building');
		});

		it('should land in its own project', async () => {
			// Prepare
			const { cx, assist } = studio();
			const lengthen = vi.spyOn(cx, 'lengthenForCatch');

			// Act
			await assist.buildTrack();

			// Assert
			expect(cx.project?.title).toBe('Built');
			expect(lengthen).toHaveBeenCalled();
		});
	});

	describe('fix method', () => {
		it('should not land in another project at the same revision', async () => {
			// Prepare
			const release = holdGate();
			const { cx, assist, open } = studio();
			const fixing = assist.fix();

			// Act
			open();
			release();
			await fixing;

			// Assert
			expect(cx.project?.title).toBe('second');
		});

		it('should say nothing of a placed platform in another project', async () => {
			// Prepare
			let answer: (value: TAutoPlaceAnswer) => void = () => undefined;
			const { cx, assist, open, project: first } = studio({ autoPlace: () => new Promise((resolve) => (answer = resolve)) });
			const piece = createLinkedPiece('platform', 'marble', 'hit2', 0.2, { id: 'waiting' });
			const marble = { ...createMarble(0, { x: 0, y: 0.6 }, 'marble'), hits: [{ id: 'hit1', time: 1, pitch: 60 }, { id: 'hit2', time: 2, pitch: 62 }] };
			const held = { ...first, marbles: [marble], track: { ...first.track, pieces: [{ ...piece, place: { ...piece.place, held: { dot: { x: 0, y: 0 }, velocity: null, leaves: null } } }] } } as TProject;
			cx.$history.set(createHistory(held));
			cx.simulation.$result.set({ revision: held.revision, duration: held.length, marbles: [], pieces: [], contacts: [], hits: [HIT], stats: { computeMs: 0, reusedUntil: 0, steps: 0 } } as unknown as TSimulationResult);
			const fixing = assist.fix();
			await vi.waitFor(() => expect(assist.isAnswering).toBe(true));

			// Act
			open();
			answer({ piece: createLinkedPiece('platform', 'marble', 'hit1', 0.3, { id: 'placed' }), angle: 0.3, nextDot: null, computeMs: 1 });
			await fixing;

			// Assert
			expect(cx.project?.track.pieces).toEqual([]);
			expect(cx.$notice.get()?.message ?? '').not.toContain('Placed a platform');
		});
	});

	describe('place method', () => {
		it('should not place a piece in another project at the same revision', async () => {
			// Prepare
			let answer: (value: TAutoPlaceAnswer) => void = () => undefined;
			const { cx, assist, open } = studio({ autoPlace: () => new Promise((resolve) => (answer = resolve)) });
			const placing = assist.place(HIT, 'platform');

			// Act
			open();
			answer({ piece: createLinkedPiece('platform', 'marble', 'hit1', 0.3, { id: 'placed' }), angle: 0.3, nextDot: null, computeMs: 1 });
			await placing;

			// Assert
			expect(cx.project?.id).toBe('second');
			expect(cx.project?.track.pieces).toEqual([]);
		});
	});

	describe('Continue ghosts', () => {
		it('should not show an answer that arrives after another project opened at the same revision', async () => {
			// Prepare
			let answer: (value: unknown) => void = () => undefined;
			const { assist, open } = studio({ continueRun: () => new Promise((resolve) => (answer = resolve)) });
			const stop = assist.mount();
			const suggestion = { hitId: 'hit1', piece: { id: 'ghost' }, resolved: null, dot: { x: 0, y: 0 }, status: 'onTime', error: 0, isInFrame: true, isOk: true };

			// Act
			open();
			answer({ revision: 0, marbleId: 'marble', computeMs: 1, pattern: 'mirror', commands: [], suggestions: [suggestion] });
			await Promise.resolve();
			await Promise.resolve();

			// Assert
			expect(assist.hasGhosts).toBe(false);
			stop();
		});
	});

	describe('acceptGhosts method', () => {
		it('should not take what was offered in another project at the same revision', () => {
			// Prepare
			const { cx, assist, open } = studio({ autoPlace: () => new Promise(() => undefined), continueRun: () => new Promise(() => undefined) });
			const stop = assist.mount();
			assist.preview(HIT);
			expect(assist.hasGhosts).toBe(true);

			// Act
			open();
			assist.acceptGhosts();

			// Assert
			expect(cx.project?.track.pieces).toEqual([]);
			expect(assist.hasGhosts).toBe(false);
			stop();
		});
	});
});
