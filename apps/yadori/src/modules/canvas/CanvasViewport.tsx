import { useFeatureState } from 'feature-react/state';
import React from 'react';
import type { CanvasCx } from './CanvasCx';

/** Only changes when crossing the check-badge visibility threshold, not on each zoom frame. */
export const CanvasOverviewContext = React.createContext(true);
export const CanvasZoomReadout: React.FC<{ cx: CanvasCx }> = React.memo(({ cx }) => {
	const viewport = useFeatureState(cx.$viewport);
	return <>{Math.round(viewport.zoom * 100)}%</>;
});
CanvasZoomReadout.displayName = 'CanvasZoomReadout';
