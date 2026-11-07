import { describe, expect, it } from 'vitest';
import { PatternsCx, groupSelection } from '@/modules/track';
import { createHistory, createMarble, createProject, type TPatternGroup, type TProject } from '@/modules/project';
import { createLinkedPiece } from '@/modules/simulation';
import { StudioCx } from './StudioCx';

function studio(): { cx: StudioCx; patterns: PatternsCx; group: TPatternGroup } {
	const created = createProject({ title: 'Song' });
	const marble = { ...createMarble(0, { x: 0, y: 0 }), hits: [{ id: 'hit1', time: 1, pitch: 60 }, { id: 'hit2', time: 2, pitch: 62 }] };
	const pieces = marble.hits.map((hit, index) => createLinkedPiece('platform', marble.id, hit.id, 0.3, { id: `piece-${index}` }));
	const group: TPatternGroup = { id: 'group-1', name: 'Zigzag', marbleId: marble.id, pieceIds: pieces.map((piece) => piece.id), pattern: { kind: 'zigzag', hitIds: ['hit1', 'hit2'], width: 0.14, bounce: 0.5 } };
	const project: TProject = { ...created, marbles: [marble], track: { ...created.track, pieces, groups: [group] } };
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
		expect(cx.project?.track.groups).toEqual([{ id: group.id, name: group.name, marbleId: group.marbleId, pieceIds: group.pieceIds }]);
		expect(cx.$history.get()?.past.length).toBe(steps + 1);
		cx.undo();

		// Assert
		expect(cx.project?.track.groups.map((item) => item.id)).toEqual([group.id]);
		expect(cx.$selection.get()).toEqual(expect.arrayContaining(groupSelection(group)));
	});

	it("should not leave Flatten's notice saying it happened after Undo", () => {
		const { cx, patterns, group } = studio();
		patterns.flatten(group);
		expect(cx.$notice.get()?.message).toBe('Flattened Zigzag');

		cx.undo();

		expect(cx.$notice.get()).toBeNull();
	});

	it('should leave the piece a person went for selected, from the notice that says it is locked', () => {
		const { cx, patterns, group } = studio();
		patterns.tellLocked(group, 'piece-1');
		const flatten = cx.$notice.get()?.actions?.find((action) => action.label === 'Flatten');
		expect(cx.$notice.get()?.message).toBe('Part of Zigzag.');

		flatten?.run();
		expect(cx.$selection.get()).toEqual(['piece-1']);
		expect(cx.project?.track.groups[0]).not.toHaveProperty('pattern');
	});

	it('should flatten again with Redo', () => {
		const { cx, patterns, group } = studio();
		patterns.flatten(group);
		cx.undo();

		cx.redo();

		expect(cx.project?.track.groups).toEqual([{ id: group.id, name: group.name, marbleId: group.marbleId, pieceIds: group.pieceIds }]);
	});
});
