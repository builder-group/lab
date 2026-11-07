import { useFeatureState } from 'feature-react/state';
import { ChevronDown, ChevronLeft, ChevronRight, FlipHorizontal2, FolderInput } from 'lucide-react';
import React from 'react';
import { ScrubField } from '@/components';
import { hitReach, isUnreachable, pieceProblems, releaseFixFor, struckPieces } from '@/modules/building';
import type { TPiece, TProject, TVec2 } from '@/modules/project';
import type { StudioCx } from '@/modules/studio';
import { toPoints, useRunPreflight } from '@/modules/canvas';
import { normalizeSurfaceAngle, toDegrees, toRadians } from './angles';
import { acceptWords, causeWords, defaultChoice, effectWords, hasStopBeside, isBadProposal, isOverBuilt, passedWords, plainGroupOf, rowWords, senderOf, standingWords, whereTitle, whereWords, BUILD_UP_TO, type TBarRow, type TBarTarget } from './bar';
import { isRowRefused, type TBarAnswer } from './BarCx';
import { GhostPiece } from './GhostLayer';
import { GroupIcon } from './GroupIcon';
import { FLATTEN_HELP } from './PatternsCx';
import { lookStatus, pieceStatus, struckStatus } from './PieceInspector';
import { timingStatus, type TTimingStatus } from './timing-status';
import type { TrackCx } from './TrackCx';
import { unreachableActions } from './unreachable-fixes';

/** The bar: where you are, what's there or would go there, the one platform's Adjust, and its status at the end, floating over the wall's bottom */
export const FloatingBar: React.FC<{ cx: StudioCx }> = (props) => {
	const { cx } = props;
	const state = useFeatureState(cx.bar.$state);
	const trackCx = useFeatureState(cx.$trackCx);
	const project = useFeatureState(cx.$history)?.present;
	const isPlaying = useFeatureState(cx.$playing);
	const building = useFeatureState(cx.assist.$building);
	const trackView = useFeatureState(cx.$trackView);
	const workspace = useFeatureState(cx.$workspace);
	const isStripDragging = useFeatureState(cx.$isStripDragging);
	// A drag, on the wall or in the strip, or a drawn rail has the wall to itself until release
	const { target } = state;
	if (target == null || project == null || trackCx == null || workspace !== 'track' || trackView !== '2d' || isPlaying || building != null || isStripDragging) return null;
	return <BarBody cx={cx} trackCx={trackCx} project={project} target={target} />;
};

const BarBody: React.FC<{ cx: StudioCx; trackCx: TrackCx; project: TProject; target: TBarTarget }> = (props) => {
	const { cx, trackCx, project, target } = props;
	const drag = useFeatureState(trackCx.$drag);
	const pen = useFeatureState(trackCx.$pen);
	const tool = useFeatureState(trackCx.$tool);
	const { menu, isDetailsOpen } = useFeatureState(cx.bar.$state);
	const status = useBarStatus(cx, project, target);
	if (drag != null || pen != null || tool === 'path') return null;
	const piece = target.kind === 'note' ? target.piece : null;
	const group = target.kind === 'rest' ? null : target.group;
	const canAdjust = target.kind === 'note' && piece?.type === 'platform' && target.group == null;
	return (
		<div className="mm-bar mm-ghost-in" role="toolbar" aria-label="Note" onPointerDown={(event) => event.stopPropagation()}>
			<div className="mm-bar-row">
				<button className="mm-bar-arrow" aria-label="Previous Stop" disabled={!hasStopBeside(project, target, -1)} onClick={() => cx.bar.move(-1)} title="Go to the previous note or rest (←)" type="button">
					<ChevronLeft size={14} strokeWidth={1.8} />
				</button>
				<span className="mm-bar-where mm-tabular" aria-label={whereTitle(target)} title={whereTitle(target)}>
					{whereWords(target)}
				</span>
				<button className="mm-bar-arrow" aria-label="Next Stop" disabled={!hasStopBeside(project, target, 1)} onClick={() => cx.bar.move(1)} title="Go to the next note or rest (→)" type="button">
					<ChevronRight size={14} strokeWidth={1.8} />
				</button>
				<span className="mm-bar-divider" />
				<span className="mm-bar-what">
					<BarWhat cx={cx} project={project} target={target} />
				</span>
				{canAdjust && piece != null ? (
					<>
						<span className="mm-bar-divider" />
						<BarAdjust cx={cx} piece={piece} isLastBuilt={target.isLastBuilt} />
					</>
				) : null}
				{group != null ? (
					<>
						<span className="mm-bar-divider" />
						<button className="mm-bar-arrow" aria-label="Flatten" onClick={() => cx.patterns.flatten(group)} title={`Flatten: ${FLATTEN_HELP.charAt(0).toLowerCase()}${FLATTEN_HELP.slice(1)}`} type="button">
							<FolderInput size={14} strokeWidth={1.7} />
						</button>
					</>
				) : null}
				<span className="mm-bar-divider" />
				<StatusMark cx={cx} status={status} isOpen={isDetailsOpen} />
			</div>
			{menu != null ? <BarMenu cx={cx} target={target} rows={menu.rows} index={menu.index} /> : null}
			{isDetailsOpen && status.hasDetails ? <BarDetails cx={cx} status={status} /> : null}
		</div>
	);
};

