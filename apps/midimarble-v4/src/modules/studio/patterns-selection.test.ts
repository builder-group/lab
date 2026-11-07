import { describe, expect, it } from 'vitest';
import { groupSelection, rangeSelection } from '@/modules/track';
import { createProject, type TGroup, type TProject, parseRangeKey, toGroupKey, toHitKey, toRangeKey } from '@/modules/project';
import { inspectorTarget } from './inspector-target';
import { buildOutline, defaultCollapsed } from './outline';

const group: TGroup = { id: 'g1', name: 'Zigzag', marbleId: 'marble', pieceIds: ['p1', 'p2'], pattern: { kind: 'zigzag', hitIds: ['h1', 'h2'], width: 0.14, bounce: 0.5 } };

function project(): TProject {
	const base = createProject({ id: 'p', title: 'P' });
	const marble = { ...base.marbles[0], id: 'marble', hits: [1, 2, 3, 5].map((time, index) => ({ id: `h${index + 1}`, time })) } as TProject['marbles'][number];
	const piece = (id: string, hitId: string): TProject['track']['pieces'][number] => ({ id, name: id, type: 'platform', params: {}, angle: 0, place: { kind: 'plays', marbleId: 'marble', hitId, contactAt: 0.5 } });
	return { ...base, marbles: [marble], track: { ...base.track, pieces: [piece('p1', 'h1'), piece('p2', 'h2'), piece('p3', 'h3')], groups: [group] } };
}

describe('Pattern selection', () => {
	it('should turn a strip range over notes into the same selection as dragging over the hits', () => {
		expect(rangeSelection(project(), 'marble', 0.9, 2.1)).toEqual([toHitKey('marble', 'h1'), toHitKey('marble', 'h2')]);
	});

	it('should keep a strip range over silence as a range the inspector can show', () => {
		const [key = ''] = rangeSelection(project(), 'marble', 3.2, 4.8);
		expect(parseRangeKey(key)).toEqual({ marbleId: 'marble', from: 3.2, to: 4.8 });
		expect(inspectorTarget(project(), [key], 'track')).toEqual({ kind: 'patternRange', marbleId: 'marble', from: 3.2, to: 4.8 });
	});

	it('should show a Group in Track and its pieces in Film', () => {
		const selection = groupSelection(group);
		expect(selection).toEqual([toGroupKey('g1'), 'p1', 'p2']);
		expect(inspectorTarget(project(), selection, 'track')).toEqual({ kind: 'group', id: 'g1' });
		expect(inspectorTarget(project(), selection, 'film').kind).toBe('pieces');
		expect(inspectorTarget(project(), [toRangeKey('marble', 1, 2)], 'film').kind).toBe('scene');
	});
});

describe('buildOutline with Groups', () => {
	it('should gather a Group\'s pieces under a collapsible row beneath the marble', () => {
		const open = buildOutline(project(), { workspace: 'track', collapsed: [] }).map((row) => `${row.depth}:${row.kind}:${row.id}`);
		expect(open.slice(-4)).toEqual([`1:patternGroup:${toGroupKey('g1')}`, '2:piece:p1', '2:piece:p2', '1:piece:p3']);
	});

	it('should start a Group closed', () => {
		const marbleId = project().marbles[0]?.id;
		const rows = buildOutline(project(), { workspace: 'track', collapsed: defaultCollapsed(project(), 'track').filter((key) => key !== marbleId) });
		expect(rows.some((row) => row.id === 'p1')).toBe(false);
		expect(rows.some((row) => row.id === 'p3')).toBe(true);
	});
});
