import { useFeatureState } from 'feature-react/state';
import { Box, Check, ChevronRight, RefreshCw, Search } from 'lucide-react';
import React from 'react';
import { HelpTip, openContextMenu, type TMenuEntry } from '@/components';
import type { TLibraryItem } from '@/modules/library';
import type { TProject } from '@/modules/project';
import { getPieceDefinition } from '@/modules/simulation';
import type { StudioCx } from '@/modules/studio';
import { itemFitsPieceType, themeCommands, themePresets, type TThemePreset } from './design-commands';
import { libraryItemLabel } from './DesignLibraryCx';

/** MIME type of a library item dragged onto the preview or the inspector */
export const LIBRARY_DRAG_TYPE = 'application/x-midimarble-asset';

/**
 * Library of the Design sidebar, like Blender's asset browser in a Finder sidebar: themes, the project's
 * items and the user's library as thumbnail tiles. Drag a tile onto a piece, or select it and apply it.
 */
export const DesignLibrary: React.FC<TDesignLibraryProps> = (props) => {
	const { cx, project } = props;
	const status = useFeatureState(cx.library.$status);
	const error = useFeatureState(cx.library.$error);
	const projectItems = useFeatureState(cx.library.$projectItems);
	const globalItems = useFeatureState(cx.library.$globalItems);
	const selection = useFeatureState(cx.$selection);
	const [query, setQuery] = React.useState('');
	const [active, setActive] = React.useState<string | null>(null);
	const [collapsed, setCollapsed] = React.useState<string[]>([]);

	const selectedPieces = project.entities.filter((entity) => selection.includes(entity.id) && entity.components.piece != null);
	const selectedType = selectedPieces[0]?.components.piece?.type ?? null;
	const filter = (items: TLibraryItem[]): TLibraryItem[] => {
		const words = query.trim().toLowerCase();
		return !words.length ? items : items.filter((item) => `${libraryItemLabel(item)} ${item.manifest?.pieceType ?? ''} ${item.manifest?.role ?? ''}`.toLowerCase().includes(words));
	};
	const activeItem = [...projectItems, ...globalItems].find((item) => itemKey(item) === active) ?? null;
	const isUnavailable = status === 'unavailable';

	function toggleSection(id: string): void {
		setCollapsed((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]));
	}

	function itemMenu(item: TLibraryItem): TMenuEntry[] {
		const pieceType = item.manifest?.pieceType ?? selectedType;
		const typeLabel = pieceType == null ? null : getPieceDefinition(pieceType)?.label ?? pieceType;
		const isSkin = item.manifest?.role === 'skin';
		return [
			{
				label: selectedPieces.length > 1 ? `Apply to ${selectedPieces.length} Pieces` : 'Apply to Selection',
				disabled: !isSkin || !selectedPieces.length || !itemFitsPieceType(item, selectedType),
				onSelect: () => void cx.library.applySkin(item, { kind: 'entities', entityIds: selectedPieces.map((entity) => entity.id) })
			},
			{
				label: typeLabel == null ? 'Apply to All Pieces of This Type' : `Apply to All ${typeLabel}s`,
				disabled: !isSkin || pieceType == null,
				onSelect: () => {
					if (pieceType != null) void cx.library.applySkin(item, { kind: 'pieceType', pieceType });
				}
			},
			'separator',
			...(item.scope === 'project' ? [{ label: 'Save to My Library', onSelect: () => void cx.library.promote(item) }] : []),
			{ label: item.scope === 'project' ? 'Remove from Project' : 'Remove from My Library', onSelect: () => void cx.library.remove(item) }
		];
	}

	return (
		<div className="flex min-h-0 flex-1 flex-col">
			<div className="flex items-center justify-between pr-2">
				<div className="mm-section-title">Library</div>
				<button
					className="mm-icon-button !h-5 !w-5"
					disabled={isUnavailable || status === 'loading'}
					onClick={() => void cx.library.refresh()}
					title="Reload Library"
					aria-label="Reload Library"
					type="button"
				>
					<RefreshCw size={12} strokeWidth={2} className={status === 'loading' ? 'animate-spin' : undefined} />
				</button>
			</div>
			<div className="relative mx-3 mb-1.5">
				<Search size={12} strokeWidth={2} className="pointer-events-none absolute top-1/2 left-2 -translate-y-1/2 text-[var(--text-tertiary)]" />
				<input
					id="library-search"
					className="mm-input mm-search"
					placeholder="Search"
					aria-label="Search the library"
					value={query}
					onChange={(event) => setQuery(event.target.value)}
					onKeyDown={(event) => {
						if (event.key === 'Escape') setQuery('');
					}}
				/>
			</div>

			<div className="min-h-0 flex-1 overflow-y-auto pb-2">
				<LibrarySection id="themes" title="Themes" isOpen={!collapsed.includes('themes')} onToggle={toggleSection}>
					<div className="mm-tile-grid">
						{themePresets
							.filter((theme) => !query.trim() || theme.label.toLowerCase().includes(query.trim().toLowerCase()))
							.map((theme) => (
								<ThemeTile
									key={theme.id}
									theme={theme}
									isApplied={project.design.theme === theme.id}
									onApply={() => cx.execute(themeCommands(project, theme.id))}
								/>
							))}
					</div>
				</LibrarySection>

				<LibrarySection id="project" title="In This Project" isOpen={!collapsed.includes('project')} onToggle={toggleSection} count={projectItems.length}>
					{isUnavailable ? (
						<EmptyRow text="Desktop app only" help="Skins and decorations are Blender files, so the library opens in the desktop app." />
					) : !projectItems.length ? (
						<EmptyRow text="No items" help="Skins you accept from an agent or apply from My Library are copied here, so the project stays portable." />
					) : (
						<ItemGrid items={filter(projectItems)} active={active} onActivate={setActive} onMenu={itemMenu} selectedType={selectedType} />
					)}
				</LibrarySection>

				<LibrarySection id="global" title="My Library" isOpen={!collapsed.includes('global')} onToggle={toggleSection} count={globalItems.length}>
					{isUnavailable ? (
						<EmptyRow text="Desktop app only" help="Items you save from any project appear here in the desktop app." />
					) : !globalItems.length ? (
						<EmptyRow text="No items" help="Right-click a project item and choose Save to My Library to use it in other projects." />
					) : (
						<ItemGrid items={filter(globalItems)} active={active} onActivate={setActive} onMenu={itemMenu} selectedType={selectedType} />
					)}
				</LibrarySection>

				{status === 'error' && error != null ? (
					<p role="alert" className="mm-caption px-3 !text-[var(--bad)]">
						{error}
					</p>
				) : null}
			</div>

			{activeItem != null ? (
				<div className="flex flex-col gap-1.5 border-t border-[var(--separator)] px-3 pt-2.5">
					<div className="truncate text-[11px] text-[var(--text-secondary)]">{libraryItemLabel(activeItem)}</div>
					<div className="flex gap-1.5">
						{itemMenu(activeItem)
							.slice(0, 2)
							.map((entry) =>
								typeof entry === 'object' && 'label' in entry ? (
									<button key={entry.label} className="mm-button min-w-0 flex-1 !px-2" disabled={entry.disabled} onClick={entry.onSelect} type="button">
										<span className="truncate">{entry.label.replace('Apply to ', '')}</span>
									</button>
								) : null
							)}
					</div>
				</div>
			) : null}
		</div>
	);
};

