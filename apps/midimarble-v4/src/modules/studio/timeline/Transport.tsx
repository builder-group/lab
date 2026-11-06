import { useFeatureState } from 'feature-react/state';
import { ChevronDown, ChevronFirst, ChevronLast, LoaderCircle, Minus, MoveHorizontal, Pause, Play, Plus, Repeat, SkipBack, Smartphone } from 'lucide-react';
import React from 'react';
import { MenuButton, openContextMenu } from '@/components';
import { problemSummary } from '@/modules/building';
import type { THitResult } from '@/modules/simulation';
import { getCommand, type TCommandId } from '../commands';
import { problemMenu } from '../menus';
import { askedFilmLength, formatTime, parseTime } from '@/modules/project';
import type { StudioCx } from '../StudioCx';
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
			<div className="flex min-w-0 flex-1 items-center">{project != null ? <HitSummary cx={cx} /> : null}</div>
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
					<RepeatButton cx={cx} />
					<PhoneSpeakerButton cx={cx} />
				</div>
				<TimeReadout cx={cx} />
			</div>
			<div className="mm-transport-end flex flex-1 items-center justify-end">
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
 * the Camera track: "107 of 109 hits on time · 4 other problems", or "2 hits need attention" in amber. With problems a
 * click goes to the first in time order, and the chevron or a right-click lists them all. Until the run for the current
 * edit arrives it reads "Checking…", and while Fix runs only its progress line shows, in the notice.
 */
