import { useFeatureState } from 'feature-react/state';
import { LoaderCircle } from 'lucide-react';
import React from 'react';
import { HelpTip } from '@/components';
import { FinishShape, RailShape, SwitchbackShape, toPoints, TunnelShape } from '@/modules/compose/PieceLayer';
import { pieceKind } from '@/modules/compose/scene';
import type { TVec2 } from '@/modules/project';
import type { StudioCx } from '@/modules/studio/StudioCx';
import { placeDecor, startDecorDrag } from './decor-actions';
import { DraftDecorShape } from './DraftDecorShape';
import { DECOR_DRAG_TYPE, LIBRARY_DRAG_TYPE, readDecorDrop } from './DesignLibrary';
import { SCREEN_TITLE_BACKING, SCREEN_TITLE_FONT, SCREEN_TITLE_SHADOW, type TDraftMarble, type TScreenTitleLayout } from './draft-look';
import { DraftPreviewCx, type TDraftTitle } from './DraftPreviewCx';
import { appliedOverrides } from './project-themes';
import { HitboxOverlay } from './HitboxOverlay';

/**
 * The film frame drawn in the app through the film camera, standing in for Blender's preview while it is not
 * there. Clicks pick pieces and titles or place a title, library drops skin the piece under the pointer.
 */
export const DraftPreview: React.FC<TDraftPreviewProps> = (props) => {
	const { studio, frame, isPlacing, isBusy, cover, coverLabel, onPick, onPlace, onDropAsset } = props;
	const [draft] = React.useState(() => new DraftPreviewCx(studio));
	const containerRef = React.useRef<HTMLDivElement>(null);
	const canvasRef = React.useRef<HTMLCanvasElement>(null);
	const [dropTarget, setDropTarget] = React.useState(false);
	const swallowClickRef = React.useRef(false);
	const hasResult = useFeatureState(studio.simulation.$result) != null;
	const design = useFeatureState(studio.$history)?.present.design;
	// A Background colour the theme or the Wall layer set shows around the frame, where the film has no wall
	const background = design != null ? appliedOverrides(design).backgroundColor : undefined;

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
		if (swallowClickRef.current) {
			swallowClickRef.current = false;
			return;
		}
		const { point, u, v } = pointOf(event);
		if (isPlacing) {
			onPlace(u, v, event.shiftKey);
			return;
		}
		onPick(draft.pick(point, titleBoxes(draft.titles())), event.shiftKey);
	}

	function onDrop(event: React.DragEvent<HTMLDivElement>): void {
		setDropTarget(false);
		const decor = readDecorDrop(event, studio);
		if (decor != null) {
			event.preventDefault();
			const { u, v } = pointOf(event);
			placeDecor(studio, decor, u, v);
			return;
		}
		const data = event.dataTransfer.getData(LIBRARY_DRAG_TYPE);
		if (!data) return;
		event.preventDefault();
		const id = draft.pick(pointOf(event).point, new Map());
		if (id != null) onDropAsset(id, JSON.parse(data) as { id: string; scope: string });
	}

	// Letterboxed: the frame keeps the film's aspect at the largest size the pane fits, however narrow it is
	return (
		<div className="flex h-full min-h-0 w-full min-w-0 items-center justify-center" style={{ containerType: 'size', background }}>
			<div className="relative" style={{ aspectRatio: `${frame.width} / ${frame.height}`, width: `min(100cqw, 100cqh * ${frame.width / frame.height})` }}>
				<div
					ref={containerRef}
					role="img"
					aria-label="Draft Preview at the playhead"
					data-placing={isPlacing}
					data-drop-target={dropTarget}
					className="mm-preview absolute inset-0 overflow-hidden rounded-[6px]"
					style={{ boxShadow: '0 0 0 0.5px rgb(0 0 0 / 0.15), 0 12px 40px rgb(0 0 0 / 0.18)' }}
					onClick={onClick}
					onPointerDown={(event) => {
						if (isPlacing || event.button !== 0 || !studio.$selection.get().some((key) => key.startsWith('decor:'))) return;
						startDecorDrag(studio, event, (point) => draft.decorAt(point), (wasDragged) => {
							swallowClickRef.current = wasDragged;
						});
					}}
					onDragOver={(event) => {
						if (!event.dataTransfer.types.includes(LIBRARY_DRAG_TYPE) && !event.dataTransfer.types.includes(DECOR_DRAG_TYPE)) return;
						event.preventDefault();
						event.dataTransfer.dropEffect = 'copy';
						setDropTarget(true);
					}}
					onDragLeave={() => setDropTarget(false)}
					onDrop={onDrop}
				>
					<canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />
					<DraftOverlay draft={draft} />
					{cover}
					<SelectionOverlay draft={draft} />
					<HitboxOverlay draft={draft} />
					{!hasResult ? (
						<div className="absolute inset-0 flex items-center justify-center text-[var(--text-tertiary)]">
							<LoaderCircle className="animate-spin" size={22} />
						</div>
					) : null}
				</div>
				<div className="mm-floating absolute top-2 left-2 flex items-center gap-1.5 py-1 pr-1.5 pl-2.5 text-[11px] text-[var(--text-secondary)]">
					{isBusy ? <LoaderCircle className="animate-spin" size={11} /> : null}
					{coverLabel != null ? (
						<>
							<span className="font-medium text-[var(--text)]">{coverLabel}</span>
							<HelpTip side="right" text="Blender renders the film in the background while you work: Flat Light first, then Fast lighting ahead of the playhead. Turn it off with Live Preview in the Blender menu." />
						</>
					) : (
						<>
							<span className="font-medium text-[var(--text)]">Draft Preview</span>
							<HelpTip side="right" text="Blender draws the real look. This preview follows the same camera." />
						</>
					)}
				</div>
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
	/** Drawn over the frame, such as Blender's background preview frame; clicks still pick through the draft */
	cover?: React.ReactNode;
	/** Replaces the Draft Preview label while the cover shows a frame */
	coverLabel?: string | null;
	onPick: (entityId: string | null, shiftKey: boolean) => void;
	/** Click while placing, in 0..1 image coordinates; ⇧-click keeps the tool for another placement */
	onPlace: (u: number, v: number, keepTool: boolean) => void;
	onDropAsset: (entityId: string, asset: { id: string; scope: string }) => void;
}

