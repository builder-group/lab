import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHistory, createProject, type TProject } from '@/modules/project';
import type { TSimulationResult } from '@/modules/simulation';
import { StudioCx } from './StudioCx';

const simulate = vi.fn<(project: TProject, horizon?: number) => Promise<never>>(() => new Promise(() => undefined));

vi.mock('@/modules/simulation', async (original) => ({
	...(await original<typeof import('@/modules/simulation/index')>()),
	createSimulationClient: () => ({ simulate, dispose: () => undefined })
}));

describe('SimulationCx previews', () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.stubGlobal('requestAnimationFrame', () => 0);
		vi.stubGlobal('cancelAnimationFrame', () => undefined);
	});
	afterEach(() => {
		vi.useRealTimers();
		vi.unstubAllGlobals();
		simulate.mockClear();
	});

	/** Lets the frame fallback pass and returns the horizon of the newest run */
	function nextRun(): number | undefined {
		vi.advanceTimersByTime(100);
		return simulate.mock.lastCall?.[1];
	}

	it('runs whole at first, to a horizon while moving, and whole again on a pause or the release', () => {
		const project = createProject({ title: 'Song' });
		// A drag changes the pieces each time
		const moved = (): TProject => ({ ...project, track: { ...project.track, pieces: [...project.track.pieces] } });
		const cx = new StudioCx();
		const unmount = cx.simulation.mount();
		cx.$history.set(createHistory(project));
		expect(nextRun()).toBeUndefined();

		cx.simulation.startPreview(moved());
		expect(cx.simulation.$previewing.get()).toBe(true);
		expect(nextRun()).toBeUndefined();

		cx.simulation.startPreview(moved());
		expect(nextRun()).toBeGreaterThan(0);
		// Nothing new for a while: the pointer has paused
		vi.advanceTimersByTime(200);
		expect(simulate.mock.lastCall?.[1]).toBeUndefined();

		cx.simulation.startPreview(moved());
		expect(nextRun()).toBeGreaterThan(0);
		cx.simulation.endPreview();
		expect(cx.simulation.$previewing.get()).toBe(false);
		expect(nextRun()).toBeUndefined();
		unmount();
	});

	describe('$problems', () => {
		const run = (project: TProject, revision = project.revision): TSimulationResult => ({ revision, duration: project.length, marbles: [], pieces: [], contacts: [], hits: [], stats: { computeMs: 0, reusedUntil: 0, steps: 0 } });

		function opened(): { cx: StudioCx; project: TProject; unmount: () => void } {
			const project = createProject({ title: 'Song' });
			const cx = new StudioCx();
			const unmount = cx.simulation.mount();
			cx.$history.set(createHistory(project));
			return { cx, project, unmount };
		}

		it('is pending without a project, and until the run has caught up', () => {
			const cx = new StudioCx();
			expect(cx.simulation.$problems.get().state).toBe('pending');

			const { cx: open, project, unmount } = opened();
			expect(open.simulation.$problems.get().state).toBe('pending');
			open.simulation.$result.set(run(project, project.revision - 1));
			expect(open.simulation.$problems.get().state).toBe('pending');
			open.simulation.$result.set(run(project));
			expect(open.simulation.$problems.get().state).toBe('checked');
			unmount();
		});

		it('notifies who listens when the run arrives', () => {
			const { cx, project, unmount } = opened();
			const states: string[] = [];
			const stop = cx.simulation.$problems.listen(({ value }) => {
				states.push(value.state);
			});
			cx.simulation.$result.set(run(project));
			expect(states).toEqual(['checked']);
			stop();
			unmount();
		});

		it('holds the last check through a drag', () => {
			const { cx, project, unmount } = opened();
			cx.simulation.$result.set(run(project));
			const checked = cx.simulation.$problems.get();

			cx.simulation.startPreview({ ...project, track: { ...project.track, pieces: [...project.track.pieces] } });
			cx.simulation.$result.set(run(project));
			expect(cx.simulation.$problems.get()).toBe(checked);

			cx.simulation.endPreview();
			expect(cx.simulation.$problems.get()).not.toBe(checked);
			unmount();
		});

		it('checks nothing while Build Track works', () => {
			const { cx, project, unmount } = opened();
			cx.simulation.$result.set(run(project));
			cx.assist.$building.set({} as never);
			expect(cx.simulation.$problems.get().state).toBe('pending');
			cx.assist.$building.set(null);
			expect(cx.simulation.$problems.get().state).toBe('checked');
			unmount();
		});
	});
});
