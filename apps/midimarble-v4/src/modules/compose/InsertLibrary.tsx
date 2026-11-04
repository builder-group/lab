import { useFeatureState } from 'feature-react/state';
import { Music } from 'lucide-react';
import React from 'react';
import { popoverFrame } from './view';
import { HelpTip } from '@/components';
import { TRACK_HELP } from '@/modules/design/concept-words';
import type { ComposeCx } from './ComposeCx';
import { armedInsertItem, insertSections, type TInsertItem } from './library';
import { PiecePreview } from './PiecePreview';

/**
 * The tool rail's Insert popover in both workspaces, like Figma's assets and Paper's insert panel: opens beside its
 * button, stays inside the window and closes on a press outside.
 */
export const InsertPopover: React.FC<TInsertPopoverProps> = (props) => {
	const { anchor, onClose, title = 'Insert', shortcut, head, footer, side = 'start', isHidden = false, isDense = false, children } = props;
	const ref = React.useRef<HTMLDivElement>(null);
	const bodyRef = React.useRef<HTMLDivElement>(null);
	const bounds = useCanvasBounds();
	const [frame, setFrame] = React.useState<{ left: number; top: number; maxHeight: number } | null>(null);

	// Kept inside the canvas whatever the panels and the window do, which scrolls a panel taller than it. Runs after every
	// render, as a search or a Pack changes how tall the panel wants to be.
	React.useLayoutEffect(() => {
		const button = anchor.current?.getBoundingClientRect();
		const panel = ref.current;
		const body = bodyRef.current;
		if (button == null || panel == null || body == null || bounds == null) return;
		const next = popoverFrame(button, bounds, { width: panel.offsetWidth, height: panel.offsetHeight - body.clientHeight + body.scrollHeight }, side);
		setFrame((current) => (current?.left === next.left && current.top === next.top && current.maxHeight === next.maxHeight ? current : next));
	});

	// A press outside the popover and its button closes it, like a Figma popover; its own tiles' context menu stays part of it
	React.useEffect(() => {
		function onPointerDown(event: PointerEvent): void {
			const target = event.target as Node | null;
			if (ref.current?.contains(target) === true || anchor.current?.contains(target) === true) return;
			if (target instanceof Element && target.closest('[role="menu"]') != null) return;
			onClose();
		}
		window.addEventListener('pointerdown', onPointerDown, true);
		return () => window.removeEventListener('pointerdown', onPointerDown, true);
	}, [onClose, anchor]);

	return (
		<div
			ref={ref}
			className="mm-library"
			role="dialog"
			aria-label={title}
			data-dense={isDense}
			style={{ left: frame?.left ?? -9999, top: frame?.top ?? 0, maxHeight: frame?.maxHeight, visibility: frame == null || isHidden ? 'hidden' : undefined }}
		>
			<div className="mm-library-head">
				<span className="font-semibold">{title}</span>
				{shortcut != null ? <kbd>{shortcut}</kbd> : null}
			</div>
			{head}
			<div ref={bodyRef} className="mm-library-body">
				{children}
			</div>
			{footer != null ? <div className="mm-library-foot">{footer}</div> : null}
		</div>
	);
};

interface TInsertPopoverProps {
	/** The control the popover opens beside */
	anchor: React.RefObject<HTMLButtonElement | null>;
	onClose: () => void;
	title?: string;
	shortcut?: string;
	/** Stays above the scrolling list, such as a search field */
	head?: React.ReactNode;
	/** Stays below the scrolling list */
	footer?: React.ReactNode;
	/** The canvas edge it sits against: Insert's rail on the left, the inspector's rows on the right */
	side?: 'start' | 'end';
	/** Out of the way while a tile is dragged out of it */
	isHidden?: boolean;
	/** Three columns for a long list */
	isDense?: boolean;
	children: React.ReactNode;
}

