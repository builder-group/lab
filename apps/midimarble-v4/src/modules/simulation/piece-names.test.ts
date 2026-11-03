import { describe, expect, it } from 'vitest';
import type { TEntity } from '@/modules/project';
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

function linked(type: string, laneId: string, hitId: string, name: string): TEntity {
	return { ...createLinkedPiece(type, laneId, hitId, 0, { id: `${type}-${hitId}` }), name };
}

describe('namePiecesInOrder function', () => {
	it('should number each type in hit order, marble after marble, with free pieces last', () => {
		// Prepare: pieces in build order, interleaved between the marbles
		const project = twoMarbles();
		const free: TEntity = { id: 'free', name: 'Rail 9', components: { piece: { type: 'rail', params: {} } } };
		project.entities.push(
			free,
			linked('platform', 'lane-1', 'hit-1-1', 'Platform 1'),
			linked('platform', 'lane-2', 'hit-2-1', 'Platform 2'),
			linked('platform', 'lane-1', 'hit-1-3', 'Platform 3'),
			linked('switchback', 'lane-1', 'hit-1-2', 'Switchback 4'),
			linked('platform', 'lane-1', 'hit-1-2', 'Platform 5'),
			linked('platform', 'lane-2', 'hit-2-2', 'Platform 6')
		);

		// Act
		const named = namePiecesInOrder(project);

		// Assert
		const names = Object.fromEntries(named.entities.map((entity) => [entity.id, entity.name]));
		expect(names).toMatchObject({
			'platform-hit-1-1': 'Platform 1',
			'platform-hit-1-2': 'Platform 2',
			'platform-hit-1-3': 'Platform 3',
			'platform-hit-2-1': 'Platform 4',
			'platform-hit-2-2': 'Platform 5',
			'switchback-hit-1-2': 'Switchback 1',
			free: 'Rail 1'
		});
	});

	it('should change only names and keep the entity order', () => {
		const project = twoMarbles();
		project.entities.push(linked('platform', 'lane-1', 'hit-1-2', 'Platform 7'), linked('platform', 'lane-1', 'hit-1-1', 'Platform 8'));

		const named = namePiecesInOrder(project);

		const withoutNames = (entities: TEntity[]) => entities.map(({ name: _name, ...entity }) => entity);
		expect(withoutNames(named.entities)).toEqual(withoutNames(project.entities));
		expect({ ...named, entities: [] }).toEqual({ ...project, entities: [] });
		// Marbles keep their names
		expect(named.entities.slice(0, 2).map((entity) => entity.name)).toEqual(project.entities.slice(0, 2).map((entity) => entity.name));
	});
});

describe('nextPieceName function', () => {
	it('should continue after the highest number of the type in use', () => {
		const entities = [
			linked('platform', 'lane-1', 'hit-1-1', 'Platform 1'),
			linked('platform', 'lane-1', 'hit-1-3', 'Platform 3'),
			linked('switchback', 'lane-1', 'hit-1-2', 'Switchback 1')
		];

		expect(nextPieceName('platform', entities)).toBe('Platform 4');
		expect(nextPieceName('switchback', entities)).toBe('Switchback 2');
		expect(nextPieceName('rail', entities)).toBe('Rail 1');
	});

	it('should count renamed pieces so a new name is not taken', () => {
		const entities = [linked('platform', 'lane-1', 'hit-1-1', 'Top'), linked('platform', 'lane-1', 'hit-1-2', 'Platform 1')];

		expect(nextPieceName('platform', entities)).toBe('Platform 3');
	});
});
