import { useFeatureState } from 'feature-react/state';
import type { StudioCx } from '@/modules/studio';
import type { TExportPreflight } from '@/modules/building';

/** The project's problems for what stays on screen around the wall, or null until the run has caught up with the project */
export function useRunPreflight(cx: StudioCx): TExportPreflight | null {
	const problems = useFeatureState(cx.simulation.$problems);
	return problems.state === 'checked' ? problems : null;
}
