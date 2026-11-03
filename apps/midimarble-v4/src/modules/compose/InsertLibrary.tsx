import { useFeatureState } from 'feature-react/state';
import React from 'react';
import type { ComposeCx } from './ComposeCx';
import { armedInsertItem, insertSections, type TInsertItem } from './library';
import { PiecePreview } from './PiecePreview';

/**
 * Insert popover of the tool rail, like Figma's assets and Paper's insert panel: a tile per item with a
 * preview of its real geometry. A click arms the item's tool; a drag drops it on the canvas.
 */
export const InsertLibrary: React.FC<TInsertLibraryProps> = (props) => {
	const { compose, anchor, onStartDrag } = props;
	const tool = useFeatureState(compose.$tool);
	const pathType = useFeatureState(compose.$pathType);
	const armed = armedInsertItem(tool, pathType);
	const ref = React.useRef<HTMLDivElement>(null);
	const [position, setPosition] = React.useState<{ left: number; top: number } | null>(null);

	// Opens beside the button, kept inside the window
	React.useLayoutEffect(() => {
		const button = anchor.current?.getBoundingClientRect();
		const height = ref.current?.offsetHeight ?? 0;
		if (button == null) return;
		const top = Math.max(8, Math.min(button.top - 12, window.innerHeight - height - 8));
		setPosition({ left: button.right + 10, top });
	}, [anchor]);

	// A press outside the popover and its button closes it, like a Figma popover
	React.useEffect(() => {
		function onPointerDown(event: PointerEvent): void {
			const target = event.target as Node | null;
			if (ref.current?.contains(target) === true || anchor.current?.contains(target) === true) return;
			compose.$libraryOpen.set(false);
		}
		window.addEventListener('pointerdown', onPointerDown, true);
		return () => window.removeEventListener('pointerdown', onPointerDown, true);
	}, [compose, anchor]);

	return (
		<div
			ref={ref}
			className="mm-library"
			role="dialog"
			aria-label="Insert"
			style={{ left: position?.left ?? -9999, top: position?.top ?? 0, visibility: position == null ? 'hidden' : undefined }}
		>
			<div className="mm-library-head">
				<span className="font-semibold">Insert</span>
				<kbd>⇧I</kbd>
			</div>
			{insertSections.map((section) => (
				<section key={section.title} className="mm-library-section" aria-label={section.title}>
					<div className="mm-library-section-title">{section.title}</div>
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
		</div>
	);
};

interface TInsertLibraryProps {
	compose: ComposeCx;
	/** The rail's Insert button, which the popover opens beside */
	anchor: React.RefObject<HTMLButtonElement | null>;
	/** A press on a tile: a click arms it, a drag past a few pixels drops it on the canvas */
	onStartDrag: (item: TInsertItem, event: React.PointerEvent) => void;
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
