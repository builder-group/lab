import { describe, expect, it } from 'vitest';
import type { TPiece, TProject } from '@/modules/project';
import { draftPieceColors, PLAIN_PIECE_COLOR } from './draft-look';
import { pieceLabelColor, trackPieceColors } from './label-colors';

const MARBLE = '#3478f6';
const OWN = '#e0622e';

function project(entities: Partial<TPiece>[]): TProject {
	return { track: { pieces: entities, groups: [] }, marbles: [{ id: 'marble', labelColor: MARBLE, hits: [] }] } as unknown as TProject;
}

const played: TPiece = { id: 'a', type: 'platform', params: {}, angle: 0, place: { kind: 'plays', marbleId: 'marble', hitId: 'h', contactAt: 0.5 } };
const free: TPiece = { id: 'b', type: 'platform', params: {}, angle: 0, place: { kind: 'free', position: { x: 0, y: 0 } } };

describe('pieceLabelColor function', () => {
	it('should prefer its own color, then its marble\'s, then none', () => {
		expect(pieceLabelColor(project([played]), played)).toBe(MARBLE);
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
