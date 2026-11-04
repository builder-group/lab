import { describe, expect, it } from 'vitest';
import { buildSceneDescription, skinAssetPath } from '@/modules/blender';
import type { TLibraryItem } from '@/modules/library';
import { applyProjectCommands, type TProject } from '@/modules/project';
import { createStaircaseProject } from '@/modules/simulation/fixture-projects';
import {
	addWallTextCommands,
	cameraCommands,
	clearSkinCommands,
	colorByNoteCommands,
	isScreenTitle,
	itemFitsPieceType,
	moreThemeSkins,
	previewPointToWall,
	reactionCommands,
	showsThemeSkin,
	skinCommands,
	themeCommands,
	pieceCountLabel,
	skinAppliedMessage,
	themeSkinCommands,
	themeSkins,
	themeTitleColor,
	titleStyleTiming,
	withTitleStyle
} from './design-commands';
import { isNewThemeRequest, libraryEntries } from './DesignLibraryCx';
import { draftPieceColors } from './draft-look';

function apply(project: TProject, commands: Parameters<typeof applyProjectCommands>[1]): TProject {
	const [isAppliedOk, appliedErr, applied] = applyProjectCommands(project, commands);
	if (!isAppliedOk) throw appliedErr;
	return applied;
}

function pieceIds(project: TProject): string[] {
	return project.entities.filter((entity) => entity.components.piece != null).map((entity) => entity.id);
}

