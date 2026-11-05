import { describe, expect, it } from 'vitest';
import { buildSceneDescription, skinAssetPath, themeCommands, themeTitleColor, draftPieceColors } from '@/modules/scene';
import type { TLibraryItem } from '@/modules/scene';
import { type TProject } from '@/modules/project';
import { createStaircaseProject } from '@/modules/simulation/fixture-projects';
import { cameraCommands } from '@/modules/camera';
import { addWallTextCommands, handChangeCount, resetHandChangesCommands, builtInSkinCommands, isScreenTitle, itemFitsPieceType, previewPointToWall, resetToThemeCommands, skinPropertyCommands, skinTargetIds, skinCommands, pieceCountLabel, skinAppliedMessage, titleStyleTiming, withTitleStyle } from './film-commands';
import { libraryEntries } from './FilmLibraryCx';
import { apply } from '@/modules/project/test-helpers';

function pieceIds(project: TProject): string[] {
	return project.entities.filter((entity) => entity.components.piece != null).map((entity) => entity.id);
}

describe('design commands', () => {
	it('should dress a skin the same in every theme', () => {
		// The Draft Preview dresses a skin the same in every theme, like the Blender worker
		const copper = { type: 'platform', color: '#3478f6', skin: { assetId: 'platform:copper' } };
		expect(draftPieceColors('neon', copper)).toEqual(draftPieceColors('brass', copper));
	});

	it('should link a built-in skin, and follow the theme again with the theme\'s own skin', () => {
		const project = { ...createStaircaseProject(), design: { ...createStaircaseProject().design, theme: 'brass' } };
		const [first] = pieceIds(project);
		if (first == null) throw new Error('fixture');
		const linked = apply(project, builtInSkinCommands(project, { kind: 'pieceType', pieceType: 'platform' }, 'platform:copper'));
		const piece = linked.entities.find((entity) => entity.id === first);
		expect(piece?.components.skin?.assetId).toBe('platform:copper');
		const cleared = apply(linked, builtInSkinCommands(linked, { kind: 'entities', entityIds: [first] }, 'platform:gold'));
		const clearedPiece = cleared.entities.find((entity) => entity.id === first);
		expect(clearedPiece?.components.skin).toBeUndefined();
	});

	it('should write property overrides as one edit, keep them through a skin change and reset to the theme', () => {
		const project = createStaircaseProject();
		const ids = pieceIds(project).slice(0, 2);
		const commands = skinPropertyCommands(project, ids, { colorSource: 'note', onHit: 'glow', glowColor: '#00ff88' });
		expect(commands).toHaveLength(2);
		const set = apply(project, commands);
		const skinOf = (next: TProject) => next.entities.find((entity) => entity.id === ids[0])?.components.skin;
		expect(skinOf(set)).toEqual({ colorSource: 'note', onHit: 'glow', glowColor: '#00ff88' });
		const skinned = apply(set, skinCommands(set, { kind: 'entities', entityIds: ids }, 'platform:key'));
		expect(skinOf(skinned)).toMatchObject({ assetId: 'platform:key', colorSource: 'note' });
		const cleared = apply(skinned, skinPropertyCommands(skinned, ids, { glowColor: null }));
		expect(skinOf(cleared)).not.toHaveProperty('glowColor');
		const extra = apply(set, skinPropertyCommands(set, ids, { property: { name: 'Ribbon Color', value: '#ff0000' } }));
		expect(skinOf(extra)?.properties).toEqual({ 'Ribbon Color': '#ff0000' });
		const reset = apply(skinned, resetToThemeCommands(skinned, ids));
		expect(reset.entities.some((entity) => entity.components.skin != null)).toBe(false);
		// Only overrides that leave nothing remove the component
		const back = apply(set, skinPropertyCommands(set, ids, { colorSource: null, onHit: null, glowColor: null }));
		expect(skinOf(back)).toBeUndefined();
	});

	it('should skin marbles too and never touch their physics', () => {
		const project = createStaircaseProject();
		const marble = project.entities.find((entity) => entity.components.marble != null);
		if (marble == null) throw new Error('fixture');
		const next = apply(project, builtInSkinCommands(project, { kind: 'pieceType', pieceType: 'marble' }, 'marble:glass'));
		const skinned = next.entities.find((entity) => entity.id === marble.id);
		expect(skinned?.components.skin?.assetId).toBe('marble:glass');
		expect(skinned?.components.marble).toEqual(marble.components.marble);
		expect(skinTargetIds(next, { kind: 'entities', entityIds: [marble.id] })).toEqual([marble.id]);
	});

	it('should show a kept project item once and kept items from other projects', () => {
		const item = (id: string, scope: 'project' | 'global'): TLibraryItem => ({ id, scope, path: id, manifest: null, manifestError: null, hasAsset: true, packId: null, previewUrl: null });
		const entries = libraryEntries([item('a', 'project'), item('b', 'project')], [item('b', 'global'), item('c', 'global')]);
		expect(entries.map((entry) => [entry.item.id, entry.item.scope, entry.isKept])).toEqual([
			['a', 'project', false],
			['b', 'project', true],
			['c', 'global', true]
		]);
	});

	it('should set the theme once and skip an unchanged theme', () => {
		const project = createStaircaseProject();
		expect(themeCommands(project, project.design.theme)).toEqual([]);
		expect(apply(project, themeCommands(project, 'brass')).design.theme).toBe('brass');
	});

	it('should keep the other camera settings when one changes', () => {
		const project = createStaircaseProject();
		const next = apply(project, cameraCommands(project, { lead: 0.4 }));
		expect(next.design.camera).toEqual({ ...project.design.camera, lead: 0.4 });
	});

	it('should link a skin to the selected pieces only', () => {
		const project = createStaircaseProject();
		const [first, second] = pieceIds(project);
		const next = apply(project, skinCommands(project, { kind: 'entities', entityIds: [first ?? ''] }, 'piano-key'));
		expect(next.entities.find((entity) => entity.id === first)?.components.skin).toEqual({ assetId: 'piano-key' });
		expect(next.entities.find((entity) => entity.id === second)?.components.skin).toBeUndefined();
	});

	it('should skin every piece of a type', () => {
		const project = createStaircaseProject();
		const skinned = apply(project, skinCommands(project, { kind: 'pieceType', pieceType: 'platform' }, 'piano-key'));
		expect(skinned.entities.filter((entity) => entity.components.skin?.assetId === 'piano-key')).toHaveLength(pieceIds(project).length);
	});

	it('should add wall text as an entity with a transform that reaches the scene description', () => {
		const project = createStaircaseProject();
		const { commands, entityId } = addWallTextCommands({ x: 0.1, y: 0.3 }, { color: '#1f3a5f', frameHeight: 0.5, text: 'Fin' });
		const next = apply(project, commands);
		const entity = next.entities.find((item) => item.id === entityId);
		expect(entity?.components.wallText?.text).toBe('Fin');
		expect(entity?.components.transform?.position).toEqual({ x: 0.1, y: 0.3 });
		const build = buildSceneDescription(next, { revision: next.revision, duration: 1, marbles: [], pieces: [], hits: [] } as never, { fps: 30 });
		expect(build.description.wallTexts).toEqual([expect.objectContaining({ id: entityId, text: 'Fin', position: { x: 0.1, y: 0.3 } })]);
	});

	it('should map the preview center to the frame band center at the release height', () => {
		const project = createStaircaseProject();
		const release = project.entities.find((entity) => entity.components.release != null)?.components.release;
		const point = previewPointToWall(project, null, 0, 0.5, 0.5);
		expect(point.x).toBeCloseTo(release?.position.x ?? 0);
		expect(point.y).toBeCloseTo(release?.position.y ?? 0);
		expect(previewPointToWall(project, null, 0, 0.5, 0).y).toBeGreaterThan(point.y);
	});
});