/** Rails, tunnels, switchbacks and Finishes as lines in the theme's colours and titles as text */
const DraftOverlay: React.FC<{ draft: DraftPreviewCx }> = (props) => {
	const { draft } = props;
	useFeatureState(draft.$frame);
	const scale = draft.screenScale();
	const titles = draft.titles();
	const pieces = draft.pieces();
	const glows = draft.glows();
	const playhead = draft.studio.$playhead.get();

	return (
		<svg className="pointer-events-none absolute inset-0 h-full w-full overflow-visible" aria-hidden>
			{/* Decor sits on the wall, so it comes first; the outlines of Blender's own objects say they show only there */}
			{draft.decor().map((decor) => (
				<DraftDecorShape key={decor.key} decor={decor} />
			))}
			{draft.blenderOutlines().map((outline) => (
				<polygon key={outline.key} points={toPoints(outline.points)} fill="none" stroke="currentColor" strokeOpacity={0.35 * outline.opacity} strokeWidth={1} strokeDasharray="4 3" />
			))}
			{glows ? (
				// Neon's bloom, cheaply: every piece's outline in its glow colour, blurred once as a group and added onto the frame
				<g style={{ filter: `blur(${Math.max(2, Math.min(8, scale * 0.012))}px)`, mixBlendMode: 'screen' }} opacity={0.85}>
					{pieces.map((piece) => {
						const palette = draft.colorsOf(piece);
						const glow = pieceKind(piece) === 'tube' || piece.type === 'windmill' ? palette.nub : palette.bar;
						return <polygon key={piece.entityId} points={toPoints(draft.selectionOutline(piece))} fill={glow} fillOpacity={0.35} stroke={glow} strokeWidth={Math.max(2, scale * 0.006)} strokeLinejoin="round" />;
					})}
				</g>
			) : null}
			{pieces.map((piece) => {
				const kind = pieceKind(piece);
				const palette = draft.colorsOf(piece);
				if (kind === 'path') return <RailShape key={piece.entityId} compose={draft} piece={piece} scale={scale} opacity={1} palette={palette} tint={palette.bar} />;
				if (kind === 'tube') return <TunnelShape key={piece.entityId} compose={draft} piece={piece} scale={scale} opacity={1} palette={palette} />;
				if (kind === 'holder') return <SwitchbackShape key={piece.entityId} compose={draft} piece={piece} scale={scale} opacity={1} palette={palette} />;
				if (kind === 'catcher') return <FinishShape key={piece.entityId} compose={draft} piece={piece} scale={scale} opacity={1} palette={palette} tint={palette.bar} />;
				return null;
			})}
			{/* A skin's shape cue on its platform: chrome caps, a key, a lens or a grille, so a skin shows before Blender renders it */}
			{pieces.map((piece) =>
				draft.skinMarks(piece).map((mark) => <polygon key={`${piece.entityId}:${mark.id}`} points={toPoints(mark.points)} fill={mark.color} stroke={mark.color} strokeWidth={0.5} strokeLinejoin="round" />)
			)}
			{draft.marbles().map((marble) => {
				const center = draft.toScreen(marble.position);
				const radius = marble.radius * scale;
				if (!Number.isFinite(center.x) || !Number.isFinite(radius)) return null;
				if (marble.finish != null) {
					// A rolling marble's turn stands in for its angle, close enough for a preview
					const turn = (marble.position.x / marble.radius) * (180 / Math.PI);
					return <MarbleFinish key={marble.entityId} finish={marble.finish} center={center} radius={radius} turn={turn} time={playhead} />;
				}
				if (marble.rim == null) return null;
				// Pearl marbles are near white; a ring in their hue says which lane each one is
				return (
					<g key={marble.entityId}>
						<circle cx={center.x} cy={center.y} r={radius * 1.35} fill="none" stroke={marble.rim} strokeOpacity={0.45} strokeWidth={Math.max(2, radius * 0.5)} style={{ filter: 'blur(2px)' }} />
						<circle cx={center.x} cy={center.y} r={radius * 1.04} fill="none" stroke={marble.rim} strokeWidth={Math.max(1.25, radius * 0.18)} />
					</g>
				);
			})}
			{titles.map((title) => (title.screen != null ? <ScreenTitle key={title.entityId} title={title} screen={title.screen} /> : <WallTitle key={title.entityId} title={title} />))}
		</svg>
	);
};

