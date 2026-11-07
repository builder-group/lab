import { useFeatureState } from 'feature-react/state';
import { House, PanelBottom, PanelLeft, PanelRight, Sparkles } from 'lucide-react';
import React from 'react';
import { MenuButton, RenameField, WindowControlsInset, type TMenuEntry } from '@/components';
import { host } from '@/environment';
import { openExternalUrl } from '@/lib';
import { blenderState, type TBlenderState, exportStatusLabel } from '@/modules/film';
import { workspaceProblems } from '@/modules/building';
import { useRunPreflight } from '@/modules/canvas';
import { agentStatusLine, connectedAgents } from '@/modules/mcp/agent-presence';
import { commandItem } from './commands';
import { hasUnsavedChanges } from './document';
import type { StudioCx, TStudioPanel, TWorkspace } from './StudioCx';

const BLENDER_DOWNLOAD_URL = 'https://www.blender.org/download/';

/**
 * Unified title bar of a one-document window, like a macOS document app: the traffic lights, the sidebar toggle, Home
 * and the workspace switch on the left, as Blender keeps its workspaces in its top bar, the document title with its
 * edited state in the center, then the project's actions on the right: Blender, Agent, Export Film… and the panel
 * toggles. Three columns, so the title stays centered while there is room and truncates instead of reaching a side.
 */
export const TitleBar: React.FC<TTitleBarProps> = (props) => {
	const { cx } = props;
	const panels = useFeatureState(cx.$panels);

	return (
		<header data-tauri-drag-region className="mm-titlebar h-[38px] shrink-0 pr-2 pl-3 select-none">
			<div data-tauri-drag-region className="flex h-full items-center gap-0.5">
				<WindowControlsInset />
				<PanelToggle cx={cx} panel="sidebar" isOn={panels.sidebar} label="Sidebar" shortcut="⌃⌘S" icon={<PanelLeft size={16} strokeWidth={1.6} />} />
				<button className="mm-icon-button !h-7 !w-7" onClick={() => void cx.closeProject()} title="Close the project and show the start screen" aria-label="Home" type="button">
					<House size={15} strokeWidth={1.6} />
				</button>
				<WorkspaceSwitch cx={cx} />
			</div>
			<DocumentTitle cx={cx} />
			<div data-tauri-drag-region className="flex h-full items-center justify-end gap-0.5">
				<span className="inline-flex" data-quick-help="blender">
					<BlenderChip cx={cx} />
				</span>
				<span className="inline-flex" data-quick-help="agent">
					<AgentChip cx={cx} />
				</span>
				<ExportButton cx={cx} />
				<span className="mx-1 h-4 w-px bg-[var(--separator)]" />
				<PanelToggle cx={cx} panel="timeline" isOn={panels.timeline} label="Timeline" shortcut="⌃⌘T" icon={<PanelBottom size={16} strokeWidth={1.6} />} />
				<PanelToggle cx={cx} panel="inspector" isOn={panels.inspector} label="Inspector" shortcut="⌃⌘I" icon={<PanelRight size={16} strokeWidth={1.6} />} />
			</div>
		</header>
	);
};

interface TTitleBarProps {
	cx: StudioCx;
}

const workspaces: { id: TWorkspace; label: string; purpose: string; shortcut: string }[] = [
	{ id: 'track', label: 'Track', purpose: 'Track: shapes and timing, in 2D, 3D or Camera', shortcut: '⌘1' },
	{ id: 'film', label: 'Film', purpose: 'Film: skins, camera and titles', shortcut: '⌘2' }
];

function problemsLabel(workspace: TWorkspace, count: number): string {
	if (workspace === 'track') return count === 1 ? '1 note needs attention' : `${count} notes need attention`;
	return count === 1 ? '1 problem needs attention' : `${count} problems need attention`;
}

/** Track and Film, the window's two workspaces; a quiet amber dot says the other one has problems */
const WorkspaceSwitch: React.FC<{ cx: StudioCx }> = (props) => {
	const { cx } = props;
	const workspace = useFeatureState(cx.$workspace);
	const preflight = useRunPreflight(cx);
	const problems = React.useMemo(() => (preflight != null ? workspaceProblems(preflight) : null), [preflight]);
	return (
		<div className="mm-segmented mm-titlebar-workspace" role="tablist" aria-label="Workspace" data-quick-help="workspace">
			{workspaces.map((item) => {
				// Only the other workspace's problems: the one you are in shows its own in place, like Xcode's tab badges
				const count = item.id === workspace || problems == null ? 0 : problems[item.id];
				const attention = count > 0 ? problemsLabel(item.id, count) : null;
				return (
					<button
						key={item.id}
						data-active={workspace === item.id}
						onClick={() => cx.$workspace.set(item.id)}
						role="tab"
						aria-selected={workspace === item.id}
						data-hint-anchor={item.id === 'film' ? 'film' : undefined}
						title={`${attention != null ? `${attention} · ` : ''}${item.purpose} (${item.shortcut})`}
						type="button"
					>
						{item.label}
						{attention != null ? <span className="mm-titlebar-workspace-dot" role="img" aria-label={attention} /> : null}
					</button>
				);
			})}
		</div>
	);
};

