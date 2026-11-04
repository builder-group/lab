import { useFeatureState } from 'feature-react/state';
import { Box, RefreshCw, Search, Sparkles, Star } from 'lucide-react';
import React from 'react';
import { HelpTip, openContextMenu, type TMenuEntry } from '@/components';
import type { TLibraryItem } from '@/modules/library';
import type { TEntity, TProject } from '@/modules/project';
import { getPieceDefinition } from '@/modules/simulation';
import type { StudioCx } from '@/modules/studio';
import { deleteTheme, duplicateTheme } from '@/modules/studio/commands';
import {
	commonPieceType,
	itemFitsPieceType,
	moreThemeSkins,
	showsThemeSkin,
	skinAppliedMessage,
	themeCommands,
	themePresets,
	themeSkinCommands,
	themeSkins,
	type TSkinTarget,
	type TThemeSkin
} from './design-commands';
import { baseThemeOf, projectThemes, renameThemeCommands, resolveTheme, THEME_OVERRIDE_FIELDS, themeOrigin, type TResolvedTheme } from './project-themes';
import { takesNoteColor } from './draft-look';
import { libraryEntries, libraryItemLabel, libraryItemOrigin, NEW_THEME_PROMPT, type TLibraryEntry } from './DesignLibraryCx';

/** MIME type of a library item dragged onto the preview or the inspector */
export const LIBRARY_DRAG_TYPE = 'application/x-midimarble-asset';

/**
 * Library of the Film sidebar, like Figma's Assets panel: one place without storage scopes. With nothing selected it
 * shows the themes; with pieces selected, the skins for that piece type, the current theme's first. Click applies to
 * the selection, ⌥-click to every piece of that type.
 */
export const DesignLibrary: React.FC<TDesignLibraryProps> = (props) => {
	const { cx, project } = props;
	const status = useFeatureState(cx.library.$status);
	const error = useFeatureState(cx.library.$error);
	const projectItems = useFeatureState(cx.library.$projectItems);
	const globalItems = useFeatureState(cx.library.$globalItems);
	const selection = useFeatureState(cx.$selection);
	const [query, setQuery] = React.useState('');

	const entries = React.useMemo(() => libraryEntries(projectItems, globalItems), [projectItems, globalItems]);
	const selectedPieces = project.entities.filter((entity) => selection.includes(entity.id) && entity.components.piece != null);
	const pieceType = commonPieceType(selectedPieces);
	const typeLabel = pieceType != null ? (getPieceDefinition(pieceType)?.label ?? pieceType) : null;
	const isUnavailable = status === 'unavailable';
	const words = query.trim().toLowerCase();
	const matches = (text: string): boolean => !words.length || text.toLowerCase().includes(words);

	function newThemeWithAgent(): void {
		// One run per piece type: each makes the new theme's skin for that type, which Accept puts on every piece of it
		const seen = new Set<string>();
		const mentionIds = project.entities.flatMap((entity) => {
			const type = entity.components.piece?.type;
			if (type == null || seen.has(type)) return [];
			seen.add(type);
			return [entity.id];
		});
		cx.openAgent({ text: NEW_THEME_PROMPT, mentionIds: mentionIds.length > 0 ? mentionIds : ['scene'] });
	}

	return (
		<div className="flex min-h-0 flex-1 flex-col">
			<div className="mx-3 mt-1 mb-1.5 flex items-center gap-1">
				<div className="relative min-w-0 flex-1">
					<Search size={12} strokeWidth={2} className="pointer-events-none absolute top-1/2 left-2 -translate-y-1/2 text-[var(--text-tertiary)]" />
					<input
						id="library-search"
						className="mm-input mm-search"
						placeholder={typeLabel != null ? `Search ${typeLabel} Skins` : 'Search'}
						aria-label="Search the library"
						value={query}
						onChange={(event) => setQuery(event.target.value)}
						onKeyDown={(event) => {
							if (event.key === 'Escape') setQuery('');
						}}
					/>
				</div>
				<button
					className="mm-icon-button !h-6 !w-6 shrink-0"
					disabled={isUnavailable || status === 'loading'}
					onClick={() => void cx.library.refresh()}
					title="Reload the library"
					aria-label="Reload Library"
					type="button"
				>
					<RefreshCw size={12} strokeWidth={2} className={status === 'loading' ? 'animate-spin' : undefined} />
				</button>
			</div>

			<div className="min-h-0 flex-1 overflow-y-auto pb-2">
				{pieceType == null || typeLabel == null ? (
					<ThemeSection cx={cx} project={project} entries={entries} matches={matches} isUnavailable={isUnavailable} onNewTheme={newThemeWithAgent} />
				) : (
					<SkinSection
						cx={cx}
						project={project}
						entries={entries}
						selectedPieces={selectedPieces}
						pieceType={pieceType}
						typeLabel={typeLabel}
						matches={matches}
						isUnavailable={isUnavailable}
					/>
				)}
				{status === 'error' && error != null ? (
					<p role="alert" className="mm-caption px-3 !text-[var(--bad)]">
						{error}
					</p>
				) : null}
			</div>
		</div>
	);
};