/**
 * A marble skin over its body circle, in the spirit of `skin_materials.py`: Glass's winding vanes and pale ribbon, Metal's
 * dark band under a bright sky, Magic's two clouds drifting slowly in a dark orb. All with a highlight.
 */
const MarbleFinish: React.FC<{ finish: NonNullable<TDraftMarble['finish']>; center: TVec2; radius: number; turn: number; time: number }> = (props) => {
	const { finish, center, radius, turn, time } = props;
	const clipId = React.useId();
	const r = radius;
	const highlight = <circle cx={center.x - r * 0.34} cy={center.y - r * 0.4} r={r * 0.15} fill="#ffffff" fillOpacity={0.9} />;
	return (
		<g>
			<clipPath id={clipId}>
				<circle cx={center.x} cy={center.y} r={r} />
			</clipPath>
			<g clipPath={`url(#${clipId})`}>
				{finish.kind === 'glass' ? (
					<g transform={`rotate(${turn} ${center.x} ${center.y})`} fill="none" strokeLinecap="round">
						<path d={swirl(center, r, 1)} stroke={finish.color} strokeWidth={r * 0.42} />
						<path d={swirl(center, r, -1)} stroke={finish.second} strokeWidth={r * 0.18} />
					</g>
				) : null}
				{finish.kind === 'metal' ? <path d={`M ${center.x - r} ${center.y + r * 0.08} Q ${center.x} ${center.y + r * 0.26} ${center.x + r} ${center.y + r * 0.08} V ${center.y + r} H ${center.x - r} Z`} fill={finish.second} fillOpacity={0.72} /> : null}
				{finish.kind === 'magic' ? (
					<g style={{ filter: `blur(${Math.max(1, r * 0.2)}px)` }}>
						<circle cx={center.x + Math.sin(time * 0.5) * r * 0.4} cy={center.y + Math.cos(time * 0.37) * r * 0.35} r={r * 0.55} fill={finish.color} />
						<circle cx={center.x - Math.cos(time * 0.43) * r * 0.42} cy={center.y - Math.sin(time * 0.31) * r * 0.38} r={r * 0.42} fill={finish.second} />
					</g>
				) : null}
			</g>
			<circle cx={center.x} cy={center.y} r={r} fill="none" stroke={finish.kind === 'magic' ? finish.color : 'rgb(0 0 0 / 0.35)'} strokeWidth={Math.max(0.75, r * 0.07)} />
			{highlight}
		</g>
	);
};

/** One S-shaped vane through the marble's centre */
function swirl(center: TVec2, r: number, side: 1 | -1): string {
	const [x, y] = [center.x, center.y];
	return `M ${x - side * r * 0.72} ${y - r * 0.4} C ${x - side * r * 0.2} ${y - r * 0.85} ${x + side * r * 0.2} ${y + r * 0.85} ${x + side * r * 0.72} ${y + r * 0.4}`;
}

/**
 * The selection's outlines, through the film camera. They lie above the cover too, so a selected piece stays marked
 * over Blender's preview frames, which follow the same camera.
 */