describe('skinAssetPath function', () => {
	it('should point project items at their blend and leave built-in skins alone', () => {
		expect(skinAssetPath('piano-key')).toBe('assets/piano-key/asset.blend');
		expect(skinAssetPath('brass:gold')).toBeNull();
		expect(skinAssetPath(undefined)).toBeNull();
	});
});

describe('itemFitsPieceType function', () => {
	const item = (pieceType?: string, role: 'skin' | 'decoration' = 'skin'): TLibraryItem => ({
		id: 'item',
		scope: 'project',
		path: '/item',
		manifest: { $schema: 'marble-asset@1', id: 'item', label: 'Item', role, pieceType },
		manifestError: null,
		hasAsset: true, packId: null,
		previewUrl: null
	});

	it('should accept skins for the type or for any type and reject decorations', () => {
		expect(itemFitsPieceType(item('platform'), 'platform')).toBe(true);
		expect(itemFitsPieceType(item('rail'), 'platform')).toBe(false);
		expect(itemFitsPieceType(item(undefined), 'windmill')).toBe(true);
		expect(itemFitsPieceType(item('platform', 'decoration'), 'platform')).toBe(false);
	});

	it('should offer a marble only a skin made for marbles', () => {
		expect(itemFitsPieceType(item('marble'), 'marble')).toBe(true);
		expect(itemFitsPieceType(item(undefined), 'marble')).toBe(false);
		expect(itemFitsPieceType(item('platform'), 'marble')).toBe(false);
	});

	it('should say what a skin did on a selection with other piece types or under Color by Note', () => {
		const piece = (id: string, type: string, name: string): TProject['entities'][number] => ({ id, name, components: { piece: { type, params: {} } } }) as TProject['entities'][number];
		const platforms = [1, 2, 3, 4, 5].map((index) => piece(`p${index}`, 'platform', `Platform ${index}`));
		const rail = piece('r1', 'rail', 'Rail 1');
		expect(pieceCountLabel([...platforms, rail])).toBe('5 Platforms, 1 Rail');
		expect(skinAppliedMessage({ skinLabel: 'Copper', pieceType: 'platform', selected: [...platforms, rail], keepsSkinColor: false })).toBe('Copper applied to 5 platforms; Rail 1 kept its skin');
		expect(skinAppliedMessage({ skinLabel: 'Copper', pieceType: 'platform', selected: platforms, keepsSkinColor: false })).toBeNull();
		expect(skinAppliedMessage({ skinLabel: 'Copper', pieceType: 'platform', selected: platforms.slice(0, 1), keepsSkinColor: true })).toBe("Copper applied to 1 platform. It keeps Copper's color with Color by Note");
		expect(skinAppliedMessage({ skinLabel: 'Copper', pieceType: 'platform', selected: platforms, keepsSkinColor: true })).toBe("Copper applied to 5 platforms. They keep Copper's color with Color by Note");
	});

	it('should give a title style its size and default timing, keeping times set by hand', () => {
		const text = { text: 'Title', font: 'Bfont Regular', size: 0.03, color: '#ffffff' };
		const context = { frameHeight: 0.5, playhead: 6, end: 35, songName: 'Jingle Bells', aspect: 9 / 16 };
		expect(withTitleStyle(text, 'caption', context)).toEqual({ ...text, style: 'caption', size: 0.06, in: 6, out: 9 });
		// Song Name opens the film in the frame, shrunk to fit the frame width
		const songName = withTitleStyle(text, 'songName', context);
		expect(songName).toEqual({ ...text, text: 'Jingle Bells', style: 'songName', size: 0.047, out: 3 });
		expect(isScreenTitle('songName')).toBe(true);
		expect(withTitleStyle(text, 'endCard', context)).toEqual({ ...text, style: 'endCard', size: 0.08, in: 32 });
		expect(withTitleStyle({ ...text, in: 2 }, 'endCard', context).in).toBe(2);
		expect(withTitleStyle({ ...text, style: 'caption', size: 0.06 }, 'wall', context)).toEqual({ ...text, size: 0.03 });
	});

	it('should re-time a title only while it still has its style\'s own times', () => {
		const text = { text: 'Title', font: 'Bfont Regular', size: 0.03, color: '#ffffff' };
		const context = { frameHeight: 0.5, playhead: 31, end: 35, songName: null };
		const songName = withTitleStyle(text, 'songName', context);
		expect(songName).toMatchObject({ out: 3 });
		expect(songName.in).toBeUndefined();
		// Song Name's own times become End Card's, then Caption's at the playhead, then the whole film again
		const endCard = withTitleStyle(songName, 'endCard', context);
		expect(endCard).toMatchObject({ in: 32 });
		expect(endCard.out).toBeUndefined();
		const caption = withTitleStyle(endCard, 'caption', context);
		expect(caption).toMatchObject({ in: 31, out: 34 });
		// A caption made earlier at another playhead still has its own 3 s
		expect(withTitleStyle(caption, 'songName', { ...context, playhead: 10 })).toMatchObject({ out: 3 });
		const wall = withTitleStyle(caption, 'wall', context);
		expect(wall.in).toBeUndefined();
		expect(wall.out).toBeUndefined();
		// Times typed by hand stay
		const typed = { ...songName, out: 5 };
		expect(withTitleStyle(typed, 'endCard', context)).toMatchObject({ out: 5 });
		expect(withTitleStyle(typed, 'endCard', context).in).toBeUndefined();
		// A caption near the end of the film still gets 3 s
		expect(withTitleStyle(text, 'caption', { ...context, playhead: 34 })).toMatchObject({ in: 32 });
		expect(titleStyleTiming('caption', { playhead: 0, end: 35 })).toEqual({ out: 3 });
		expect(titleStyleTiming('songName', { playhead: 0, end: 2 })).toEqual({});
	});

	it('should recolor titles that still have the old theme\'s title color when the theme changes', () => {
		const project = createStaircaseProject();
		const title = { id: 'text-1', name: 'Title', components: { wallText: { text: 'Title', font: 'Bfont Regular', size: 0.03, color: themeTitleColor(project.design.theme) }, transform: { position: { x: 0, y: 0 }, angle: 0 } } };
		const custom = { ...title, id: 'text-2', components: { ...title.components, wallText: { ...title.components.wallText, color: '#ff0000' } } };
		const withTitles = apply(project, [{ type: 'upsertEntity', entity: title }, { type: 'upsertEntity', entity: custom }]);
		const other = withTitles.design.theme === 'brass' ? 'pegboard' : 'brass';
		const next = apply(withTitles, themeCommands(withTitles, other));
		expect(next.entities.find((entity) => entity.id === 'text-1')?.components.wallText?.color).toBe(themeTitleColor(other));
		expect(next.entities.find((entity) => entity.id === 'text-2')?.components.wallText?.color).toBe('#ff0000');
	});
});