const HitSummary: React.FC<{ cx: StudioCx }> = (props) => {
	const { cx } = props;
	// Build Track and Fix say how far they are in the notice, the one place for progress; the count waits until they end
	const fixing = useFeatureState(cx.assist.$fixing);
	const building = useFeatureState(cx.assist.$building);
	const workspace = useFeatureState(cx.$workspace);
	const problems = useFeatureState(cx.simulation.$problems);
	const summary = React.useMemo(() => problemSummary(problems, workspace), [problems, workspace]);
	if (!summary.total && !summary.problems.length && summary.state === 'checked') return null;

	if (fixing != null || building != null || summary.state === 'pending') {
		return (
			<span className="mm-hit-summary" data-tone="pending" role="status" aria-live="polite" data-quick-help="hitSummary">
				<LoaderCircle size={12} strokeWidth={2} className="animate-spin" aria-hidden />
				Checking…
			</span>
		);
	}
	if (!summary.problems.length) {
		return (
			<span className="mm-hit-summary" data-tone={summary.tone} role="status" title={summary.label} data-quick-help="hitSummary" onContextMenu={(event) => openContextMenu(event, problemMenu(cx))}>
				<span className="min-w-0 truncate">{summary.label}</span>
			</span>
		);
	}
	return (
		<span className="mm-hit-summary-group" data-quick-help="hitSummary" onContextMenu={(event) => openContextMenu(event, problemMenu(cx))}>
			<button className="mm-hit-summary" data-tone="warn" onClick={() => cx.showFirstProblem()} title="Show the first problem" type="button">
				<span className="mm-hit-summary-dot" aria-hidden />
				<span className="min-w-0 truncate">{summary.label}</span>
			</button>
			<MenuButton className="mm-hit-summary mm-hit-summary-chevron" title="Show every problem" items={problemMenu(cx)} label={<ChevronDown size={12} strokeWidth={2} />} />
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

/** Repeat Range: playback loops the range on the ruler, like Logic's cycle button. A preview only. */
const RepeatButton: React.FC<{ cx: StudioCx }> = (props) => {
	const { cx } = props;
	useFeatureState(cx.$repeatRange);
	useFeatureState(cx.$history);
	const target = getCommand('play.repeat');
	const isOn = target.isChecked?.(cx) === true;
	return (
		<button className="mm-transport-button" data-repeat={isOn} onClick={() => target.run(cx)} title={`Repeat: play a range on the ruler again and again (${target.shortcut ?? ''})`} aria-label={target.title} aria-pressed={isOn} type="button">
			<Repeat size={15} strokeWidth={1.75} />
		</button>
	);
};

/** Phone Speaker: hear the song as a phone plays it, with little under 300 Hz. A preview only. */
const PhoneSpeakerButton: React.FC<{ cx: StudioCx }> = (props) => {
	const { cx } = props;
	const isOn = useFeatureState(cx.$phoneSpeaker);
	const target = getCommand('play.phoneSpeaker');
	return (
		<button className="mm-transport-button" data-repeat={isOn} onClick={() => target.run(cx)} title="Phone Speaker: hear the song as a phone plays it. The film doesn't change" aria-label={target.title} aria-pressed={isOn} type="button">
			<Smartphone size={15} strokeWidth={1.75} />
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
	const end = useFeatureState(cx.$history)?.present.length ?? 0;
	const [draft, setDraft] = React.useState<{ field: 'playhead' | 'length'; text: string } | null>(null);
	const [isInvalid, setIsInvalid] = React.useState(false);

	function startEditing(field: 'playhead' | 'length'): void {
		if (field === 'playhead') cx.$playing.set(false);
		setIsInvalid(false);
		setDraft({ field, text: formatTime(field === 'playhead' ? cx.$playhead.get() : end) });
	}

	function commit(): void {
		if (draft == null) return;
		const time = parseTime(draft.text);
		if (time == null) {
			setIsInvalid(true);
			return;
		}
		if (draft.field === 'playhead') cx.seek(Math.min(end, time));
		else {
			const length = askedFilmLength(time, end);
			if (Math.abs(length - end) > 1e-6) cx.execute([{ type: 'updateProject', patch: { length } }]);
		}
		setDraft(null);
	}

	const input = (field: 'playhead' | 'length', className: string, label: string): React.ReactElement => (
		<input
			className={className}
			value={draft?.text ?? ''}
			aria-label={label}
			aria-invalid={isInvalid}
			title={isInvalid ? 'Type a time like 1:23.45, 1:23 or seconds' : undefined}
			spellCheck={false}
			autoFocus
			data-field={field}
			onFocus={(event) => event.currentTarget.select()}
			onChange={(event) => {
				setIsInvalid(false);
				setDraft({ field, text: event.target.value });
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
	);

	return (
		<div className="mm-lcd" data-editing={draft != null} data-invalid={isInvalid}>
			{draft?.field === 'playhead' ? (
				input('playhead', 'mm-lcd-input', 'Go to time')
			) : (
				<button className="mm-lcd-time" onClick={() => startEditing('playhead')} title="Playhead position. Click to type a time." aria-label={`Playhead at ${formatTime(playhead)}. Click to type a time.`} type="button">
					{formatTime(playhead)}
				</button>
			)}
			{draft?.field === 'length' ? (
				input('length', 'mm-lcd-length mm-lcd-length-input', 'Film length')
			) : (
				<button className="mm-lcd-length" onClick={() => startEditing('length')} title="Film length. Click to type it, or drag the end marker on the ruler." aria-label={`Film length ${formatTime(end)}. Click to type it.`} type="button">
					{formatTime(end)}
				</button>
			)}
		</div>
	);
};

/** Final Cut's timeline zoom: a slider between − and + glyphs, then Zoom to Fit */
const ZoomControl: React.FC<{ zoom: number; onZoom: (zoom: number) => void; onZoomToFit: () => void }> = (props) => {
	const { zoom, onZoom, onZoomToFit } = props;
	const position = zoomToSlider(zoom);
	return (
		<div className="flex items-center gap-1" role="group" aria-label="Timeline zoom">
			<span className="mm-zoom-range flex items-center gap-1">
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
			</span>
			<button className="mm-icon-button !h-6 !w-6" onClick={onZoomToFit} title="Zoom to Fit" aria-label="Zoom to Fit" type="button">
				<MoveHorizontal size={15} strokeWidth={1.75} />
			</button>
		</div>
	);
};
