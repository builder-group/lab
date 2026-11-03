import { useFeatureState } from 'feature-react/state';
import React from 'react';
import { Inspector } from './Inspector';
import { Notice } from './Notice';
import { Sidebar } from './Sidebar';
import type { StudioCx } from './StudioCx';
import { StudioToolbar } from './StudioToolbar';
import { Timeline } from './Timeline';
import { usePlayback } from './use-playback';
import { useStudioShortcuts } from './use-studio-shortcuts';

export const Studio: React.FC<TStudioProps> = (props) => {
	const { cx, canvas } = props;
	const workspace = useFeatureState(cx.$workspace);
	const [panels, setPanels] = React.useState({ sidebar: true, inspector: true, timeline: true });

	const togglePanel = React.useCallback((panel: keyof typeof panels) => {
		setPanels((current) => ({ ...current, [panel]: !current[panel] }));
	}, []);

	useStudioShortcuts(cx, togglePanel);
	usePlayback(cx);

	return (
		<div className="flex h-full flex-col">
			<StudioToolbar cx={cx} panels={panels} onTogglePanel={togglePanel} />
			<div className="flex min-h-0 flex-1">
				{panels.sidebar ? <Sidebar cx={cx} /> : null}
				<main
					className="relative min-w-0 flex-1 border-t border-[var(--separator)]"
					aria-label={workspace === 'compose' ? 'Compose canvas' : 'Design preview'}
				>
					{canvas}
				</main>
				{panels.inspector ? <Inspector cx={cx} /> : null}
			</div>
			{panels.timeline ? <Timeline cx={cx} /> : null}
			<Notice cx={cx} />
		</div>
	);
};

interface TStudioProps {
	cx: StudioCx;
	canvas: React.ReactNode;
}

export type TStudioPanel = 'sidebar' | 'inspector' | 'timeline';
