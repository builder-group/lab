import { useFeatureState } from 'feature-react/state';
import { Check, ChevronDown, ChevronLeft, ChevronRight, FlipHorizontal2, Wand2, X } from 'lucide-react';
import React from 'react';
import { ScrubField } from '@/components';
import { canMakeBacking, hitReach, isUnreachable, releaseFixFor, type TProposal } from '@/modules/building';
import type { TPiece, TProject, TVec2 } from '@/modules/project';
import type { StudioCx } from '@/modules/studio';
import { toPoints } from '@/modules/canvas';
import { normalizeSurfaceAngle, toDegrees, toRadians } from './angles';
import { acceptWords, effectWords, hasStopBeside, rowWords, standingWords, whereWords, BUILD_UP_TO, type TBarRow, type TBarTarget } from './bar';
import type { TBarAnswer } from './BarCx';
import { GhostPiece } from './GhostLayer';
import { FLATTEN_HELP } from './PatternsCx';
import { timingStatus, type TTimingStatus } from './timing-status';
import type { TrackCx } from './TrackCx';
import { unreachableActions } from './unreachable-fixes';

/** The bar: where you are, what's there or would go there, and the one platform's Adjust, floating over the wall's bottom */
export const FloatingBar: React.FC<{ cx: StudioCx }> = (props) => {
	const { cx } = props;
	const state = useFeatureState(cx.bar.$state);
	const trackCx = useFeatureState(cx.$trackCx);
	const project = useFeatureState(cx.$history)?.present;
	const isPlaying = useFeatureState(cx.$playing);
	const building = useFeatureState(cx.assist.$building);
	const trackView = useFeatureState(cx.$trackView);
	const workspace = useFeatureState(cx.$workspace);
	// A drag or a drawn rail has the wall to itself
	const { target } = state;
	if (target == null || project == null || trackCx == null || workspace !== 'track' || trackView !== '2d' || isPlaying || building != null) return null;
	return <BarBody cx={cx} trackCx={trackCx} project={project} target={target} />;
};

const BarBody: React.FC<{ cx: StudioCx; trackCx: TrackCx; project: TProject; target: TBarTarget }> = (props) => {
	const { cx, trackCx, project, target } = props;
	const drag = useFeatureState(trackCx.$drag);
	const pen = useFeatureState(trackCx.$pen);
	const tool = useFeatureState(trackCx.$tool);
	const { menu } = useFeatureState(cx.bar.$state);
	if (drag != null || pen != null || tool === 'path') return null;
	const piece = target.kind === 'note' ? target.piece : null;
	const canAdjust = target.kind === 'note' && piece?.type === 'platform' && target.group == null;
	return (
		<div className="mm-bar mm-ghost-in" role="toolbar" aria-label="Note" data-quick-help="bar" onPointerDown={(event) => event.stopPropagation()}>
			<BarLine cx={cx} project={project} target={target} />
			<div className="mm-bar-row">
				<button className="mm-bar-arrow" aria-label="Previous Stop" disabled={!hasStopBeside(project, target, -1)} onClick={() => cx.bar.move(-1)} title="Go to the previous note or rest (←)" type="button">
					<ChevronLeft size={14} strokeWidth={1.8} />
				</button>
				<span className="mm-bar-where mm-tabular">{whereWords(target)}</span>
				<button className="mm-bar-arrow" aria-label="Next Stop" disabled={!hasStopBeside(project, target, 1)} onClick={() => cx.bar.move(1)} title="Go to the next note or rest (→)" type="button">
					<ChevronRight size={14} strokeWidth={1.8} />
				</button>
				<span className="mm-bar-divider" />
				<BarWhat cx={cx} project={project} target={target} />
				{canAdjust && piece != null ? (
					<>
						<span className="mm-bar-divider" />
						<BarAdjust cx={cx} piece={piece} isLastBuilt={target.isLastBuilt} />
					</>
				) : null}
			</div>
			{menu != null ? <BarMenu cx={cx} project={project} target={target} rows={menu.rows} index={menu.index} /> : null}
		</div>
	);
};

