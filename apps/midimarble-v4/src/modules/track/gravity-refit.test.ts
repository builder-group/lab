import { describe, expect, it, vi } from 'vitest';
import { createHistory, createLane, createMarble, createProject, type TPatternGroup, type TProject } from '@/modules/project';
import { createLinkedPiece } from '@/modules/simulation';
import { PatternCanceledError } from '@/modules/building';
import { type TPatternAnswer } from '@/modules/building/patterns/pattern.worker';
import { StudioCx } from '@/modules/studio';
import { PatternsCx } from './PatternsCx';

function studio(): { cx: StudioCx; patterns: PatternsCx; group: TPatternGroup; run: ReturnType<typeof vi.fn> } {
	const created = createProject({ title: 'Song' });
	const lane = { ...createLane(0), hits: [{ id: 'hit1', time: 1, pitch: 60 }, { id: 'hit2', time: 2, pitch: 62 }] };
	const pieces = lane.hits.map((hit, index) => createLinkedPiece('platform', lane.id, hit.id, 0.3, { id: `piece-${index}` }));
	const group: TPatternGroup = { id: 'group-1', name: 'Zigzag', kind: 'zigzag', marbleId: lane.id, from: 1, to: 2, width: 0.14, bounce: 0.5, pieceIds: pieces.map((piece) => piece.id) };
	const project: TProject = { ...created, music: { ...created.music, lanes: [lane] }, groups: [group], entities: [createMarble(lane, { x: 0, y: 0 }), ...pieces] };
	const cx = new StudioCx();
	cx.$history.set(createHistory(project));
	const patterns = new PatternsCx(cx);
	const run = vi.fn();
	(patterns as unknown as { client: unknown }).client = { run, cancel: () => run.mock.results.at(-1), dispose: () => undefined };
	return { cx, patterns, group, run };
}

describe('Gravity and live Patterns', () => {
	it('should fit a Pattern again in the same Undo step as the change', async () => {
		const { cx, patterns, group, run } = studio();
		const steps = cx.$history.get()?.past.length ?? 0;
		const answer = { commands: [{ type: 'upsertGroup', group: { ...group, width: 0.15 } }], groupId: group.id, name: group.name, problems: [], later: [], laterLateHits: 0, otherMarbleTouches: [], notes: [] } as unknown as TPatternAnswer;
		run.mockResolvedValue(answer);

		await patterns.setGravity(0.5);

		expect(run.mock.calls[0]?.[1]).toMatchObject({ groupId: group.id, kind: 'zigzag' });
		expect(run.mock.calls[0]?.[0].gravity).toBe(0.5);
		expect(cx.project?.groups?.[0]).toMatchObject({ width: 0.15 });
		expect(cx.$history.get()?.past.length).toBe(steps + 1);
	});

	it('should take the change back on Stop', async () => {
		const { cx, patterns, run } = studio();
		const before = cx.project?.gravity;
		run.mockImplementation(async () => {
			patterns.stop();
			throw new PatternCanceledError();
		});

		await patterns.setGravity(0.5);

		expect(cx.project?.gravity).toEqual(before);
	});
});
