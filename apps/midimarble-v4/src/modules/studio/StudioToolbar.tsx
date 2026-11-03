import { useFeatureState } from 'feature-react/state';
import {
	PanelBottom,
	PanelLeft,
	PanelRight,
	Pause,
	Play,
	SkipBack
} from 'lucide-react';
import React from 'react';
import { WindowControlsInset } from '@/components';
import { formatTime } from './format';
import type { TStudioPanel } from './Studio';
import type { StudioCx, TWorkspace } from './StudioCx';

export const StudioToolbar: React.FC<TStudioToolbarProps> = (props) => {
	const { cx, panels, onTogglePanel } = props;
	const history = useFeatureState(cx.$history);
	const save = useFeatureState(cx.$save);
	const workspace = useFeatureState(cx.$workspace);
	const playing = useFeatureState(cx.$playing);
	const playhead = useFeatureState(cx.$playhead);
	const title = history?.present.title ?? 'Untitled';

	return (
		<header data-tauri-drag-region className="flex h-[52px] shrink-0 items-center gap-1 px-2 select-none">
			<WindowControlsInset />
			<button
				className="mm-icon-button"
				data-active={panels.sidebar}
				onClick={() => onTogglePanel('sidebar')}
				title="Show Sidebar (⌃⌘S)"
				type="button"
			>
				<PanelLeft size={16} strokeWidth={1.6} />
			</button>
			<div data-tauri-drag-region className="ml-1 flex min-w-0 flex-col leading-tight">
				<span data-tauri-drag-region className="truncate text-[13px] font-semibold">
					{title}
				</span>
				<span data-tauri-drag-region className="text-[11px] text-[var(--text-secondary)]">
					{saveLabels[save]}
				</span>
			</div>
			<div data-tauri-drag-region className="flex flex-1 justify-center">
				<div className="mm-segmented" role="tablist" aria-label="Workspace">
					{workspaces.map((item) => (
						<button
							key={item.id}
							data-active={workspace === item.id}
							onClick={() => cx.$workspace.set(item.id)}
							role="tab"
							aria-selected={workspace === item.id}
							title={`${item.label} (${item.shortcut})`}
							type="button"
						>
							{item.label}
						</button>
					))}
				</div>
			</div>
			<button className="mm-icon-button" onClick={() => cx.$playhead.set(0)} title="Go to Beginning (↩)" type="button">
				<SkipBack size={15} strokeWidth={1.8} />
			</button>
			<button
				className="mm-icon-button"
				onClick={() => cx.$playing.set(!playing)}
				title={playing ? 'Pause (Space)' : 'Play (Space)'}
				type="button"
			>
				{playing ? <Pause size={15} strokeWidth={1.8} /> : <Play size={15} strokeWidth={1.8} />}
			</button>
			<span className="mm-mono w-[72px] text-center text-[12px] text-[var(--text-secondary)]">
				{formatTime(playhead)}
			</span>
			<button
				className="mm-icon-button"
				data-active={panels.timeline}
				onClick={() => onTogglePanel('timeline')}
				title="Show Timeline (⌃⌘T)"
				type="button"
			>
				<PanelBottom size={16} strokeWidth={1.6} />
			</button>
			<button
				className="mm-icon-button"
				data-active={panels.inspector}
				onClick={() => onTogglePanel('inspector')}
				title="Show Inspector (⌃⌘I)"
				type="button"
			>
				<PanelRight size={16} strokeWidth={1.6} />
			</button>
		</header>
	);
};

interface TStudioToolbarProps {
	cx: StudioCx;
	panels: Record<TStudioPanel, boolean>;
	onTogglePanel: (panel: TStudioPanel) => void;
}

const workspaces: { id: TWorkspace; label: string; shortcut: string }[] = [
	{ id: 'compose', label: 'Compose', shortcut: '⌘1' },
	{ id: 'design', label: 'Design', shortcut: '⌘2' }
];

const saveLabels = {
	saved: 'Saved',
	dirty: 'Edited',
	saving: 'Saving…',
	failed: 'Not saved'
} as const;