interface TDesignLibraryProps {
	cx: StudioCx;
	project: TProject;
}

// MARK: - Themes

const ThemeSection: React.FC<{
	cx: StudioCx;
	project: TProject;
	entries: TLibraryEntry[];
	matches: (text: string) => boolean;
	isUnavailable: boolean;
	onNewTheme: () => void;
}> = (props) => {
	const { cx, project, entries, matches, isUnavailable, onNewTheme } = props;
	const isColorByNote = project.design.themeOptions?.colorByNote === true;
	const [renamingId, setRenamingId] = React.useState<string | null>(null);
	// One list, like the skins: built-in themes first, then the project's own with where they come from
	const themes = [...themePresets.map((theme) => theme.id), ...projectThemes(project.design).map((theme) => theme.id)]
		.map((id) => resolveTheme(project.design, id))
		.filter((theme) => matches(`${theme.name} ${themeOrigin(theme)} ${themePresets.find((item) => item.id === theme.id)?.description ?? ''}`));
	const items = entries.filter((entry) => matches(`${libraryItemLabel(entry.item)} ${entry.item.manifest?.pieceType ?? ''} ${libraryItemOrigin(entry.item)}`));

	function menu(theme: TResolvedTheme): TMenuEntry[] {
		const isProjectTheme = theme.projectTheme != null;
		return [
			{ label: 'Apply Theme', disabled: project.design.theme === theme.id, onSelect: () => cx.execute(themeCommands(project, theme.id)) },
			{ label: 'Duplicate Theme', onSelect: () => duplicateTheme(cx, theme.id) },
			...(isProjectTheme
				? [
						'separator' as const,
						{ label: 'Rename', onSelect: () => setRenamingId(theme.id) },
						{ label: 'Delete Theme', onSelect: () => deleteTheme(cx, theme.id) }
					]
				: [])
		];
	}

	return (
		<>
			<SectionTitle
				title="Themes"
				help="A theme dresses the whole film: wall, light, marbles and a skin for every piece type. Duplicate a theme to change its colours. Select a piece to see its skins; select several, such as a section with Shift-click in Layers, to skin them all at once"
			/>
			<div className="mm-tile-grid" role="list" aria-label="Themes">
				{themes.map((theme) => (
					<ThemeCard
						key={theme.id}
						theme={theme}
						isInUse={project.design.theme === theme.id}
						isColorByNote={isColorByNote}
						isRenaming={renamingId === theme.id}
						onApply={() => cx.execute(themeCommands(project, theme.id))}
						onMenu={() => menu(theme)}
						onRename={(name) => {
							setRenamingId(null);
							cx.execute(renameThemeCommands(project, theme.id, name));
						}}
						onRenameCancel={() => setRenamingId(null)}
					/>
				))}
			</div>
			<div className="px-3 pt-1 pb-2">
				<button className="mm-button w-full" onClick={onNewTheme} title="Describe a look and the agent makes a theme with a skin for every piece type" type="button">
					<Sparkles size={12} strokeWidth={1.8} />
					New Theme with Agent…
				</button>
			</div>
			{items.length > 0 ? (
				<>
					<SectionTitle title="Skins and Decorations" help="Select a piece to apply a skin, or drag an item onto the film" />
					<ItemGrid cx={cx} project={project} entries={items} selectedPieces={[]} pieceType={null} />
				</>
			) : isUnavailable ? (
				<SectionTitle title="Skins and Decorations" help="Skins made with the agent are Blender files, so they show in the desktop app" />
			) : null}
		</>
	);
};

