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
	itemFitsPieceType,
	previewPointToWall,
	reactionCommands,
	showsThemeSkin,
	skinCommands,
	themeCommands,
	themeSkinCommands,
	themeSkins
} from './design-commands';
import { isNewThemeRequest, libraryEntries } from './DesignLibraryCx';

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
		const { commands, entityId } = addWallTextCommands({ x: 0.1, y: 0.3 }, 'Fin');
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
});
