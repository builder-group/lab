import { useFeatureState } from 'feature-react/state';
import { ChevronDown, ChevronFirst, ChevronLast, Minus, MoveHorizontal, Pause, Play, Plus, SkipBack } from 'lucide-react';
import React from 'react';
import { MenuButton, openContextMenu, type TMenuEntry } from '@/components';
import { brokenHits } from '@/modules/compose/fix-it';
import { unreachableHits } from '@/modules/compose/reachability';
import type { THitResult } from '@/modules/simulation';
import { getCommand, type TCommandId } from '../commands';
import { formatTime } from '../format';
import { toHitKey } from '../selection';
import type { StudioCx } from '../StudioCx';
import { hitSummary } from './hit-status';
import { parseTime } from './parse-time';
import { sliderToZoom, zoomToSlider } from './timeline-layout';

/**
 * Timeline header like Logic's control bar: the hit summary at the left, Go to Beginning, Previous Hit, Play and
 * Next Hit as plain glyphs beside an LCD time readout in the middle, and Final Cut's zoom slider with Zoom to Fit
 * at the right
 */
export const Transport: React.FC<TTransportProps> = (props) => {
	const { cx, results, zoom, onZoom, onZoomToFit } = props;
	const playing = useFeatureState(cx.$playing);

	return (
		<div className="mm-transport" role="toolbar" aria-label="Transport">
			<div className="flex min-w-0 flex-1 items-center">{results != null && results.length > 0 ? <HitSummary cx={cx} results={results} /> : null}</div>
			<div className="flex items-center gap-2">
				<div className="flex items-center gap-px" role="group" aria-label="Playback" data-quick-help="transport">
					<TransportButton cx={cx} command="play.start" icon={<SkipBack size={16} strokeWidth={1.75} />} />
					<TransportButton cx={cx} command="play.previousHit" icon={<ChevronFirst size={17} strokeWidth={1.75} />} />
					<TransportButton
						cx={cx}
						command="play.toggle"
						title={playing ? 'Pause' : 'Play'}
						isActive={playing}
						icon={
							playing ? (
								<Pause size={16} strokeWidth={1.75} fill="currentColor" />
							) : (
								<Play size={16} strokeWidth={1.75} fill="currentColor" className="translate-x-px" />
							)
						}
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
 * "12 of 12 hits on time", or "2 hits need attention" in amber, which selects and reveals the first problem hit
 * and moves the playhead to it, like Xcode's issue count. Its menu (the chevron or a right-click) also offers
 * Re-place Broken Platforms, the Fix-it for a run an edit broke.
 */
const HitSummary: React.FC<{ cx: StudioCx; results: THitResult[] }> = (props) => {
	const { cx, results } = props;
	const project = useFeatureState(cx.$history)?.present ?? null;
	const compose = useFeatureState(cx.$compose);
	const summary = React.useMemo(() => hitSummary(results, project == null ? [] : unreachableHits(project, cx.simulation.$result.get())), [results, project, cx]);
	const first = summary.problems[0];
	const isGood = first == null && summary.onTime === summary.total;

	if (first == null) {
		return (
			<span className="mm-hit-summary" data-tone={isGood ? 'good' : 'neutral'} role="status" data-quick-help="hitSummary">
				{summary.label}
			</span>
		);
	}
	const reveal = (hit: THitResult): void => cx.revealIssue({ ids: [hit.pieceEntityId ?? toHitKey(hit.laneId, hit.hitId)], point: hit.dot ?? undefined, time: hit.targetTime });
	const broken = brokenHits(results).length;
	const menu = (): TMenuEntry[] => [
		{ label: 'Show First Problem', onSelect: () => reveal(first) },
		{
			label: broken > 0 ? `Re-place Broken Platforms (${broken})` : 'Re-place Broken Platforms',
			disabled: broken === 0 || compose == null || compose.assist.isReplacing,
			onSelect: () => void compose?.assist.replace()
		}
	];
	return (
		<span className="inline-flex items-center">
			<button
				className="mm-hit-summary"
				data-tone="warn"
				data-quick-help="hitSummary"
				onClick={() => reveal(first)}
				onContextMenu={(event) => openContextMenu(event, menu())}
				title="Show the first hit that needs attention"
				type="button"
			>
				<span className="mm-hit-summary-dot" aria-hidden />
				{summary.label}
			</button>
			<MenuButton className="mm-icon-button !h-5 !w-5" label={<ChevronDown size={12} strokeWidth={2} />} title="Fix the hits that need attention" items={menu()} />
		</span>
	);
};

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
				<button className="mm-lcd-time" onClick={startEditing} title="Playhead position. Click to type a time." aria-label={`Playhead at ${formatTime(playhead)}. Click to type a time.`} type="button">
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
