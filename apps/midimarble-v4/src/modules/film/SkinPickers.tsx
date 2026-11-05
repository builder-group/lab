import { useFeatureState } from 'feature-react/state';
import React from 'react';
import type { TMenuEntry } from '@/components';
import { addedPacks } from '@/modules/library';
import { type TLibraryItem, isThemeColorByNote, noneWallColor, resolveElementLook, PLAIN_PIECE_COLOR, pieceLabelColor, skinnedOf, wallCommands, wallLayer, catalogSkin, elementLabel, elementPlural, type TSkinElement, type TSkinned } from '@/modules/scene';
import type { TProject, TWallSkin } from '@/modules/project';
import { getPieceDefinition } from '@/modules/simulation';
import type { StudioCx } from '@/modules/studio';
import { builtInSkinCommands, itemFitsPieceType, resetToThemeCommands, skinAppliedMessage, skinTargetIds, type TSkinTarget } from './film-commands';
import { libraryEntries, libraryItemKey, libraryItemLabel, libraryItemOrigin, notAddedPackAction, type TLibraryEntry } from './FilmLibraryCx';
import { LIBRARY_DRAG_TYPE, removeLibraryEntry } from './FilmInsert';
import { skinTiles, THEME_DEFAULT_TILE, usedSkinIds, wallTiles } from './skin-tiles';
import { TilePicker, type TPickerTile } from './TilePicker';

// The inspector's Skin row, opening a picker. Each pick is one undo step.

/** The row for a set of tiles: the current tile, or Mixed */
function currentOf(tiles: readonly TPickerTile[], fallback: string): React.ComponentProps<typeof TilePicker>['current'] {
	const tile = tiles.find((item) => item.isCurrent);
	if (tile == null) return { label: fallback, previewUrl: null };
	return { label: tile.label, previewUrl: tile.previewUrl, ...(tile.thumb != null ? { thumb: tile.thumb } : {}) };
}

/**
 * The skin of the selected marbles or pieces of one type: the theme's, the Starter skins, then skins from added Packs,
 * made by an agent or imported. A click applies to the selection, ⌥-click to every one of the type.
 */
export const SkinPicker: React.FC<{ cx: StudioCx; project: TProject; element: TSkinElement; pieceType: string; pieces: TSkinned[]; selected?: TSkinned[] }> = (props) => {
	const { cx, project, element, pieceType, pieces, selected = pieces } = props;
	const projectItems = useFeatureState(cx.library.$projectItems);
	const globalItems = useFeatureState(cx.library.$globalItems);
	const packs = useFeatureState(addedPacks);
	const typeLabel = pieceType === 'marble' ? elementLabel('marble') : (getPieceDefinition(pieceType)?.label ?? pieceType);
	const plural = elementPlural(element);
	const ids = pieces.map((piece) => piece.id);
	const entries = libraryEntries(projectItems, globalItems, packs).filter((entry) => itemFitsPieceType(entry.item, pieceType));
	const targetOf = (toAll: boolean): TSkinTarget => (toAll ? { kind: 'pieceType', pieceType } : { kind: 'pieces', entityIds: ids });
	const tileTitle = (label: string): string => `${label}: click applies to the selection, ⌥-click to all ${plural.toLowerCase()}`;

	function notify(label: string, assetId: string | null): void {
		if (element !== 'marble') notifySkinApplied(cx, project, label, pieceType, selected, assetId);
	}

	function apply(id: string, label: string, toAll: boolean): void {
		const target = targetOf(toAll);
		const commands = id === THEME_DEFAULT_TILE ? resetToThemeCommands(project, skinTargetIds(project, target)) : builtInSkinCommands(project, target, id);
		if (commands.length > 0 && cx.execute(commands) && !toAll) notify(label, id === THEME_DEFAULT_TILE ? null : id);
	}

	async function applyItem(item: TLibraryItem, toAll: boolean): Promise<void> {
		const isApplied = await cx.library.applySkin(item, targetOf(toAll));
		if (isApplied && !toAll) notify(libraryItemLabel(item), item.id);
	}

	function menu(run: (toAll: boolean) => void): TMenuEntry[] {
		return [
			{ label: ids.length > 1 ? `Apply to ${ids.length} ${plural}` : 'Apply to Selection', onSelect: () => run(false) },
			{ label: `Apply to All ${plural}`, shortcut: '⌥ Click', onSelect: () => run(true) }
		];
	}

	const tiles: TPickerTile[] = [
		...skinTiles(project.film, element, pieces, usedSkinIds(project)).map((tile) => ({
			key: tile.id,
			label: tile.label,
			detail: tile.detail,
			previewUrl: tile.previewUrl,
			...(tile.label === 'None' ? { thumb: <NoneThumb isMarble={element === 'marble'} color={noneColor(project, pieces[0])} /> } : {}),
			isCurrent: tile.isCurrent,
			title: tile.id === THEME_DEFAULT_TILE ? `Back to the theme, with its colors and properties: click for the selection, ⌥-click for all ${plural.toLowerCase()}` : tileTitle(`${tile.label} (${tile.detail})`),
			onApply: (toAll: boolean) => apply(tile.id, tile.label, toAll),
			onMenu: () => menu((toAll) => apply(tile.id, tile.label, toAll))
		})),
		...entries.map((entry) => libraryTile(cx, project, entry, pieces, tileTitle(libraryItemLabel(entry.item)), (toAll) => void applyItem(entry.item, toAll), () => menu((toAll) => void applyItem(entry.item, toAll))))
	];
	// A single piece in something the tiles don't list yet, such as a skin of a project still loading its library
	const worn = new Set(pieces.map((piece) => piece.skin?.assetId));
	const only = worn.size === 1 ? [...worn][0] : undefined;
	const fallback = only != null ? (catalogSkin(only)?.label ?? only) : 'Mixed';

	return <TilePicker heading="Skin" label={`${typeLabel} skins`} current={currentOf(tiles, fallback)} title={`Choose the ${typeLabel.toLowerCase()}'s skin`} tiles={tiles} />;
};

