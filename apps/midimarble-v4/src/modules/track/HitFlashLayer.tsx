import { useFeatureState, useListener } from 'feature-react/state';
import React from 'react';
import type { THitFlash } from '@/modules/canvas';
import type { TrackCx } from './TrackCx';

/**
 * Timing shown on the wall: a ring in the hit's status color where the marble lands, gone with its animation.
 * It renders only when a hit lands, and pans with the view while a ring is up.
 */
export const HitFlashLayer: React.FC<{ trackCx: TrackCx }> = (props) => {
	const { trackCx } = props;
	const [flashes, setFlashes] = React.useState<(THitFlash & { key: string })[]>([]);
	useFeatureState(trackCx.$camera);
	useListener(trackCx.studio.$hitFlash, ({ value }) => {
		const added = value.filter((flash) => flash.dot != null).map((flash) => ({ ...flash, key: `${flash.laneId}:${flash.hitId}:${flash.time}` }));
		if (added.length > 0) setFlashes((current) => [...current.filter((flash) => !added.some((item) => item.key === flash.key)), ...added]);
	});
	return (
		<>
			{flashes.map((flash) => {
				if (flash.dot == null) return null;
				const { x, y } = trackCx.toScreen(flash.dot);
				return <circle key={flash.key} className="mm-wall-flash" data-tone={flash.tone} cx={x} cy={y} r={9} fill="none" strokeWidth={2.5} onAnimationEnd={() => setFlashes((current) => current.filter((item) => item.key !== flash.key))} />;
			})}
		</>
	);
};
