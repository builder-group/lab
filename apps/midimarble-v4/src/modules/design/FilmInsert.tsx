import { useFeatureState } from 'feature-react/state';
import { Box, Lightbulb, Star, Video, Wand2 } from 'lucide-react';
import React from 'react';
import { openContextMenu, type TMenuEntry } from '@/components';
import { InsertPopover } from '@/modules/compose/InsertLibrary';
import type { StudioCx } from '@/modules/studio';
import { assetDecorSource, builtInSource, type TDecorSource } from './decor';
import { libraryDecorSource, openScatterPanel, placeDecor } from './decor-actions';
import { DECOR_CATEGORIES, DECOR_ITEMS } from './decor-catalog';
import { libraryEntries, libraryItemLabel, libraryItemOrigin, type TLibraryEntry } from './DesignLibraryCx';
import type { TTitleStyle } from './design-commands';

/** MIME type of a library item dragged onto the preview or the inspector */
export const LIBRARY_DRAG_TYPE = 'application/x-midimarble-asset';
/** MIME type of a built-in Decor item dragged onto the viewer */
export const DECOR_DRAG_TYPE = 'application/x-midimarble-decor';
/** MIME type of a title style dragged onto the viewer */
export const TITLE_DRAG_TYPE = 'application/x-midimarble-title';

/** Whether a drag over the viewer brings something Insert offers */
export function isInsertDrag(event: React.DragEvent): boolean {
	const { types } = event.dataTransfer;
	return types.includes(LIBRARY_DRAG_TYPE) || types.includes(DECOR_DRAG_TYPE) || types.includes(TITLE_DRAG_TYPE);
}

/** The decoration a drop on the viewer brings: a built-in item, or a library item whose role is decoration */
export function readDecorDrop(event: React.DragEvent, cx: StudioCx): TDecorSource | null {
	const builtIn = event.dataTransfer.getData(DECOR_DRAG_TYPE);
	if (builtIn !== '') return builtInSource(builtIn);
	const data = event.dataTransfer.getData(LIBRARY_DRAG_TYPE);
	return data !== '' ? libraryDecorSource(cx, JSON.parse(data) as { id: string; scope: string }) : null;
}

/** Adds the title a drop on the viewer brings; a screen title sits in the frame, so where it lands doesn't matter */
export function dropTitle(event: React.DragEvent, cx: StudioCx): boolean {
	const style = event.dataTransfer.getData(TITLE_DRAG_TYPE);
	if (style === '') return false;
	event.preventDefault();
	cx.addScreenTitle(style as TTitleStyle);
	return true;
}

/**
 * Film's Insert popover, the same as Compose's with its tiles: titles, Decor by what it is, a light, a shot and what the
 * agent made or you imported, with its origin and the Keep in Library star. A click adds the item, a drag onto the viewer
 * places it. How the selection looks, its skins and the theme, is in the inspector.
 */
export const FilmInsert: React.FC<TFilmInsertProps> = (props) => {
	const { cx, anchor, onAddLight, onAddShot } = props;
	const status = useFeatureState(cx.library.$status);
	const error = useFeatureState(cx.library.$error);
	const projectItems = useFeatureState(cx.library.$projectItems);
	const globalItems = useFeatureState(cx.library.$globalItems);
	const [isDragging, setIsDragging] = React.useState(false);
	const close = React.useCallback(() => cx.library.$insertOpen.set(false), [cx]);
	const entries = React.useMemo(() => libraryEntries(projectItems, globalItems).filter((entry) => entry.item.manifest?.role === 'decoration'), [projectItems, globalItems]);

	// Escape closes it before it reaches the studio shortcuts
	React.useEffect(() => {
		function onKeyDown(event: KeyboardEvent): void {
			if (event.key !== 'Escape') return;
			event.preventDefault();
			event.stopPropagation();
			cx.library.$insertOpen.set(false);
		}
		window.addEventListener('keydown', onKeyDown, true);
		return () => window.removeEventListener('keydown', onKeyDown, true);
	}, [cx]);

	/** Runs a tile's action, then gets out of the way */
	function add(action: () => void): void {
		close();
		action();
	}

	function drag(type: string, data: string): Pick<TInsertTileProps, 'onDragStart' | 'onDragEnd'> {
		return {
			onDragStart: (event) => {
				event.dataTransfer.setData(type, data);
				event.dataTransfer.effectAllowed = 'copy';
				// Hidden on the next frame, since the browser ends a drag whose source goes away while it starts
				requestAnimationFrame(() => setIsDragging(true));
			},
			onDragEnd: close
		};
	}

	return (
		<InsertPopover anchor={anchor} onClose={close} isHidden={isDragging} isDense>
			<InsertSection title="Titles">
				{TITLE_TILES.map((title) => (
					<InsertTile key={title.style} label={title.label} title={title.description} preview={<span className="mm-title-preview" data-style={title.style} />} onAdd={() => add(() => cx.addScreenTitle(title.style))} {...drag(TITLE_DRAG_TYPE, title.style)} />
				))}
			</InsertSection>
			{DECOR_CATEGORIES.map((category) => (
				<InsertSection key={category} title={category}>
					{DECOR_ITEMS.filter((item) => item.category === category).map((item) => (
						<InsertTile
							key={item.id}
							label={item.label}
							title={`Add ${item.label} at the playhead, or drag it onto the wall`}
							preview={<img alt="" src={item.previewUrl} draggable={false} />}
							onAdd={() => add(() => placeDecor(cx, builtInSource(item.id)))}
							{...drag(DECOR_DRAG_TYPE, item.id)}
						/>
					))}
				</InsertSection>
			))}
			<InsertSection title="Light and Camera">
				<InsertTile label="Light" title="Add a light to the scene" preview={<Lightbulb size={22} strokeWidth={1.4} />} onAdd={() => add(onAddLight)} />
				<InsertTile label="Shot" title="Add a shot at the playhead" preview={<Video size={22} strokeWidth={1.4} />} onAdd={() => add(onAddShot)} />
			</InsertSection>
			{entries.length > 0 ? (
				<InsertSection title="Library">
					{entries.map((entry) => (
						<LibraryTile key={`${entry.item.scope}:${entry.item.id}`} cx={cx} entry={entry} onAdd={add} drag={drag} />
					))}
				</InsertSection>
			) : null}
			{status === 'error' && error != null ? (
				<p role="alert" className="mm-caption px-1 pt-2 !text-[var(--bad)]">
					{error}
				</p>
			) : null}
			<button className="mm-button mt-2 w-full" onClick={() => add(() => openScatterPanel(cx))} title="Fill the free wall the camera shows with the theme's Decor set, or the items you pick" type="button">
				<Wand2 size={12} strokeWidth={1.8} />
				Scatter Decor…
			</button>
		</InsertPopover>
	);
};

