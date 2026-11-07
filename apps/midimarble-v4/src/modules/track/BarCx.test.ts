import { createState } from 'feature-state';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { applyProjectCommands, createHistory, createMarble, createProject, pushHistory, toHitKey, undoHistory, type TProject, type TProjectCommand, type TProjectHistory } from '@/modules/project';
import { localProposeDeps } from '@/modules/building';
import { createSimulator, type TSimulationResult, type TSimulator } from '@/modules/simulation';
import type { StudioCx } from '@/modules/studio';
import { defaultChoice } from './bar';
import { BarCx } from './BarCx';

let simulator: TSimulator;
beforeAll(async () => {
	simulator = await createSimulator();
});
afterAll(() => simulator.dispose());

/** Notes close together, nothing placed */
function notes(times = [0.5, 1, 1.5, 2]): TProject {
	const marble = createMarble(0, { x: 0, y: 0.6 }, 'marble');
	return { ...createProject({ title: 'Bar' }), marbles: [{ ...marble, hits: times.map((time, index) => ({ id: `hit-${index}`, time })) }], length: 3 };
}

const flush = async (): Promise<void> => {
	for (let i = 0; i < 40; i++) await new Promise((resolve) => setTimeout(resolve, 2));
};

/** The bar on a small stand-in for the studio with the real `propose`, whose autoPlace waits while `hold` says so */
function studio(project: TProject): { cx: StudioCx; bar: BarCx; lands: () => number; release: () => void; hold: () => void; undo: () => void } {
	const $history = createState<TProjectHistory | null>(createHistory(project));
	const $result = createState<TSimulationResult | null>(simulator.simulate(project));
	const $selection = createState<string[]>([]);
	let landed = 0;
	let waiting: (() => void)[] = [];
	let isHeld = false;
	const deps = localProposeDeps(simulator);
	const cx = {
		$history,
		$selection,
		$workspace: createState('track'),
		$playing: createState(false),
		$reveal: createState(null),
		get project() {
			return $history.get()?.present ?? null;
		},
		seek: () => undefined,
		audition: () => undefined,
		notify: () => 0,
		notifyEdit: () => 0,
		assist: {
			isBuilding: false,
			proposeDeps: () => ({
				...deps,
				autoPlace: async (request: Parameters<typeof deps.autoPlace>[0]) => {
					if (isHeld) await new Promise<void>((resolve) => waiting.push(resolve));
					return deps.autoPlace(request);
				}
			})
		},
		patterns: { ask: async () => null, cancelAsk: () => undefined },
		simulation: {
			$result,
			isPreviewing: false,
			landWorkedOut: (commands: TProjectCommand[]) => {
				const history = $history.get();
				if (history == null) return false;
				const [isOk, , next] = applyProjectCommands(history.present, commands);
				if (!isOk) return false;
				landed += 1;
				const revised = { ...next, revision: history.present.revision + 1 };
				$history.set(pushHistory(history, revised));
				$result.set(simulator.simulate(revised));
				return true;
			}
		}
	} as unknown as StudioCx;
	const bar = new BarCx(cx);
	bar.mount();
	return {
		cx,
		bar,
		lands: () => landed,
		hold: () => (isHeld = true),
		release: () => {
			isHeld = false;
			for (const go of waiting) go();
			waiting = [];
		},
		undo: () => {
			const history = $history.get();
			if (history == null) return;
			const back = undoHistory(history);
			$history.set(back);
			$result.set(simulator.simulate(back.present));
		}
	};
}

