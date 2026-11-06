import { describe, expect, it, vi } from 'vitest';
import { PatternCanceledError } from '@/modules/building';
import { type TPatternAnswer } from '@/modules/building/patterns/pattern.worker';
import { createHistory, createMarble, createProject, pushHistory, type TProject } from '@/modules/project';
import { StudioCx } from '@/modules/studio';
import { PatternsCx } from './PatternsCx';

function project(id: string, marbleId: string): TProject {
	const created = createProject({ id, title: id });
	return { ...created, marbles: [{ ...createMarble(0, { x: 0, y: 0.6 }, marbleId), hits: [{ id: 'hit1', time: 1 }, { id: 'hit2', time: 2 }] }] };
}

function answerFor(marbleId: string): TPatternAnswer {
	const group = { id: 'group-a', name: 'Zigzag', marbleId, pieceIds: [] };
	return { commands: [{ type: 'addGroup', group }], groupId: group.id, name: group.name, problems: [], later: [], laterLateHits: 0, otherMarbleTouches: [], notes: [], refusal: null, offers: [], verdicts: [], movedAfter: 0, pieces: [] } as unknown as TPatternAnswer;
}

interface TFitStudio {
	cx: StudioCx;
	patterns: PatternsCx;
	cancel: ReturnType<typeof vi.fn>;
	/** The answer arrives though no cancel stopped it, as one already on its way does */
	land: () => void;
}

function fitStudio(start: TProject): TFitStudio {
	const cx = new StudioCx();
	cx.$history.set(createHistory(start));
	const patterns = new PatternsCx(cx);
	let land: () => void = () => undefined;
	let refuse: (error: Error) => void = () => undefined;
	const run = (): Promise<TPatternAnswer> =>
		new Promise((resolve, reject) => {
			land = () => resolve(answerFor('marble-a'));
			refuse = reject;
		});
	const cancel = vi.fn(() => refuse(new PatternCanceledError()));
	(patterns as unknown as { client: unknown }).client = { run, cancel, cancelPreview: () => undefined, dispose: () => undefined };
	patterns.mount();
	return { cx, patterns, cancel, land: () => land() };
}

const target = { marbleId: 'marble-a', from: 1, to: 2 };

describe('PatternsCx class', () => {
	describe('apply method', () => {
		it('should cancel a fit when another project opens at the same step count', async () => {
			// Prepare
			const { cx, patterns, cancel } = fitStudio(project('a', 'marble-a'));
			const fitting = patterns.apply(target, 'zigzag');

			// Act
			cx.$history.set(createHistory(project('b', 'marble-b')));
			const answer = await fitting;

			// Assert
			expect(cancel).toHaveBeenCalledTimes(1);
			expect(answer).toBeNull();
			expect(cx.project?.track.groups).toEqual([]);
		});

		it('should cancel a fit on an edit once the history is full', async () => {
			// Prepare
			let history = createHistory(project('a', 'marble-a'));
			for (let revision = 1; revision <= 200; revision++) history = pushHistory(history, { ...history.present, revision });
			const { cx, patterns, cancel } = fitStudio(history.present);
			cx.$history.set(history);
			const fitting = patterns.apply(target, 'zigzag');

			// Act
			cx.execute([{ type: 'updateProject', patch: { title: 'Edited' } }]);
			const answer = await fitting;

			// Assert
			expect(cx.$history.get()?.past).toHaveLength(200);
			expect(cancel).toHaveBeenCalledTimes(1);
			expect(answer).toBeNull();
			expect(cx.project?.track.groups).toEqual([]);
		});

		it('should not land an answer already on its way when the project changes', async () => {
			// Prepare
			const { cx, patterns, land } = fitStudio(project('a', 'marble-a'));
			const fitting = patterns.apply(target, 'zigzag');

			// Act
			land();
			cx.$history.set(createHistory(project('b', 'marble-b')));
			await fitting;

			// Assert
			expect(cx.project?.id).toBe('b');
			expect(cx.project?.track.groups).toEqual([]);
		});

		it('should go on through what amends the step, such as a longer song', async () => {
			// Prepare
			const { cx, patterns, cancel, land } = fitStudio(project('a', 'marble-a'));
			cx.execute([{ type: 'updateProject', patch: { title: 'Edited' } }]);
			const fitting = patterns.apply(target, 'zigzag');

			// Act
			cx.execute([{ type: 'updateProject', patch: { length: 60 } }], { amend: true });
			land();
			const answer = await fitting;

			// Assert
			expect(cancel).not.toHaveBeenCalled();
			expect(answer).not.toBeNull();
			expect(cx.project?.track.groups.map((group) => group.id)).toEqual(['group-a']);
		});
	});
});