interface TBarAction {
	label: string;
	title?: string;
	run: () => void;
}

/** What the status mark says: its tone and name, what's wrong and why in a sentence, and what to do about it */
interface TBarStatus {
	tone: TTimingStatus['tone'];
	label: string;
	words: string | null;
	actions: TBarAction[];
	/** Whether the mark opens a popover: only when there's more to say than its color, so On Time is just the mark */
	hasDetails: boolean;
}

/** Kinds that change what stands here rather than place something new: the marble's way here doesn't decide them */
const EDITS: ReadonlySet<string> = new Set(['remove', 'flip', 'fix']);

/**
 * The one status of the bar, first what applies: the report of an edit made right here, then what the choice would do,
 * then how what stands here is doing, from the same problems as the inspector's pill
 */
function useBarStatus(cx: StudioCx, project: TProject, target: TBarTarget): TBarStatus {
	const notice = useFeatureState(cx.$notice);
	const result = useFeatureState(cx.simulation.$result);
	const state = useFeatureState(cx.bar.$state);
	const standing = useStanding(cx, target);
	const sender = senderOf(project, result, target);
	const name = sender?.piece.name ?? 'the piece before';
	const goToSender: TBarAction[] = sender != null ? [{ label: `Go to ${name}`, title: `${name} sends the marble here. Change it there`, run: () => cx.bar.goToStop(sender.stop) }] : [];
	const base: TTimingStatus = standing ?? { tone: 'neutral', label: target.kind === 'rest' ? 'Rest' : 'Open', detail: target.kind === 'rest' ? 'Nothing fills this rest yet' : 'No platform plays this note yet' };
	const fix: TBarAction[] = isOverBuilt(target) ? [{ label: 'Fix', title: 'Show what Fix would change (A)', run: () => cx.bar.fix() }] : [];
	if (notice != null && cx.bar.carriesNotice(notice)) {
		const tone = notice.tone === 'error' ? 'bad' : base.tone;
		const actions = (notice.actions ?? []).map((action) => ({ label: action.label, ...(action.title != null ? { title: action.title } : {}), run: () => { cx.dismissNotice(notice.id); action.run(); } }));
		// The problem's Fix is here, never on the notice
		return { tone, label: notice.tone === 'error' ? 'Problem' : base.label, words: notice.message, actions: tone === 'bad' || tone === 'warn' ? [...fix, ...actions] : actions, hasDetails: true };
	}
	const proposal = state.choice != null ? state.answers[state.choice]?.proposal : undefined;
	if (state.choice != null && proposal != null) {
		const isPassed = state.passed.length > 0 && state.choice === defaultChoice(target, state.passed);
		const passed = isPassed ? passedWords(state.passed.map((kind) => ({ kind, proposal: state.answers[kind]?.proposal })), state.choice) : null;
		const words = [passed, effectWords(target, proposal)].filter((part) => part != null).join(' ') || null;
		const isRefused = proposal.status === 'refused';
		const isBad = isRefused || isBadProposal(proposal);
		const hit = target.kind === 'note' && isRefused ? result?.hits.find((item) => item.marbleId === target.marbleId && item.hitId === target.hitId) : undefined;
		const reach = hit != null ? hitReach(project, result, hit) : null;
		const fixes = hit != null && reach != null && isUnreachable(reach) ? unreachableActions(cx, hit, releaseFixFor(project, hit, reach)) : [];
		if (isBad) return { tone: 'bad', label: isRefused ? "Doesn't Fit" : 'Problem', words, actions: [...fixes, ...(EDITS.has(proposal.ask.kind) ? [] : goToSender)], hasDetails: true };
		if (words != null) return { tone: base.tone, label: base.label, words, actions: [], hasDetails: true };
	}
	if (base.tone === 'bad' || base.tone === 'warn') return { tone: base.tone, label: base.label, words: causeWords(project, target, sender, base), actions: [...fix, ...goToSender], hasDetails: true };
	return { tone: base.tone, label: base.label, words: base.detail ?? null, actions: [], hasDetails: false };
}