/**
 * A theme card: the rendered still of its base, the colours a project theme changes as dots in the corner, its name
 * and where it comes from. The context menu has Duplicate Theme, and Rename and Delete Theme for a project theme.
 */
const ThemeCard: React.FC<{
	theme: TResolvedTheme;
	isInUse: boolean;
	isColorByNote: boolean;
	isRenaming: boolean;
	onApply: () => void;
	onMenu: () => TMenuEntry[];
	onRename: (name: string) => void;
	onRenameCancel: () => void;
}> = (props) => {
	const { theme, isInUse, isColorByNote, isRenaming, onApply, onMenu, onRename, onRenameCancel } = props;
	const preset = themePresets.find((item) => item.id === theme.base);
	const description = themePresets.find((item) => item.id === theme.id)?.description ?? themeOrigin(theme);
	const swatches = THEME_OVERRIDE_FIELDS.flatMap((field) => {
		const color = theme.overrides[field.name];
		return color != null ? [{ name: field.label, color }] : [];
	});
	return (
		<div className="mm-tile-wrap" role="listitem">
			<button className="mm-tile" data-applied={isInUse} aria-pressed={isInUse} title={description} onClick={onApply} onContextMenu={(event) => openContextMenu(event, onMenu())} type="button">
				<span className="mm-tile-thumb mm-tile-thumb-square">
					{preset != null ? <img alt="" src={isColorByNote ? preset.notePreviewUrl : preset.previewUrl} draggable={false} /> : null}
					{swatches.length > 0 ? (
						<span className="absolute top-1 left-1 flex gap-0.5" aria-label={swatches.map((swatch) => `${swatch.name} ${swatch.color}`).join(', ')}>
							{swatches.map((swatch) => (
								<span key={swatch.name} className="h-2.5 w-2.5 rounded-full shadow-[0_0_0_1px_rgb(255_255_255/0.8)]" style={{ background: swatch.color }} />
							))}
						</span>
					) : null}
					{isInUse ? <span className="mm-tile-badge">In Use</span> : null}
				</span>
				{isRenaming ? null : <span className="mm-tile-label">{theme.name}</span>}
				<span className="mm-tile-secondary">{themeOrigin(theme)}</span>
			</button>
			{isRenaming ? <ThemeNameField name={theme.name} onCommit={onRename} onCancel={onRenameCancel} /> : null}
		</div>
	);
};

/** Inline rename of a project theme's card, like Finder: Return keeps the name, Escape cancels */
const ThemeNameField: React.FC<{ name: string; onCommit: (name: string) => void; onCancel: () => void }> = (props) => {
	const { name, onCommit, onCancel } = props;
	const [value, setValue] = React.useState(name);
	return (
		<input
			className="mm-input mt-0.5 w-full"
			aria-label="Theme name"
			autoFocus
			value={value}
			onFocus={(event) => event.currentTarget.select()}
			onChange={(event) => setValue(event.target.value)}
			onBlur={() => onCommit(value)}
			onKeyDown={(event) => {
				if (event.key === 'Enter') onCommit(value);
				if (event.key === 'Escape') onCancel();
				event.stopPropagation();
			}}
		/>
	);
};

// MARK: - Skins