/** The canvas area on screen, which floating panels stay inside; follows the panels and the window */
function useCanvasBounds(): DOMRect | null {
	const [bounds, setBounds] = React.useState<DOMRect | null>(null);
	React.useLayoutEffect(() => {
		const canvas = document.querySelector('[data-canvas-bounds]');
		if (canvas == null) return;
		const measure = (): void => setBounds(canvas.getBoundingClientRect());
		measure();
		const observer = new ResizeObserver(measure);
		observer.observe(canvas);
		window.addEventListener('resize', measure);
		return () => {
			observer.disconnect();
			window.removeEventListener('resize', measure);
		};
	}, []);
	return bounds;
}

/** Compose's Insert: a tile per item with a preview of its real geometry. A click arms the item's tool; a drag drops it on the canvas. */
export const InsertLibrary: React.FC<TInsertLibraryProps> = (props) => {
	const { compose, anchor, onStartDrag, onAddSong } = props;
	const tool = useFeatureState(compose.$tool);
	const pathType = useFeatureState(compose.$pathType);
	const armed = armedInsertItem(tool, pathType);
	const close = React.useCallback(() => compose.$libraryOpen.set(false), [compose]);

	return (
		<InsertPopover anchor={anchor} onClose={close} shortcut="⇧I">
			{insertSections.map((section) => (
				<section key={section.title} className="mm-library-section" aria-label={section.title}>
					<div className="mm-library-section-title">
						{section.title}
						{section.title === 'Track' ? <HelpTip text={TRACK_HELP} side="right" /> : null}
					</div>
					<div className="mm-library-grid">
						{section.entries.map((entry) => (
							<button
								key={entry.item}
								className="mm-library-tile"
								data-armed={armed === entry.item}
								aria-label={`${entry.label}: ${entry.description}`}
								onPointerDown={(event) => onStartDrag(entry.item, event)}
								onKeyDown={(event) => {
									if (event.key !== 'Enter' && event.key !== ' ') return;
									event.preventDefault();
									compose.armInsert(entry.item);
								}}
								type="button"
							>
								<span className="mm-library-preview">
									<PiecePreview item={entry.item} width={112} height={56} />
								</span>
								<span className="mm-library-label">
									<span>{entry.label}</span>
									{entry.shortcut != null ? <kbd>{entry.shortcut}</kbd> : null}
								</span>
								<span className="mm-tooltip">{entry.description}</span>
							</button>
						))}
					</div>
				</section>
			))}
			{onAddSong != null ? (
				<section className="mm-library-section" aria-label="Song">
					<div className="mm-library-section-title">Song</div>
					<div className="mm-library-grid">
						<button
							className="mm-library-tile"
							aria-label="Song…: add a MIDI file or a recording"
							onClick={() => {
								close();
								onAddSong();
							}}
							type="button"
						>
							<span className="mm-library-preview">
								<Music size={22} strokeWidth={1.4} />
							</span>
							<span className="mm-library-label">
								<span>Song…</span>
							</span>
							<span className="mm-tooltip">Add a MIDI file or a recording: the only sound of the film</span>
						</button>
					</div>
				</section>
			) : null}
		</InsertPopover>
	);
};

interface TInsertLibraryProps {
	compose: ComposeCx;
	/** The rail's Insert button, which the popover opens beside */
	anchor: React.RefObject<HTMLButtonElement | null>;
	/** A press on a tile: a click arms it, a drag past a few pixels drops it on the canvas */
	onStartDrag: (item: TInsertItem, event: React.PointerEvent) => void;
	/** Adds the song; absent while the project has one */
	onAddSong?: (() => void) | undefined;
}

/** Tile that follows the pointer while a library item is dragged outside the canvas */
export const InsertDragGhost: React.FC<{ item: TInsertItem; position: { x: number; y: number } }> = (props) => {
	const { item, position } = props;
	return (
		<div className="mm-library-ghost" style={{ left: position.x, top: position.y }} aria-hidden>
			<PiecePreview item={item} width={88} height={44} />
		</div>
	);
};
