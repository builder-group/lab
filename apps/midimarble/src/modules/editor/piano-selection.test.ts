import { describe, expect, it } from 'vitest';
import { reconcilePianoSelection, type TPianoSelection } from './piano-selection';

describe('reconcilePianoSelection function', () => {
	it('should discard a group permanently after selecting another note from the scene', () => {
		const group: TPianoSelection = { primaryId: 'a', ids: new Set(['a', 'b']) };
		const outside = reconcilePianoSelection(group, 'c');
		const returned = reconcilePianoSelection(outside, 'a');
		expect([...outside.ids]).toEqual(['c']);
		expect([...returned.ids]).toEqual(['a']);
	});

	it('should preserve a shift-selected group when its primary changes to another member', () => {
		const group: TPianoSelection = { primaryId: 'a', ids: new Set(['a', 'b']) };
		const selected = reconcilePianoSelection(group, 'b');
		expect(selected.primaryId).toBe('b');
		expect(selected.ids).toBe(group.ids);
		const returned = reconcilePianoSelection(selected, 'a');
		expect(returned.primaryId).toBe('a');
		expect(returned.ids).toBe(group.ids);
	});

	it('should keep the new group after toggling its previous primary off', () => {
		const group: TPianoSelection = { primaryId: 'b', ids: new Set(['a', 'c']) };
		const selected = reconcilePianoSelection(group, 'a');
		expect(selected.primaryId).toBe('a');
		expect(selected.ids).toBe(group.ids);
	});

	it('should discard a marquee group after its primary changes from no note to a member and back', () => {
		const marquee: TPianoSelection = { primaryId: null, ids: new Set(['c', 'e']) };
		const selected = reconcilePianoSelection(marquee, 'c');
		const marble = reconcilePianoSelection(selected, null);
		const returned = reconcilePianoSelection(marble, 'c');
		expect(selected.primaryId).toBe('c');
		expect([...selected.ids]).toEqual(['c', 'e']);
		expect(marble.primaryId).toBeNull();
		expect(marble.ids.size).toBe(0);
		expect([...returned.ids]).toEqual(['c']);
	});

	it('should clear a group after moving its primary to another member then selecting the scene', () => {
		const group: TPianoSelection = { primaryId: 'a', ids: new Set(['a', 'b']) };
		const selected = reconcilePianoSelection(group, 'b');
		const scene = reconcilePianoSelection(selected, null);
		expect(scene.ids.size).toBe(0);
		expect([...reconcilePianoSelection(scene, 'a').ids]).toEqual(['a']);
	});

	it('should clear a group when the scene selects a non-note entity', () => {
		const group: TPianoSelection = { primaryId: 'a', ids: new Set(['a', 'b']) };
		const cleared = reconcilePianoSelection(group, null);
		expect(cleared.ids.size).toBe(0);
		expect([...reconcilePianoSelection(cleared, 'a').ids]).toEqual(['a']);
	});

	it('should preserve an explicit empty selection while its primary remains unchanged', () => {
		const empty: TPianoSelection = { primaryId: 'a', ids: new Set() };
		expect(reconcilePianoSelection(empty, 'a')).toBe(empty);
	});
});
