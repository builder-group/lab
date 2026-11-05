import { describe, expect, it } from 'vitest';
import type { TEntity, TProject } from '@/modules/project';
import { draftPieceColors, PLAIN_PIECE_COLOR } from './draft-look';
import { pieceLabelColor, trackPieceColors } from './label-colors';

const LANE = '#3478f6';
const OWN = '#e0622e';

function project(entities: Partial<TEntity>[]): TProject {
	return { entities, music: { lanes: [{ id: 'lane', color: LANE, hits: [] }] } } as unknown as TProject;
}

const played = { id: 'a', components: { piece: { type: 'platform' }, hitLink: { laneId: 'lane', hitId: 'h' } } } as unknown as TEntity;
const free = { id: 'b', components: { piece: { type: 'platform' } } } as unknown as TEntity;

describe('pieceLabelColor function', () => {
	it('should prefer its own color, then its marble\'s, then none', () => {
		expect(pieceLabelColor(project([played]), played)).toBe(LANE);
		expect(pieceLabelColor(project([{ ...played, labelColor: OWN }]), { ...played, labelColor: OWN })).toBe(OWN);
		expect(pieceLabelColor(project([free]), free)).toBeNull();
	});
});

describe('trackPieceColors function', () => {
	it('should read a recolored piece from the new project state', () => {
		// Prepare
		const before = project([{ ...free, labelColor: '#ff0000' }]);
		const after = project([{ ...free, labelColor: '#00ff00' }]);

		// Act
		const first = trackPieceColors(before, free.id, 'platform');
		const second = trackPieceColors(after, free.id, 'platform');

		// Assert
		expect(first).not.toBe(second);
		expect(trackPieceColors(before, free.id, 'platform')).toBe(first);
	});

	it('should draw a piece with no color as plain Pegboard wood, whatever the theme', () => {
		expect(trackPieceColors(project([free]), 'b', 'platform').bar).toBe(PLAIN_PIECE_COLOR);
	});

	it('should give the same object for the same color, so memoized shapes stay put', () => {
		const shown = project([played]);
		expect(trackPieceColors(shown, 'a', 'platform')).toBe(trackPieceColors(shown, 'a', 'platform'));
	});
});

describe('the skin None', () => {
	it('should draw in its color in every theme, and no other skin takes the label color', () => {
		for (const theme of ['pegboard', 'brass', 'neon']) {
			expect(draftPieceColors(theme, { type: 'platform', color: OWN, skin: { assetId: 'platform:none' } }).bar).toBe(OWN);
		}
	});
});
