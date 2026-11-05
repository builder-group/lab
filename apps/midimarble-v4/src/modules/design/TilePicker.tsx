import { Box, ChevronDown, Search, Star } from 'lucide-react';
import React from 'react';
import { createPortal } from 'react-dom';
import { openContextMenu, type TMenuEntry } from '@/components';
import { InsertPopover } from '@/modules/compose/InsertLibrary';
import { filterTiles, showsTileSearch } from './skin-tiles';

/** A tile's quiet second line; with `onClick` a link inside the tile, as a tile is one big button */
export const TileDetail: React.FC<{ text: string; onClick?: (() => void) | undefined }> = ({ text, onClick }) => (
	<span
		className={onClick != null ? 'mm-tile-secondary underline' : 'mm-tile-secondary'}
		onClick={
			onClick != null
				? (event) => {
						event.stopPropagation();
						onClick();
					}
				: undefined
		}
	>
		{text}
	</span>
);

/** One choice of a picker, as a picture; a ring marks the current one */
export interface TPickerTile {
	key: string;
	label: string;
	/** Quiet origin line */
	detail?: string;
	/** Clicking the origin line, for one that opens its Pack's card */
	onDetail?: (() => void) | undefined;
	previewUrl: string | null;
	/** Drawn in place of a rendered preview */
	thumb?: React.ReactNode;
	isCurrent: boolean;
	title: string;
	onApply: (toAll: boolean) => void;
	onMenu?: () => TMenuEntry[];
	onDragStart?: (event: React.DragEvent) => void;
	isKept?: boolean;
	onKeep?: () => void;
	/** Takes the label's place while the tile is renamed */
	nameField?: React.ReactNode;
}

/**
 * What a selection wears as one compact row, the picture and the name; a click opens the same floating panel as Insert
 * with the choices as pictures. A pick applies and closes it, ⌥ applies to all of a type, Esc or a click outside cancels.
 */
export const TilePicker: React.FC<{
	/** The row's element id, for ⌘K to focus it */
	id?: string;
	/** The panel's heading, such as "Skin" */
	heading: string;
	/** Names the choices for screen readers: "Platform skins" */
	label: string;
	current: { label: string; detail?: string; previewUrl: string | null; thumb?: React.ReactNode };
	/** The row's tooltip */
	title: string;
	tiles: readonly TPickerTile[];
	/** Beside the row, such as Reset */
	accessory?: React.ReactNode;
}> = (props) => {
	const { id, heading, label, current, title, tiles, accessory } = props;
	const [isOpen, setIsOpen] = React.useState(false);
	const rowRef = React.useRef<HTMLButtonElement>(null);
	const close = React.useCallback(() => setIsOpen(false), []);
	return (
		<div className="mm-picker-row-wrap" data-span="2">
			<button ref={rowRef} {...(id != null ? { id } : {})} className="mm-picker-row" aria-haspopup="dialog" aria-expanded={isOpen} title={title} onClick={() => setIsOpen(!isOpen)} type="button">
				<span className="mm-picker-row-thumb">{current.thumb ?? (current.previewUrl != null ? <img alt="" src={current.previewUrl} draggable={false} /> : <Box size={14} strokeWidth={1.4} className="text-[var(--text-tertiary)]" />)}</span>
				<span className="min-w-0 flex-1 truncate text-left font-medium">
					{current.label}
					{current.detail != null && current.detail !== '' ? <span className="font-normal text-[var(--text-tertiary)]"> · {current.detail}</span> : null}
				</span>
				<ChevronDown size={12} strokeWidth={2} className="shrink-0 text-[var(--text-tertiary)]" />
			</button>
			{accessory}
			{isOpen ? createPortal(<PickerPanel heading={heading} label={label} anchor={rowRef} tiles={tiles} onClose={close} />, document.body) : null}
		</div>
	);
};

const PickerPanel: React.FC<{ heading: string; label: string; anchor: React.RefObject<HTMLButtonElement | null>; tiles: readonly TPickerTile[]; onClose: () => void }> = (props) => {
	const { heading, label, anchor, tiles, onClose } = props;
	const [query, setQuery] = React.useState('');
	const [isDragging, setIsDragging] = React.useState(false);
	const shown = filterTiles(tiles, query);

	// Escape cancels before it reaches the studio shortcuts
	React.useEffect(() => {
		function onKeyDown(event: KeyboardEvent): void {
			if (event.key !== 'Escape') return;
			event.preventDefault();
			event.stopPropagation();
			onClose();
		}
		window.addEventListener('keydown', onKeyDown, true);
		return () => window.removeEventListener('keydown', onKeyDown, true);
	}, [onClose]);

	return (
		<InsertPopover
			anchor={anchor}
			onClose={onClose}
			title={heading}
			isDense
			isHidden={isDragging}
			side="end"
			head={
				showsTileSearch(tiles) ? (
					<label className="mm-picker-search">
						<Search size={12} strokeWidth={1.8} className="shrink-0 text-[var(--text-tertiary)]" />
						<input className="min-w-0 flex-1 bg-transparent outline-none" autoFocus aria-label={`Search ${label}`} placeholder="Search" value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => event.stopPropagation()} />
					</label>
				) : null
			}
		>
			<div className="mm-library-grid" role="listbox" aria-label={label}>
				{shown.map((tile) => (
					<PickerTile
						key={tile.key}
						tile={tile}
						onPick={(toAll) => {
							onClose();
							tile.onApply(toAll);
						}}
						onDragBegin={() => requestAnimationFrame(() => setIsDragging(true))}
						onDragEnd={onClose}
					/>
				))}
			</div>
			{shown.length === 0 ? <p className="mm-caption px-1 py-3 text-center">Nothing called “{query.trim()}”</p> : null}
		</InsertPopover>
	);
};

const PickerTile: React.FC<{ tile: TPickerTile; onPick: (toAll: boolean) => void; onDragBegin: () => void; onDragEnd: () => void }> = (props) => {
	const { tile, onPick, onDragBegin, onDragEnd } = props;
	const { onDragStart, onMenu, onKeep, isKept, nameField } = tile;
	return (
		<div className="mm-tile-wrap" role="option" aria-selected={tile.isCurrent}>
			<button
				className="mm-library-tile"
				data-film
				data-armed={tile.isCurrent}
				draggable={onDragStart != null}
				title={tile.title}
				onClick={(event) => onPick(event.altKey)}
				onContextMenu={onMenu != null ? (event) => openContextMenu(event, onMenu()) : undefined}
				onDragStart={
					onDragStart != null
						? (event) => {
								onDragStart(event);
								onDragBegin();
							}
						: undefined
				}
				onDragEnd={onDragStart != null ? onDragEnd : undefined}
				type="button"
			>
				<span className="mm-library-preview">{tile.thumb ?? (tile.previewUrl != null ? <img alt="" src={tile.previewUrl} draggable={false} /> : <Box size={20} strokeWidth={1.4} className="text-[var(--text-tertiary)]" />)}</span>
				{nameField != null ? null : (
					<span className="mm-library-label">
						<span className="line-clamp-2">{tile.label}</span>
					</span>
				)}
				{tile.detail != null && tile.detail !== '' ? <TileDetail text={tile.detail} onClick={tile.onDetail} /> : null}
			</button>
			{nameField}
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
