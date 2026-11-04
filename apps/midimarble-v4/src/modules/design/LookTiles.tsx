import { useFeatureState } from 'feature-react/state';
import React from 'react';
import type { TMenuEntry } from '@/components';
import type { TLibraryItem } from '@/modules/library';
import type { TEntity, TProject, TWallKind } from '@/modules/project';
import { getPieceDefinition } from '@/modules/simulation';
import type { StudioCx } from '@/modules/studio';
import { assetDecorSource, builtInSource, decorSourceCommands, findDecor, type TDecorSource } from './decor';
import { builtInSkinCommands, followThemeSkinCommands, itemFitsPieceType, skinAppliedMessage, skinTargetIds, type TSkinTarget } from './design-commands';
import { DRAFT_TINSEL } from './draft-look';
import { LIBRARY_DRAG_TYPE, removeLibraryEntry } from './FilmInsert';
import { libraryEntries, libraryItemLabel, libraryItemOrigin, type TLibraryEntry } from './DesignLibraryCx';
import { LookTile } from './LookTile';
import { isThemeColorByNote, resolveElementLook } from './project-themes';
import { wallCommands, wallLayer } from './scene-layers';
import { elementLabel, elementPlural, type TSkinElement } from './skin-catalog';
import { decorTiles, skinTiles, THEME_DEFAULT_TILE, wallTiles } from './skin-tiles';

// The tiles of the inspector's Look section. Each click is one undo step.

const TileGrid: React.FC<{ label: string; children: React.ReactNode }> = (props) => (
	<div className="mm-tile-grid mm-look-tiles" data-span="2" role="listbox" aria-label={props.label}>
		{props.children}
	</div>
);

/**
 * Skins for the selected marbles or pieces of one type: Theme Default, the built-in skins, then skins made with the
 * agent or imported. A click applies to the selection, ⌥-click to every one of the type.
 */
