import { describe, expect, it } from 'vitest';
import type { TPiece } from '@/modules/project';
import { createBareRunProject } from './fixture-projects';
import { namePiecesInOrder, nextPieceName } from './piece-names';
import { createLinkedPiece } from './placement';

function twoMarbles() {
	return createBareRunProject({
		id: 'names',
		title: 'Names',
		end: 4,
		marbles: [
			{ x: -0.1, y: 0.6, releaseTime: 0, hitTimes: [0.5, 1, 1.5] },
			{ x: 0.1, y: 0.6, releaseTime: 0, hitTimes: [0.75, 1.25] }
		]
	});
}

function linked(type: string, marbleId: string, hitId: string, name: string): TPiece {
	return { ...createLinkedPiece(type, marbleId, hitId, 0, { id: `${type}-${hitId}` }), name };
}

describe('namePiecesInOrder function', () => {
	it('should number each type in hit order, marble after marble, with free pieces last', () => {
		// Prepare: pieces in build order, interleaved between the marbles
		const project = twoMarbles();
		const free: TPiece = { id: 'free', name: 'Rail 9', type: 'rail', params: {}, angle: 0, place: { kind: 'free', position: { x: 0, y: 0 } } };
		project.track.pieces.push(
			free,
			linked('platform', 'marble-1', 'hit-1-1', 'Platform 1'),
			linked('platform', 'marble-2', 'hit-2-1', 'Platform 2'),
			linked('platform', 'marble-1', 'hit-1-3', 'Platform 3'),
			linked('tunnel', 'marble-1', 'hit-1-2', 'Tunnel 4'),
			linked('platform', 'marble-1', 'hit-1-2', 'Platform 5'),
			linked('platform', 'marble-2', 'hit-2-2', 'Platform 6')
		);

		// Act
		const named = namePiecesInOrder(project);

		// Assert
		const names = Object.fromEntries(named.track.pieces.map((piece) => [piece.id, piece.name]));
		expect(names).toMatchObject({
			'platform-hit-1-1': 'Platform 1',
			'platform-hit-1-2': 'Platform 2',
			'platform-hit-1-3': 'Platform 3',
			'platform-hit-2-1': 'Platform 4',
			'platform-hit-2-2': 'Platform 5',
			'tunnel-hit-1-2': 'Tunnel 1',
			free: 'Rail 1'
		});
	});

	it('should change only names and keep the piece order', () => {
		const project = twoMarbles();
		project.track.pieces.push(linked('platform', 'marble-1', 'hit-1-2', 'Platform 7'), linked('platform', 'marble-1', 'hit-1-1', 'Platform 8'));

		const named = namePiecesInOrder(project);

		const withoutNames = (pieces: TPiece[]) => pieces.map(({ name: _name, ...piece }) => piece);
		expect(withoutNames(named.track.pieces)).toEqual(withoutNames(project.track.pieces));
		expect({ ...named, track: { ...named.track, pieces: [] } }).toEqual({ ...project, track: { ...project.track, pieces: [] } });
		// Marbles keep their names
		expect(named.marbles.map((marble) => marble.name)).toEqual(project.marbles.map((marble) => marble.name));
	});
});

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
