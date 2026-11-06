import type { TFilm } from './schema';
import { parseDecorKey, parseLightKey, toDecorKey, toLightKey } from './selection';

// The lists under `film` that show as layers, for what treats them alike: Edit > Undo's names, an agent's presence marks,
// Rename and the keys a selection may hold. A new list needs an entry here and none of those. Its row in Layers, its
// inspector and what it draws differ per layer, so those stay with each layer: "Add a film layer" in docs/architecture.md.

export interface TFilmLayer {
	kind: 'title' | 'decor' | 'light';
	/** Its names in Edit > Undo. Null for titles, which are named with the marbles and pieces. */
	words: { one: string; many: string } | null;
	/** Its items, from a whole film or from the part of one an `updateFilm` names */
	items: (film: Partial<TFilm>) => readonly { id: string; position?: unknown }[] | undefined;
	toKey: (id: string) => string;
	/** The item a selection key names, or null. A title's ID is its key, so no key is recognizably a title's. */
	parseKey: (key: string) => string | null;
}

/** In this order for a command that names several: its Undo name is the first's */
export const FILM_LAYERS: readonly TFilmLayer[] = [
	{ kind: 'title', words: null, items: (film) => film.titles, toKey: (id) => id, parseKey: () => null },
	{ kind: 'decor', words: { one: 'Decor', many: 'Decor' }, items: (film) => film.decor, toKey: toDecorKey, parseKey: parseDecorKey },
	{ kind: 'light', words: { one: 'Light', many: 'Lights' }, items: (film) => film.lights?.added, toKey: toLightKey, parseKey: parseLightKey }
];

/** Whether a selection key names a film layer's item by its prefix */
export function isFilmLayerKey(key: string): boolean {
	return FILM_LAYERS.some((layer) => layer.parseKey(key) != null);
}
