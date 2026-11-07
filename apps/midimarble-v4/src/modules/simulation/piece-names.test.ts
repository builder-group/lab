import { describe, expect, it } from 'vitest';
import type { TPiece } from '@/modules/project';
import { nextPieceName } from './piece-names';
import { createLinkedPiece } from './placement';

function linked(type: string, marbleId: string, hitId: string, name: string): TPiece {
	return { ...createLinkedPiece(type, marbleId, hitId, 0, { id: `${type}-${hitId}` }), name };
}

describe('nextPieceName function', () => {
	it('should continue after the highest number of the type in use', () => {
		const pieces = [
			linked('platform', 'marble-1', 'hit-1-1', 'Platform 1'),
			linked('platform', 'marble-1', 'hit-1-3', 'Platform 3'),
			linked('tunnel', 'marble-1', 'hit-1-2', 'Tunnel 1')
		];

		expect(nextPieceName('platform', pieces)).toBe('Platform 4');
		expect(nextPieceName('tunnel', pieces)).toBe('Tunnel 2');
		expect(nextPieceName('rail', pieces)).toBe('Rail 1');
	});

	it('should count renamed pieces so a new name is not taken', () => {
		const pieces = [linked('platform', 'marble-1', 'hit-1-1', 'Top'), linked('platform', 'marble-1', 'hit-1-2', 'Platform 1')];

		expect(nextPieceName('platform', pieces)).toBe('Platform 3');
	});
});