/** Anything about this note: a notice of the edit just made, or what the choice would do, or what's wrong with what stands */
const BarLine: React.FC<{ cx: StudioCx; project: TProject; target: TBarTarget }> = (props) => {
	const { cx, project, target } = props;
	const notice = useFeatureState(cx.$notice);
	const selection = useFeatureState(cx.$selection);
	const result = useFeatureState(cx.simulation.$result);
	const state = useFeatureState(cx.bar.$state);
	const answer = state.choice != null ? state.answers[state.choice] : undefined;
	if (notice != null && cx.bar.carriesNotice(notice)) {
		return (
			<div className="mm-bar-line" data-tone={notice.tone === 'error' ? 'bad' : undefined}>
				<span className="truncate" title={notice.message}>
					{notice.message}
				</span>
				{(notice.actions ?? []).map((action) => (
					<button
						key={action.label}
						className="mm-notice-action"
						onClick={() => {
							cx.dismissNotice(notice.id);
							action.run();
						}}
						title={action.title}
						type="button"
					>
						{action.label}
					</button>
				))}
			</div>
		);
	}
	const proposal = answer?.proposal;
	const words = proposal != null ? effectWords(project, target, proposal) : null;
	if (words != null) {
		const hit = target.kind === 'note' && proposal?.status === 'refused' ? result?.hits.find((item) => item.marbleId === target.marbleId && item.hitId === target.hitId) : undefined;
		const reach = hit != null ? hitReach(project, result, hit) : null;
		const fixes = hit != null && reach != null && isUnreachable(reach) ? unreachableActions(cx, hit, canMakeBacking(project) ? releaseFixFor(project, hit, reach) : null) : [];
		return (
			<div className="mm-bar-line" data-tone={proposal?.status === 'fits' ? undefined : 'bad'}>
				<span className="truncate" title={words}>
					{words}
				</span>
				{fixes.map((action) => (
					<button key={action.label} className="mm-notice-action" onClick={action.run} title={action.title} type="button">
						{action.label}
					</button>
				))}
			</div>
		);
	}
	if (selection.length === 0 || state.choice != null) return null;
	const status = standingStatus(cx, target);
	if (status == null || status.tone === 'good' || status.tone === 'neutral' || status.detail == null) return null;
	return (
		<div className="mm-bar-line" data-tone="bad">
			<span className="truncate" title={status.detail}>
				{status.detail}
			</span>
		</div>
	);
};

/** How what stands on a note is doing, in the words of the inspector's pill */
function standingStatus(cx: StudioCx, target: TBarTarget): TTimingStatus | null {
	const result = cx.simulation.$result.get();
	if (target.kind === 'rest') {
		const resolved = result?.pieces.find((item) => item.pieceId === target.piece?.id);
		return target.piece != null ? timingStatus(resolved, undefined, { piece: target.piece.name ?? 'This piece' }) : null;
	}
	if (target.kind === 'notes') {
		const hits = result?.hits.filter((hit) => hit.marbleId === target.marbleId && target.hitIds.includes(hit.hitId)) ?? [];
		const worst = hits.find((hit) => hit.status !== 'onTime' && hit.status !== 'open');
		return worst != null ? timingStatus(undefined, worst) : hits.every((hit) => hit.status === 'onTime') ? { tone: 'good', label: 'On Time' } : { tone: 'neutral', label: 'Open' };
	}
	const hit = result?.hits.find((item) => item.marbleId === target.marbleId && item.hitId === target.hitId);
	const resolved = result?.pieces.find((item) => item.pieceId === target.piece?.id);
	const marble = cx.project?.marbles.find((item) => item.id === target.marbleId)?.name;
	return target.piece != null ? timingStatus(resolved, hit, { ...(marble != null ? { marble } : {}), piece: target.piece.name ?? 'This piece' }) : null;
}

const BarWhat: React.FC<{ cx: StudioCx; project: TProject; target: TBarTarget }> = (props) => {
	const { cx, project, target } = props;
	const state = useFeatureState(cx.bar.$state);
	const { choice, answers, queued } = state;
	useFeatureState(cx.simulation.$result);
	const group = target.kind === 'rest' ? null : target.group;
	const status = standingStatus(cx, target);
	const isOpen = state.menu != null;
	if (group != null && choice == null) {
		return (
			<>
				<span className="mm-bar-what-text">Part of {group.name}</span>
				<button className="mm-notice-action" onClick={() => cx.patterns.flatten(group)} title={FLATTEN_HELP} type="button">
					Flatten
				</button>
				<NoteMark status={status} />
			</>
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
				<button className="mm-bar-accept" data-tone={isRefused ? 'none' : isProblem ? 'bad' : 'go'} aria-busy={isChecking} disabled={isRefused && target.kind !== 'rest'} onClick={() => cx.bar.enter()} title={isChecking ? 'Checking it. A press takes it once it plays' : `${label} and go on (↩)`} type="button">
					{queued > 0 ? <span className="mm-tabular">{label} ×{queued}</span> : label}
					<kbd className="mm-keycap">↩</kbd>
				</button>
				{toggle}
			</span>
		);
	}
	return (
		<>
			<button className="mm-bar-type" aria-haspopup="menu" aria-expanded={isOpen} data-open={isOpen} onClick={() => cx.bar.toggleMenu()} title="Change what stands here (⇥)" type="button">
				{standingWords(project, target)}
				<ChevronDown size={13} strokeWidth={1.8} />
			</button>
			<NoteMark status={status} />
			{status?.tone === 'bad' || status?.tone === 'warn' ? (
				<button className="mm-bar-fix" onClick={() => cx.assist.fixSelection()} title={status.detail ?? 'Fix this'} type="button">
					<Wand2 size={12} strokeWidth={1.8} />
					Fix
				</button>
			) : null}
		</>
	);
};