describe('BarCx', () => {
	it('opens on the first note of a track with nothing built', () => {
		const { cx, bar } = studio(notes());
		expect(cx.$selection.get()).toEqual([toHitKey('marble', 'hit-0')]);
		expect(bar.$state.get()).toMatchObject({ choice: 'platform', target: { kind: 'note', number: 1, stage: 'open' } });
	});

	it('changes nothing by moving', async () => {
		const project = notes();
		const { cx, bar, lands } = studio(project);
		await flush();
		bar.move(1);
		bar.move(-1);
		await flush();
		expect(lands()).toBe(0);
		expect(cx.project).toBe(project);
	});

	it('lands exactly what it showed on Enter and moves on, as one step', async () => {
		const { cx, bar, lands } = studio(notes());
		await flush();
		const shown = bar.answerOfChoice?.proposal;
		expect(shown?.status).toBe('fits');
		bar.enter();
		expect(lands()).toBe(1);
		expect(cx.project?.track.pieces.map((piece) => piece.id)).toEqual(shown?.pieces.map((piece) => piece.id));
		expect(cx.project?.track.pieces[0]?.angle).toBe(shown?.pieces[0]?.angle);
		expect(cx.$selection.get()).toEqual([toHitKey('marble', 'hit-1')]);
	});

	it('waits for the answer when Enter comes first, and takes it', async () => {
		const { cx, bar, lands, hold, release } = studio(notes());
		await flush();
		bar.enter();
		await flush();
		hold();
		bar.move(-1);
		bar.move(1);
		await flush();
		expect(bar.answerOfChoice?.proposal).toBeNull();
		bar.enter();
		expect(lands()).toBe(1);
		expect(bar.$state.get().queued).toBe(1);
		release();
		await flush();
		expect(lands()).toBe(2);
		expect(cx.project?.track.pieces).toHaveLength(2);
	});

	it('drops an answer for a note it has moved on from', async () => {
		const { bar, lands, hold, release } = studio(notes());
		await flush();
		bar.enter();
		await flush();
		hold();
		bar.move(-1);
		bar.move(1);
		bar.enter();
		bar.move(-1);
		release();
		await flush();
		// The press belonged to the note it left
		expect(lands()).toBe(1);
		expect(bar.$state.get().target).toMatchObject({ number: 1 });
	});

	it('goes back to where it stood on an Undo of what it landed', async () => {
		const { cx, bar, undo } = studio(notes());
		await flush();
		bar.enter();
		await flush();
		bar.enter();
		await flush();
		expect(bar.$state.get().target).toMatchObject({ number: 3 });
		undo();
		await flush();
		expect(cx.project?.track.pieces).toHaveLength(1);
		expect(cx.$selection.get()).toEqual([toHitKey('marble', 'hit-1')]);
		expect(bar.$state.get().target).toMatchObject({ number: 2, stage: 'open' });
	});

	it('moves on from a built note on Enter, with nothing to land', async () => {
		const { bar, lands } = studio(notes());
		await flush();
		bar.enter();
		await flush();
		bar.move(-1);
		await flush();
		expect(bar.$state.get()).toMatchObject({ choice: null, target: { number: 1, stage: 'built', isLastBuilt: true } });
		bar.enter();
		expect(lands()).toBe(1);
		expect(bar.$state.get().target).toMatchObject({ number: 2 });
	});

	it('chooses in the dropdown without landing, and Esc takes the choice back', async () => {
		const { bar, lands } = studio(notes());
		await flush();
		bar.enter();
		await flush();
		bar.move(-1);
		await flush();
		bar.flip();
		await flush();
		expect(bar.$state.get().choice).toBe('flip');
		expect(lands()).toBe(1);
		expect(bar.escape()).toBe(true);
		expect(bar.$state.get().choice).toBeNull();
		expect(bar.escape()).toBe(false);
	});

	it('takes ⌫ as its Remove: the hint first, then a second ⌫ lands it', async () => {
		const { cx, bar, lands } = studio(notes());
		await flush();
		// Nothing stands on an open note
		expect(bar.remove()).toBe(false);
		bar.enter();
		await flush();
		bar.move(-1);
		await flush();
		expect(bar.remove()).toBe(true);
		expect(bar.$state.get().choice).toBe('remove');
		expect(lands()).toBe(1);
		await flush();
		expect(bar.answerOfChoice?.proposal?.commands.length).toBeGreaterThan(0);
		bar.remove();
		expect(lands()).toBe(2);
		expect(cx.project?.track.pieces).toHaveLength(0);
		// Remove is over once landed: the open note offers its Platform again
		expect(bar.$state.get().choice).toBe('platform');
	});

	it('at an empty rest falls through a refused Curved Rail to the next kind in the fixed order', async () => {
		const { bar } = studio(notes([0.5, 1, 2.5, 3]));
		await flush();
		bar.enter();
		await flush();
		bar.enter();
		await flush();
		await flush();
		const state = bar.$state.get();
		expect(state.target).toMatchObject({ kind: 'rest', stage: 'open' });
		// The stand-in's Patterns answer nothing, so Curved Rail is refused
		expect(state.answers['longRail']?.proposal?.status).toBe('refused');
		expect(state.passed[0]).toBe('longRail');
		expect(state.choice).toBe(state.target != null ? defaultChoice(state.target, state.passed) : null);
		expect(state.choice).not.toBe('longRail');
		// Esc has nothing to take back: the choice is the default
		expect(bar.escape()).toBe(false);
	});

	it('offers past the built notes to build up to here, and asks nothing', async () => {
		const { bar } = studio(notes());
		await flush();
		bar.move(1);
		await flush();
		expect(bar.$state.get()).toMatchObject({ choice: 'buildUpTo', answers: {}, target: { number: 2, stage: 'pastBuilt' } });
	});

	it('opens the status popover from its mark, closes it for the dropdown and on Escape, and drops it on moving on', async () => {
		const { bar } = studio(notes());
		await flush();
		bar.toggleDetails();
		expect(bar.$state.get().isDetailsOpen).toBe(true);
		bar.openMenu();
		expect(bar.$state.get()).toMatchObject({ isDetailsOpen: false });
		bar.closeMenu();
		bar.toggleDetails();
		expect(bar.escape()).toBe(true);
		expect(bar.$state.get().isDetailsOpen).toBe(false);
		bar.toggleDetails();
		bar.move(1);
		expect(bar.$state.get().isDetailsOpen).toBe(false);
	});
});
