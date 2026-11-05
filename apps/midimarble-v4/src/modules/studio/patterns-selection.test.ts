import { describe, expect, it } from 'vitest';
import { groupSelection, patternTargets, rangeSelection } from '@/modules/compose/PatternsCx';
import { createProject, type TGroup, type TProject } from '@/modules/project';
import { inspectorTarget } from './inspector-target';
import { buildOutline, defaultCollapsed } from './outline';
import { parseRangeKey, toGroupKey, toHitKey, toRangeKey } from './selection';

const group: TGroup = { id: 'g1', name: 'Zigzag', laneId: 'lane', from: 1, to: 2, kind: 'zigzag', width: 0.14, bounce: 0.5, pieceIds: ['p1', 'p2'] };

function project(): TProject {
	const base = createProject({ id: 'p', title: 'P' });
	const lane = { ...base.music.lanes[0], id: 'lane', hits: [1, 2, 3, 5].map((time, index) => ({ id: `h${index + 1}`, time })) } as TProject['music']['lanes'][number];
	const marble = base.entities[0] as TProject['entities'][number];
	const piece = (id: string, hitId: string): TProject['entities'][number] => ({ id, name: id, components: { piece: { type: 'platform', params: {} }, hitLink: { laneId: 'lane', hitId, angle: 0, contactAt: 0.5 } } });
	return { ...base, music: { ...base.music, lanes: [lane] }, entities: [{ ...marble, components: { ...marble.components, marble: { radius: 0.012, laneId: 'lane' } } }, piece('p1', 'h1'), piece('p2', 'h2'), piece('p3', 'h3')], groups: [group] };
}

describe('Pattern selection', () => {
	it('should turn a strip range over notes into the same selection as dragging over the hits', () => {
		expect(rangeSelection(project(), 'lane', 0.9, 2.1)).toEqual([toHitKey('lane', 'h1'), toHitKey('lane', 'h2')]);
	});

	it('should keep a strip range over silence as a range the inspector can show', () => {
		const [key = ''] = rangeSelection(project(), 'lane', 3.2, 4.8);
		expect(parseRangeKey(key)).toEqual({ laneId: 'lane', from: 3.2, to: 4.8 });
		expect(inspectorTarget(project(), [key], 'compose')).toEqual({ kind: 'patternRange', laneId: 'lane', from: 3.2, to: 4.8 });
		expect(patternTargets(project(), [key])).toEqual([{ laneId: 'lane', from: 3.2, to: 4.8 }]);
	});

	it('should offer one range per marble from selected hits', () => {
		expect(patternTargets(project(), [toHitKey('lane', 'h3'), toHitKey('lane', 'h1')])).toEqual([{ laneId: 'lane', from: 1, to: 3 }]);
	});

	it('should show a Group in Compose and its pieces in Film', () => {
		const selection = groupSelection(group);
		expect(selection).toEqual([toGroupKey('g1'), 'p1', 'p2']);
		expect(inspectorTarget(project(), selection, 'compose')).toEqual({ kind: 'group', id: 'g1' });
		expect(inspectorTarget(project(), selection, 'design').kind).toBe('pieces');
		expect(inspectorTarget(project(), [toRangeKey('lane', 1, 2)], 'design').kind).toBe('scene');
	});
});

describe('buildOutline with Groups', () => {
	it('should gather a Group\'s pieces under a collapsible row beneath the marble', () => {
		const open = buildOutline(project(), { workspace: 'compose', collapsed: [] }).map((row) => `${row.depth}:${row.kind}:${row.id}`);
		expect(open.slice(-5, -1)).toEqual([`1:patternGroup:${toGroupKey('g1')}`, '2:piece:p1', '2:piece:p2', '1:piece:p3']);
	});

	it('should start a Group closed', () => {
		const rows = buildOutline(project(), { workspace: 'compose', collapsed: defaultCollapsed(project(), 'compose') });
		expect(rows.some((row) => row.id === 'p1')).toBe(false);
		expect(rows.some((row) => row.id === 'p3')).toBe(true);
	});
});