/** How what stands here is doing, in the words of the inspector's pill and from the same problems */
function useStanding(cx: StudioCx, target: TBarTarget): TTimingStatus | null {
	const result = useFeatureState(cx.simulation.$result);
	const preflight = useRunPreflight(cx);
	const project = cx.project;
	const struck = React.useMemo(() => (preflight != null ? struckPieces(preflight) : null), [preflight]);
	const looks = React.useMemo(() => (preflight != null ? pieceProblems(preflight) : null), [preflight]);
	if (project == null) return null;
	if (target.kind === 'notes') {
		const hits = result?.hits.filter((hit) => hit.marbleId === target.marbleId && target.hitIds.includes(hit.hitId)) ?? [];
		const worst = hits.find((hit) => hit.status !== 'onTime' && hit.status !== 'open');
		return worst != null ? timingStatus(undefined, worst) : hits.every((hit) => hit.status === 'onTime') ? { tone: 'good', label: 'On Time', detail: `${hits.length} notes on time` } : null;
	}
	const { piece } = target;
	if (piece == null) return null;
	const resolved = result?.pieces.find((item) => item.pieceId === piece.id);
	return lookStatus(struckStatus(pieceStatus(project, piece, resolved, result), struck?.get(piece.id)), looks?.get(piece.id));
}

/** How long the mark pulses after an accept landed a new problem, in milliseconds */
const PULSE_MS = 900;

/** The status at the bar's end, in the shapes and colors of the notes in the timeline; a click opens what's wrong */
const StatusMark: React.FC<{ cx: StudioCx; status: TBarStatus; isOpen: boolean }> = (props) => {
	const { cx, status, isOpen } = props;
	const pulsedAt = useFeatureState(cx.bar.$pulsedAt);
	const isPulsing = pulsedAt > 0 && performance.now() - pulsedAt < PULSE_MS && status.tone === 'bad';
	const title = status.words != null ? `${status.label}: ${status.words}` : status.label;
	// Nothing more to say than its color: just the mark, its words in the tooltip
	if (!status.hasDetails) {
		return (
			<span className="mm-bar-mark" data-tone={status.tone} role="img" aria-label={title} title={title}>
				<StatusGlyph tone={status.tone} />
			</span>
		);
	}
	return (
		<button key={isPulsing ? pulsedAt : 'still'} className="mm-bar-mark" data-tone={status.tone} data-open={isOpen} data-pulse={isPulsing} aria-label={title} aria-haspopup="dialog" aria-expanded={isOpen} onClick={() => cx.bar.toggleDetails()} title={title} type="button">
			<StatusGlyph tone={status.tone} />
		</button>
	);
};

function toneColor(tone: TTimingStatus['tone']): string {
	return tone === 'good' ? 'var(--good)' : tone === 'warn' ? 'var(--warn)' : tone === 'bad' ? 'var(--bad)' : 'var(--text-tertiary)';
}

/**
 * A filled circle in the status color, with "!" when it needs attention, like a macOS status light, so a red one never
 * reads as Stop or Record above the transport; a hollow ring for what's open. The timeline keeps its keyframe shapes
 */
const StatusGlyph: React.FC<{ tone: TTimingStatus['tone'] }> = (props) => {
	const { tone } = props;
	const color = toneColor(tone);
	const isAttention = tone === 'bad' || tone === 'warn';
	return (
		<svg width={14} height={14} viewBox="-7 -7 14 14" aria-hidden>
			{tone === 'neutral' ? <circle r={4.4} fill="none" stroke={color} strokeWidth={1.3} /> : <circle r={tone === 'good' ? 4.5 : 6} fill={color} />}
			{isAttention ? <path d="M 0 -3.3 L 0 0.9 M 0 3.1 L 0 3.2" stroke="white" strokeWidth={1.7} strokeLinecap="round" /> : null}
		</svg>
	);
};

