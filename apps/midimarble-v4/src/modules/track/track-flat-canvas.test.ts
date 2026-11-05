import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHistory, createLane, createMarble, createProject, type TProject } from '@/modules/project';
import type { TSimulationResult } from '@/modules/simulation';
import { StudioCx } from '@/modules/studio';
import { createFreePiece, displayPiece } from '@/modules/building';
import { TrackCx } from './TrackCx';
import type { TrackRenderer, TRenderPiece } from '@/modules/canvas';

const draws = vi.hoisted(() => ({ count: 0 }));

vi.mock('three', async (original) => {
	const three = await original<typeof import('three')>();
	class HeadlessRenderer {
		setClearColor(): void {}
		setPixelRatio(): void {}
		setSize(): void {}
		render(): void {
			draws.count += 1;
		}
		dispose(): void {}
	}
	return { ...three, WebGLRenderer: HeadlessRenderer };
});

let frames: { id: number; callback: FrameRequestCallback }[] = [];
let nextFrame = 1;

function runFrames(): void {
	const due = frames;
	frames = [];
	for (const frame of due) frame.callback(performance.now() + 16);
}

function mounted(): { cx: StudioCx; trackCx: TrackCx; renderer: TrackRenderer; windmillId: string; unmount: () => void } {
	const created = createProject({ title: 'Song' });
	const lane = createLane(0);
	const marble = createMarble(lane, { x: 0, y: 0 });
	const pose = { position: { x: 0.2, y: -0.2 }, angle: 0 };
	const windmill = createFreePiece('windmill', pose, [marble]);
	const project: TProject = { ...created, music: { ...created.music, lanes: [lane] }, entities: [marble, windmill] };
	const samples = Array.from({ length: 600 }, (_, index) => ({ time: index / 60, position: { x: index * 0.02, y: -index * 0.02 }, velocity: { x: 1.2, y: -1.2 } }));
	const result = {
		revision: project.revision,
		duration: project.end,
		marbles: [{ entityId: marble.id, marbleId: lane.id, samples }],
		pieces: [{ ...displayPiece(windmill, { pose }), motion: [{ time: 0, angle: 0 }, { time: 10, angle: 10 }] }],
		contacts: [],
		hits: [],
		stats: { computeMs: 0, reusedUntil: 0, steps: 0 }
	} as unknown as TSimulationResult;
	const cx = new StudioCx();
	cx.$history.set(createHistory(project));
	cx.simulation.$result.set(result);
	const trackCx = new TrackCx(cx);
	const container = { dataset: {}, addEventListener() {}, removeEventListener() {}, getBoundingClientRect: () => ({ width: 1200, height: 800 }) } as unknown as HTMLElement;
	const unmount = trackCx.mount(container, {} as HTMLCanvasElement);
	const renderer = (trackCx as unknown as { renderer: TrackRenderer }).renderer;
	renderer.setViewport({ width: 1200, height: 800 }, 1);
	trackCx.$viewport.set({ width: 1200, height: 800 });
	runFrames();
	return { cx, trackCx, renderer, windmillId: windmill.id, unmount };
}

beforeEach(() => {
	draws.count = 0;
	frames = [];
	const context = new Proxy({}, { get: () => () => {}, set: () => true });
	vi.stubGlobal('document', { createElement: () => ({ width: 0, height: 0, getContext: () => context }) });
	vi.stubGlobal('window', { matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }), addEventListener() {}, removeEventListener() {}, devicePixelRatio: 1, setTimeout: () => 0, clearTimeout() {} });
	vi.stubGlobal('getComputedStyle', () => ({ getPropertyValue: () => '#efeae1' }));
	vi.stubGlobal('ResizeObserver', class {
		observe(): void {}
		disconnect(): void {}
	});
	vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
		frames.push({ id: nextFrame, callback });
		nextFrame += 1;
		return nextFrame - 1;
	});
	vi.stubGlobal('cancelAnimationFrame', (id: number) => {
		frames = frames.filter((frame) => frame.id !== id);
	});
});

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('the flat canvas behind 3D and Camera', () => {
	it('should neither draw nor sync while another view covers it', () => {
		// Prepare
		const { cx, renderer, unmount } = mounted();
		const setPieces = vi.spyOn(renderer, 'setPieces');
		const setMarbles = vi.spyOn(renderer, 'setMarbles');

		for (const view of ['3d', 'camera'] as const) {
			cx.$trackView.set(view);
			draws.count = 0;

			// Act
			cx.$playhead.set(cx.$playhead.get() + 1);
			runFrames();

			// Assert
			expect(draws.count).toBe(0);
			expect(setPieces).not.toHaveBeenCalled();
			expect(setMarbles).not.toHaveBeenCalled();
		}
		unmount();
	});

	it('should show the current playhead and hidden layers on the way back to 2D', () => {
		// Prepare
		const { cx, renderer, windmillId, unmount } = mounted();
		const setPieces = vi.spyOn(renderer, 'setPieces');
		cx.$trackView.set('3d');
		cx.$playhead.set(4);

		// Act
		cx.$trackView.set('2d');
		runFrames();

		// Assert
		const shown = setPieces.mock.lastCall?.[0] as TRenderPiece[];
		expect(shown[0]?.piece.entityId).toBe(windmillId);
		expect(shown[0]?.angle).toBeCloseTo(4);
		expect(draws.count).toBeGreaterThan(0);

		// Act
		cx.$trackView.set('camera');
		cx.$hidden.set([windmillId]);
		cx.$trackView.set('2d');

		// Assert
		expect(setPieces.mock.lastCall?.[0]).toEqual([]);
		unmount();
	});

	it('should keep Follow moving the view in 3D, which stands on it, and not in Camera', () => {
		// Prepare
		const { cx, trackCx, unmount } = mounted();
		cx.$trackView.set('3d');
		trackCx.$follow.set(true);
		const start = trackCx.$camera.get().view;

		// Act
		cx.$playhead.set(8);
		runFrames();

		// Assert
		expect(trackCx.$camera.get().view).not.toEqual(start);

		// Prepare
		cx.$trackView.set('camera');
		// A glide under way ends on its goal
		for (let frame = 0; frame < 2000 && frames.length > 0; frame += 1) runFrames();
		const held = trackCx.$camera.get().view;

		// Act
		cx.$playhead.set(9);
		runFrames();

		// Assert
		expect(trackCx.$camera.get().view).toEqual(held);
		unmount();
	});
});

describe('a playhead tick in 2D', () => {
	it('should turn the windmill without a full sync, and a new run syncs fully', () => {
		// Prepare
		const { cx, renderer, windmillId, unmount } = mounted();
		const setPieces = vi.spyOn(renderer, 'setPieces');
		const setPieceAngle = vi.spyOn(renderer, 'setPieceAngle');

		// Act
		cx.$playhead.set(2);

		// Assert
		expect(setPieces).not.toHaveBeenCalled();
		expect(setPieceAngle).toHaveBeenCalledWith(windmillId, 2);

		// Act
		cx.simulation.$result.set({ ...(cx.simulation.$result.get() as TSimulationResult) });

		// Assert
		expect(setPieces).toHaveBeenCalledTimes(1);
		unmount();
	});
});
