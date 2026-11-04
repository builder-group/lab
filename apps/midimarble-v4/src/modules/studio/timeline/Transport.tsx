import { useFeatureState } from 'feature-react/state';
import type { TBuildProgress } from '@/modules/compose/build-track';
import { addFinishLabel, lanesWithoutFinish } from '@/modules/compose/finish-assist';
import { createState } from 'feature-state';
import { ChevronDown, ChevronFirst, ChevronLast, LoaderCircle, Minus, MoveHorizontal, Pause, Play, Plus, Repeat, SkipBack } from 'lucide-react';
import React from 'react';
import { MenuButton, openContextMenu, type TMenuEntry } from '@/components';
import type { TLastFix, TPieceFixCheck } from '@/modules/compose/AssistCx';
import { blockedScenery } from '@/modules/compose/fix-it';
import { preflightExport, problemSummary } from '@/modules/design/export-preflight';
import { fitToSongOffer } from '@/modules/music';
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
					<RepeatButton cx={cx} />
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
 * to the first problem in time order. Its menu (the chevron or a right-click) lists every problem in time order, scrolling when long, then Show First
 * Problem and Re-place Broken Platforms. Until the run for the current edit arrives it reads "Checking…", and
 * while Re-place runs only its progress line shows, in the notice.
 */
const HitSummary: React.FC<{ cx: StudioCx; project: TProject }> = (props) => {
	const { cx, project } = props;
	const result = useFeatureState(cx.simulation.$result);
	const compose = useFeatureState(cx.$compose);
	const replacing = useFeatureState(compose?.assist.$replacing ?? NO_REPLACING);
	const building = useFeatureState(compose?.assist.$building ?? NO_BUILDING);
	const checks = useFeatureState(compose?.assist.$pieceFixes ?? NO_CHECKS);
	const lastFix = useFeatureState(compose?.assist.$lastFix ?? NO_LAST_FIX);
	const addingFinish = useFeatureState(compose?.assist.$addingFinish ?? NO_ADDING);
	const workspace = useFeatureState(cx.$workspace);
	// While Build Track works the summary only says so, so no step checks the whole run again for it
	const isBuilding = building != null;
	const summary = React.useMemo(() => problemSummary(preflightExport(project, isBuilding ? null : result), workspace === 'compose' ? 'compose' : 'film'), [isBuilding, project, result, workspace]);
	const isCurrent = result != null && result.revision === project.revision;
	// Blocked scenery's Fix-its are tried on a copy of the run before the menu offers them
	const blocked = React.useMemo(() => (isCurrent ? blockedScenery(project, result).map((piece) => piece.entityId) : []), [isCurrent, project, result]);
	React.useEffect(() => {
		if (replacing == null) for (const id of blocked) compose?.assist.checkPieceFix(id);
	}, [blocked, compose, replacing]);
	if (!summary.total && !summary.problems.length && summary.state === 'checked') return null;

	if (replacing != null || building != null || summary.state === 'pending') {
		return (
			<span className="mm-hit-summary" data-tone="pending" role="status" aria-live="polite" data-quick-help="hitSummary">
				<LoaderCircle size={12} strokeWidth={2} className="animate-spin" aria-hidden />
				{building != null ? 'Building…' : replacing != null ? 'Re-placing…' : 'Checking…'}
			</span>
		);
	}
	// The latest fix result and Fit to Song where the user set a length the song no longer matches
	const hasLastFix = lastFix != null && lastFix.projectId === project.id;
	const fitEnd = fitToSongOffer(project);
	// Add Finish for each marble that plays last and has none, so the film ends on the catch
	const unfinished = lanesWithoutFinish(project);
	const extras: TMenuEntry[] = [
		...(compose?.assist.hasOpenHits === true ? [{ label: 'Build Track', shortcut: '⇧N', onSelect: () => void compose.assist.buildTrack() }] : []),
		...unfinished.map((laneId) => ({
			label: addFinishLabel(project, laneId, unfinished.length),
			disabled: compose == null || addingFinish != null,
			onSelect: () => void compose?.assist.addFinish(laneId)
		})),
		...(hasLastFix ? [{ label: 'Show Last Fix', onSelect: () => compose?.assist.showLastFix() }] : []),
		// Ends the film `filmTail` after the last hit, measured with a Finish, like the ruler's Fit to Song
		...(fitEnd != null ? [{ label: 'Fit to Song', onSelect: () => void cx.fitToSong() }] : [])
	];
	// Already in time order, as the summary keeps them
	const problems = summary.problems;
	const first = problems[0];
	if (first == null) {
		return (
			<span className="inline-flex items-center">
				<span className="mm-hit-summary" data-tone={summary.tone} role="status" data-quick-help="hitSummary">
					{summary.label}
				</span>
				{extras.length ? <MenuButton className="mm-icon-button !h-5 !w-5" label={<ChevronDown size={12} strokeWidth={2} />} title="Fixes and length" items={extras} /> : null}
			</span>
		);
	}
	const plan = compose != null && isCurrent ? compose.assist.replacePlan(project, result) : null;
	// A plan of Blocked scenery alone is offered only once a what-if found a fix for one of its pieces
	const sceneryChecks = blocked.map((id) => checks[id]).map((check) => (check?.revision === project.revision ? check.fix : null));
	const isSceneryOnly = plan != null && plan.platforms === 0 && plan.releases.length === 0;
	const sceneryWorks = !isSceneryOnly || sceneryChecks.some((fix) => fix?.commands != null);
	const menu = (): TMenuEntry[] => [
		{ section: problems.length === 1 ? '1 Problem' : `${problems.length} Problems` },
		// Every problem in time order; a long list scrolls inside the menu, like Xcode's issue navigator
		...problems.map((issue) => ({
			label: issue.title,
			disabled: issue.target == null,
			onSelect: () => issue.target != null && cx.revealIssue(issue.target)
		})),
		'separator' as const,
		{ label: 'Show First Problem', onSelect: () => cx.showFirstProblem() },
		{
			// One label with the edit's notice: "Fix 33 Hits", "Move Windmill 1 Clear"
			label: plan == null || plan.isEmpty ? 'Re-place Broken Platforms' : plan.label,
			disabled: plan == null || plan.isEmpty || !sceneryWorks || compose == null || compose.assist.isReplacing,
			onSelect: () => void compose?.assist.replace()
		},
		...extras
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

/** Beside the summary of a project with hits and no Song: it plays silently, so the summary asks for one */
const NO_REPLACING = createState<{ done: number; total: number } | null>(null);
const NO_BUILDING = createState<TBuildProgress | null>(null);
const NO_CHECKS = createState<Record<string, TPieceFixCheck>>({});
const NO_LAST_FIX = createState<TLastFix | null>(null);
const NO_ADDING = createState<string | null>(null);

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

/** Repeat Range: playback loops the range on the ruler, like Logic's cycle button. A preview only, unrelated to Seamless Loop. */
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

/**
 * Playhead position like Logic's LCD: the current time in tabular figures, the length beside it. A click
 * turns it into a field; Return goes to the typed time and Escape cancels.
 */
const TimeReadout: React.FC<{ cx: StudioCx }> = (props) => {
	const { cx } = props;
	const playhead = useFeatureState(cx.$playhead);
	const end = useFeatureState(cx.$history)?.present.end ?? 0;
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
		else if (Math.abs(time - end) > 1e-6) cx.execute([{ type: 'setEnd', end: Math.max(MIN_FILM_LENGTH, time) }]);
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

const MIN_FILM_LENGTH = 0.5;

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
