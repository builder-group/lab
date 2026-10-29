import { describe, expect, it } from 'vitest';
import { createDemoProject, createWorldObject } from '../project/fixtures/sample-project';
import { getAdjacentObjectId, getObjectCollections } from './outliner';

describe('getObjectCollections function', () => {
	it('should derive world, track and guide collections without changing object order or project data', () => {
		const project = createDemoProject();
		project.tracks = [
			{ id: 'lead', name: 'Lead', color: '#123456', instrument: 10, muted: false },
			{ id: 'bass', name: 'Bass', color: '#654321', instrument: 20, muted: false }
		];
		project.notes = [
			{ id: 'c4', trackId: 'lead', midi: 60, time: 1, duration: 0.2, velocity: 1 },
			{ id: 'd3', trackId: 'bass', midi: 50, time: 2, duration: 0.2, velocity: 1 }
		];
		const world = { ...createWorldObject('bar', [0, 0, 0]), id: 'world' };
		const lead = {
			...createWorldObject('bar', [0, 0, 0]),
			id: 'lead',
			binding: { noteId: 'c4', offset: [0, 0, 0] as [number, number, number] }
		};
		const bass = {
			...createWorldObject('drum', [0, 0, 0]),
			id: 'bass',
			binding: { noteId: 'd3', offset: [0, 0, 0] as [number, number, number] }
		};
		const guide = {
			...createWorldObject('rail', [0, 0, 0]),
			id: 'guide',
			trajectoryAnchor: { time: 3, offset: [0, 0, 0] as [number, number, number] }
		};
		project.objects = [guide, bass, lead, world, { ...lead, id: 'second-lead' }];
		const before = structuredClone(project);

		const collections = getObjectCollections(project);

		expect(
			collections.map((collection) => [
				collection.id,
				collection.objects.map((object) => object.id)
			])
		).toEqual([
			['world', ['world']],
			['track:lead', ['lead', 'second-lead']],
			['track:bass', ['bass']],
			['guides', ['guide']]
		]);
		expect(collections[1]).toMatchObject({ label: 'Lead', color: '#123456' });
		expect(project).toEqual(before);
	});

	it('should find linked objects by model, track and pitch, including typed sharps', () => {
		const project = createDemoProject();
		project.tracks = [
			{ id: 'melody', name: 'Bright melody', color: '#abcdef', instrument: 10, muted: false }
		];
		project.notes = [
			{ id: 'sharp', trackId: 'melody', midi: 61, time: 1, duration: 0.2, velocity: 1 }
		];
		const object = {
			...createWorldObject('bar', [0, 0, 0]),
			id: 'key',
			name: 'Upper strike',
			modelId: 'key-panel' as const,
			binding: { noteId: 'sharp', offset: [0, 0, 0] as [number, number, number] }
		};
		project.objects = [object];

		expect(getObjectCollections(project, 'wide melody C#4')[0]?.objects).toEqual([object]);
		expect(getObjectCollections(project, 'bar 61')[0]?.objects).toEqual([object]);
		expect(getObjectCollections(project, 'rail')).toEqual([]);
	});

	it('should include time anchors in linked filtering and keep orphaned links findable', () => {
		const project = createDemoProject();
		project.objects = [
			{ ...createWorldObject('bar', [0, 0, 0]), id: 'world' },
			{
				...createWorldObject('bar', [0, 0, 0]),
				id: 'orphan',
				binding: { noteId: 'missing', offset: [0, 0, 0] }
			},
			{
				...createWorldObject('rail', [0, 0, 0]),
				id: 'guide',
				trajectoryAnchor: { time: 1, offset: [0, 0, 0] }
			}
		];
		expect(
			getObjectCollections(project, '', 'linked').flatMap((collection) =>
				collection.objects.map((object) => object.id)
			)
		).toEqual(['orphan', 'guide']);
		expect(getObjectCollections(project, '', 'world').map((collection) => collection.id)).toEqual([
			'world'
		]);
		expect(getObjectCollections({ ...project, objects: [] })).toEqual([]);
	});
});

describe('getAdjacentObjectId function', () => {
	it('should navigate visible collection rows in order and clamp at either end', () => {
		const visibleIds = ['world', 'lead-a', 'lead-b', 'guide'];
		expect(getAdjacentObjectId(visibleIds, 'lead-b', 'ArrowDown')).toBe('guide');
		expect(getAdjacentObjectId(visibleIds, 'lead-a', 'ArrowUp')).toBe('world');
		expect(getAdjacentObjectId(visibleIds, 'world', 'ArrowUp')).toBe('world');
		expect(getAdjacentObjectId(visibleIds, 'guide', 'ArrowDown')).toBe('guide');
		expect(getAdjacentObjectId(visibleIds, 'lead-a', 'Home')).toBe('world');
		expect(getAdjacentObjectId(visibleIds, 'lead-a', 'End')).toBe('guide');
	});
	it('should recover from a filtered selection and tolerate no expanded collections', () => {
		expect(getAdjacentObjectId(['visible'], 'hidden', 'ArrowDown')).toBe('visible');
		expect(getAdjacentObjectId([], 'hidden', 'Home')).toBeNull();
	});
});