interface TDesignLibraryProps {
	cx: StudioCx;
	project: TProject;
}

const LibrarySection: React.FC<{ id: string; title: string; isOpen: boolean; onToggle: (id: string) => void; count?: number; children: React.ReactNode }> = (props) => {
	const { id, title, isOpen, onToggle, count, children } = props;
	return (
		<section aria-label={title} className="mb-2">
			<button className="mm-library-header" aria-expanded={isOpen} onClick={() => onToggle(id)} type="button">
				<span className="mm-disclosure" data-open={isOpen}>
					<ChevronRight size={10} strokeWidth={2.4} />
				</span>
				<span className="flex-1 text-left">{title}</span>
				{count != null && count > 0 ? <span className="mm-tabular font-normal text-[var(--text-tertiary)]">{count}</span> : null}
			</button>
			{isOpen ? children : null}
		</section>
	);
};

const ItemGrid: React.FC<{
	items: TLibraryItem[];
	active: string | null;
	selectedType: string | null;
	onActivate: (key: string | null) => void;
	onMenu: (item: TLibraryItem) => TMenuEntry[];
}> = (props) => {
	const { items, active, selectedType, onActivate, onMenu } = props;
	if (!items.length) return <p className="mm-caption px-3">No matches</p>;
	return (
		<div className="mm-tile-grid" role="listbox" aria-label="Library items">
			{items.map((item) => {
				const key = itemKey(item);
				const pieceType = item.manifest?.pieceType;
				const fits = selectedType == null || itemFitsPieceType(item, selectedType);
				return (
					<button
						key={key}
						role="option"
						aria-selected={active === key}
						className="mm-tile"
						data-selected={active === key}
						data-dimmed={!fits}
						draggable={item.manifest?.role === 'skin'}
						title={item.manifestError ?? `${libraryItemLabel(item)}${pieceType != null ? ` · ${getPieceDefinition(pieceType)?.label ?? pieceType}` : ''}`}
						onClick={() => onActivate(active === key ? null : key)}
						onDoubleClick={() => onMenu(item).find((entry): entry is Extract<TMenuEntry, { label: string }> => typeof entry === 'object' && 'label' in entry && entry.disabled !== true)?.onSelect()}
						onContextMenu={(event) => {
							onActivate(key);
							openContextMenu(event, onMenu(item));
						}}
						onDragStart={(event) => {
							event.dataTransfer.setData(LIBRARY_DRAG_TYPE, JSON.stringify({ id: item.id, scope: item.scope }));
							event.dataTransfer.effectAllowed = 'copy';
						}}
						type="button"
					>
						<span className="mm-tile-thumb">
							{item.previewUrl != null ? (
								<img alt="" src={item.previewUrl} draggable={false} />
							) : (
								<Box size={20} strokeWidth={1.4} className="text-[var(--text-tertiary)]" />
							)}
						</span>
						<span className="mm-tile-label">{libraryItemLabel(item)}</span>
						<span className="mm-tile-secondary">{item.manifestError != null ? 'Invalid manifest' : roleLabel(item)}</span>
					</button>
				);
			})}
		</div>
	);
};