const SkinSection: React.FC<{
	cx: StudioCx;
	project: TProject;
	entries: TLibraryEntry[];
	selectedPieces: TEntity[];
	pieceType: string;
	typeLabel: string;
	matches: (text: string) => boolean;
	isUnavailable: boolean;
}> = (props) => {
	const { cx, project, entries, selectedPieces, pieceType, typeLabel, matches, isUnavailable } = props;
	// A project theme dresses pieces with its base theme's skins
	const base = baseThemeOf(project.design);
	const origin = `${themePresets.find((item) => item.id === base)?.label ?? base} Theme`;
	const builtIn = themeSkins(base, pieceType).filter((skin) => matches(`${skin.label} ${origin}`));
	// Other themes' skins this theme's pieces can wear, so a Neon or Pegboard project has the same choice as Brass
	const more = moreThemeSkins(base, pieceType).filter((skin) => matches(`${skin.label} ${themeLabel(skin.themeId)} Theme More Skins`));
	const items = entries.filter((entry) => itemFitsPieceType(entry.item, pieceType) && matches(`${libraryItemLabel(entry.item)} ${libraryItemOrigin(entry.item)}`));
	const piecesOfType = project.entities.filter((entity) => entity.components.piece?.type === pieceType);
	const isMixed = selectedPieces.some((entity) => entity.components.piece?.type !== pieceType);
	const selectionTarget: TSkinTarget = { kind: 'entities', entityIds: selectedPieces.filter((entity) => entity.components.piece?.type === pieceType).map((entity) => entity.id) };

	function applyThemeSkin(skin: TThemeSkin, toAll: boolean): void {
		if (!cx.execute(themeSkinCommands(project, toAll ? { kind: 'pieceType', pieceType } : selectionTarget, skin)) || toAll) return;
		notifySkinApplied(cx, project, skin.label, pieceType, selectedPieces, skin.assetId);
	}

	return (
		<>
			<SectionTitle
				title={`${typeLabel} Skins`}
				help={`Click applies to every selected ${typeLabel.toLowerCase()}, ⌥-click to every ${typeLabel.toLowerCase()} in the project. To give a section its own look, Shift-click its first and last ${typeLabel.toLowerCase()} in Layers, then pick a skin${isMixed ? `. Other selected pieces keep their skin` : ''}`}
			/>
			<div className="mm-tile-grid" role="listbox" aria-label={`${typeLabel} skins`}>
				{builtIn.map((skin) => (
					<SkinTile
						key={skin.assetId ?? 'default'}
						label={skin.label}
						origin={origin}
						previewUrl={skin.previewUrl}
						isApplied={selectionTarget.entityIds.length > 0 && selectedPieces.filter((entity) => entity.components.piece?.type === pieceType).every((entity) => showsThemeSkin(entity, skin))}
						isInUse={piecesOfType.some((entity) => showsThemeSkin(entity, skin))}
						typeLabel={typeLabel}
						onApply={(toAll) => applyThemeSkin(skin, toAll)}
						onMenu={() => applyMenu(typeLabel, selectionTarget.entityIds.length, (toAll) => applyThemeSkin(skin, toAll))}
					/>
				))}
			</div>
			{more.length > 0 ? (
				<>
					<SectionTitle
						title="More Skins"
						help={`Skins from other themes. They keep their own look in the ${themeLabel(base)} theme`}
					/>
					<div
						className="mm-tile-grid"
						role="listbox"
						aria-label={`More ${typeLabel.toLowerCase()} skins`}
					>
						{more.map((skin) => (
							<SkinTile
								key={skin.assetId ?? 'default'}
								label={skin.label}
								origin={`${themeLabel(skin.themeId)} Theme`}
								previewUrl={skin.previewUrl}
								isApplied={
									selectionTarget.entityIds.length > 0 &&
									selectedPieces
										.filter((entity) => entity.components.piece?.type === pieceType)
										.every((entity) => showsThemeSkin(entity, skin))
								}
								isInUse={piecesOfType.some((entity) => showsThemeSkin(entity, skin))}
								typeLabel={typeLabel}
								onApply={(toAll) => applyThemeSkin(skin, toAll)}
								onMenu={() =>
									applyMenu(typeLabel, selectionTarget.entityIds.length, (toAll) =>
										applyThemeSkin(skin, toAll)
									)
								}
							/>
						))}
					</div>
				</>
			) : null}
			{items.length > 0 ? (
				<ItemGrid cx={cx} project={project} entries={items} selectedPieces={selectedPieces} pieceType={pieceType} />
			) : !isUnavailable ? (
				<div className="px-3 pt-1">
					<EmptyRow text={`Ask the agent for a ${typeLabel.toLowerCase()} skin (⌘J)`} help="Accepted Results show here with Made with Agent; star one to keep it for every project" />
				</div>
			) : null}
		</>
	);
};