/** The status mark's popover: what's wrong, why, and what to do, above the bar's end so the bar never grows */
const BarDetails: React.FC<{ cx: StudioCx; status: TBarStatus }> = (props) => {
	const { cx, status } = props;
	return (
		<div className="mm-menu mm-bar-details" role="dialog" aria-label={status.label}>
			<div className="mm-bar-details-title" style={{ color: status.tone === 'neutral' ? undefined : toneColor(status.tone) }}>
				<StatusGlyph tone={status.tone} />
				{status.label}
			</div>
			{status.words != null ? <p className="mm-bar-details-words">{status.words}</p> : null}
			{status.actions.length > 0 ? (
				<div className="mm-bar-details-actions">
					{status.actions.map((action, index) => (
						<button
							key={action.label}
							className="mm-notice-action"
							// What to do first, like a dialog's default button; the rest go elsewhere
							data-variant={index === 0 && status.tone !== 'neutral' ? 'primary' : undefined}
							onClick={() => {
								cx.bar.closeDetails();
								action.run();
							}}
							title={action.title}
							type="button"
						>
							{action.label}
						</button>
					))}
				</div>
			) : null}
		</div>
	);
};

const BarWhat: React.FC<{ cx: StudioCx; project: TProject; target: TBarTarget }> = (props) => {
	const { cx, project, target } = props;
	const state = useFeatureState(cx.bar.$state);
	const { choice, answers, queued } = state;
	useFeatureState(cx.simulation.$result);
	const group = target.kind === 'rest' ? null : target.group;
	const isOpen = state.menu != null;
	if (group != null && choice == null) {
		return (
			<span className="mm-bar-what-text" title={`Part of ${group.name}, a live Pattern`}>
				<GroupIcon group={group} />
				<span className="mm-bar-label">{group.name}</span>
			</span>
		);
	}
	const toggle = (
		<button className="mm-bar-chevron" aria-label="Choose" aria-haspopup="menu" aria-expanded={isOpen} data-open={isOpen} onClick={() => cx.bar.toggleMenu()} title="Choose what goes here (⇥)" type="button">
			<ChevronDown size={13} strokeWidth={1.8} />
		</button>
	);
	if (choice != null) {
		const answer = answers[choice];
		const proposal = answer?.proposal ?? null;
		const isRefused = proposal?.status === 'refused' || proposal?.status === 'buildUpTo';
		const isProblem = proposal != null && isBadProposal(proposal);
		const label = acceptWords(project, target, choice, isProblem);
		const isChecking = choice !== BUILD_UP_TO && proposal == null;
		return (
			<span className="mm-bar-split">
				<button className="mm-bar-accept" data-tone={isRefused ? 'none' : isProblem ? 'bad' : 'go'} aria-busy={isChecking} disabled={isRefused && target.kind !== 'rest'} onClick={() => cx.bar.enter()} title={isChecking ? 'Checking it. A press takes it once it plays' : `${label} and go on (⏎)`} type="button">
					<span className="mm-bar-label">{queued > 0 ? `${label} ×${queued}` : label}</span>
					<kbd className="mm-keycap">⏎</kbd>
				</button>
				{toggle}
			</span>
		);
	}
	const plain = plainGroupOf(project, target);
	return (
		<button className="mm-bar-type" aria-haspopup="menu" aria-expanded={isOpen} data-open={isOpen} onClick={() => cx.bar.toggleMenu()} title="Change what stands here (⇥)" type="button">
			{plain != null ? <GroupIcon group={plain} /> : null}
			<span className="mm-bar-label">{standingWords(project, target)}</span>
			<ChevronDown size={13} strokeWidth={1.8} />
		</button>
	);
};

const BarAdjust: React.FC<{ cx: StudioCx; piece: TPiece; isLastBuilt: boolean }> = (props) => {
	const { cx, piece, isLastBuilt } = props;
	const degrees = Math.round(toDegrees(normalizeSurfaceAngle(piece.angle)) * 10) / 10;
	const tilted = (value: number): TProject | null => {
		const { project } = cx;
		return project != null ? { ...project, track: { ...project.track, pieces: project.track.pieces.map((item) => (item.id === piece.id ? { ...item, angle: toRadians(value) } : item)) } } : null;
	};
	return (
		<>
			<span className="mm-bar-tilt">
				<ScrubField
					id="bar-tilt"
					label="∠"
					name="Tilt"
					value={degrees}
					unit="°"
					step={0.5}
					precision={1}
					min={-90}
					max={90}
					onPreview={(value) => {
						const project = tilted(value);
						if (project != null) cx.simulation.startPreview(project);
					}}
					onCommit={(value) => {
						void cx.simulation.landChecked([{ type: 'updatePiece', pieceId: piece.id, patch: { angle: toRadians(value) } }], { label: 'Tilt', anyway: 'Tilt Anyway' });
						cx.simulation.endPreview();
					}}
					onCancel={() => cx.simulation.endPreview()}
				/>
			</span>
			{isLastBuilt ? (
				<button className="mm-bar-arrow" aria-label="Flip" onClick={() => cx.bar.flip()} title="Tilt it the other way (M)" type="button">
					<FlipHorizontal2 size={14} strokeWidth={1.7} />
				</button>
			) : null}
		</>
	);
};

