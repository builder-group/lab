import { useFeatureState } from 'feature-react/state';
import { House, PanelBottom, PanelLeft, PanelRight, Plus, X } from 'lucide-react';
import React from 'react';
import { WindowControlsInset } from '@/components';
import { ActivityView } from '@/modules/design/ActivityView';
import type { StudioCx, TStudioPanel } from './StudioCx';

/**
 * Document-style title bar after Paper: the traffic lights, the sidebar toggle, a Projects tab that
 * returns to the start window and the open project as a document tab, then activity and panel toggles
 */
export const TitleBar: React.FC<TTitleBarProps> = (props) => {
	const { cx } = props;
	const title = useFeatureState(cx.$history)?.present.title ?? 'Untitled';
	const save = useFeatureState(cx.$save);
	const panels = useFeatureState(cx.$panels);

	return (
		<header data-tauri-drag-region className="mm-titlebar flex h-[38px] shrink-0 items-center gap-1 pr-2 pl-3 select-none">
			<WindowControlsInset />
			<PanelToggle cx={cx} panel="sidebar" isOn={panels.sidebar} label="Sidebar" shortcut="⌃⌘S" icon={<PanelLeft size={16} strokeWidth={1.6} />} />
			<div className="ml-1 flex min-w-0 items-center gap-1" role="tablist" aria-label="Open documents">
				<button className="mm-doc-tab" onClick={() => void cx.closeProject()} title="Projects" aria-label="Projects" role="tab" aria-selected={false} type="button">
					<House size={14} strokeWidth={1.7} />
				</button>
				<div className="mm-doc-tab" data-active="true" role="tab" aria-selected>
					<span className="truncate">{title}</span>
					{save === 'dirty' || save === 'saving' ? (
						<span className="mm-doc-dot" title={save === 'saving' ? 'Saving…' : 'Edited'} aria-label="Edited" />
					) : save === 'failed' ? (
						<span className="text-[11px] text-[var(--bad)]">Not saved</span>
					) : null}
					<button className="mm-doc-close" onClick={() => void cx.closeProject()} title="Close Project" aria-label="Close Project" type="button">
						<X size={11} strokeWidth={2} />
					</button>
				</div>
				<button className="mm-icon-button !h-6 !w-6" onClick={() => void cx.newProject()} title="New Project (⌘N)" aria-label="New Project" type="button">
					<Plus size={14} strokeWidth={1.8} />
				</button>
			</div>
			<div data-tauri-drag-region className="flex h-full flex-1 items-center justify-center">
				<ActivityView cx={cx} />
			</div>
			<PanelToggle cx={cx} panel="timeline" isOn={panels.timeline} label="Timeline" shortcut="⌃⌘T" icon={<PanelBottom size={16} strokeWidth={1.6} />} />
			<PanelToggle cx={cx} panel="inspector" isOn={panels.inspector} label="Inspector" shortcut="⌃⌘I" icon={<PanelRight size={16} strokeWidth={1.6} />} />
		</header>
	);
};

interface TTitleBarProps {
	cx: StudioCx;
}

const PanelToggle: React.FC<{ cx: StudioCx; panel: TStudioPanel; isOn: boolean; label: string; shortcut: string; icon: React.ReactNode }> = (props) => {
	const { cx, panel, isOn, label, shortcut, icon } = props;
	return (
		<button
			className="mm-icon-button !h-7 !w-7"
			data-active={isOn}
			aria-pressed={isOn}
			aria-label={label}
			onClick={() => cx.togglePanel(panel)}
			title={`${isOn ? 'Hide' : 'Show'} ${label} (${shortcut})`}
			type="button"
		>
			{icon}
		</button>
	);
};
