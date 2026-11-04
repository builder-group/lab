import { useFeatureState } from 'feature-react/state';
import { LoaderCircle, Type } from 'lucide-react';
import React from 'react';
import { isEditingTarget } from '@/lib';
import type { StudioCx } from '@/modules/studio/StudioCx';
import type { DesignCx } from './DesignCx';
import { LIBRARY_DRAG_TYPE } from './DesignLibrary';
import { DraftPreview } from './DraftPreview';

/**
 * Viewer for the Blender scene at the playhead, like the viewer of Final Cut Pro. While Blender's preview is not
 * there (the browser, Blender not installed, starting or failed) the Draft Preview draws the run through the same
 * camera in the app, like Final Cut's proxy playback.
 */
export const DesignView: React.FC<TDesignViewProps> = (props) => {
	const { cx, studio, frame, onPick, onPlace, onDropAsset } = props;
	const status = useFeatureState(cx.$status);
	const preview = useFeatureState(cx.$preview);
	const error = useFeatureState(cx.$error);
	const placing = useFeatureState(cx.$placing);
	const [dropTarget, setDropTarget] = React.useState(false);
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

	// Escape clears the selection (a piece, a title, shots) as it does on the Compose canvas. Menus, sheets and text
	// fields handle their own Escape first.
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

	const isDraft = preview == null || status === 'unavailable' || status === 'missing' || status === 'error';

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
		const { u, v } = toImage(event);
		if (placing === 'text') {
			placeTitle(u, v, event.shiftKey);
			return;
		}
		onPick(await cx.pick(u, v), event.shiftKey);
	}

	async function onDrop(event: React.DragEvent<HTMLImageElement>): Promise<void> {
		setDropTarget(false);
		const data = event.dataTransfer.getData(LIBRARY_DRAG_TYPE);
		if (!data) return;
		event.preventDefault();
		const { u, v } = toImage(event);
		const id = await cx.pick(u, v);
		if (id != null) onDropAsset(id, JSON.parse(data) as { id: string; scope: string });
	}

	return (
		<div className="relative flex h-full w-full items-center justify-center bg-[var(--canvas)] p-8">
			{isDraft ? (
				<DraftPreview
					studio={studio}
					frame={frame}
					isPlacing={placing != null}
					isBusy={busy}
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
					onDragOver={(event) => {
						if (!event.dataTransfer.types.includes(LIBRARY_DRAG_TYPE)) return;
						event.preventDefault();
						event.dataTransfer.dropEffect = 'copy';
						setDropTarget(true);
					}}
					onDragLeave={() => setDropTarget(false)}
					onDrop={(event) => void onDrop(event)}
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
			) : !isDraft && busy ? (
				<div className="mm-floating absolute top-3 left-3 flex items-center gap-1.5 px-2.5 py-1 text-[11px] text-[var(--text-secondary)]">
					<LoaderCircle className="animate-spin" size={11} />
					Preview out of date
				</div>
			) : null}

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

interface TDesignViewProps {
	cx: DesignCx;
	studio: StudioCx;
	frame: { width: number; height: number };
	/** A click on the preview; Shift adds to or removes from the selection */
	onPick: (entityId: string | null, shiftKey: boolean) => void;
	/** Click while placing, in 0..1 image coordinates */
	onPlace: (u: number, v: number) => void;
	/** A library item dropped on a piece of the preview */
	onDropAsset: (entityId: string, asset: { id: string; scope: string }) => void;
}