const BarMenu: React.FC<{ cx: StudioCx; target: TBarTarget; rows: TBarRow[]; index: number }> = (props) => {
	const { cx, target, rows, index } = props;
	const { answers, choice } = useFeatureState(cx.bar.$state);
	return (
		<div className="mm-menu mm-bar-menu" role="menu" onPointerLeave={() => cx.bar.hoverRow(rows.findIndex((row) => row.id === choice))}>
			{rows.map((row, rowIndex) => {
				const answer = row.isChoice ? answers[row.id] : undefined;
				const words = row.note ?? (answer?.proposal != null ? rowWords(target, answer.proposal) : row.isChoice && row.id !== BUILD_UP_TO ? 'Checking…' : '');
				// What doesn't fit is greyed out with its reason, as macOS and Figma menus do: no ✓ that reads as the current choice
				const isDisabled = isRowRefused(answer);
				return (
					<React.Fragment key={row.id}>
						{row.isSplit === true && rowIndex > 0 ? <div className="mm-menu-separator" role="separator" /> : null}
						<button
							className="mm-menu-item"
							role="menuitem"
							aria-disabled={isDisabled}
							data-highlighted={rowIndex === index && !isDisabled}
							onPointerEnter={() => cx.bar.hoverRow(rowIndex)}
							onClick={() => {
								if (!isDisabled) cx.bar.runRow(row);
							}}
							title={isDisabled ? `${row.label}: ${words}` : undefined}
							type="button"
						>
							{row.label}
							<span className="mm-bar-row-note" data-bad={isBadAnswer(answer)} title={words}>
								{words}
							</span>
						</button>
					</React.Fragment>
				);
			})}
		</div>
	);
};

function isBadAnswer(answer: TBarAnswer | undefined): boolean {
	return answer?.proposal != null && isBadProposal(answer.proposal) && !isRowRefused(answer);
}

/** The hint on the wall: what's chosen, or the row under the pointer. Nothing here is on the track yet */
export const BarHint: React.FC<{ trackCx: TrackCx }> = (props) => {
	const { trackCx } = props;
	const cx = trackCx.studio;
	const state = useFeatureState(cx.bar.$state);
	const camera = useFeatureState(trackCx.$camera);
	useFeatureState(trackCx.$viewport);
	const override = useFeatureState(trackCx.$override);
	const drag = useFeatureState(trackCx.$drag);
	const isStripDragging = useFeatureState(cx.$isStripDragging);
	// Any drag has the wall to itself: the hint of what's selected waits for the release
	const isDragging = override != null || (drag != null && drag.kind !== 'pan') || isStripDragging;
	const answer = cx.bar.shownAnswer;
	if (answer == null || isDragging || state.target == null) return null;
	const { proposal, shape } = answer;
	const isOk = proposal == null || proposal.status === 'fits';
	const color = cx.project?.marbles.find((marble) => marble.id === state.target?.marbleId)?.labelColor ?? 'var(--text)';
	const flight: TVec2[] = proposal?.flight ?? [];
	return (
		<g className="mm-ghost-in" data-bar-hint={answer.kind} data-shape-ms={answer.shapeMs != null ? Math.round(answer.shapeMs) : undefined} data-answer-ms={answer.answerMs != null ? Math.round(answer.answerMs) : undefined}>
			{flight.length > 1 ? <polyline points={toPoints(flight.map((point) => trackCx.toScreen(point)))} fill="none" stroke={color} strokeWidth={1.25} strokeDasharray="2 4" strokeLinecap="round" opacity={0.7} /> : null}
			{shape.map((piece) => (
				<GhostPiece key={piece.pieceId} trackCx={trackCx} piece={piece} scale={camera.view.scale} isOk={isOk && answer.kind !== 'remove'} color={color} />
			))}
			{proposal?.nextDot != null ? <NextDot position={trackCx.toScreen(proposal.nextDot)} color={color} /> : null}
		</g>
	);
};

const NextDot: React.FC<{ position: TVec2; color: string }> = (props) => {
	const { position, color } = props;
	return <circle cx={position.x} cy={position.y} r={4} fill="var(--canvas)" fillOpacity={0.7} stroke={color} strokeWidth={1.25} strokeDasharray="2 2" />;
};
