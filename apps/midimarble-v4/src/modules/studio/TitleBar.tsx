import { useFeatureState } from 'feature-react/state';
import { CircleHelp, House, PanelBottom, PanelLeft, PanelRight, Sparkles } from 'lucide-react';
import React from 'react';
import { MenuButton, RenameField, WindowControlsInset, type TMenuEntry } from '@/components';
import { host } from '@/environment';
import { openExternalUrl } from '@/lib';
import { blenderState } from '@/modules/design/blender-state';
import { exportStatusLabel } from '@/modules/design/ExportSheet';
import { commandItem } from './commands';
import { hasUnsavedChanges } from './document';
import type { StudioCx, TStudioPanel } from './StudioCx';

const BLENDER_DOWNLOAD_URL = 'https://www.blender.org/download/';

/**
 * Unified title bar of a one-document window, like a macOS document app: the traffic lights, the sidebar
 * toggle and Home on the left, the document title with its edited state in the centre, then the project's
 * actions on the right: the Blender chip, Quick Help, Agent, Export Film… and the panel toggles
 */
export const TitleBar: React.FC<TTitleBarProps> = (props) => {
	const { cx } = props;
	const panels = useFeatureState(cx.$panels);
	const isQuickHelpOn = useFeatureState(cx.$quickHelp);
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
			<span className="inline-flex" data-quick-help="blender">
				<BlenderChip cx={cx} />
			</span>
			<button
				className="mm-icon-button !h-7 !w-7"
				data-active={isQuickHelpOn}
				aria-pressed={isQuickHelpOn}
				aria-label="Quick Help"
				onClick={() => cx.$quickHelp.set(!isQuickHelpOn)}
				title={`${isQuickHelpOn ? 'Hide' : 'Show'} Quick Help (⇧⌘/)`}
				type="button"
			>
				<CircleHelp size={15} strokeWidth={1.6} />
			</button>
			<button
				className="mm-titlebar-agent"
				data-quick-help="agent"
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
			<ExportButton cx={cx} />
			<span className="mx-1 h-4 w-px bg-[var(--separator)]" />
			<PanelToggle cx={cx} panel="timeline" isOn={panels.timeline} label="Timeline" shortcut="⌃⌘T" icon={<PanelBottom size={16} strokeWidth={1.6} />} />
			<PanelToggle cx={cx} panel="inspector" isOn={panels.inspector} label="Inspector" shortcut="⌃⌘I" icon={<PanelRight size={16} strokeWidth={1.6} />} />
		</header>
	);
};

interface TTitleBarProps {
	cx: StudioCx;
}

/**
 * Centred title like a macOS document window; double-click renames. A saved project autosaves every edit within a
 * second, so it shows no edited dot, which would only flicker; a failed save shows a red "Not Saved". An unsaved
 * document, such as an opened example, shows "Not Saved" once it has changes, like an untitled macOS document's Edited
 */
const DocumentTitle: React.FC<{ cx: StudioCx }> = (props) => {
	const { cx } = props;
	const history = useFeatureState(cx.$history);
	const isTemporary = useFeatureState(cx.$isTemporary);
	const save = useFeatureState(cx.$save);
	const [isRenaming, setIsRenaming] = React.useState(false);
	const title = history?.present.title ?? 'Untitled';
	const isUnsaved = isTemporary && history != null && hasUnsavedChanges(history);

	return (
		<div data-tauri-drag-region className="pointer-events-none absolute inset-x-0 flex justify-center">
			<div
				className="mm-titlebar-title pointer-events-auto"
				onDoubleClick={() => setIsRenaming(true)}
				title={isRenaming ? undefined : isTemporary ? 'Not saved yet. Press ⌘S to choose where to save it' : 'Saved automatically. Double-click to rename'}
			>
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
						{isUnsaved && save !== 'failed' ? <span className="text-[11px] font-normal text-[var(--text-secondary)]">Not Saved</span> : null}
						{save === 'failed' ? <span className="text-[11px] font-normal text-[var(--bad)]">Not Saved</span> : null}
					</>
				)}
			</div>
		</div>
	);
};