/**
 * Centered title like a macOS document window; double-click renames. A saved project autosaves every edit within a
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
		<div data-tauri-drag-region className="flex h-full min-w-0 items-center justify-center px-2">
			<div
				className="mm-titlebar-title"
				onDoubleClick={() => setIsRenaming(true)}
				title={isRenaming ? undefined : isTemporary ? 'Not saved yet. Press ⌘S to choose where to save it' : 'Saved automatically. Double-click to rename'}
			>
				{isRenaming ? (
					<RenameField
						value={title}
						onDone={(value) => {
							setIsRenaming(false);
							if (value != null && value !== title) cx.execute([{ type: 'updateProject', patch: { title: value } }]);
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
 * Blender's state as its logo tinted by state beside its neutral name, a neutral secondary button like Xcode's activity view: the state
 * word joins it only while Blender works and is otherwise in the tooltip and the menu. The menu opens the scene in
 * Blender, restarts the worker or shows its log. Without Blender it offers only Install Blender…
 */
const BlenderChip: React.FC<{ cx: StudioCx }> = (props) => {
	const { cx } = props;
	const status = useFeatureState(cx.film.$status);
	const version = useFeatureState(cx.film.$blenderVersion);
	const error = useFeatureState(cx.film.$error);
	const isRenderingPreview = useFeatureState(cx.film.live.$isRendering);
	const state = blenderState(status, version, error, isRenderingPreview);
	let items: TMenuEntry[];
	if (status === 'missing') {
		items = [{ section: 'Blender Not Installed' }, { label: 'Install Blender…', onSelect: () => void openExternalUrl(BLENDER_DOWNLOAD_URL) }];
	} else {
		const logPath = cx.film.logPath();
		items = [
			{ section: state.detail },
			commandItem(cx, 'film.editInBlender'),
			commandItem(cx, 'film.restartBlender'),
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
					<BlenderGlyph tone={state.tone} />
					<span>Blender</span>
				</>
			}
			items={items}
		/>
	);
};

/**
 * The person's own AI app as a collaborator: who is connected, and what connects one. Like Blender's button, its
 * glyph is yellow while an agent is connected, through Connect or in a live session, and pulses with a state word only
 * while it is at work.
 */
const AgentChip: React.FC<{ cx: StudioCx }> = (props) => {
	const { cx } = props;
	const isEnabled = useFeatureState(cx.mcp.$isEnabled);
	const clients = useFeatureState(cx.mcp.$clients);
	const connections = useFeatureState(cx.mcp.$connections);
	// The rows read this through the registry
	useFeatureState(cx.mcp.$connecting);
	const isWorking = useFeatureState(cx.mcp.presence.$current) != null;
	const working = useWorkingWord(isWorking ? 'Working' : null);
	const connected = connectedAgents(isEnabled, clients, connections);
	const status = agentStatusLine(isEnabled, connected);

	return (
		<MenuButton
			className="mm-titlebar-chip"
			title={status}
			align="right"
			onOpen={() => void cx.mcp.refreshConnections()}
			label={
				<>
					<Sparkles className="mm-titlebar-agent-glyph" data-connected={connected.length > 0} data-working={isWorking} size={14} strokeWidth={1.7} aria-hidden />
					<span>Agent</span>
					<span className="mm-titlebar-chip-state" data-shown={working.isShown}>
						{working.word}
					</span>
				</>
			}
			items={[{ section: status }, commandItem(cx, 'help.connectClaude'), commandItem(cx, 'help.connectCodex'), commandItem(cx, 'help.copyMcpCommand'), commandItem(cx, 'help.enableMcp'), commandItem(cx, 'agent.showFolder')]}
		/>
	);
};

