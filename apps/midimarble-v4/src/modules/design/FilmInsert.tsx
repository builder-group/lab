import { useFeatureState } from 'feature-react/state';
import { Box, Lightbulb, Music, PackagePlus, Star, Type, Video, Wand2 } from 'lucide-react';
import React from 'react';
import { addedPacks } from '@/modules/library';
import { HelpTip, openContextMenu, type TMenuEntry } from '@/components';
import { InsertPopover } from '@/modules/compose/InsertLibrary';
import { PiecePreview } from '@/modules/compose/PiecePreview';
import type { StudioCx } from '@/modules/studio';
import { builtInSource, type TDecorSource } from './decor';
import { libraryDecorSource, openScatterPanel, placeDecor, placeLibraryDecor } from './decor-actions';
import { DECOR_HELP } from './concept-words';
import { listedDecorItems, usedDecorSources } from './decor-catalog';
import { TileDetail } from './LookTile';
import { libraryEntries, libraryItemKey, notAddedPackAction, libraryItemLabel, libraryItemOrigin, type TLibraryEntry } from './DesignLibraryCx';
import type { TTitleStyle } from './design-commands';

/** MIME type of a library item dragged onto the preview or the inspector */
export const LIBRARY_DRAG_TYPE = 'application/x-midimarble-asset';
/** MIME type of a listed Decor item dragged onto the viewer */
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
	return data !== '' ? libraryDecorSource(cx, JSON.parse(data) as { id: string; scope: string; packId?: string | null }) : null;
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
 * Film's Insert popover, the one place to add something, the same as Compose's with its tiles: the song while there is
 * none and a marble, titles, Decor with its origin line and the Keep in Library star on what the agent made or you
 * imported, a light and a shot. A click adds the item, a drag onto the viewer places it. How the selection looks, its
 * skins and the theme, is in the inspector.
 */
export const FilmInsert: React.FC<TFilmInsertProps> = (props) => {
	const { cx, anchor, hasSong, onAddSong, onAddMarble, onAddTitle, onAddLight, onAddShot } = props;
	const status = useFeatureState(cx.library.$status);
	const error = useFeatureState(cx.library.$error);
	const projectItems = useFeatureState(cx.library.$projectItems);
	const globalItems = useFeatureState(cx.library.$globalItems);
	const packs = useFeatureState(addedPacks);
	const history = useFeatureState(cx.$history);
	const [isDragging, setIsDragging] = React.useState(false);
	const close = React.useCallback(() => cx.library.$insertOpen.set(false), [cx]);
	const entries = React.useMemo(() => libraryEntries(projectItems, globalItems, packs).filter((entry) => entry.item.manifest?.role === 'decoration'), [projectItems, globalItems, packs]);

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
			<InsertSection title={hasSong ? 'Marble' : 'Song and Marble'}>
				{hasSong ? null : <InsertTile label="Song…" title="Add a MIDI file or a recording: the only sound of the film" preview={<Music size={22} strokeWidth={1.4} />} onAdd={() => add(onAddSong)} />}
				<InsertTile label="Marble" title="A new marble with its own layer" preview={<PiecePreview item="marble" width={72} height={48} />} onAdd={() => add(onAddMarble)} />
			</InsertSection>
			<InsertSection title="Titles">
				<InsertTile label="Wall Title" title="Click the preview where it goes (T)" preview={<Type size={22} strokeWidth={1.4} />} onAdd={() => add(onAddTitle)} />
				{TITLE_TILES.map((title) => (
					<InsertTile key={title.style} label={title.label} title={title.description} preview={<span className="mm-title-preview" data-style={title.style} />} onAdd={() => add(() => cx.addScreenTitle(title.style))} {...drag(TITLE_DRAG_TYPE, title.style)} />
				))}
			</InsertSection>
			<InsertSection title="Decor" help={DECOR_HELP}>
				{listedDecorItems(usedDecorSources(history?.present.design ?? {})).map((item) => (
					<InsertTile
						key={item.id}
						label={item.label}
						{...(item.origin != null ? { detail: item.origin } : {})}
						title={`Add ${item.label} at the playhead, or drag it onto the wall`}
						preview={<img alt="" src={item.previewUrl} draggable={false} />}
						onAdd={() => add(() => placeDecor(cx, builtInSource(item.id)))}
						{...drag(DECOR_DRAG_TYPE, item.id)}
					/>
				))}
				{entries.map((entry) => (
					<LibraryTile key={libraryItemKey(entry.item)} cx={cx} entry={entry} onAdd={add} drag={drag} />
				))}
			</InsertSection>
			<button className="mm-button my-2 w-full" onClick={() => add(() => cx.library.$isAddPackOpen.set(true))} title="A Pack brings more themes, skins and decor; nothing in your project changes" type="button">
				<PackagePlus size={12} strokeWidth={1.8} />
				Add Pack…
			</button>
			<InsertSection title="Light and Camera">
				<InsertTile label="Light" title="Add a light to the scene" preview={<Lightbulb size={22} strokeWidth={1.4} />} onAdd={() => add(onAddLight)} />
				<InsertTile label="Shot" title="Add a shot at the playhead" preview={<Video size={22} strokeWidth={1.4} />} onAdd={() => add(onAddShot)} />
			</InsertSection>
			{status === 'error' && error != null ? (
				<p role="alert" className="mm-caption px-1 pt-2 !text-[var(--bad)]">
					{error}
				</p>
			) : null}
			<button className="mm-button mt-2 w-full" onClick={() => add(() => openScatterPanel(cx))} title="Asks what to scatter, then fills the free wall the camera shows" type="button">
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
	hasSong: boolean;
	onAddSong: () => void;
	onAddMarble: () => void;
	onAddTitle: () => void;
	onAddLight: () => void;
	onAddShot: () => void;
}

