import { useFeatureState } from 'feature-react/state';
import { LoaderCircle, Type } from 'lucide-react';
import React from 'react';
import { openContextMenu } from '@/components';
import { isEditingTarget } from '@/lib';
import { filmMenu, filmObjectMenu } from '@/modules/studio/menus';
import { CAMERA_KEY } from '@/modules/project';
import type { StudioCx } from '@/modules/studio';
import { startCameraOrbit } from '@/modules/canvas';
import type { FilmCx } from './FilmCx';
import { decorAtWall } from '@/modules/scene';
import { startDecorDrag } from './decor-actions';
import { insertDropHandlers } from './FilmInsert';
import { ScatterPanel } from './ScatterPanel';
import { DraftPreview } from './DraftPreview';
import { lookupFrame } from './live-preview';
import { LivePreviewFrame } from './LivePreviewFrame';

/**
 * Viewer for the Blender scene at the playhead, like the viewer of Final Cut Pro. While Blender's picture is not
 * there (the browser, Blender not installed, starting or failed), or the View menu's Draft Preview is on, the Draft
 * Preview draws the run through the same camera in the app, like Final Cut's proxy playback. Playback and scrubbing
 * show Blender's background frames over the Draft Preview where they are rendered. With the Camera selected, a drag
 * orbits it, drawn by the Draft Preview until Blender catches up.
 */
export const FilmView: React.FC<TFilmViewProps> = (props) => {
	const { cx, studio, frame, onPick, onPlace, onDropAsset } = props;
	const status = useFeatureState(cx.$status);
	const preview = useFeatureState(cx.$preview);
	const error = useFeatureState(cx.$error);
	const placing = useFeatureState(cx.$placing);
	const [dropTarget, setDropTarget] = React.useState(false);
	const swallowClickRef = React.useRef(false);
	const isLiveEnabled = useFeatureState(cx.live.$enabled);
	const isLiveMode = useLiveMode(cx, studio);
	const orbit = useFeatureState(cx.$orbit);
	const selection = useFeatureState(studio.$selection);
	const cameraMode = useFeatureState(studio.$history)?.present.design.camera.mode;
	const canOrbit = selection.includes(CAMERA_KEY) && cameraMode === 'rig' && placing == null;
	const busy = status === 'starting' || status === 'syncing' || status === 'rendering';

	// Escape leaves the placing mode before it reaches the studio shortcuts
	React.useEffect(() => {
		if (placing == null) return;
		function onKeyDown(event: KeyboardEvent): void {
			if (event.key !== 'Escape') return;
			event.preventDefault();
			event.stopPropagation();
			cx.$placing.set(null);
		}
		window.addEventListener('keydown', onKeyDown, true);
		return () => window.removeEventListener('keydown', onKeyDown, true);
	}, [cx, placing]);

	// Escape selects the Scene, as it does on the Track canvas. Menus, sheets and text fields handle their own Escape
	// first.
	React.useEffect(() => {
		function onKeyDown(event: KeyboardEvent): void {
			if (event.key !== 'Escape' || event.defaultPrevented || isEditingTarget(event) || event.metaKey || event.altKey || event.ctrlKey) return;
			if (!studio.$selection.get().length) return;
			event.preventDefault();
			studio.$selection.set([]);
		}
		window.addEventListener('keydown', onKeyDown);
		return () => window.removeEventListener('keydown', onKeyDown);
	}, [studio]);

	const canRunBlender = status !== 'unavailable' && status !== 'missing';
	// Blender's frames hold every layer, so with a layer hidden the view is the Draft, which leaves it out
	const hasHiddenLayer = useFeatureState(studio.$hidden).length > 0;
	const isDraft = preview == null || !canRunBlender || status === 'error' || !isLiveEnabled || isLiveMode || orbit != null || hasHiddenLayer;
	const canShowLive = isLiveEnabled && canRunBlender && !hasHiddenLayer;

	function toImage(event: React.MouseEvent<HTMLElement>): { u: number; v: number } {
		const rect = event.currentTarget.getBoundingClientRect();
		return { u: (event.clientX - rect.left) / rect.width, v: (event.clientY - rect.top) / rect.height };
	}

	/**
	 * Places a title and returns to Move like Figma's Text tool, so the next click selects instead of stacking a
	 * second title; ⇧-click keeps the Title tool for another one
	 */
	function placeTitle(u: number, v: number, keepTool: boolean): void {
		onPlace(u, v);
		if (!keepTool) cx.$placing.set(null);
	}

	async function onClick(event: React.MouseEvent<HTMLImageElement>): Promise<void> {
		if (swallowClickRef.current) {
			swallowClickRef.current = false;
			return;
		}
		const { u, v } = toImage(event);
		if (placing === 'text') {
			placeTitle(u, v, event.shiftKey);
			return;
		}
		onPick(await cx.pick(u, v), event.shiftKey);
	}

	return (
		<div
			className="relative flex h-full w-full items-center justify-center bg-[var(--canvas)] p-8"
			data-orbit={canOrbit}
			onPointerDownCapture={(event) => {
				if (canOrbit && event.button === 0 && event.target instanceof Element && event.target.closest('.mm-preview') != null) startCameraOrbit(studio, event);
			}}
			onContextMenu={(event) => {
				if (!event.defaultPrevented) openContextMenu(event, filmMenu(studio));
			}}
			onClick={(event) => {
				// The surroundings of the preview are empty space, like the wall around a piece
				if (event.target === event.currentTarget && !event.shiftKey && placing == null) studio.$selection.set([]);
			}}
		>
			{isDraft ? (
				<DraftPreview
					studio={studio}
					frame={frame}
					isPlacing={placing != null}
					cover={canShowLive && orbit == null ? <LivePreviewFrame live={cx.live} studio={studio} /> : null}
					onPick={onPick}
					onPlace={placeTitle}
					onDropAsset={onDropAsset}
				/>
			) : preview != null ? (
				<img
					alt="Blender preview at the playhead"
					style={{
						aspectRatio: `${frame.width} / ${frame.height}`,
						boxShadow: '0 0 0 0.5px rgb(0 0 0 / 0.15), 0 12px 40px rgb(0 0 0 / 0.18)',
						opacity: busy ? 0.85 : 1
					}}
					draggable={false}
					src={preview.url}
					data-placing={placing != null}
					data-drop-target={dropTarget}
					className="mm-preview max-h-full max-w-full rounded-[6px] object-contain"
					onClick={(event) => void onClick(event)}
					onContextMenu={(event) => {
						event.preventDefault();
						const { clientX, clientY } = event;
						const { u, v } = toImage(event);
						void cx.pick(u, v).then((id) => {
							if (id != null && !studio.$selection.get().includes(id)) onPick(id, false);
							openContextMenu({ clientX, clientY, preventDefault: () => undefined }, (id != null ? filmObjectMenu(studio, id) : null) ?? filmMenu(studio));
						});
					}}
					onPointerDown={(event) => {
						const project = studio.project;
						if (project == null || placing != null || event.button !== 0 || !studio.$selection.get().some((key) => key.startsWith('decor:'))) return;
						startDecorDrag(studio, event, (point) => decorAtWall(project, studio.$playhead.get(), point), (wasDragged) => {
							swallowClickRef.current = wasDragged;
						});
					}}
					{...insertDropHandlers<HTMLImageElement>({
						studio,
						setDropTarget,
						imagePoint: toImage,
						pieceAt: (event) => {
							const { u, v } = toImage(event);
							return cx.pick(u, v);
						},
						onDropAsset
					})}
				/>
			) : (
				<div
					className="flex max-h-full items-center justify-center rounded-[6px] bg-[var(--content)] text-[var(--text-tertiary)]"
					style={{ aspectRatio: `${frame.width} / ${frame.height}`, height: '100%' }}
				>
					{busy ? <LoaderCircle className="animate-spin" size={22} /> : 'No preview yet'}
				</div>
			)}

			{placing === 'text' ? (
				<div className="mm-floating absolute top-3 left-1/2 flex -translate-x-1/2 items-center gap-2 px-3 py-1.5 text-[12px]">
					<Type size={13} strokeWidth={1.8} />
					<span>Click the wall to place a title · ⇧-click to place more</span>
					<kbd className="mm-keycap">esc</kbd>
				</div>
			) : null}

			<ScatterPanel cx={studio} />

			{status === 'error' && error != null ? (
				<div
					role="alert"
					className="absolute bottom-4 left-1/2 max-w-[520px] -translate-x-1/2 rounded-[10px] bg-[var(--content-raised)] px-4 py-2 text-[12px] text-[var(--bad)]"
					style={{ boxShadow: 'var(--shadow-popover)' }}
				>
					{error}
					<button className="ml-3 underline" onClick={() => cx.requestPreview(0)} type="button">
						Try Again
					</button>
				</div>
			) : null}
		</div>
	);
};

