import { describe, expect, it } from 'vitest';
import { applyProjectCommands, createHistory, createMarble, createProject, isPatternGroup, parseProject, serializeProject, type TPatternGroup, type TProject, toGroupKey } from '@/modules/project';
import { createLinkedPiece } from '@/modules/simulation';
import { buildOutline, FREE_PIECES_KEY } from '@/modules/studio/outline';
import { StudioCx } from '@/modules/studio';
import { builtRunCommands, canUngroup, groupSelected, plainGroupSpan, ungroupSelected } from './group-commands';

function studio(zigzag = false): { cx: StudioCx; project: TProject } {
	const created = createProject({ title: 'Song' });
	const marble = { ...createMarble(0, { x: 0, y: 0 }), hits: [{ id: 'hit1', time: 1, pitch: 60 }, { id: 'hit2', time: 2, pitch: 62 }, { id: 'hit3', time: 3, pitch: 64 }] };
	const pieces = marble.hits.map((hit, index) => createLinkedPiece('platform', marble.id, hit.id, 0.3, { id: `piece-${index}` }));
	const live: TPatternGroup = { id: 'live', name: 'Zigzag', marbleId: marble.id, pieceIds: ['piece-0'], pattern: { kind: 'zigzag', hitIds: ['hit1'], width: 0.14, bounce: 0.5 } };
	const project: TProject = { ...created, marbles: [marble], track: { ...created.track, pieces, groups: zigzag ? [live] : [] } };
	const cx = new StudioCx();
	cx.$history.set(createHistory(project));
	return { cx, project };
}

describe('Group by hand', () => {
	it('should make a plain Group of the selected pieces, selected, in one Undo step that Ungroup takes apart', () => {
		const { cx, project } = studio();
		const steps = cx.$history.get()?.past.length ?? 0;
		cx.$selection.set(['piece-1', 'piece-2']);

		groupSelected(cx);

		const [group] = cx.project?.track.groups ?? [];
		expect(group).toMatchObject({ name: 'Group', marbleId: project.marbles[0]?.id, pieceIds: ['piece-1', 'piece-2'] });
		expect(group != null && isPatternGroup(group)).toBe(false);
		expect(cx.$selection.get()).toEqual([toGroupKey(group?.id ?? ''), 'piece-1', 'piece-2']);
		expect(cx.$history.get()?.past.length).toBe(steps + 1);

		ungroupSelected(cx);
		expect(cx.project?.track.groups).toEqual([]);
		expect(cx.$selection.get()).toEqual(['piece-1', 'piece-2']);
	});

	it('should leave a live Pattern alone and say why', () => {
		const { cx } = studio(true);
		cx.$selection.set(['piece-0', 'piece-1']);

		groupSelected(cx);
		expect(cx.project?.track.groups.map((group) => group.id)).toEqual(['live']);
		expect(cx.$notice.get()?.message).toBe('Part of Zigzag. Flatten to edit it.');

		ungroupSelected(cx);
		expect(cx.project?.track.groups.map((group) => group.id)).toEqual(['live']);
	});

	it('should take pieces out of the plain Group they were in, and drop one left empty', () => {
		const { cx } = studio();
		cx.$selection.set(['piece-1']);
		groupSelected(cx);
		cx.$selection.set(['piece-1', 'piece-2']);

		groupSelected(cx);

		expect(cx.project?.track.groups.map((group) => group.pieceIds)).toEqual([['piece-1', 'piece-2']]);
	});

	it('should save and open a plain Group, its block spanning the notes its pieces play', () => {
		const { cx, project } = studio();
		cx.$selection.set(['piece-0', 'piece-2']);
		groupSelected(cx);
		const [isOk, err, opened] = parseProject(serializeProject(cx.project as TProject));
		if (!isOk) throw err;

		const [group] = opened.track.groups;
		expect(group != null && !isPatternGroup(group) && plainGroupSpan(opened, project.marbles[0]!, group)).toEqual({ from: 1, to: 3 });
		expect(canUngroup(cx)).toBe(true);
	});

	it('should list a Group across marbles under Track Pieces, its pieces out of their marble', () => {
		const { project } = studio();
		const [isOk, err, next] = applyProjectCommands(project, [{ type: 'addGroup', group: { id: 'across', name: 'Group', pieceIds: ['piece-1'] } }]);
		if (!isOk) throw err;

		const rows = buildOutline(next, { workspace: 'track' });

		expect(rows.find((row) => row.id === toGroupKey('across'))?.parentId).toBe(FREE_PIECES_KEY);
		expect(rows.find((row) => row.id === 'piece-1')?.parentId).toBe(toGroupKey('across'));
	});

	it('should group what a build placed by run: a Zigzag, a Rail, and nothing for a lone bar or an older piece', () => {
		const created = createProject({ title: 'Song' });
		const hitIds = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'h7'];
		const marble = { ...createMarble(0, { x: 0, y: 0 }), hits: hitIds.map((id, index) => ({ id, time: index + 1, pitch: 60 })) };
		const piece = (hitId: string, type: 'platform' | 'rail') => createLinkedPiece(type, marble.id, hitId, 0.3, { id: `p-${hitId}` });
		const pieces = [piece('h1', 'platform'), piece('h2', 'platform'), piece('h3', 'platform'), piece('h4', 'platform'), piece('h5', 'rail'), piece('h6', 'platform'), piece('h7', 'platform')];
		const after: TProject = { ...created, marbles: [marble], track: { ...created.track, pieces } };
		const before: TProject = { ...after, track: { ...after.track, pieces: pieces.filter((piece) => piece.id !== 'p-h2' && piece.id !== 'p-h3' && piece.id !== 'p-h4' && piece.id !== 'p-h5' && piece.id !== 'p-h6') } };
		const dots = [0, -1, 1, -1, 0, 0, 1];
		const hits = hitIds.map((id, index) => ({ pieceEntityId: `p-${id}`, dot: { x: dots[index] ?? 0, y: 0 } })) as unknown as Parameters<typeof builtRunCommands>[2];

		const commands = builtRunCommands(before, after, hits);

		expect(commands.map((command) => (command.type === 'addGroup' ? [command.group.name, command.group.pieceIds] : null))).toEqual([
			['Zigzag', ['p-h2', 'p-h3', 'p-h4']],
			['Rail', ['p-h5']]
		]);
	});
});
