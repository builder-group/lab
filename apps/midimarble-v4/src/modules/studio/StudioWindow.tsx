import { useFeatureState } from 'feature-react/state';
import React from 'react';
import { TrackCanvas } from '@/modules/track';
import { FilmView } from '@/modules/film';
import { mountNativeMenu } from './native-menu';
import { Studio } from './Studio';
import { StudioCx } from './StudioCx';

export { StudioCx };

/** The studio's lifecycle, which runs from launch: the start window has the macOS menu bar and an open project restores */
export function mountStudio(cx: StudioCx): () => void {
	const unmountCx = cx.mount();
	const unmountMenu = mountNativeMenu(cx);
	return () => {
		unmountCx();
		unmountMenu();
	};
}

/** The window of an open project. This module and what it imports load after the start window shows (`StartCx`). */
export const StudioWindow: React.FC<{ cx: StudioCx }> = (props) => {
	const { cx } = props;
	const history = useFeatureState(cx.$history);
	const workspace = useFeatureState(cx.$workspace);

	if (history == null) return null;
	return (
		<Studio
			cx={cx}
			canvas={
				workspace === 'track' ? (
					<TrackCanvas cx={cx} />
				) : (
					<FilmView
						cx={cx.film}
						studio={cx}
						frame={history.present.frame}
						onPick={(id, shiftKey) => {
							const selection = cx.$selection.get();
							if (!shiftKey) cx.$selection.set(id == null ? [] : [id]);
							else if (id != null) cx.$selection.set(selection.includes(id) ? selection.filter((item) => item !== id) : [...selection, id]);
						}}
						onPlace={(u, v) => cx.placeWallText(u, v)}
						onDropAsset={(entityId, asset) => {
							const item = [...cx.library.$projectItems.get(), ...cx.library.$globalItems.get()].find((candidate) => candidate.id === asset.id && candidate.scope === asset.scope);
							if (item == null) return;
							cx.$selection.set([entityId]);
							void cx.library.applySkin(item, { kind: 'entities', entityIds: [entityId] });
						}}
					/>
				)
			}
		/>
	);
};