const SelectionOverlay: React.FC<{ draft: DraftPreviewCx }> = (props) => {
	const { draft } = props;
	useFeatureState(draft.$frame);
	const selection = useFeatureState(draft.studio.$selection);
	if (!selection.length) return null;
	const titles = draft.titles();
	const boxes = titleBoxes(titles);

	return (
		<svg className="pointer-events-none absolute inset-0 h-full w-full overflow-visible" aria-hidden data-selection-outlines>
			{draft
				.pieces()
				.filter((piece) => selection.includes(piece.entityId))
				.map((piece) => {
					const points = toPoints(draft.selectionOutline(piece));
					// A white halo and a light fill under the accent stroke keep the outline readable on Brass's gold bars
					return (
						<g key={piece.entityId}>
							<polygon points={points} fill="none" stroke="white" strokeOpacity={0.9} strokeWidth={3.75} strokeLinejoin="round" />
							<polygon points={points} fill="color-mix(in srgb, var(--accent) 12%, transparent)" stroke="var(--accent-strong)" strokeWidth={1.75} strokeLinejoin="round" />
						</g>
					);
				})}
			{titles
				// A title outside its In and Out shows no outline, so no stray box crosses the frame
				.filter((title) => selection.includes(title.entityId) && title.opacity > 0)
				.map((title) => {
					const box = boxes.get(title.entityId);
					return box == null ? null : <polygon key={title.entityId} points={toPoints(box)} fill="none" stroke="var(--accent-strong)" strokeWidth={1.75} />;
				})}
			{selection.flatMap((key) => {
				const outline = key.startsWith('decor:') || key.startsWith('blender:') ? draft.decorOutline(key) : null;
				return outline != null ? [<polygon key={key} points={toPoints(outline)} fill="none" stroke="var(--accent-strong)" strokeWidth={1.75} strokeLinejoin="round" />] : [];
			})}
		</svg>
	);
};

/** A Wall Title in the frame, turned with the wall */
const WallTitle: React.FC<{ title: TDraftTitle }> = (props) => {
	const { title } = props;
	return (
		<text
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
	);
};

/** A Caption, Song Name or End Card as the encoded film draws it: bold, centred, on a soft dark backing with a shadow */
const ScreenTitle: React.FC<{ title: TDraftTitle; screen: TScreenTitleLayout }> = (props) => {
	const { title, screen } = props;
	const width = textWidth(title.text, screen.fontSize);
	// FFmpeg's text height is about the font's ascent and descent
	const height = screen.fontSize * 1.1;
	return (
		<g opacity={title.opacity}>
			<rect
				x={screen.center.x - width / 2 - screen.padding}
				y={screen.center.y - height / 2 - screen.padding}
				width={width + screen.padding * 2}
				height={height + screen.padding * 2}
				fill={SCREEN_TITLE_BACKING}
			/>
			<text
				x={screen.center.x}
				y={screen.center.y}
				fill={title.color}
				fontSize={screen.fontSize}
				fontWeight={700}
				textAnchor="middle"
				dominantBaseline="central"
				style={{ fontFamily: SCREEN_TITLE_FONT, textShadow: `0 ${screen.shadow}px 0 ${SCREEN_TITLE_SHADOW}` }}
			>
				{title.text}
			</text>
		</g>
	);
};

let measureContext: CanvasRenderingContext2D | null | undefined;

/** Width of a screen title's text in CSS pixels, measured in the encoder's font, estimated without a canvas */
function textWidth(text: string, fontSize: number): number {
	if (measureContext === undefined) measureContext = typeof document === 'undefined' ? null : document.createElement('canvas').getContext('2d');
	if (measureContext == null) return text.length * fontSize * 0.6;
	measureContext.font = `700 ${fontSize}px ${SCREEN_TITLE_FONT}`;
	return measureContext.measureText(text).width;
}

/** Picking boxes of titles: the text's approximate extent around its centre, turned with it, plus a small margin */
function titleBoxes(titles: TDraftTitle[]): Map<string, TVec2[]> {
	const boxes = new Map<string, TVec2[]>();
	for (const title of titles) {
		// Screen titles pick on their backing
		const screen = title.screen;
		const halfWidth = screen != null ? textWidth(title.text, screen.fontSize) / 2 + screen.padding : (Math.max(1, title.text.length) * title.fontSize * 0.58) / 2 + 4;
		const halfHeight = screen != null ? (screen.fontSize * 1.1) / 2 + screen.padding : (title.fontSize * 0.8) / 2 + 4;
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