export const SkinTiles: React.FC<{ cx: StudioCx; project: TProject; element: TSkinElement; pieceType: string; entities: TEntity[]; selected?: TEntity[] }> = (props) => {
	const { cx, project, element, pieceType, entities, selected = entities } = props;
	const projectItems = useFeatureState(cx.library.$projectItems);
	const globalItems = useFeatureState(cx.library.$globalItems);
	const typeLabel = pieceType === 'marble' ? elementLabel('marble') : (getPieceDefinition(pieceType)?.label ?? pieceType);
	const plural = elementPlural(element);
	const ids = entities.map((entity) => entity.id);
	const entries = element === 'marble' ? [] : libraryEntries(projectItems, globalItems).filter((entry) => itemFitsPieceType(entry.item, pieceType));
	const targetOf = (toAll: boolean): TSkinTarget => (toAll ? { kind: 'pieceType', pieceType } : { kind: 'entities', entityIds: ids });
	const tileTitle = (label: string): string => `${label}: click applies to the selection, ⌥-click to all ${plural.toLowerCase()}`;

	function notify(label: string, assetId: string | null): void {
		if (element !== 'marble') notifySkinApplied(cx, project, label, pieceType, selected, assetId);
	}

	function apply(id: string, label: string, toAll: boolean): void {
		const target = targetOf(toAll);
		const commands = id === THEME_DEFAULT_TILE ? followThemeSkinCommands(project, skinTargetIds(project, target)) : builtInSkinCommands(project, target, id);
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

	return (
		<TileGrid label={`${typeLabel} skins`}>
			{skinTiles(project.design, element, entities).map((tile) => (
				<LookTile
					key={tile.id}
					label={tile.label}
					detail={tile.detail}
					previewUrl={tile.previewUrl}
					isCurrent={tile.isCurrent}
					title={tileTitle(tile.detail.length > 0 ? `${tile.label} (${tile.detail})` : tile.label)}
					onApply={(toAll) => apply(tile.id, tile.label, toAll)}
					onMenu={() => menu((toAll) => apply(tile.id, tile.label, toAll))}
				/>
			))}
			{entries.map((entry) => (
				<LibrarySkinTile key={`${entry.item.scope}:${entry.item.id}`} cx={cx} project={project} entry={entry} entities={entities} title={tileTitle(libraryItemLabel(entry.item))} onApply={(toAll) => void applyItem(entry.item, toAll)} menu={() => menu((toAll) => void applyItem(entry.item, toAll))} />
			))}
		</TileGrid>
	);
};

/** A skin made with the agent or imported, with where it comes from and its star */
const LibrarySkinTile: React.FC<{ cx: StudioCx; project: TProject; entry: TLibraryEntry; entities: TEntity[]; title: string; onApply: (toAll: boolean) => void; menu: () => TMenuEntry[] }> = (props) => {
	const { cx, project, entry, entities, title, onApply, menu } = props;
	const { item } = entry;
	// Removing an item the film still shows would leave its pieces without a skin
	const isInUse = project.entities.some((entity) => entity.components.skin?.assetId === item.id);
	return (
		<LookTile
			label={libraryItemLabel(item)}
			detail={item.manifestError != null ? "Can't be read" : libraryItemOrigin(item)}
			previewUrl={item.previewUrl}
			isCurrent={entities.length > 0 && entities.every((entity) => entity.components.skin?.assetId === item.id)}
			title={title}
			isKept={entry.isKept}
			onKeep={() => void cx.library.setKept(entry, !entry.isKept)}
			onApply={onApply}
			onMenu={() => [
				...menu(),
				'separator',
				{ label: 'Keep in Library', checked: entry.isKept, onSelect: () => void cx.library.setKept(entry, !entry.isKept) },
				{ label: 'Remove', disabled: isInUse, onSelect: () => void removeLibraryEntry(cx, entry) }
			]}
			onDragStart={(event) => {
				event.dataTransfer.setData(LIBRARY_DRAG_TYPE, JSON.stringify({ id: item.id, scope: item.scope }));
				event.dataTransfer.effectAllowed = 'copy';
			}}
		/>
	);
};

/** The Wall's skins, drawn in the wall's colour */
export const WallTiles: React.FC<{ cx: StudioCx; project: TProject }> = (props) => {
	const { cx, project } = props;
	const color = wallLayer(project.design).color;
	return (
		<TileGrid label="Wall skins">
			{wallTiles(project.design).map((tile) => (
				<LookTile
					key={tile.id}
					label={tile.label}
					detail={tile.detail}
					previewUrl={null}
					thumb={<WallThumb kind={tile.shownKind} color={color} />}
					isCurrent={tile.isCurrent}
					title={tile.kind == null ? `Use the theme's wall (${tile.detail})` : `A ${tile.label} wall`}
					onApply={() => {
						const commands = wallCommands(project, { kind: tile.kind });
						if (commands.length > 0) cx.execute(commands);
					}}
				/>
			))}
		</TileGrid>
	);
};

/** A wall's kind in small: the walls have no rendered previews */
const WallThumb: React.FC<{ kind: TWallKind; color: string }> = ({ kind, color }) => {
	const dark = 'rgb(0 0 0 / 0.28)';
	const light = 'rgb(255 255 255 / 0.2)';
	const looks: Partial<Record<TWallKind, React.CSSProperties>> = {
		pegboard: { backgroundImage: `radial-gradient(circle, ${dark} 1.5px, transparent 2px)`, backgroundSize: '9px 9px' },
		grid: { backgroundImage: `linear-gradient(${dark} 1px, transparent 1px), linear-gradient(90deg, ${dark} 1px, transparent 1px)`, backgroundSize: '12px 12px' },
		tinsel: { backgroundColor: DRAFT_TINSEL, backgroundImage: `radial-gradient(circle, ${light} 1px, transparent 1.5px)`, backgroundSize: '5px 7px' }
	};
	return <span className="absolute inset-0" style={{ backgroundColor: color, ...looks[kind] }} />;
};

/** What the selected Decor items are: the built-in items, then Decor made with the agent or imported */
export const DecorTiles: React.FC<{ cx: StudioCx; project: TProject; ids: string[] }> = (props) => {
	const { cx, project, ids } = props;
	const projectItems = useFeatureState(cx.library.$projectItems);
	const globalItems = useFeatureState(cx.library.$globalItems);
	const decors = ids.flatMap((id) => findDecor(project.design, id) ?? []);
	const entries = libraryEntries(projectItems, globalItems).filter((entry) => entry.item.manifest?.role === 'decoration');

	function apply(source: TDecorSource): void {
		const commands = decorSourceCommands(project, ids, source);
		if (commands.length > 0) cx.execute(commands);
	}

	return (
		<TileGrid label="Decor items">
			{decorTiles(decors).map((tile) => (
				<LookTile key={tile.id} label={tile.label} previewUrl={tile.previewUrl} isCurrent={tile.isCurrent} title={`Make it a ${tile.label}`} onApply={() => apply(builtInSource(tile.id))} />
			))}
			{entries.map(({ item }) => {
				const source = assetDecorSource(item.id, libraryItemLabel(item), item.manifest?.fittedParams);
				return <LookTile key={`${item.scope}:${item.id}`} label={source.label} detail={libraryItemOrigin(item)} previewUrl={item.previewUrl} isCurrent={decors.length > 0 && decors.every((decor) => decor.source === source.source)} title={`Make it ${source.label}`} onApply={() => apply(source)} />;
			})}
		</TileGrid>
	);
};

/**
 * Says what a skin did when the film alone doesn't show it: other piece types kept, or platforms keeping the skin's
 * colour with Colour by Note on. `assetId` is the applied skin, null for the theme's default.
 */
function notifySkinApplied(cx: StudioCx, project: TProject, skinLabel: string, pieceType: string, selected: TEntity[], assetId: string | null): void {
	const keepsSkinColor = isThemeColorByNote(project.design) && !resolveElementLook(project.design, 'platform', assetId != null ? { assetId, link: 'linked' } : null).isThemeSkin;
	const message = skinAppliedMessage({ skinLabel, pieceType, selected, keepsSkinColor });
	if (message != null) cx.notifyEdit(message);
}
