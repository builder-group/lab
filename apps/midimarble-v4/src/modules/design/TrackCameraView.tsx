import { useFeatureState } from 'feature-react/state';
import React from 'react';
import { CAMERA_KEY } from '@/modules/studio/selection';
import type { StudioCx, TTrackView } from '@/modules/studio/StudioCx';
import { startCameraOrbit } from './camera-orbit';
import { DraftPreview } from './DraftPreview';

const views: { id: TTrackView; label: string; title: string }[] = [
	{ id: 'wall', label: 'Wall', title: 'The flat wall, with all editing' },
	{ id: 'camera', label: 'Camera', title: 'Through the film camera, to judge the framing' }
];

/**
 * Track's Wall or Camera switch and, on Camera, the Draft Preview drawn over the flat canvas, which stays mounted
 * behind it so the tool rail and the keys keep working. Clicks select but nothing drags; with the Camera layer selected
 * a drag orbits. Arming a tool or dragging a tile out of Insert goes back to the Wall, the only place they work.
 */
export const TrackCameraView: React.FC<TTrackCameraViewProps> = (props) => {
	const { cx, frame } = props;
	const view = useFeatureState(cx.$trackView);
	const compose = useFeatureState(cx.$compose);
	const selection = useFeatureState(cx.$selection);
	const cameraMode = useFeatureState(cx.$history)?.present.design.camera.mode;
	const canOrbit = selection.includes(CAMERA_KEY) && cameraMode === 'rig';

	React.useEffect(() => {
		if (compose == null) return;
		const stops = [
			compose.$tool.listen(({ value }) => {
				if (value !== 'select') cx.$trackView.set('wall');
			}),
			compose.$inserting.listen(({ value }) => {
				if (value != null) cx.$trackView.set('wall');
			})
		];
		return () => {
			for (const stop of stops) stop();
		};
	}, [cx, compose]);

	function onPick(id: string | null, shiftKey: boolean): void {
		// Titles belong to Film: they show here, but a click on one selects nothing
		if (id != null && cx.project?.entities.find((entity) => entity.id === id)?.components.wallText != null) return;
		const current = cx.$selection.get();
		if (!shiftKey) cx.$selection.set(id == null ? [] : [id]);
		else if (id != null) cx.$selection.set(current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
	}

	return (
		<>
			{view === 'camera' ? (
				<div
					className="absolute inset-0 z-[25] flex items-center justify-center bg-[var(--canvas)] p-8"
					data-orbit={canOrbit}
					onPointerDownCapture={(event) => {
						if (canOrbit && event.button === 0 && event.target instanceof Element && event.target.closest('.mm-preview') != null) startCameraOrbit(cx, event);
					}}
					onClick={(event) => {
						if (event.target === event.currentTarget && !event.shiftKey) cx.$selection.set([]);
					}}
				>
					<DraftPreview studio={cx} frame={frame} isPlacing={false} onPick={onPick} onPlace={noop} onDropAsset={noop} />
				</div>
			) : null}
			<div className="mm-floating mm-segmented absolute top-3 left-3 z-30" role="radiogroup" aria-label="Track view">
				{views.map((item) => (
					<button key={item.id} role="radio" aria-checked={view === item.id} data-active={view === item.id} title={item.title} onClick={() => cx.$trackView.set(item.id)} type="button">
						{item.label}
					</button>
				))}
			</div>
		</>
	);
};

function noop(): void {
	// Track's Camera view places nothing
}

interface TTrackCameraViewProps {
	cx: StudioCx;
	frame: { width: number; height: number };
}
