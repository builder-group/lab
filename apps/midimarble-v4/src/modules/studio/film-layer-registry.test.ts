import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { pendingPreflight } from '@/modules/building';
import { projectState } from '@/modules/mcp/mcp-state';
import { createProject, FILM_LAYERS, type TFilm, type TFilmLayer, type TProject } from '@/modules/project';
import { buildSceneDescription } from '@/modules/scene';
import { editLabel } from './edit-label';
import { inspectorTarget } from './inspector-target';
import { buildOutline, isFilmRow } from './outline';

const ITEM_ID = 'item-1';

/** One item of each layer, what the scene description calls the list and the Blender module that applies it. A new kind fails to compile here. */
const LAYER_PARTS: Record<TFilmLayer['kind'], { film: Partial<TFilm>; sceneField: string; blenderModule: string }> = {
	title: {
		film: { titles: [{ id: ITEM_ID, name: 'Title', text: 'Title', font: 'Bfont Regular', size: 0.03, position: { x: 0, y: 0 }, angle: 0 }] },
		sceneField: 'wallTexts',
		blenderModule: 'walltext.py'
	},
	decor: {
		film: { decor: [{ id: ITEM_ID, name: 'Bauble', source: 'decor:bauble-red', position: { x: 0, y: 0 }, scale: 1, rotation: 0 }] },
		sceneField: 'decor',
		blenderModule: 'decor.py'
	},
	light: {
		film: { lights: { added: [{ id: ITEM_ID, name: 'Light 1', color: '#ffffff', strength: 1, side: 0, height: 0 }] } },
		sceneField: 'lights',
		blenderModule: 'studio.py'
	}
};

function source(path: string): string {
	return readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8');
}

function agentState(project: TProject): string {
	return JSON.stringify(projectState(project, null, { path: null, workspace: 'film', selection: [], playhead: 0, isPlaying: false, agentFolder: null, references: { images: 0, text: '' }, problems: pendingPreflight(project) }));
}

function missingParts(layer: TFilmLayer): string[] {
	const parts = LAYER_PARTS[layer.kind];
	const before = createProject({ id: 'layers', title: 'Layers' });
	const after: TProject = { ...before, film: { ...before.film, ...parts.film } };
	const key = layer.toKey(ITEM_ID);
	const missing: string[] = [];

	if (layer.items(after.film)?.some((item) => item.id === ITEM_ID) !== true) missing.push('`items` in project/film-layers.ts reads no such list');

	const row = buildOutline(after).find((item) => item.id === key);
	if (row == null) missing.push('no row in `buildOutline` in studio/outline.ts');
	else if (!isFilmRow(row)) missing.push('`isFilmRow` in studio/outline.ts leaves its row out');
	else if (!source('./Sidebar.tsx').includes(`'${row.kind}'`)) missing.push(`studio/Sidebar.tsx doesn't draw its row, '${row.kind}'`);

	const target = inspectorTarget(after, [key]);
	if (target.kind === 'scene') missing.push('`selectedTarget` in studio/inspector-target.ts falls to the Scene for its key');
	else if (!source('./Inspector.tsx').includes(`case '${target.kind}'`)) missing.push(`studio/Inspector.tsx has no case for '${target.kind}'`);

	if (editLabel(before, after, [{ type: 'updateFilm', film: parts.film }]) == null) missing.push('no name in Edit > Undo: `words` in project/film-layers.ts');

	if (agentState(after) === agentState(before)) missing.push("an agent can't see it in `projectState` in mcp/mcp-state.ts");

	const { description } = buildSceneDescription(after, { revision: after.revision, duration: 1, marbles: [], pieces: [], hits: [] } as never, { fps: 30 });
	const list = (description as unknown as Record<string, unknown>)[parts.sceneField];
	if (!Array.isArray(list) || list.length === 0) missing.push(`no \`${parts.sceneField}\` in the scene description in scene/scene-builder.ts`);
	if (!source('../../../blender/mm_worker/scene.py').includes(`description.get('${parts.sceneField}')`)) missing.push(`blender/mm_worker/scene.py doesn't read \`${parts.sceneField}\``);
	if (!source(`../../../blender/mm_worker/${parts.blenderModule}`).includes('def ')) missing.push(`blender/mm_worker/${parts.blenderModule} applies nothing`);

	return missing;
}

describe('film layers', () => {
	it.each(FILM_LAYERS.map((layer) => [layer.kind, layer] as const))('should have every part of a film layer: %s', (kind, layer) => {
		const missing = missingParts(layer);
		expect(missing.join('; '), `Film layer '${kind}' is incomplete: ${missing.join('; ')}. See "Add a film layer" in docs/architecture.md.`).toBe('');
	});
});