/** Skins made with the agent or imported, and decorations, each with its origin, In Use badge and star */
const ItemGrid: React.FC<{ cx: StudioCx; project: TProject; entries: TLibraryEntry[]; selectedPieces: TEntity[]; pieceType: string | null }> = (props) => {
	const { cx, project, entries, selectedPieces, pieceType } = props;
	const selectedIds = selectedPieces.filter((entity) => entity.components.piece?.type === pieceType).map((entity) => entity.id);

	async function apply(item: TLibraryItem, toAll: boolean): Promise<void> {
		const type = item.manifest?.pieceType ?? pieceType;
		if (toAll && type != null) {
			await cx.library.applySkin(item, { kind: 'pieceType', pieceType: type });
			return;
		}
		if ((await cx.library.applySkin(item, { kind: 'entities', entityIds: selectedIds })) && pieceType != null) {
			notifySkinApplied(cx, project, libraryItemLabel(item), pieceType, selectedPieces, item.id);
		}
	}

	function menu(entry: TLibraryEntry, isInUse: boolean): TMenuEntry[] {
		const { item } = entry;
		const type = item.manifest?.pieceType ?? pieceType;
		const typeLabel = type != null ? (getPieceDefinition(type)?.label ?? type) : null;
		const isSkin = item.manifest?.role === 'skin';
		return [
			...(isSkin && typeLabel != null ? applyMenu(typeLabel, selectedIds.length, (toAll) => void apply(item, toAll)) : []),
			...(isSkin && typeLabel != null ? ['separator' as const] : []),
			{ label: 'Keep in Library', checked: entry.isKept, onSelect: () => void cx.library.setKept(entry, !entry.isKept) },
			// Removing an item the film still shows would leave its pieces without a skin
			{ label: 'Remove', disabled: isInUse, onSelect: () => void removeEntry(cx, entry) }
		];
	}

	return (
		<div className="mm-tile-grid" role="listbox" aria-label="Library items">
			{entries.map((entry) => {
				const { item } = entry;
				const users = project.entities.filter((entity) => entity.components.skin?.assetId === item.id);
				const isInUse = users.length > 0;
				const isSkin = item.manifest?.role === 'skin';
				const type = item.manifest?.pieceType ?? pieceType;
				const typeLabel = type != null ? (getPieceDefinition(type)?.label ?? type) : 'piece';
				return (
					<SkinTile
						key={`${item.scope}:${item.id}`}
						label={libraryItemLabel(item)}
						origin={item.manifestError != null ? "Can't be read" : libraryItemOrigin(item)}
						previewUrl={item.previewUrl}
						isApplied={selectedIds.length > 0 && selectedIds.every((id) => users.some((entity) => entity.id === id))}
						isInUse={isInUse}
						isKept={entry.isKept}
						onKeep={() => void cx.library.setKept(entry, !entry.isKept)}
						typeLabel={typeLabel}
						isDisabled={!isSkin && pieceType != null}
						onApply={isSkin && selectedIds.length > 0 ? (toAll) => void apply(item, toAll) : null}
						onMenu={() => menu(entry, isInUse)}
						onDragStart={(event) => {
							event.dataTransfer.setData(LIBRARY_DRAG_TYPE, JSON.stringify({ id: item.id, scope: item.scope }));
							event.dataTransfer.effectAllowed = 'copy';
						}}
					/>
				);
			})}
		</div>
	);
};

