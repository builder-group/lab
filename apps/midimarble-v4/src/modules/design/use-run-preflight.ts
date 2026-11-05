import { useFeatureState } from 'feature-react/state';
import { createState } from 'feature-state';
import React from 'react';
import type { TBuildProgress } from '@/modules/compose/build-track';
import type { TProject } from '@/modules/project';
import type { StudioCx } from '@/modules/studio';
import { preflightExport, type TExportPreflight } from './export-preflight';

const NOT_BUILDING = createState<TBuildProgress | null>(null);

/**
 * The checked preflight for what stays on screen around the wall, or null until the run has caught up with the
 * project. A drag keeps showing the last value, so no pointer move checks the whole run on the main thread, and while
 * Build Track works there is none, so no step does.
 */
export function useRunPreflight(cx: StudioCx, project: TProject | undefined): TExportPreflight | null {
	const result = useFeatureState(cx.simulation.$result);
	const blenderObjects = useFeatureState(cx.design.$blenderObjects);
	const isPreviewing = useFeatureState(cx.simulation.$previewing);
	const isBuilding = useFeatureState(useFeatureState(cx.$compose)?.assist.$building ?? NOT_BUILDING) != null;
	return React.useMemo(() => {
		if (project == null || isBuilding) return null;
		const held = isPreviewing ? lastPreflight.get(cx) : undefined;
		if (held != null) return held;
		const preflight = preflightExport(project, result, blenderObjects);
		if (preflight.state !== 'checked') {
			lastPreflight.delete(cx);
			return null;
		}
		lastPreflight.set(cx, preflight);
		return preflight;
	}, [cx, isBuilding, isPreviewing, project, result, blenderObjects]);
}

// What a drag keeps showing, shared so a panel that opens during the drag shows it too
const lastPreflight = new WeakMap<StudioCx, TExportPreflight>();
