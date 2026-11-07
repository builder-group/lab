import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHistory, createMarble, createProject, type TProject } from '@/modules/project';
import { createLinkedPiece } from '@/modules/simulation';
import { type TPatternAnswer } from '@/modules/building/patterns/pattern.worker';
import { StudioCx } from '@/modules/studio';
import { PatternsCx } from './PatternsCx';

const TARGET = { marbleId: '', from: 1, to: 2 };

function studio(): { cx: StudioCx; patterns: PatternsCx; target: typeof TARGET; run: ReturnType<typeof vi.fn>; preview: ReturnType<typeof vi.fn>; cancelPreview: ReturnType<typeof vi.fn>; fits: TPatternAnswer; refused: TPatternAnswer } {
	const created = createProject({ title: 'Song' });
	const marble = { ...createMarble(0, { x: 0, y: 0 }), hits: [{ id: 'hit1', time: 1, pitch: 60 }, { id: 'hit2', time: 2, pitch: 62 }] };
	const project: TProject = { ...created, marbles: [marble] };
	const cx = new StudioCx();
	cx.$history.set(createHistory(project));
	const patterns = new PatternsCx(cx);
	const run = vi.fn();
	const preview = vi.fn();
	const client = { run, preview, cancelPreview: vi.fn(), cancel: () => undefined, dispose: () => undefined };
	(patterns as unknown as { client: unknown }).client = client;
	const piece = createLinkedPiece('platform', marble.id, 'hit1', 0.3, { id: 'bar' });
	const base = { name: 'Zigzag', problems: [], blocking: [], later: [], laterLateHits: 0, otherMarbleTouches: [], notes: [], madePieces: [], measures: null, movedAfter: 0, ending: null, offers: [], pieces: [] };
	const fits = { ...base, commands: [{ type: 'addPiece', piece }, { type: 'addGroup', group: { id: 'group-1', name: 'Zigzag', marbleId: marble.id, pieceIds: ['bar'], pattern: { kind: 'zigzag', hitIds: ['hit1'], width: 0.1, bounce: 0.5 } } }], groupId: 'group-1', refusal: null, verdicts: [{ hitId: 'hit1', fits: true, words: null }, { hitId: 'hit2', fits: true, words: null }] } as unknown as TPatternAnswer;
	const refusal = { marbleId: marble.id, hitId: 'hit2', words: "Zigzag doesn't fit at Hit 2 of Marble 1. The marble can't reach this note on time. Nothing changed." };
	const refused = { ...base, commands: [], groupId: null, refusal, offers: [{ label: 'Use Width 12 cm', words: 'Width 12 cm fits this range.', width: 0.12 }], verdicts: [{ hitId: 'hit1', fits: true, words: null }, { hitId: 'hit2', fits: false, words: "The marble can't reach this note on time." }] } as unknown as TPatternAnswer;
	return { cx, patterns, target: { ...TARGET, marbleId: marble.id }, run, preview, cancelPreview: client.cancelPreview, fits, refused };
}

describe('Patterns asked first', () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});
	afterEach(() => {
		vi.useRealTimers();
	});

	it('should leave out a Width nobody asked for, so the app picks one', async () => {
		const { patterns, target, run, fits } = studio();
		run.mockResolvedValue(fits);

		await patterns.apply(target, 'zigzag');

		expect(run.mock.calls[0]?.[1]).not.toHaveProperty('width');
	});

	it('should change nothing on a refusal, keep saying why, and offer what fits', async () => {
		const { cx, patterns, target, run, refused, fits } = studio();
		run.mockResolvedValueOnce(refused);
		const project = cx.project;

		await patterns.apply(target, 'zigzag');

		expect(cx.project).toBe(project);
		const notice = cx.$notice.get();
		expect(notice?.message).toContain("Zigzag doesn't fit at Hit 2 of Marble 1.");
		expect(notice?.message).toContain('Width 12 cm fits this range.');
		expect(notice?.actions?.[0]?.label).toBe('Use Width 12 cm');

		run.mockResolvedValueOnce(fits);
		notice?.actions?.[0]?.run();
		await vi.advanceTimersByTimeAsync(0);
		expect(run.mock.calls[1]?.[1]).toMatchObject({ width: 0.12 });
		expect(cx.project?.track.groups[0]?.id).toBe('group-1');
	});

});