/** Blender's logo in one color, the state's: its orange when ready, the same pulsing while working, red on error, gray when not installed */
const BlenderGlyph: React.FC<{ tone: TBlenderState['tone'] }> = (props) => (
	<svg className="mm-titlebar-chip-glyph" data-tone={props.tone} width={14} height={14} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
		<path d="M12.51 13.214c.046-.8.438-1.506 1.03-2.006a3.424 3.424 0 0 1 2.212-.79c.85 0 1.631.3 2.211.79.592.5.983 1.206 1.028 2.005.045.823-.285 1.586-.865 2.153a3.389 3.389 0 0 1-2.374.938 3.393 3.393 0 0 1-2.376-.938c-.58-.567-.91-1.33-.865-2.152M7.35 14.831c.006.314.106.922.256 1.398a7.372 7.372 0 0 0 1.593 2.757 8.227 8.227 0 0 0 2.787 2.001 8.947 8.947 0 0 0 3.66.76 8.964 8.964 0 0 0 3.657-.772 8.285 8.285 0 0 0 2.785-2.01 7.428 7.428 0 0 0 1.592-2.762 6.964 6.964 0 0 0 .25-3.074 7.123 7.123 0 0 0-1.016-2.779 7.764 7.764 0 0 0-1.852-2.043h.002L13.566 2.55c-.003-.002-.006-.005-.01-.006-.52-.4-1.396-.398-1.968.002-.58.405-.647 1.074-.132 1.498l-.002.002 3.08 2.503-9.35.01h-.013c-.755.001-1.48.491-1.623 1.112-.148.623.365 1.139 1.15 1.142V8.6l4.739-.01-8.466 6.497-.032.025c-.799.611-1.057 1.628-.554 2.271.511.652 1.597.654 2.403.003L7 12.89s-.067.507-.062.809zm11.886 1.683c-.976.994-2.344 1.557-3.822 1.56-1.48.003-2.85-.555-3.826-1.547a4.548 4.548 0 0 1-1.037-1.623 4.22 4.22 0 0 1-.236-1.799 4.36 4.36 0 0 1 .518-1.705 4.795 4.795 0 0 1 1.177-1.4 5.384 5.384 0 0 1 3.4-1.19 5.363 5.363 0 0 1 3.4 1.18c.52.421.915.897 1.176 1.4.26.518.417 1.085.516 1.705.05.603-.03 1.212-.236 1.799a4.55 4.55 0 0 1-1.034 1.62" />
	</svg>
);

/** Long enough that a quick scene update doesn't resize the button */
const WORKING_SHOW_DELAY_MS = 400;
/** Long enough that a burst of updates reads as one, rather than the button opening and closing */
const WORKING_HOLD_MS = 1000;

/** The state word the Blender button shows: it waits out short work, and keeps its text while the button closes */
function useWorkingWord(label: string | null): { word: string; isShown: boolean } {
	const [word, setWord] = React.useState('');
	const [isShown, setIsShown] = React.useState(false);
	const isWorking = label != null;
	if (label != null && label !== word) setWord(label);

	React.useEffect(() => {
		const timer = window.setTimeout(() => setIsShown(isWorking), isWorking ? WORKING_SHOW_DELAY_MS : WORKING_HOLD_MS);
		return () => window.clearTimeout(timer);
	}, [isWorking]);

	return { word, isShown };
}

/**
 * The window's one accent button. While a film exports with the sheet closed it carries the progress as a
 * small ring, like Final Cut's background tasks; a failed export leaves a dot until the sheet opens
 */
const ExportButton: React.FC<{ cx: StudioCx }> = (props) => {
	const { cx } = props;
	const job = useFeatureState(cx.filmExport.$job);
	const isSheetOpen = useFeatureState(cx.filmExport.$isSheetOpen);
	const isExporting = job.phase === 'preparing' || job.phase === 'rendering' || job.phase === 'encoding';
	const hasFailed = job.phase === 'failed';
	const showsActivity = !isSheetOpen && (isExporting || hasFailed);
	const title = !showsActivity ? 'Export the film (⌘E)' : isExporting ? `${exportStatusLabel(job)}. Click to show the export` : 'Export failed. Click for details';

	return (
		<button
			className="mm-button mm-titlebar-export"
			data-variant="primary"
			data-quick-help="export"
			onClick={() => cx.filmExport.openSheet()}
			title={title}
			aria-label={showsActivity ? title : 'Export Film…'}
			type="button"
		>
			{showsActivity && isExporting ? <ProgressRing progress={job.phase === 'preparing' ? null : job.progress} /> : null}
			{showsActivity && hasFailed ? <span className="mm-titlebar-export-dot" /> : null}
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
