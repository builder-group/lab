import { useFeatureState } from 'feature-react/state';
import { LoaderCircle } from 'lucide-react';
import React from 'react';
import { HelpTip } from '@/components';
import { MARBLE_Z } from '@/modules/compose/ComposeRenderer';
import { RailShape, SwitchbackShape, toPoints, TunnelShape } from '@/modules/compose/PieceLayer';
import { pieceKind, pieceOutline } from '@/modules/compose/scene';
import type { TVec2 } from '@/modules/project';
import type { StudioCx } from '@/modules/studio/StudioCx';
import { LIBRARY_DRAG_TYPE } from './DesignLibrary';
import { DraftPreviewCx, type TDraftTitle } from './DraftPreviewCx';

/**
 * The film frame drawn in the app through the film camera, standing in for Blender's preview while it is not
 * there. Clicks pick pieces and titles or place a title, library drops skin the piece under the pointer.
 */
export const DraftPreview: React.FC<TDraftPreviewProps> = (props) => {
	const { studio, frame, isPlacing, isBusy, onPick, onPlace, onDropAsset } = props;
	const [draft] = React.useState(() => new DraftPreviewCx(studio));
	const containerRef = React.useRef<HTMLDivElement>(null);
	const canvasRef = React.useRef<HTMLCanvasElement>(null);
	const [dropTarget, setDropTarget] = React.useState(false);
	const hasResult = useFeatureState(studio.simulation.$result) != null;

	React.useEffect(() => {
		const container = containerRef.current;
		const canvas = canvasRef.current;
		if (container == null || canvas == null) return;
		return draft.mount(container, canvas);
	}, [draft]);

	function pointOf(event: React.MouseEvent<HTMLElement>): { point: TVec2; u: number; v: number } {
		const rect = event.currentTarget.getBoundingClientRect();
		const point = { x: event.clientX - rect.left, y: event.clientY - rect.top };
		return { point, u: point.x / rect.width, v: point.y / rect.height };
	}

	function onClick(event: React.MouseEvent<HTMLDivElement>): void {
		const { point, u, v } = pointOf(event);
		if (isPlacing) {
			onPlace(u, v);
			return;
		}
		onPick(draft.pick(point, titleBoxes(draft.titles())), event.shiftKey);
	}

	function onDrop(event: React.DragEvent<HTMLDivElement>): void {
		setDropTarget(false);
		const data = event.dataTransfer.getData(LIBRARY_DRAG_TYPE);
		if (!data) return;
		event.preventDefault();
		const id = draft.pick(pointOf(event).point, new Map());
		if (id != null) onDropAsset(id, JSON.parse(data) as { id: string; scope: string });
	}

	return (
		<div
			className="relative max-h-full max-w-full"
			style={{ aspectRatio: `${frame.width} / ${frame.height}`, height: '100%' }}
		>
			<div
				ref={containerRef}
				role="img"
				aria-label="Draft Preview at the playhead"
				data-placing={isPlacing}
				data-drop-target={dropTarget}
				className="mm-preview absolute inset-0 overflow-hidden rounded-[6px]"
				style={{ boxShadow: '0 0 0 0.5px rgb(0 0 0 / 0.15), 0 12px 40px rgb(0 0 0 / 0.18)' }}
				onClick={onClick}
				onDragOver={(event) => {
					if (!event.dataTransfer.types.includes(LIBRARY_DRAG_TYPE)) return;
					event.preventDefault();
					event.dataTransfer.dropEffect = 'copy';
					setDropTarget(true);
				}}
				onDragLeave={() => setDropTarget(false)}
				onDrop={onDrop}
			>
				<canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />
				<DraftOverlay draft={draft} />
				{!hasResult ? (
					<div className="absolute inset-0 flex items-center justify-center text-[var(--text-tertiary)]">
						<LoaderCircle className="animate-spin" size={22} />
					</div>
				) : null}
			</div>
			<div className="mm-floating absolute top-2 left-2 flex items-center gap-1.5 py-1 pr-1.5 pl-2.5 text-[11px] text-[var(--text-secondary)]">
				{isBusy ? <LoaderCircle className="animate-spin" size={11} /> : null}
				<span className="font-medium text-[var(--text)]">Draft Preview</span>
				<HelpTip side="right" text="Blender draws the real look. This preview follows the same camera." />
			</div>
		</div>
	);
};