/** A skin from a Pack, made by an agent or imported, with where it comes from and its star */
function libraryTile(cx: StudioCx, project: TProject, entry: TLibraryEntry, pieces: TSkinned[], title: string, onApply: (toAll: boolean) => void, menu: () => TMenuEntry[]): TPickerTile {
	const { item } = entry;
	const pack = addedPacks.get().find((candidate) => candidate.id === item.packId);
	// Removing an item the film still shows would leave its pieces without a skin
	const isInUse = skinnedOf(project).some((piece) => piece.skin?.assetId === item.id);
	return {
		key: libraryItemKey(item),
		label: libraryItemLabel(item),
		detail: item.manifestError != null ? "Can't be read" : libraryItemOrigin(item),
		onDetail: notAddedPackAction(cx, item),
		previewUrl: item.previewUrl,
		isCurrent: pieces.length > 0 && pieces.every((piece) => piece.skin?.assetId === item.id),
		title,
		...(pack != null ? {} : { isKept: entry.isKept, onKeep: () => void cx.library.setKept(entry, !entry.isKept) }),
		onApply,
		onMenu: () => [
			...menu(),
			'separator',
			...(pack != null
				? [{ label: 'Remove Pack', onSelect: () => void cx.library.removePack(pack) }]
				: [
						{ label: 'Keep in Library', checked: entry.isKept, onSelect: () => void cx.library.setKept(entry, !entry.isKept) },
						{ label: 'Remove', disabled: isInUse, onSelect: () => void removeLibraryEntry(cx, entry) }
					])
		],
		onDragStart: (event) => {
			event.dataTransfer.setData(LIBRARY_DRAG_TYPE, JSON.stringify({ id: item.id, scope: item.scope, packId: item.packId }));
			event.dataTransfer.effectAllowed = 'copy';
		}
	};
}

/** The Wall's skin, drawn in the wall's color */
export const WallPicker: React.FC<{ cx: StudioCx; project: TProject }> = (props) => {
	const { cx, project } = props;
	const color = wallLayer(project.film).color;
	const tiles: TPickerTile[] = wallTiles(project.film).map((tile) => ({
		key: tile.id,
		label: tile.label,
		detail: tile.detail,
		previewUrl: null,
		thumb: <WallThumb kind={tile.shownKind} color={tile.kind === 'none' ? noneWallColor(project.film.wall.labelColor) : color} />,
		isCurrent: tile.isCurrent,
		title: tile.kind == null ? "Back to the theme's wall, with its colors" : tile.kind === 'none' ? 'The plain Pegboard wall in the color Track gives it' : `A ${tile.label} wall`,
		onApply: () => {
			const commands = wallCommands(project, tile.kind == null ? { kind: null, color: null, backgroundColor: null } : { kind: tile.kind });
			if (commands.length > 0) cx.execute(commands);
		}
	}));
	return <TilePicker heading="Skin" label="Wall skins" current={currentOf(tiles, 'Mixed')} title="Choose the wall's skin" tiles={tiles} />;
};

/** What the skin None shows on the first of a selection: its label color, or plain wood */
function noneColor(project: TProject, piece: TSkinned | undefined): string {
	if (piece == null) return PLAIN_PIECE_COLOR;
	return 'type' in piece ? (pieceLabelColor(project, piece) ?? PLAIN_PIECE_COLOR) : piece.labelColor;
}

/** The skin None in small: the plain shape in its color, since it has no rendered look of its own */
const NoneThumb: React.FC<{ isMarble: boolean; color: string }> = ({ isMarble, color }) => (
	<span className="absolute inset-0 flex items-center justify-center bg-[var(--control)]">
		<span className={isMarble ? 'h-1/2 aspect-square rounded-full' : 'h-[14%] w-3/5 rounded-[2px]'} style={{ background: color }} />
	</span>
);

/** A wall's kind in small: the walls have no rendered previews */
const WallThumb: React.FC<{ kind: TWallSkin; color: string }> = ({ kind, color }) => {
	const dark = 'rgb(0 0 0 / 0.28)';
	const holes: React.CSSProperties = { backgroundImage: `radial-gradient(circle, ${dark} 1.5px, transparent 2px)`, backgroundSize: '9px 9px' };
	const looks: Partial<Record<TWallSkin, React.CSSProperties>> = {
		pegboard: holes,
		none: holes,
		grid: { backgroundImage: `linear-gradient(${dark} 1px, transparent 1px), linear-gradient(90deg, ${dark} 1px, transparent 1px)`, backgroundSize: '12px 12px' }
	};
	return <span className="absolute inset-0" style={{ backgroundColor: color, ...looks[kind] }} />;
};

/**
 * Says what a skin did when the film alone doesn't show it: other piece types kept, or platforms keeping the skin's
 * color with Color by Note on. `assetId` is the applied skin, null for the theme's default.
 */
function notifySkinApplied(cx: StudioCx, project: TProject, skinLabel: string, pieceType: string, selected: TSkinned[], assetId: string | null): void {
	const keepsSkinColor = isThemeColorByNote(project.film) && !resolveElementLook(project.film, 'platform', assetId != null ? { assetId } : null).isThemeSkin;
	const message = skinAppliedMessage({ skinLabel, pieceType, selected, keepsSkinColor });
	if (message != null) cx.notifyEdit(message);
}
