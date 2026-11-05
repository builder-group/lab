import { describe, expect, it } from 'vitest';
import { PatternsCx, groupSelection } from '@/modules/compose/PatternsCx';
import { createHistory, createLane, createMarble, createProject, type TGroup, type TProject } from '@/modules/project';
import { createLinkedPiece } from '@/modules/simulation';
import { StudioCx } from './StudioCx';

function studio(): { cx: StudioCx; patterns: PatternsCx; group: TGroup } {
	const created = createProject({ title: 'Song' });
	const lane = { ...createLane(0), hits: [{ id: 'hit1', time: 1, pitch: 60 }, { id: 'hit2', time: 2, pitch: 62 }] };
	const pieces = lane.hits.map((hit, index) => createLinkedPiece('platform', lane.id, hit.id, 0.3, { id: `piece-${index}` }));
	const group: TGroup = { id: 'group-1', name: 'Zigzag', kind: 'zigzag', laneId: lane.id, from: 1, to: 2, width: 0.14, bounce: 0.5, pieceIds: pieces.map((piece) => piece.id) };
	const project: TProject = { ...created, music: { ...created.music, lanes: [lane] }, groups: [group], entities: [createMarble(lane, { x: 0, y: 0 }), ...pieces] };
	const cx = new StudioCx();
	cx.$history.set(createHistory(project));
	cx.$selection.set(groupSelection(group));
	return { cx, patterns: new PatternsCx(cx), group };
}

describe('Flatten and Undo', () => {
	it('should take one Undo to bring the live Pattern back, selected as a whole', () => {
		// Prepare
		const { cx, patterns, group } = studio();
		const steps = cx.$history.get()?.past.length ?? 0;

		// Act
		patterns.flatten(group);
		expect(cx.project?.groups ?? []).toEqual([]);
		expect(cx.$history.get()?.past.length).toBe(steps + 1);
		cx.undo();

		// Assert
		expect(cx.project?.groups?.map((item) => item.id)).toEqual([group.id]);
		expect(cx.$selection.get()).toEqual(expect.arrayContaining(groupSelection(group)));
	});

	it("should not leave Flatten's notice saying it happened after Undo", () => {
		const { cx, patterns, group } = studio();
		patterns.flatten(group);
		expect(cx.$notice.get()?.message).toBe('Flattened Zigzag');

		cx.undo();

		expect(cx.$notice.get()).toBeNull();
	});

	it('should flatten again with Redo', () => {
		const { cx, patterns, group } = studio();
		patterns.flatten(group);
		cx.undo();

		cx.redo();

		expect(cx.project?.groups ?? []).toEqual([]);
	});
});
