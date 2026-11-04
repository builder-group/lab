import { Box, Star } from 'lucide-react';
import React from 'react';
import { openContextMenu, type TMenuEntry } from '@/components';

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

/** One choice shown as a picture, in the Look section and the Library; a ring marks the current one */
export const LookTile: React.FC<{
	label: string;
	detail?: string;
	/** Clicking the detail line, for an origin that opens its Pack's card */
	onDetail?: (() => void) | undefined;
	previewUrl: string | null;
	/** Drawn in place of a rendered preview */
	thumb?: React.ReactNode;
	isCurrent: boolean;
	title: string;
	onApply: (toAll: boolean) => void;
	onMenu?: () => TMenuEntry[];
	onDoubleClick?: () => void;
	onDragStart?: (event: React.DragEvent) => void;
	isKept?: boolean;
	onKeep?: () => void;
}> = (props) => {
	const { label, detail, onDetail, previewUrl, thumb, isCurrent, title, onApply, onMenu, onDoubleClick, onDragStart, isKept, onKeep } = props;
	return (
		<div className="mm-tile-wrap" role="option" aria-selected={isCurrent}>
			<button
				className="mm-tile"
				data-applied={isCurrent}
				draggable={onDragStart != null}
				title={title}
				onClick={(event) => onApply(event.altKey)}
				onDoubleClick={onDoubleClick}
				onContextMenu={onMenu != null ? (event) => openContextMenu(event, onMenu()) : undefined}
				onDragStart={onDragStart}
				type="button"
			>
				<span className="mm-tile-thumb mm-tile-thumb-square">{thumb ?? (previewUrl != null ? <img alt="" src={previewUrl} draggable={false} /> : <Box size={20} strokeWidth={1.4} className="text-[var(--text-tertiary)]" />)}</span>
				<span className="mm-tile-label">{label}</span>
				{detail != null && detail.length > 0 ? <TileDetail text={detail} onClick={onDetail} /> : null}
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