describe('design commands', () => {
	it('should list the theme default first and the Brass platform variants', () => {
		expect(themeSkins('pegboard', 'rail').map((skin) => skin.assetId)).toEqual([null]);
		const brass = themeSkins('brass', 'platform');
		expect(brass[0]).toMatchObject({ assetId: null, label: 'Gold', previewUrl: '/skins/brass-platform.png' });
		expect(brass.map((skin) => skin.assetId)).toContain('brass:device-copper');
		expect(themeSkins('brass', 'unknown')).toEqual([]);
	});

	it('should offer Brass platform skins under More Skins in the other themes and their copies', () => {
		const more = moreThemeSkins('neon', 'platform');
		expect(more).toHaveLength(themeSkins('brass', 'platform').length);
		expect(more[0]).toMatchObject({ assetId: 'brass:gold', label: 'Gold', themeId: 'brass' });
		expect(more.every((skin) => skin.assetId?.startsWith('brass:') === true)).toBe(true);
		expect(moreThemeSkins('pegboard', 'platform')).toEqual(more);
		expect(moreThemeSkins('brass', 'platform')).toEqual([]);
		expect(moreThemeSkins('neon', 'rail')).toEqual([]);
		// The Draft Preview dresses a Brass skin as Brass in Neon, like the Blender worker
		const copper = {
			type: 'platform',
			color: '#3478f6',
			skin: { assetId: 'brass:copper', link: 'linked' as const }
		};
		expect(draftPieceColors('neon', copper, false)).toEqual(
			draftPieceColors('brass', copper, false)
		);
	});

	it('should link a theme variant and clear the skin for the theme default', () => {
		const project = createStaircaseProject();
		const [first] = pieceIds(project);
		const [gold, copper] = themeSkins('brass', 'platform');
		if (first == null || gold == null || copper == null) throw new Error('fixture');
		const linked = apply(project, themeSkinCommands(project, { kind: 'pieceType', pieceType: 'platform' }, copper));
		const piece = linked.entities.find((entity) => entity.id === first);
		expect(piece?.components.skin?.assetId).toBe('brass:copper');
		expect(piece != null && showsThemeSkin(piece, copper)).toBe(true);
		const cleared = apply(linked, themeSkinCommands(linked, { kind: 'entities', entityIds: [first] }, gold));
		const clearedPiece = cleared.entities.find((entity) => entity.id === first);
		expect(clearedPiece?.components.skin).toBeUndefined();
		expect(clearedPiece != null && showsThemeSkin(clearedPiece, gold)).toBe(true);
	});

	it('should toggle Colour by Note and skip an unchanged value', () => {
		const project = createStaircaseProject();
		expect(colorByNoteCommands(project, false)).toEqual([]);
		expect(apply(project, colorByNoteCommands(project, true)).design.themeOptions?.colorByNote).toBe(true);
	});

	it('should show a kept project item once and kept items from other projects', () => {
		const item = (id: string, scope: 'project' | 'global'): TLibraryItem => ({ id, scope, path: id, manifest: null, manifestError: null, hasAsset: true, previewUrl: null });
		const entries = libraryEntries([item('a', 'project'), item('b', 'project')], [item('b', 'global'), item('c', 'global')]);
		expect(entries.map((entry) => [entry.item.id, entry.item.scope, entry.isKept])).toEqual([
			['a', 'project', false],
			['b', 'project', true],
			['c', 'global', true]
		]);
	});

	it('should recognise a New Theme request after its mentions', () => {
		expect(isNewThemeRequest('@[Platform 1] @[Rail 1] New theme: neon arcade')).toBe(true);
		expect(isNewThemeRequest('Make the platform neon')).toBe(false);
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
		expect(next.entities.find((entity) => entity.id === first)?.components.skin).toEqual({ assetId: 'piano-key', link: 'linked' });
		expect(next.entities.find((entity) => entity.id === second)?.components.skin).toBeUndefined();
	});

	it('should skin every piece of a type and clear it back to the theme default', () => {
		const project = createStaircaseProject();
		const skinned = apply(project, skinCommands(project, { kind: 'pieceType', pieceType: 'platform' }, 'piano-key'));
		expect(skinned.entities.filter((entity) => entity.components.skin?.assetId === 'piano-key')).toHaveLength(pieceIds(project).length);
		const cleared = apply(skinned, clearSkinCommands(skinned, pieceIds(skinned)));
		expect(cleared.entities.some((entity) => entity.components.skin != null)).toBe(false);
	});

	it('should write a reaction preset and remove it for the theme default', () => {
		const project = createStaircaseProject();
		const ids = pieceIds(project).slice(0, 2);
		const pressed = apply(project, reactionCommands(project, ids, 'press'));
		expect(pressed.entities.filter((entity) => entity.components.reaction?.preset === 'press')).toHaveLength(2);
		const theme = apply(pressed, reactionCommands(pressed, ids, 'theme'));
		expect(theme.entities.some((entity) => entity.components.reaction != null)).toBe(false);
	});

	it('should add wall text as an entity with a transform that reaches the scene description', () => {
		const project = createStaircaseProject();
		const { commands, entityId } = addWallTextCommands({ x: 0.1, y: 0.3 }, { theme: 'pegboard', frameHeight: 0.5, text: 'Fin' });
		const next = apply(project, commands);
		const entity = next.entities.find((item) => item.id === entityId);
		expect(entity?.components.wallText?.text).toBe('Fin');
		expect(entity?.components.transform?.position).toEqual({ x: 0.1, y: 0.3 });
		const build = buildSceneDescription(next, { revision: next.revision, duration: 1, marbles: [], pieces: [], hits: [] } as never, { fps: 30 });
		expect(build.description.wallTexts).toEqual([expect.objectContaining({ id: entityId, text: 'Fin', position: { x: 0.1, y: 0.3 } })]);
	});

	it('should map the preview centre to the frame band centre at the release height', () => {
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
		hasAsset: true,
		previewUrl: null
	});

	it('should accept skins for the type or for any type and reject decorations', () => {
		expect(itemFitsPieceType(item('platform'), 'platform')).toBe(true);
		expect(itemFitsPieceType(item('rail'), 'platform')).toBe(false);
		expect(itemFitsPieceType(item(undefined), 'windmill')).toBe(true);
		expect(itemFitsPieceType(item('platform', 'decoration'), 'platform')).toBe(false);
	});

	it('should say what a skin did on a selection with other piece types or under Colour by Note', () => {
		const piece = (id: string, type: string, name: string): TProject['entities'][number] => ({ id, name, components: { piece: { type, params: {} } } }) as TProject['entities'][number];
		const platforms = [1, 2, 3, 4, 5].map((index) => piece(`p${index}`, 'platform', `Platform ${index}`));
		const rail = piece('r1', 'rail', 'Rail 1');
		expect(pieceCountLabel([...platforms, rail])).toBe('5 Platforms, 1 Rail');
		expect(skinAppliedMessage({ skinLabel: 'Copper', pieceType: 'platform', selected: [...platforms, rail], colorByNote: false })).toBe('Copper applied to 5 platforms; Rail 1 kept its skin');
		expect(skinAppliedMessage({ skinLabel: 'Copper', pieceType: 'platform', selected: platforms, colorByNote: false })).toBeNull();
		expect(skinAppliedMessage({ skinLabel: 'Copper', pieceType: 'platform', selected: platforms.slice(0, 1), colorByNote: true })).toBe("Copper applied to 1 platform. Colour by Note sets the platform's colour");
	});

	it('should give a title style its size and default timing, keeping times set by hand', () => {
		const text = { text: 'Title', font: 'Bfont Regular', size: 0.03, depth: 0.002, color: '#ffffff' };
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
		const text = { text: 'Title', font: 'Bfont Regular', size: 0.03, depth: 0.002, color: '#ffffff' };
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

	it('should recolour titles that still have the old theme\'s title colour when the theme changes', () => {
		const project = createStaircaseProject();
		const title = { id: 'text-1', name: 'Title', components: { wallText: { text: 'Title', font: 'Bfont Regular', size: 0.03, depth: 0.002, color: themeTitleColor(project.design.theme) }, transform: { position: { x: 0, y: 0 }, angle: 0 } } };
		const custom = { ...title, id: 'text-2', components: { ...title.components, wallText: { ...title.components.wallText, color: '#ff0000' } } };
		const withTitles = apply(project, [{ type: 'upsertEntity', entity: title }, { type: 'upsertEntity', entity: custom }]);
		const other = withTitles.design.theme === 'brass' ? 'pegboard' : 'brass';
		const next = apply(withTitles, themeCommands(withTitles, other));
		expect(next.entities.find((entity) => entity.id === 'text-1')?.components.wallText?.color).toBe(themeTitleColor(other));
		expect(next.entities.find((entity) => entity.id === 'text-2')?.components.wallText?.color).toBe('#ff0000');
	});
});