/**
 * Blender's state as a dot and one word, like Xcode's activity view; its menu opens the scene in Blender,
 * restarts the worker or shows its log. Without Blender it offers only Install Blender…
 */
const BlenderChip: React.FC<{ cx: StudioCx }> = (props) => {
	const { cx } = props;
	const status = useFeatureState(cx.design.$status);
	const version = useFeatureState(cx.design.$blenderVersion);
	const error = useFeatureState(cx.design.$error);
	const state = blenderState(status, version, error);

	let items: TMenuEntry[];
	if (status === 'missing') {
		items = [{ section: 'Blender Not Installed' }, { label: 'Install Blender…', onSelect: () => void openExternalUrl(BLENDER_DOWNLOAD_URL) }];
	} else {
		const logPath = cx.design.logPath();
		items = [
			{ section: state.detail },
			commandItem(cx, 'design.editInBlender'),
			commandItem(cx, 'design.restartBlender'),
			'separator',
			{
				label: 'Show Blender Log',
				disabled: logPath == null,
				onSelect: () => {
					if (logPath == null) return;
					void host.revealInFinder(logPath).then(([isShownOk, shownErr]) => {
						if (!isShownOk) cx.notify(shownErr.message, 'error');
					});
				}
			}
		];
	}

	return (
		<MenuButton
			className="mm-titlebar-chip"
			title={state.detail}
			align="right"
			label={
				<>
					<span className="mm-titlebar-chip-dot" data-tone={state.tone} />
					<span className="truncate">{state.label}</span>
				</>
			}
			items={items}
		/>
	);
};

/**
 * The window's one accent button. While a film exports with the sheet closed it carries the progress as a
 * small ring, like Final Cut's background tasks; a finished or failed export leaves a dot until the sheet opens
 */
const ExportButton: React.FC<{ cx: StudioCx }> = (props) => {
	const { cx } = props;
	const job = useFeatureState(cx.film.$job);
	const isSheetOpen = useFeatureState(cx.film.$isSheetOpen);
	const isExporting = job.phase === 'preparing' || job.phase === 'rendering' || job.phase === 'encoding';
	const isFinished = job.phase === 'done' || job.phase === 'failed';
	const showsActivity = !isSheetOpen && (isExporting || isFinished);
	const title = !showsActivity ? 'Export the film (⌘E)' : isExporting ? `${exportStatusLabel(job)}. Click to show the export` : job.phase === 'done' ? 'Film exported. Click to show it' : 'Export failed. Click for details';

	return (
		<button
			className="mm-button mm-titlebar-export"
			data-variant="primary"
			data-quick-help="export"
			onClick={() => cx.film.openSheet()}
			title={title}
			aria-label={showsActivity ? title : 'Export Film…'}
			type="button"
		>
			{showsActivity && isExporting ? <ProgressRing progress={job.phase === 'preparing' ? null : job.progress} /> : null}
			{showsActivity && isFinished ? <span className="mm-titlebar-export-dot" data-tone={job.phase === 'done' ? 'good' : 'bad'} /> : null}
			Export Film…
		</button>
	);
};

/** Determinate ring from 0 to 1, or a spinning arc while the length is unknown */
const ProgressRing: React.FC<{ progress: number | null }> = (props) => {
	const { progress } = props;
	const radius = 5.5;
	const length = 2 * Math.PI * radius;
	const value = progress == null ? 0.3 : Math.min(1, Math.max(0, progress));
	return (
		<svg className="mm-progress-ring" data-indeterminate={progress == null} width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
			<circle cx="7" cy="7" r={radius} fill="none" strokeWidth="2" className="mm-progress-ring-track" />
			<circle
				cx="7"
				cy="7"
				r={radius}
				fill="none"
				strokeWidth="2"
				strokeLinecap="round"
				strokeDasharray={`${value * length} ${length}`}
				transform="rotate(-90 7 7)"
				className="mm-progress-ring-value"
			/>
		</svg>
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
