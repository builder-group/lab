import { useFeatureState } from 'feature-react/state';
import { createState } from 'feature-state';
import { ChevronDown, ChevronFirst, ChevronLast, LoaderCircle, Minus, MoveHorizontal, Pause, Play, Plus, SkipBack } from 'lucide-react';
import React from 'react';
import { MenuButton, openContextMenu, type TMenuEntry } from '@/components';
import { preflightExport, problemSummary } from '@/modules/design/export-preflight';
import type { TProject } from '@/modules/project';
import type { THitResult } from '@/modules/simulation';
import { getCommand, type TCommandId } from '../commands';
import { formatTime } from '../format';
import type { StudioCx } from '../StudioCx';
import { parseTime } from './parse-time';
import { sliderToZoom, zoomToSlider } from './timeline-layout';

/**
 * Timeline header like Logic's control bar: the hit summary at the left, Go to Beginning, Previous Hit, Play and
 * Next Hit as plain glyphs beside an LCD time readout in the middle, and Final Cut's zoom slider with Zoom to Fit
 * at the right
 */
export const Transport: React.FC<TTransportProps> = (props) => {
	const { cx, zoom, onZoom, onZoomToFit } = props;
	const playing = useFeatureState(cx.$playing);
	const project = useFeatureState(cx.$history)?.present ?? null;

	return (
		<div className="mm-transport" role="toolbar" aria-label="Transport">
			<div className="flex min-w-0 flex-1 items-center">{project != null ? <HitSummary cx={cx} project={project} /> : null}</div>
			<div className="flex items-center gap-2">
				<div className="flex items-center gap-px" role="group" aria-label="Playback" data-quick-help="transport">
					<TransportButton cx={cx} command="play.start" icon={<SkipBack size={16} strokeWidth={1.75} />} />
					<TransportButton cx={cx} command="play.previousHit" icon={<ChevronFirst size={17} strokeWidth={1.75} />} />
					<TransportButton
						cx={cx}
						command="play.toggle"
						title={playing ? 'Pause' : 'Play'}
						isActive={playing}
						icon={playing ? <Pause size={16} strokeWidth={1.75} fill="currentColor" /> : <Play size={16} strokeWidth={1.75} fill="currentColor" className="translate-x-px" />}
					/>
					<TransportButton cx={cx} command="play.nextHit" icon={<ChevronLast size={17} strokeWidth={1.75} />} />
				</div>
				<TimeReadout cx={cx} />
			</div>
			<div className="flex flex-1 items-center justify-end">
				<ZoomControl zoom={zoom} onZoom={onZoom} onZoomToFit={onZoomToFit} />
			</div>
		</div>
	);
};

interface TTransportProps {
	cx: StudioCx;
	// Hit results of the latest run; null before the first one
	results: THitResult[] | null;
	zoom: number;
	onZoom: (zoom: number) => void;
	onZoomToFit: () => void;
}

/**
 * The hit summary, like Xcode's issue count, read from the same problem model as the export sheet, Layers and
 * the Camera track: "107 of 109 hits on time · 4 other problems", or "2 hits need attention" in amber. A click goes
 * to the first problem in time order. Its menu (the chevron or a right-click) lists every problem, then Show First
 * Problem and Re-place Broken Platforms. Until the run for the current edit arrives it reads "Checking…", and
 * while Re-place runs only its progress line shows, in the notice.
 */
const HitSummary: React.FC<{ cx: StudioCx; project: TProject }> = (props) => {
	const { cx, project } = props;
	const result = useFeatureState(cx.simulation.$result);
	const compose = useFeatureState(cx.$compose);
	const replacing = useFeatureState(compose?.assist.$replacing ?? NO_REPLACING);
	const summary = React.useMemo(() => problemSummary(preflightExport(project, result)), [project, result]);
	if (!summary.total && !summary.problems.length && summary.state === 'checked') return null;

	if (replacing != null || summary.state === 'pending') {
		return (
			<span className="mm-hit-summary" data-tone="pending" role="status" aria-live="polite" data-quick-help="hitSummary">
				<LoaderCircle size={12} strokeWidth={2} className="animate-spin" aria-hidden />
				{replacing != null ? 'Re-placing…' : 'Checking…'}
			</span>
		);
	}
	const first = summary.problems[0];
	if (first == null) {
		return (
			<span className="mm-hit-summary" data-tone={summary.tone} role="status" data-quick-help="hitSummary">
				{summary.label}
			</span>
		);
	}
	const plan = compose != null && result != null && result.revision === project.revision ? compose.assist.replacePlan(project, result) : null;
	const menu = (): TMenuEntry[] => [
		{ section: summary.problems.length === 1 ? '1 Problem' : `${summary.problems.length} Problems` },
		...summary.problems.slice(0, MENU_PROBLEMS).map((issue) => ({
			label: issue.title,
			disabled: issue.target == null,
			onSelect: () => issue.target != null && cx.revealIssue(issue.target)
		})),
		...(summary.problems.length > MENU_PROBLEMS ? [{ label: `${summary.problems.length - MENU_PROBLEMS} more in Export Film…`, onSelect: () => cx.film.openSheet() }] : []),
		'separator' as const,
		{ label: 'Show First Problem', onSelect: () => cx.showFirstProblem() },
		{
			label: plan == null || plan.isEmpty ? 'Re-place Broken Platforms' : `Re-place Broken Platforms (${plan.platforms + plan.scenery.length})`,
			disabled: plan == null || plan.isEmpty || compose == null || compose.assist.isReplacing,
			onSelect: () => void compose?.assist.replace()
		}
	];
	return (
		<span className="inline-flex items-center">
			<button
				className="mm-hit-summary"
				data-tone="warn"
				data-quick-help="hitSummary"
				onClick={() => cx.showFirstProblem()}
				onContextMenu={(event) => openContextMenu(event, menu())}
				title="Show the first problem"
				type="button"
			>
				<span className="mm-hit-summary-dot" aria-hidden />
				{summary.label}
			</button>
			<MenuButton className="mm-icon-button !h-5 !w-5" label={<ChevronDown size={12} strokeWidth={2} />} title="Problems and fixes" items={menu()} />
		</span>
	);
};