/** A note's status in the shapes and colors its row in the timeline has, with a word only when something's wrong */
const NoteMark: React.FC<{ status: TTimingStatus | null }> = (props) => {
	const { status } = props;
	if (status == null) return null;
	const color = status.tone === 'good' ? 'var(--good)' : status.tone === 'warn' ? 'var(--warn)' : status.tone === 'bad' ? 'var(--bad)' : 'var(--text-tertiary)';
	return (
		<span className="mm-bar-mark" role="img" aria-label={status.label} title={status.detail ?? status.label}>
			<svg width={12} height={12} viewBox="-6 -6 12 12" aria-hidden>
				{status.tone === 'bad' ? <rect x={-4} y={-4} width={8} height={8} rx={1} fill={color} /> : status.tone === 'warn' ? <circle r={4} fill={color} /> : <rect x={-3.6} y={-3.6} width={7.2} height={7.2} rx={1} transform="rotate(45)" fill={status.tone === 'good' ? color : 'none'} stroke={color} strokeWidth={1.3} />}
			</svg>
			{status.tone === 'bad' || status.tone === 'warn' ? <span style={{ color }}>{status.label}</span> : null}
		</span>
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
						cx.execute([{ type: 'updatePiece', pieceId: piece.id, patch: { angle: toRadians(value) } }], { label: 'Tilt' });
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

const BarMenu: React.FC<{ cx: StudioCx; project: TProject; target: TBarTarget; rows: TBarRow[]; index: number }> = (props) => {
	const { cx, project, target, rows, index } = props;
	const { answers, choice } = useFeatureState(cx.bar.$state);
	return (
		<div className="mm-menu mm-bar-menu" role="menu" onPointerLeave={() => cx.bar.hoverRow(rows.findIndex((row) => row.id === choice))}>
			{rows.map((row, rowIndex) => {
				const answer = row.isChoice ? answers[row.id] : undefined;
				const words = row.note ?? (answer?.proposal != null ? rowWords(project, target, answer.proposal) : row.isChoice && row.id !== BUILD_UP_TO ? 'Checking…' : '');
				return (
					<React.Fragment key={row.id}>
						{row.isSplit === true && rowIndex > 0 ? <div className="mm-menu-separator" role="separator" /> : null}
						<button className="mm-menu-item" role="menuitem" data-highlighted={rowIndex === index} onPointerEnter={() => cx.bar.hoverRow(rowIndex)} onClick={() => cx.bar.runRow(row)} type="button">
							<span className="mm-menu-check">{row.isChoice && row.id !== BUILD_UP_TO && row.id !== 'remove' ? <RowMark proposal={answer?.proposal ?? null} /> : null}</span>
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
	return answer?.proposal != null && isBadProposal(answer.proposal);
}

/** It places what's asked but breaks something: never a plain accept */
function isBadProposal(proposal: TProposal): boolean {
	const asked = new Set(proposal.notes.map((note) => note.number));
	return proposal.status === 'problems' || (proposal.facts?.lostNumbers ?? []).some((number) => !asked.has(number));
}

const RowMark: React.FC<{ proposal: TProposal | null }> = (props) => {
	const { proposal } = props;
	if (proposal == null) return null;
	return proposal.status === 'fits' ? <Check size={11} strokeWidth={2.4} aria-label="Fits" /> : <X size={11} strokeWidth={2} aria-label="Has a reason" />;
};

/** The hint on the wall: what's chosen, or the row under the pointer. Nothing here is on the track yet */
export const BarHint: React.FC<{ trackCx: TrackCx }> = (props) => {
	const { trackCx } = props;
	const cx = trackCx.studio;
	const state = useFeatureState(cx.bar.$state);
	const camera = useFeatureState(trackCx.$camera);
	useFeatureState(trackCx.$viewport);
	const isDragging = useFeatureState(trackCx.$override) != null;
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
				<GhostPiece key={piece.pieceId} trackCx={trackCx} piece={piece} scale={camera.view.scale} isOk={isOk && answer.kind !== 'remove'} />
			))}
			{proposal?.nextDot != null ? <NextDot position={trackCx.toScreen(proposal.nextDot)} color={color} /> : null}
		</g>
	);
};

const NextDot: React.FC<{ position: TVec2; color: string }> = (props) => {
	const { position, color } = props;
	return <circle cx={position.x} cy={position.y} r={4} fill="var(--canvas)" fillOpacity={0.7} stroke={color} strokeWidth={1.25} strokeDasharray="2 2" />;
};