const TITLE_TILES: readonly { style: TTitleStyle; label: string; description: string }[] = [
	{ style: 'caption', label: 'Caption', description: 'Shows for 3 s from the playhead' },
	{ style: 'songName', label: 'Song Name', description: "Opens the film with the song's name" },
	{ style: 'endCard', label: 'End Card', description: 'Closes the film' }
];

const InsertSection: React.FC<{ title: string; help?: string; children: React.ReactNode }> = (props) => {
	const { title, help, children } = props;
	return (
		<section className="mm-library-section" aria-label={title}>
			<div className="mm-library-section-title">
				{title}
				{help != null ? <HelpTip text={help} side="right" /> : null}
			</div>
			<div className="mm-library-grid">{children}</div>
		</section>
	);
};

const InsertTile: React.FC<TInsertTileProps> = (props) => {
	const { label, detail, onDetail, title, preview, onAdd, onDragStart, onDragEnd, onContextMenu } = props;
	return (
		<button className="mm-library-tile" data-film draggable={onDragStart != null} title={title} onClick={onAdd} onDragStart={onDragStart} onDragEnd={onDragEnd} onContextMenu={onContextMenu} type="button">
			<span className="mm-library-preview">{preview}</span>
			<span className="mm-library-label">
				<span className="truncate">{label}</span>
			</span>
			{detail != null ? <TileDetail text={detail} onClick={onDetail} /> : null}
		</button>
	);
};

interface TInsertTileProps {
	label: string;
	/** Quiet origin line: Starter, a Pack's name, Made with Agent or Imported */
	detail?: string;
	/** Clicking the detail line, for an origin that opens its Pack's card */
	onDetail?: (() => void) | undefined;
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
	const pack = addedPacks.get().find((candidate) => candidate.id === item.packId);
	const menu = (): TMenuEntry[] =>
		pack != null
			? [{ label: 'Remove Pack', onSelect: () => void cx.library.removePack(pack) }]
			: [
					{ label: 'Keep in Library', checked: entry.isKept, onSelect: () => void cx.library.setKept(entry, !entry.isKept) },
					{ label: 'Remove', onSelect: () => void removeLibraryEntry(cx, entry) }
				];
	return (
		<div className="mm-tile-wrap">
			<InsertTile
				label={label}
				detail={libraryItemOrigin(item)}
				onDetail={notAddedPackAction(cx, item)}
				title={`Add ${label} at the playhead, or drag it onto the wall`}
				preview={item.previewUrl != null ? <img alt="" src={item.previewUrl} draggable={false} /> : <Box size={22} strokeWidth={1.4} />}
				onAdd={() => onAdd(() => void placeLibraryDecor(cx, item, label))}
				onContextMenu={(event) => openContextMenu(event, menu())}
				{...drag(LIBRARY_DRAG_TYPE, JSON.stringify({ id: item.id, scope: item.scope, packId: item.packId }))}
			/>
			{pack != null ? null : <button
				className="mm-tile-star"
				data-kept={entry.isKept}
				aria-pressed={entry.isKept}
				aria-label="Keep in Library"
				title={entry.isKept ? 'Kept in the library for every project' : 'Keep in Library to use it in every project'}
				onClick={() => void cx.library.setKept(entry, !entry.isKept)}
				type="button"
			>
				<Star size={11} strokeWidth={2} fill={entry.isKept ? 'currentColor' : 'none'} />
			</button>}
		</div>
	);
};

/** Takes an item out of the library: its kept copy, and the project's. A Pack's item leaves with Remove Pack. */
export async function removeLibraryEntry(cx: StudioCx, entry: TLibraryEntry): Promise<void> {
	if (entry.item.packId != null) return;
	if (entry.isKept) await cx.library.setKept(entry, false);
	if (entry.item.scope === 'project') await cx.library.remove(entry.item);
}