const ThemeTile: React.FC<{ theme: TThemePreset; isApplied: boolean; onApply: () => void }> = (props) => {
	const { theme, isApplied, onApply } = props;
	return (
		<button className="mm-tile" data-applied={isApplied} aria-pressed={isApplied} title={`${theme.label}: ${theme.description}`} onClick={onApply} type="button">
			<span className="mm-tile-thumb" style={themeArt[theme.id]?.wall}>
				<span className="absolute top-[38%] left-[18%] h-[9%] w-[46%] -rotate-12 rounded-[2px]" style={themeArt[theme.id]?.bar} />
				<span className="absolute top-[22%] left-[30%] h-[13%] w-[13%] rounded-full" style={themeArt[theme.id]?.marble} />
				<span className="absolute top-[62%] left-[46%] h-[9%] w-[40%] rotate-12 rounded-[2px]" style={themeArt[theme.id]?.bar} />
				{isApplied ? (
					<span className="absolute right-1 bottom-1 flex h-4 w-4 items-center justify-center rounded-full bg-[var(--accent)] text-[var(--on-accent)]">
						<Check size={10} strokeWidth={3} />
					</span>
				) : null}
			</span>
			<span className="mm-tile-label">{theme.label}</span>
			<span className="mm-tile-secondary">{isApplied ? 'Applied' : 'Theme'}</span>
		</button>
	);
};

// Small paintings of each theme, standing in for rendered thumbnails until the worker can render them
const themeArt: Record<string, { wall: React.CSSProperties; bar: React.CSSProperties; marble: React.CSSProperties }> = {
	pegboard: {
		wall: {
			backgroundColor: '#dcc9a6',
			backgroundImage: 'radial-gradient(circle, rgb(90 64 30 / 0.35) 1px, transparent 1.4px)',
			backgroundSize: '7px 7px'
		},
		bar: { background: '#ff6b5a', boxShadow: '0 1px 1.5px rgb(0 0 0 / 0.25)' },
		marble: { background: 'radial-gradient(circle at 35% 30%, #fff, #8fb4ff 45%, #3478f6)', boxShadow: '0 1px 2px rgb(0 0 0 / 0.3)' }
	},
	brass: {
		wall: { background: 'radial-gradient(120% 90% at 30% 20%, #8a7aa6, #5c4d78 60%, #43375a)' },
		bar: { background: 'linear-gradient(180deg, #ffe7a3, #d4a640 45%, #8c6418)', boxShadow: '0 1px 2px rgb(0 0 0 / 0.4)' },
		marble: { background: 'radial-gradient(circle at 35% 30%, #fff, #c9ccd4 45%, #6d7280)', boxShadow: '0 1px 2px rgb(0 0 0 / 0.4)' }
	}
};

function itemKey(item: TLibraryItem): string {
	return `${item.scope}:${item.id}`;
}

function roleLabel(item: TLibraryItem): string {
	const manifest = item.manifest;
	if (manifest == null) return '';
	if (manifest.role === 'skin') return manifest.pieceType != null ? `${getPieceDefinition(manifest.pieceType)?.label ?? manifest.pieceType} skin` : 'Skin';
	return manifest.role === 'text' ? 'Text' : 'Decoration';
}

/** An empty library section: one short line, with the explanation behind the question mark */
const EmptyRow: React.FC<{ text: string; help: string }> = (props) => {
	const { text, help } = props;
	return (
		<div className="flex items-center gap-1.5 px-3">
			<span className="mm-caption">{text}</span>
			<HelpTip text={help} />
		</div>
	);
};
