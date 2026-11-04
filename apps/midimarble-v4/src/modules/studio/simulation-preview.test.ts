import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHistory, createProject, type TProject } from '@/modules/project';
import { StudioCx } from './StudioCx';

const simulate = vi.fn<(project: TProject, horizon?: number) => Promise<never>>(() => new Promise(() => undefined));

vi.mock('@/modules/simulation', async (original) => ({
	...(await original<typeof import('@/modules/simulation')>()),
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
		const cx = new StudioCx();
		const unmount = cx.simulation.mount();
		cx.$history.set(createHistory(project));
		expect(nextRun()).toBeUndefined();

		cx.simulation.startPreview({ ...project });
		expect(cx.simulation.$previewing.get()).toBe(true);
		expect(nextRun()).toBeUndefined();

		cx.simulation.startPreview({ ...project });
		expect(nextRun()).toBeGreaterThan(0);
		// Nothing new for a while: the pointer has paused
		vi.advanceTimersByTime(200);
		expect(simulate.mock.lastCall?.[1]).toBeUndefined();

		cx.simulation.startPreview({ ...project });
		expect(nextRun()).toBeGreaterThan(0);
		cx.simulation.endPreview();
		expect(cx.simulation.$previewing.get()).toBe(false);
		expect(nextRun()).toBeUndefined();
		unmount();
	});
});