interface TDraftPreviewProps {
	studio: StudioCx;
	frame: { width: number; height: number };
	isPlacing: boolean;
	/** Blender is starting or rendering its preview, which replaces this one when ready */
	isBusy: boolean;
	onPick: (entityId: string | null, shiftKey: boolean) => void;
	/** Click while placing, in 0..1 image coordinates */
	onPlace: (u: number, v: number) => void;
	onDropAsset: (entityId: string, asset: { id: string; scope: string }) => void;
}

/** Rails, tunnels and switchbacks as lines in the theme's colours, titles as text and the selection outlines */
const DraftOverlay: React.FC<{ draft: DraftPreviewCx }> = (props) => {
	const { draft } = props;
	const studio = draft.studio;
	useFeatureState(draft.$frame);
	const selection = useFeatureState(studio.$selection);
	const scale = draft.screenScale();
	const titles = draft.titles();
	const boxes = titleBoxes(titles);
	const pieces = draft.pieces();

	return (
		<svg className="pointer-events-none absolute inset-0 h-full w-full overflow-visible" aria-hidden>
			{pieces.map((piece) => {
				const kind = pieceKind(piece);
				const palette = draft.colorsOf(piece);
				if (kind === 'path') return <RailShape key={piece.entityId} compose={draft} piece={piece} scale={scale} opacity={1} palette={palette} tint={palette.bar} />;
				if (kind === 'tube') return <TunnelShape key={piece.entityId} compose={draft} piece={piece} scale={scale} opacity={1} palette={palette} />;
				if (kind === 'holder') return <SwitchbackShape key={piece.entityId} compose={draft} piece={piece} scale={scale} opacity={1} palette={palette} />;
				return null;
			})}
			{titles.map((title) => (
				<text
					key={title.entityId}
					x={title.center.x}
					y={title.center.y}
					fill={title.color}
					opacity={title.opacity}
					fontSize={title.fontSize}
					fontWeight={600}
					textAnchor="middle"
					dominantBaseline="central"
					transform={`rotate(${title.angle} ${title.center.x} ${title.center.y})`}
					style={{ fontFamily: '-apple-system, "Helvetica Neue", sans-serif', textShadow: '0 1px 1.5px rgb(0 0 0 / 0.25)' }}
				>
					{title.text}
				</text>
			))}
			{pieces
				.filter((piece) => selection.includes(piece.entityId))
				.map((piece) => {
					const kind = pieceKind(piece);
					const depth = kind === 'path' || kind === 'tube' ? MARBLE_Z : (piece.params['depth'] ?? 0.03);
					const outline = pieceOutline(piece).map((point) => draft.toScreen(point, depth));
					return <polygon key={piece.entityId} points={toPoints(outline)} fill="none" stroke="var(--accent)" strokeWidth={1.5} strokeLinejoin="round" />;
				})}
			{titles
				.filter((title) => selection.includes(title.entityId))
				.map((title) => {
					const box = boxes.get(title.entityId);
					return box == null ? null : <polygon key={title.entityId} points={toPoints(box)} fill="none" stroke="var(--accent)" strokeWidth={1.5} strokeDasharray={title.opacity > 0 ? undefined : '4 3'} />;
				})}
		</svg>
	);
};

/** Picking boxes of titles: the text's approximate extent around its centre, turned with it, plus a small margin */
function titleBoxes(titles: TDraftTitle[]): Map<string, TVec2[]> {
	const boxes = new Map<string, TVec2[]>();
	for (const title of titles) {
		const halfWidth = (Math.max(1, title.text.length) * title.fontSize * 0.58) / 2 + 4;
		const halfHeight = (title.fontSize * 0.8) / 2 + 4;
		const radians = (title.angle * Math.PI) / 180;
		const cos = Math.cos(radians);
		const sin = Math.sin(radians);
		boxes.set(
			title.entityId,
			[
				[-halfWidth, -halfHeight],
				[halfWidth, -halfHeight],
				[halfWidth, halfHeight],
				[-halfWidth, halfHeight]
			].map(([x = 0, y = 0]) => ({ x: title.center.x + x * cos - y * sin, y: title.center.y + x * sin + y * cos }))
		);
	}
	return boxes;
}