const SkinTile: React.FC<{
	label: string;
	origin: string;
	previewUrl: string | null;
	isApplied: boolean;
	isInUse: boolean;
	typeLabel: string;
	onApply: ((toAll: boolean) => void) | null;
	onMenu: () => TMenuEntry[];
	isKept?: boolean;
	onKeep?: () => void;
	isDisabled?: boolean;
	onDragStart?: (event: React.DragEvent) => void;
}> = (props) => {
	const { label, origin, previewUrl, isApplied, isInUse, typeLabel, onApply, onMenu, isKept, onKeep, isDisabled, onDragStart } = props;
	return (
		<div className="mm-tile-wrap" role="option" aria-selected={isApplied}>
			<button
				className="mm-tile"
				data-applied={isApplied}
				data-dimmed={isDisabled === true}
				draggable={onDragStart != null}
				title={onApply != null ? `${label}: click applies to the selection, ⌥-click to every ${typeLabel.toLowerCase()}` : label}
				onClick={(event) => onApply?.(event.altKey)}
				onContextMenu={(event) => openContextMenu(event, onMenu())}
				onDragStart={onDragStart}
				type="button"
			>
				<span className="mm-tile-thumb mm-tile-thumb-square">
					{previewUrl != null ? <img alt="" src={previewUrl} draggable={false} /> : <Box size={20} strokeWidth={1.4} className="text-[var(--text-tertiary)]" />}
					{isInUse ? <span className="mm-tile-badge">In Use</span> : null}
				</span>
				<span className="mm-tile-label">{label}</span>
				<span className="mm-tile-secondary">{origin}</span>
			</button>
			{onKeep != null ? (
				<button
					className="mm-tile-star"
					data-kept={isKept === true}
					aria-pressed={isKept === true}
					aria-label="Keep in Library"
					title={isKept === true ? 'Kept in the library for every project' : 'Keep in Library to use it in every project'}
					onClick={onKeep}
					type="button"
				>
					<Star size={11} strokeWidth={2} fill={isKept === true ? 'currentColor' : 'none'} />
				</button>
			) : null}
		</div>
	);
};

// MARK: - Helpers

/**
 * Says what a skin did when the film alone doesn't show it: other piece types kept, or platforms keeping the skin's
 * colour with Colour by Note on. `assetId` is the applied skin, null for the theme's default.
 */
export function notifySkinApplied(cx: StudioCx, project: TProject, skinLabel: string, pieceType: string, selected: TEntity[], assetId: string | null): void {
	const isColorByNote = project.design.themeOptions?.colorByNote === true;
	const keepsSkinColor = isColorByNote && !takesNoteColor(baseThemeOf(project.design), assetId != null ? { assetId, link: 'linked' } : null);
	const message = skinAppliedMessage({ skinLabel, pieceType, selected, keepsSkinColor });
	if (message != null) cx.notifyEdit(message);
}

function applyMenu(typeLabel: string, selectedCount: number, apply: (toAll: boolean) => void): TMenuEntry[] {
	return [
		{ label: selectedCount > 1 ? `Apply to ${selectedCount} ${typeLabel}s` : 'Apply to Selection', disabled: selectedCount === 0, onSelect: () => apply(false) },
		{ label: `Apply to All ${typeLabel}s`, shortcut: '⌥ Click', onSelect: () => apply(true) }
	];
}

async function removeEntry(cx: StudioCx, entry: TLibraryEntry): Promise<void> {
	if (entry.isKept) await cx.library.setKept(entry, false);
	if (entry.item.scope === 'project') await cx.library.remove(entry.item);
}

function themeLabel(themeId: string): string {
	return themePresets.find((item) => item.id === themeId)?.label ?? themeId;
}

const SectionTitle: React.FC<{ title: string; help: string }> = (props) => {
	const { title, help } = props;
	return (
		<div className="mm-library-header">
			<span className="flex-1 text-left">{title}</span>
			<HelpTip text={help} />
		</div>
	);
};

/** An empty line, with the explanation behind the question mark */
const EmptyRow: React.FC<{ text: string; help: string }> = (props) => {
	const { text, help } = props;
	return (
		<div className="flex items-center gap-1.5">
			<span className="mm-caption">{text}</span>
			<HelpTip text={help} />
		</div>
	);
};