describe('hand changes', () => {
	it('should count skins of their own and values set on a layer, and clear them as one edit', () => {
		const project = createStaircaseProject();
		expect(handChangeCount(project)).toBe(0);
		const piece = project.entities.find((entity) => entity.components.piece != null);
		const changed = apply(project, [
			...skinCommands(project, { kind: 'entities', entityIds: [piece?.id as string] }, 'platform:copper'),
			{ type: 'setDesign', design: { wall: { color: '#112233', kind: 'grid' }, lights: { key: { strength: 2 }, added: [] } } }
		]);
		expect(handChangeCount(changed)).toBe(4);
		expect(handChangeCount(apply(changed, resetHandChangesCommands(changed)))).toBe(0);
	});
});

describe('a skin and the label color', () => {
	it("should leave a marble's label color and film color alone when a skin is applied", () => {
		const project = createStaircaseProject();
		const marble = project.entities.find((entity) => entity.components.marble != null);
		const target = { kind: 'entities' as const, entityIds: [marble?.id as string] };
		const next = apply(project, builtInSkinCommands(project, target, 'marble:glass-green'));
		const dressed = next.entities.find((entity) => entity.id === marble?.id);
		expect(dressed?.components.skin?.assetId).toBe('marble:glass-green');
		expect(dressed?.components.skin?.color).toBe(marble?.components.skin?.color);
		expect(next.music.lanes[0]?.color).toBe(project.music.lanes[0]?.color);
	});
});
