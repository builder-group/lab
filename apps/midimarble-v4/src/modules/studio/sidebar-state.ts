import { createState } from 'feature-state';
import type { TWorkspace } from './StudioCx';

export type TSidebarTab = 'layers' | 'library';

// Declared before the state, which reads it while the module loads
const SIDEBAR_TABS_KEY = 'midimarble-v4:sidebar-tabs';

/** The sidebar tab each workspace shows, remembered across launches like Figma's Layers and Assets */
export const $sidebarTabs = createState<Record<TWorkspace, TSidebarTab>>(readTabs());

export function setSidebarTab(workspace: TWorkspace, tab: TSidebarTab): void {
	$sidebarTabs.set((tabs) => ({ ...tabs, [workspace]: tab }));
	try {
		localStorage.setItem(SIDEBAR_TABS_KEY, JSON.stringify($sidebarTabs.get()));
	} catch {
		// Storage can be unavailable; the tabs then reset to Layers on the next launch
	}
}

function readTabs(): Record<TWorkspace, TSidebarTab> {
	const fallback: Record<TWorkspace, TSidebarTab> = { compose: 'layers', design: 'layers' };
	try {
		const stored = JSON.parse(localStorage.getItem(SIDEBAR_TABS_KEY) ?? '{}') as Partial<Record<TWorkspace, unknown>>;
		return {
			compose: stored.compose === 'library' ? 'library' : fallback.compose,
			design: stored.design === 'library' ? 'library' : fallback.design
		};
	} catch {
		return fallback;
	}
}
