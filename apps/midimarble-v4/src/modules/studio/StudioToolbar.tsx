import { useFeatureState } from 'feature-react/state';
import { PanelBottom, PanelLeft, PanelRight, Pause, Play, Share, SkipBack } from 'lucide-react';
import React from 'react';
import { WindowControlsInset } from '@/components';
import { ActivityView } from '@/modules/design/ActivityView';
import { formatTime } from './format';
import type { StudioCx, TStudioPanel, TWorkspace } from './StudioCx';

/** Unified toolbar: sidebar toggle and document title, workspace switcher, transport, panel toggles */
export const StudioToolbar: React.FC<TStudioToolbarProps> = (props) => {
	const { cx } = props;
	const title = useFeatureState(cx.$history)?.present.title ?? 'Untitled';
	const save = useFeatureState(cx.$save);
	const workspace = useFeatureState(cx.$workspace);
	const playing = useFeatureState(cx.$playing);
	const panels = useFeatureState(cx.$panels);

	return (
		<header data-tauri-drag-region className="flex h-[52px] shrink-0 items-center gap-1 px-2 select-none">
			<WindowControlsInset />
			<PanelToggle cx={cx} panel="sidebar" isOn={panels.sidebar} label="Sidebar" shortcut="⌃⌘S" icon={<PanelLeft size={16} strokeWidth={1.6} />} />
			<div data-tauri-drag-region className="ml-1 flex min-w-0 flex-col leading-tight">
				<span data-tauri-drag-region className="truncate font-semibold">
					{title}
				</span>
				<span data-tauri-drag-region className="text-[11px] text-[var(--text-secondary)]">
					{saveLabels[save]}
				</span>
			</div>
			<div data-tauri-drag-region className="flex flex-1 items-center justify-center gap-3">
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
				<ActivityView cx={cx} />
			</div>
			<div className="flex items-center" role="group" aria-label="Transport">
				<button className="mm-icon-button" onClick={() => cx.$playhead.set(0)} title="Go to Beginning (↩)" aria-label="Go to Beginning" type="button">
					<SkipBack size={15} strokeWidth={1.8} />
				</button>
				<button className="mm-icon-button" onClick={() => cx.stepHit(-1)} title="Previous Hit (←)" aria-label="Previous Hit" type="button">
					<JumpHitIcon direction={-1} />
				</button>
				<button
					className="mm-icon-button"
					onClick={() => cx.$playing.set(!playing)}
					title={playing ? 'Pause (Space)' : 'Play (Space)'}
					aria-label={playing ? 'Pause' : 'Play'}
					type="button"
				>
					{playing ? <Pause size={15} strokeWidth={1.8} /> : <Play size={15} strokeWidth={1.8} />}
				</button>
				<button className="mm-icon-button" onClick={() => cx.stepHit(1)} title="Next Hit (→)" aria-label="Next Hit" type="button">
					<JumpHitIcon direction={1} />
				</button>
			</div>
			<TimeDisplay cx={cx} />
			<div className="ml-1 flex items-center">
				<button className="mm-icon-button" onClick={() => cx.film.openSheet()} title="Export Film (⌘E)" aria-label="Export Film" type="button">
					<Share size={15} strokeWidth={1.7} />
				</button>
				<PanelToggle cx={cx} panel="timeline" isOn={panels.timeline} label="Timeline" shortcut="⌃⌘T" icon={<PanelBottom size={16} strokeWidth={1.6} />} />
				<PanelToggle cx={cx} panel="inspector" isOn={panels.inspector} label="Inspector" shortcut="⌃⌘I" icon={<PanelRight size={16} strokeWidth={1.6} />} />
			</div>
		</header>
	);
};

interface TStudioToolbarProps {
	cx: StudioCx;
}

const PanelToggle: React.FC<{ cx: StudioCx; panel: TStudioPanel; isOn: boolean; label: string; shortcut: string; icon: React.ReactNode }> = (props) => {
	const { cx, panel, isOn, label, shortcut, icon } = props;
	return (
		<button
			className="mm-icon-button"
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

/** Position readout in its own component so playback ticks re-render only this text, like Logic's LCD */
const TimeDisplay: React.FC<{ cx: StudioCx }> = (props) => {
	const { cx } = props;
	const playhead = useFeatureState(cx.$playhead);
	return (
		<output
			className="mm-tabular ml-1 inline-flex h-[26px] w-[78px] items-center justify-center rounded-[6px] bg-[var(--hover)] font-medium"
			aria-label="Playhead position"
			title="Playhead position (minutes:seconds)"
		>
			{formatTime(playhead)}
		</output>
	);
};

/** Blender's jump-to-keyframe glyph: a triangle and a hit diamond, drawn in the lucide stroke style */
const JumpHitIcon: React.FC<{ direction: 1 | -1 }> = (props) => {
	const { direction } = props;
	return (
		<svg
			width={15}
			height={15}
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth={1.8}
			strokeLinejoin="round"
			style={{ transform: direction === -1 ? 'scaleX(-1)' : undefined }}
		>
			<path d="M4 7l6 5-6 5z" fill="currentColor" />
			<path d="M16.5 7l5 5-5 5-5-5z" />
		</svg>
	);
};

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
