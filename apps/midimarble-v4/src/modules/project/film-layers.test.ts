import { describe, expect, it } from 'vitest';
import { FILM_LAYERS, isFilmLayerKey } from './film-layers';
import { createProject } from './create-project';
import { KEY_LIGHT_KEY, toDecorKey, toLightKey, WALL_KEY } from './selection';

describe('FILM_LAYERS', () => {
	it('should read a list from a whole film and from an edit that names it', () => {
		const { film } = createProject({ title: 'Song' });
		for (const layer of FILM_LAYERS) expect(layer.items(film)).toEqual([]);
		for (const layer of FILM_LAYERS) expect(layer.items({})).toBeUndefined();
	});

	it('should give back the ID its key names, for every layer with a key of its own', () => {
		for (const layer of FILM_LAYERS.filter((item) => item.kind !== 'title')) expect(layer.parseKey(layer.toKey('item-1'))).toBe('item-1');
	});

	describe('isFilmLayerKey function', () => {
		it('should know Decor and lights by their keys', () => {
			expect(isFilmLayerKey(toDecorKey('tree'))).toBe(true);
			expect(isFilmLayerKey(toLightKey('lamp'))).toBe(true);
			expect(isFilmLayerKey(KEY_LIGHT_KEY)).toBe(true);
		});

		it('should not take a title, a piece or the Wall for one', () => {
			expect(isFilmLayerKey('title-1')).toBe(false);
			expect(isFilmLayerKey(WALL_KEY)).toBe(false);
		});
	});
});