/**
 * Whether the viewer draws in the app rather than showing Blender's still: always while playing, and while
 * paused when the still is not at the playhead yet but a background preview frame is
 */
function useLiveMode(cx: FilmCx, studio: StudioCx): boolean {
	const subscribe = React.useCallback(
		(onChange: () => void) => {
			const stops = [studio.$playing.listen(onChange), studio.$playhead.listen(onChange), cx.live.$frames.listen(onChange), cx.live.$enabled.listen(onChange), cx.$preview.listen(onChange)];
			return () => {
				for (const stop of stops) stop();
			};
		},
		[cx, studio]
	);
	const snapshot = React.useCallback((): boolean => {
		if (studio.$playing.get()) return true;
		const frames = cx.live.$frames.get();
		if (!cx.live.$enabled.get() || frames == null || frames.folder === '') return false;
		const time = studio.$playhead.get();
		const preview = cx.$preview.get();
		const isStillAtPlayhead = preview != null && Math.abs(preview.time - time) < 1e-3;
		return !isStillAtPlayhead && lookupFrame(frames, time) != null;
	}, [cx, studio]);
	return React.useSyncExternalStore(subscribe, snapshot);
}

interface TFilmViewProps {
	cx: FilmCx;
	studio: StudioCx;
	frame: { width: number; height: number };
	/** A click on the preview; Shift adds to or removes from the selection */
	onPick: (entityId: string | null, shiftKey: boolean) => void;
	/** Click while placing, in 0..1 image coordinates */
	onPlace: (u: number, v: number) => void;
	/** A library item dropped on a piece of the preview */
	onDropAsset: (entityId: string, asset: { id: string; scope: string }) => void;
}