// The menu lists this many problems; the export sheet lists them all
const MENU_PROBLEMS = 12;
const NO_REPLACING = createState<{ done: number; total: number } | null>(null);

/** A glyph button that runs a playback command and names it with its shortcut in the tooltip */
const TransportButton: React.FC<{ cx: StudioCx; command: TCommandId; icon: React.ReactNode; title?: string; isActive?: boolean }> = (props) => {
	const { cx, command, icon, title, isActive = false } = props;
	const target = getCommand(command);
	const label = title ?? target.title;
	return (
		<button
			className="mm-transport-button"
			data-active={isActive}
			onClick={() => target.run(cx)}
			title={target.shortcut == null ? label : `${label} (${target.shortcut})`}
			aria-label={label}
			aria-pressed={command === 'play.toggle' ? isActive : undefined}
			type="button"
		>
			{icon}
		</button>
	);
};

/**
 * Playhead position like Logic's LCD: the current time in tabular figures, the length beside it. A click
 * turns it into a field; Return goes to the typed time and Escape cancels.
 */
const TimeReadout: React.FC<{ cx: StudioCx }> = (props) => {
	const { cx } = props;
	const playhead = useFeatureState(cx.$playhead);
	const end = useFeatureState(cx.$history)?.present.end ?? 0;
	const [draft, setDraft] = React.useState<string | null>(null);
	const [isInvalid, setIsInvalid] = React.useState(false);

	function startEditing(): void {
		cx.$playing.set(false);
		setIsInvalid(false);
		setDraft(formatTime(cx.$playhead.get()));
	}

	function commit(): void {
		if (draft == null) return;
		const time = parseTime(draft);
		if (time == null) {
			setIsInvalid(true);
			return;
		}
		cx.$playhead.set(Math.min(end, time));
		setDraft(null);
	}

	return (
		<div className="mm-lcd" data-editing={draft != null} data-invalid={isInvalid}>
			{draft != null ? (
				<input
					className="mm-lcd-input"
					value={draft}
					aria-label="Go to time"
					spellCheck={false}
					autoFocus
					onFocus={(event) => event.currentTarget.select()}
					onChange={(event) => {
						setIsInvalid(false);
						setDraft(event.target.value);
					}}
					onKeyDown={(event) => {
						event.stopPropagation();
						if (event.key === 'Enter') {
							event.preventDefault();
							commit();
						} else if (event.key === 'Escape') {
							event.preventDefault();
							setDraft(null);
						}
					}}
					onBlur={() => setDraft(null)}
				/>
			) : (
				<button
					className="mm-lcd-time"
					onClick={startEditing}
					title="Playhead position. Click to type a time."
					aria-label={`Playhead at ${formatTime(playhead)}. Click to type a time.`}
					type="button"
				>
					{formatTime(playhead)}
				</button>
			)}
			<span className="mm-lcd-length" title="Project length">
				{formatTime(end)}
			</span>
		</div>
	);
};

/** Final Cut's timeline zoom: a slider between − and + glyphs, then Zoom to Fit */
const ZoomControl: React.FC<{ zoom: number; onZoom: (zoom: number) => void; onZoomToFit: () => void }> = (props) => {
	const { zoom, onZoom, onZoomToFit } = props;
	const position = zoomToSlider(zoom);
	return (
		<div className="flex items-center gap-1" role="group" aria-label="Timeline zoom">
			<button className="mm-icon-button !h-6 !w-6" onClick={() => onZoom(zoom / 1.5)} title="Zoom Out (⌘ Scroll)" aria-label="Zoom Out" type="button">
				<Minus size={13} strokeWidth={1.75} />
			</button>
			<input
				className="mm-slider mm-zoom-slider"
				type="range"
				min={0}
				max={1000}
				value={Math.round(position * 1000)}
				style={{ ['--fill' as string]: `${position * 100}%` }}
				onChange={(event) => onZoom(sliderToZoom(Number(event.target.value) / 1000))}
				aria-label="Zoom"
				title="Zoom (pinch or ⌘ Scroll)"
			/>
			<button className="mm-icon-button !h-6 !w-6" onClick={() => onZoom(zoom * 1.5)} title="Zoom In (⌘ Scroll)" aria-label="Zoom In" type="button">
				<Plus size={13} strokeWidth={1.75} />
			</button>
			<span className="mx-1 h-4 w-px bg-[var(--separator)]" />
			<button className="mm-icon-button !h-6 !w-6" onClick={onZoomToFit} title="Zoom to Fit" aria-label="Zoom to Fit" type="button">
				<MoveHorizontal size={15} strokeWidth={1.75} />
			</button>
		</div>
	);
};
