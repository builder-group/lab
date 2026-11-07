import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TPreflightIssue } from '@/modules/building';
import { createHistory, createProject, pushHistory, type TProject, type TProjectHistory } from '@/modules/project';
import type { TSimulationResult } from '@/modules/simulation';
import { StudioCx } from './StudioCx';

const simulate = vi.fn<(project: TProject, horizon?: number) => Promise<never>>(() => new Promise(() => undefined));

/** A problems worker that answers when told, with the issues it was given */
const problems = vi.hoisted(() => ({
	asked: [] as { project: TProject; answer: (issues: TPreflightIssue[]) => void }[]
}));

vi.mock('@/modules/building', async (original) => ({
	...(await original<typeof import('@/modules/building/index')>()),
	createSimulationClient: () => ({ simulate, dispose: () => undefined }),
	createProblemsClient: () => ({
		check: (project: TProject) => new Promise<TPreflightIssue[]>((resolve) => problems.asked.push({ project, answer: resolve })),
		dispose: () => undefined
	})
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

		it('asks the problems worker for the run, pending until it answers, and again only for what changes them', async () => {
			// Prepare: a worker exists, so the run's problems come from the problems worker
			vi.stubGlobal('Worker', function Worker() {
				return undefined;
			});
			problems.asked.length = 0;
			const { cx, project, unmount } = opened();
			const result = run(project);
			const answered = async (): Promise<void> => {
				for (let i = 0; i < 3; i++) await Promise.resolve();
			};
			const issue: TPreflightIssue = { id: 'hit:marble-1:hit-1', kind: 'hit', severity: 'warning', title: 'Note 1 of Melody is Missed', target: null };

			// Act
			cx.simulation.$result.set(result);

			// Assert: pending while the worker works, checked with its answer
			expect(cx.simulation.$problems.get().state).toBe('pending');
			expect(problems.asked).toHaveLength(1);
			problems.asked[0]?.answer([issue]);
			await answered();
			expect(cx.simulation.$problems.get().state).toBe('checked');
			expect(cx.simulation.$problems.get().issues.map((item) => item.id)).toEqual([issue.id]);

			// A film edit elsewhere keeps the run and its problems: nothing is asked again
			const titled: TProject = { ...project, revision: project.revision + 1, film: { ...project.film, wall: {} } };
			cx.$history.set(pushHistory(cx.$history.get() as TProjectHistory, titled));
			cx.simulation.$result.set({ ...result, revision: titled.revision });
			expect(cx.simulation.$problems.get().state).toBe('checked');
			expect(problems.asked).toHaveLength(1);

			// A camera edit frames the run anew, so the worker is asked again
			const framed: TProject = { ...titled, revision: titled.revision + 1, film: { ...titled.film, camera: { ...titled.film.camera } } };
			cx.$history.set(pushHistory(cx.$history.get() as TProjectHistory, framed));
			cx.simulation.$result.set({ ...result, revision: framed.revision });
			expect(cx.simulation.$problems.get().state).toBe('pending');
			expect(problems.asked).toHaveLength(2);
			problems.asked[1]?.answer([]);
			await answered();
			expect(cx.simulation.$problems.get().state).toBe('checked');
			expect(cx.simulation.$problems.get().issues).toEqual([]);
			unmount();
		});
	});
});
