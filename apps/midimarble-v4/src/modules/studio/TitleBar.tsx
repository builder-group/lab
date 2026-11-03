import { useFeatureState } from 'feature-react/state';
import { House, LoaderCircle, PanelBottom, PanelLeft, PanelRight, Sparkles } from 'lucide-react';
import React from 'react';
import { RenameField, WindowControlsInset } from '@/components';
import { exportStatusLabel } from '@/modules/design/ExportSheet';
import type { StudioCx, TStudioPanel } from './StudioCx';

/**
 * Unified title bar of a one-document window, like a macOS document app: the traffic lights, the sidebar
 * toggle and Home on the left, the document title with its edited state in the centre, then the agent and
 * the panel toggles on the right
 */
export const TitleBar: React.FC<TTitleBarProps> = (props) => {
	const { cx } = props;
	const panels = useFeatureState(cx.$panels);
	const runs = useFeatureState(cx.agents.$runs);
	const isAgentWorking = runs.some((run) => run.phase === 'working');

	return (
		<header data-tauri-drag-region className="mm-titlebar relative flex h-[38px] shrink-0 items-center gap-0.5 pr-2 pl-3 select-none">
			<WindowControlsInset />
			<PanelToggle cx={cx} panel="sidebar" isOn={panels.sidebar} label="Sidebar" shortcut="⌃⌘S" icon={<PanelLeft size={16} strokeWidth={1.6} />} />
			<button className="mm-icon-button !h-7 !w-7" onClick={() => void cx.closeProject()} title="Close the project and show the start screen" aria-label="Home" type="button">
				<House size={15} strokeWidth={1.6} />
			</button>
			<DocumentTitle cx={cx} />
			<div data-tauri-drag-region className="h-full flex-1" />
			<ExportActivity cx={cx} />
			<button
				className="mm-titlebar-agent"
				data-active={panels.agent}
				aria-pressed={panels.agent}
				onClick={() => cx.togglePanel('agent')}
				title={`${panels.agent ? 'Hide' : 'Show'} Agent (⌘J)`}
				type="button"
			>
				<Sparkles size={14} strokeWidth={1.7} />
				<span>Agent</span>
				{isAgentWorking && !panels.agent ? <span className="mm-titlebar-badge" aria-label="Agent working" /> : null}
			</button>
			<span className="mx-1 h-4 w-px bg-[var(--separator)]" />
			<PanelToggle cx={cx} panel="timeline" isOn={panels.timeline} label="Timeline" shortcut="⌃⌘T" icon={<PanelBottom size={16} strokeWidth={1.6} />} />
			<PanelToggle cx={cx} panel="inspector" isOn={panels.inspector} label="Inspector" shortcut="⌃⌘I" icon={<PanelRight size={16} strokeWidth={1.6} />} />
		</header>
	);
};

interface TTitleBarProps {
	cx: StudioCx;
}

/** Centred title like a macOS document window: a dot while edited, double-click renames */
const DocumentTitle: React.FC<{ cx: StudioCx }> = (props) => {
	const { cx } = props;
	const title = useFeatureState(cx.$history)?.present.title ?? 'Untitled';
	const save = useFeatureState(cx.$save);
	const [isRenaming, setIsRenaming] = React.useState(false);
	const isEdited = save === 'dirty' || save === 'saving';

	return (
		<div data-tauri-drag-region className="pointer-events-none absolute inset-x-0 flex justify-center">
			<div className="mm-titlebar-title pointer-events-auto" onDoubleClick={() => setIsRenaming(true)} title={isRenaming ? undefined : 'Double-click to rename'}>
				{isRenaming ? (
					<RenameField
						value={title}
						onDone={(value) => {
							setIsRenaming(false);
							if (value != null && value !== title) cx.execute([{ type: 'setTitle', title: value }]);
						}}
					/>
				) : (
					<>
						<span className="truncate">{title}</span>
						{isEdited ? <span className="mm-doc-dot" title={save === 'saving' ? 'Saving…' : 'Edited'} aria-label="Edited" /> : null}
						{save === 'failed' ? <span className="text-[11px] font-normal text-[var(--bad)]">Not Saved</span> : null}
					</>
				)}
			</div>
		</div>
	);
};

/** Export progress stays visible in the title bar while the sheet is closed; a click shows the sheet */
const ExportActivity: React.FC<{ cx: StudioCx }> = (props) => {
	const { cx } = props;
	const job = useFeatureState(cx.film.$job);
	const isSheetOpen = useFeatureState(cx.film.$isSheetOpen);
	const isExporting = job.phase === 'preparing' || job.phase === 'rendering' || job.phase === 'encoding';
	if (isSheetOpen || (!isExporting && job.phase !== 'done' && job.phase !== 'failed')) return null;

	return (
		<button className="mm-titlebar-export" data-tone={job.phase} onClick={() => cx.film.$isSheetOpen.set(true)} title="Show the export" type="button">
			{isExporting ? <LoaderCircle size={11} strokeWidth={2.2} className="shrink-0 animate-spin" /> : <span className="mm-activity-dot" data-tone={job.phase === 'done' ? 'good' : 'bad'} />}
			<span className="truncate">{isExporting ? exportStatusLabel(job) : job.phase === 'done' ? 'Film Exported' : 'Export Failed'}</span>
		</button>
	);
};

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
