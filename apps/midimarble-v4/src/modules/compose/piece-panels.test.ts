import { describe, expect, it } from 'vitest';
import type { TEntity } from '@/modules/project';
import { pieceParamPanels, showsLinkPanel } from './piece-panels';

function piece(hitLink?: { laneId: string; hitId: string }): TEntity {
	return { id: 'piece', components: { piece: { type: 'platform', params: {} }, ...(hitLink != null ? { hitLink } : {}) } } as unknown as TEntity;
}

describe('pieceParamPanels function', () => {
	it('should put a windmill\'s Brake and Spin in Physics and its shape in Hitbox', () => {
		const panels = pieceParamPanels('windmill');

		expect(panels.hitbox).toEqual(['depth', 'bladeCount', 'bladeLength', 'bladeThickness', 'hubRadius']);
		expect(panels.physics).toEqual(['bounce', 'damping', 'motorSpeed']);
	});

	it('should keep a platform\'s Length in Position and the bounce in Physics', () => {
		const panels = pieceParamPanels('platform');

		expect(panels.hitbox).toEqual(['thickness', 'depth']);
		expect(panels.physics).toEqual(['bounce']);
	});

	it('should show what a Rail\'s layout uses in Hitbox and no empty Physics', () => {
		const panels = pieceParamPanels('rail', 'switchback');

		expect(panels.hitbox).toEqual(['turns', 'width', 'drop', 'opening', 'lip', 'bend', 'radius', 'gap']);
		expect(panels.physics).toEqual([]);
		expect(pieceParamPanels('rail').hitbox).toEqual(['radius', 'gap']);
		expect(pieceParamPanels('rail', 'chain').hitbox).toContain('sweep');
	});

	it('should show a Finish\'s size in Hitbox, leaving Style and Mirror to its own panel', () => {
		expect(pieceParamPanels('finish').hitbox).toEqual(['size', 'length', 'radius']);
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