interface TFilmInsertProps {
	cx: StudioCx;
	/** The rail's Insert button, which the popover opens beside */
	anchor: React.RefObject<HTMLButtonElement | null>;
	onAddLight: () => void;
	onAddShot: () => void;
}

const TITLE_TILES: readonly { style: TTitleStyle; label: string; description: string }[] = [
	{ style: 'caption', label: 'Caption', description: 'Shows for 3 s from the playhead' },
	{ style: 'songName', label: 'Song Name', description: "Opens the film with the song's name" },
	{ style: 'endCard', label: 'End Card', description: 'Closes the film' }
];

const InsertSection: React.FC<{ title: string; children: React.ReactNode }> = (props) => {
	const { title, children } = props;
	return (
		<section className="mm-library-section" aria-label={title}>
			<div className="mm-library-section-title">{title}</div>
			<div className="mm-library-grid">{children}</div>
		</section>
	);
};

const InsertTile: React.FC<TInsertTileProps> = (props) => {
	const { label, detail, title, preview, onAdd, onDragStart, onDragEnd, onContextMenu } = props;
	return (
		<button className="mm-library-tile" data-film draggable={onDragStart != null} title={title} onClick={onAdd} onDragStart={onDragStart} onDragEnd={onDragEnd} onContextMenu={onContextMenu} type="button">
			<span className="mm-library-preview">{preview}</span>
			<span className="mm-library-label">
				<span className="truncate">{label}</span>
			</span>
			{detail != null ? <span className="mm-tile-secondary">{detail}</span> : null}
		</button>
	);
};

interface TInsertTileProps {
	label: string;
	/** Quiet origin line: Made with Agent or Imported */
	detail?: string;
	title: string;
	preview: React.ReactNode;
	onAdd: () => void;
	onDragStart?: (event: React.DragEvent) => void;
	onDragEnd?: () => void;
	onContextMenu?: (event: React.MouseEvent) => void;
}

/** What the agent made or you imported: its origin line and the Keep in Library star */
const LibraryTile: React.FC<{ cx: StudioCx; entry: TLibraryEntry; onAdd: (action: () => void) => void; drag: (type: string, data: string) => Pick<TInsertTileProps, 'onDragStart' | 'onDragEnd'> }> = (props) => {
	const { cx, entry, onAdd, drag } = props;
	const { item } = entry;
	const label = libraryItemLabel(item);
	const menu = (): TMenuEntry[] => [
		{ label: 'Keep in Library', checked: entry.isKept, onSelect: () => void cx.library.setKept(entry, !entry.isKept) },
		{ label: 'Remove', onSelect: () => void removeLibraryEntry(cx, entry) }
	];
	return (
		<div className="mm-tile-wrap">
			<InsertTile
				label={label}
				detail={libraryItemOrigin(item)}
				title={`Add ${label} at the playhead, or drag it onto the wall`}
				preview={item.previewUrl != null ? <img alt="" src={item.previewUrl} draggable={false} /> : <Box size={22} strokeWidth={1.4} />}
				onAdd={() => onAdd(() => placeDecor(cx, assetDecorSource(item.id, label, item.manifest?.fittedParams)))}
				onContextMenu={(event) => openContextMenu(event, menu())}
				{...drag(LIBRARY_DRAG_TYPE, JSON.stringify({ id: item.id, scope: item.scope }))}
			/>
			<button
				className="mm-tile-star"
				data-kept={entry.isKept}
				aria-pressed={entry.isKept}
				aria-label="Keep in Library"
				title={entry.isKept ? 'Kept in the library for every project' : 'Keep in Library to use it in every project'}
				onClick={() => void cx.library.setKept(entry, !entry.isKept)}
				type="button"
			>
				<Star size={11} strokeWidth={2} fill={entry.isKept ? 'currentColor' : 'none'} />
			</button>
		</div>
	);
};

/** Takes an item out of the library: its kept copy, and the project's */
export async function removeLibraryEntry(cx: StudioCx, entry: TLibraryEntry): Promise<void> {
	if (entry.isKept) await cx.library.setKept(entry, false);
	if (entry.item.scope === 'project') await cx.library.remove(entry.item);
}
