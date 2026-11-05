import { describe, expect, it } from 'vitest';
import type { TEntity } from '@/modules/project';
import { pieceParamPanels, showsLinkPanel } from './piece-panels';

function piece(hitLink?: { laneId: string; hitId: string }): TEntity {
	return { id: 'piece', components: { piece: { type: 'platform', params: {} }, ...(hitLink != null ? { hitLink } : {}) } } as unknown as TEntity;
}

describe('pieceParamPanels function', () => {
	it('should put a windmill\'s Brake and Spin in Physics and its size in Shape', () => {
		const panels = pieceParamPanels('windmill');

		expect(panels.shape).toEqual(['bladeCount', 'bladeLength', 'bladeThickness', 'hubRadius', 'depth']);
		expect(panels.physics).toEqual(['bounce', 'damping', 'motorSpeed']);
	});

	it('should put a platform\'s Length, Thickness and Depth in Shape and the bounce in Physics', () => {
		const panels = pieceParamPanels('platform');

		expect(panels.shape).toEqual(['length', 'thickness', 'depth']);
		expect(panels.physics).toEqual(['bounce']);
	});

	it('should show what a Rail\'s layout uses in Shape and no empty Physics', () => {
		const panels = pieceParamPanels('rail', 'switchback');

		expect(panels.shape).toEqual(['turns', 'width', 'drop', 'opening', 'lip', 'bend', 'radius', 'gap']);
		expect(panels.physics).toEqual([]);
		expect(pieceParamPanels('rail').shape).toEqual(['radius', 'gap']);
		expect(pieceParamPanels('rail', 'chain').shape).toContain('sweep');
	});

	it('should show a Bowl\'s size in Shape, leaving Style and Mirror to its own panel', () => {
		expect(pieceParamPanels('bowl').shape).toEqual(['size', 'radius']);
	});
});

describe('showsLinkPanel function', () => {
	it('should show the panel only for one linked piece', () => {
		const linked = piece({ laneId: 'lane', hitId: 'hit' });

		expect(showsLinkPanel([linked])).toBe(true);
		expect(showsLinkPanel([piece()])).toBe(false);
		expect(showsLinkPanel([linked, linked])).toBe(false);
		expect(showsLinkPanel([])).toBe(false);
	});
});
