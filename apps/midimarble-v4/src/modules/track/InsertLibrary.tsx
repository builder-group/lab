import { useFeatureState } from 'feature-react/state';
import React from 'react';
import { HelpTip } from '@/components';
import { TRACK_HELP } from '@/modules/scene';
import type { TrackCx } from './TrackCx';
import { InsertPopover } from '@/modules/canvas';
import { armedInsertItem, insertSections, type TInsertItem } from './library';
import { PiecePreview } from './PiecePreview';

/** Track's Insert: a tile per item with a preview of its real geometry. A click arms the item's tool; a drag drops it on the canvas. */
export const InsertLibrary: React.FC<TInsertLibraryProps> = (props) => {
	const { trackCx, anchor, onStartDrag } = props;
	const tool = useFeatureState(trackCx.$tool);
	const pathType = useFeatureState(trackCx.$pathType);
	const armed = armedInsertItem(tool, pathType);
	const close = React.useCallback(() => trackCx.$libraryOpen.set(false), [trackCx]);

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
									trackCx.armInsert(entry.item);
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
		</InsertPopover>
	);
};

interface TInsertLibraryProps {
	trackCx: TrackCx;
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
