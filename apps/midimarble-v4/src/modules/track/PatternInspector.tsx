import { useFeatureState } from 'feature-react/state';
import { Folder, Spline } from 'lucide-react';
import React from 'react';
import { InspectorHeader, Panel, ScrubField, SliderField } from '@/components';
import { isPatternGroup, type TGroup, type TPiece, type TPatternGroup, type TProject, type TProjectCommand, formatTime, tieOf } from '@/modules/project';
import { groupProblems, hitsInRange, isPatternKind, MAX_TILT, PATTERNS, patternKinds, patternOfKind, patternSpan, type TPatternGlyph, type TPatternKind, type TPatternProblem } from '@/modules/building';
import { platformDefinition } from '@/modules/simulation';
import type { StudioCx } from '@/modules/studio';
import type { TrackCx } from './TrackCx';
import { GhostPiece } from './GhostLayer';
import { patternTargets, verdictKey, type TPatternTarget } from './PatternsCx';

/** The Pattern tiles for selected hits: "9 Hits" in the header above them, one result however they were selected */
export const PatternTiles: React.FC<{ cx: StudioCx; project: TProject }> = (props) => {
	const { cx, project } = props;
	const selection = useFeatureState(cx.$selection);
	const workspace = useFeatureState(cx.$workspace);
	const targets = patternTargets(project, selection);
	if (workspace !== 'track' || !targets.length) return null;
	return <TilesPanel cx={cx} targets={targets} kinds={patternKinds('notes')} verdictKey={verdictKey(targets[0] ?? { marbleId: '', from: 0, to: 0 })} />;
};

/** A silence dragged out in the strip */
export const PatternRangeInspector: React.FC<{ cx: StudioCx; project: TProject; target: { marbleId: string; from: number; to: number } }> = (props) => {
	const { cx, project, target } = props;
	const marble = project.marbles.find((item) => item.id === target.marbleId);
	return (
		<>
			<InspectorHeader icon={<Spline size={16} strokeWidth={1.7} />} title={`${(target.to - target.from).toFixed(1)} s`} subtitle={`Silence on ${marble?.name ?? 'a marble'}`} />
			<TilesPanel cx={cx} targets={[target]} kinds={patternKinds('silence')} verdictKey={verdictKey(target)} />
		</>
	);
};

/** A plain Group's tiles: it has no Pattern yet, and choosing one fits its hits, as selecting them does */
export const PlainGroupTiles: React.FC<{ cx: StudioCx; project: TProject; group: TGroup }> = (props) => {
	const { cx, project, group } = props;
	const workspace = useFeatureState(cx.$workspace);
	const span = plainGroupNotes(project, group);
	if (workspace !== 'track' || span == null) return null;
	const target: TPatternTarget = { marbleId: span.marbleId, from: span.from, to: span.to };
	return <TilesPanel cx={cx} targets={[target]} kinds={patternKinds('notes')} verdictKey={verdictKey(target)} />;
};

/** What a plain Group plays, when that's a run of a marble's notes: a Pattern can then take its place */
export function plainGroupNotes(project: TProject, group: TGroup): { marbleId: string; from: number; to: number; count: number } | null {
	const ties = project.track.pieces.filter((piece) => group.pieceIds.includes(piece.id)).flatMap((piece) => tieOf(piece) ?? []);
	const marbleId = ties[0]?.marbleId;
	const marble = project.marbles.find((item) => item.id === marbleId);
	if (marble == null || marbleId == null || ties.some((tie) => tie.marbleId !== marbleId)) return null;
	const hitIds = new Set(ties.map((tie) => tie.hitId));
	const times = marble.hits.filter((hit) => hitIds.has(hit.id)).map((hit) => hit.time);
	return times.length > 1 ? { marbleId, from: Math.min(...times), to: Math.max(...times), count: times.length } : null;
}

/** A Group: its tiles with Width and Bounce, like Blender's Adjust Last Operation. Using them fits it again */
export const GroupInspector: React.FC<{ cx: StudioCx; project: TProject; groupId: string }> = (props) => {
	const { cx, project, groupId } = props;
	const trackCx = useFeatureState(cx.$trackCx);
	const result = useFeatureState(cx.simulation.$result);
	const group = project.track.groups.filter(isPatternGroup).find((item) => item.id === groupId);
	const marble = project.marbles.find((item) => item.id === group?.marbleId);
	const span = group != null && marble != null ? patternSpan(marble, group) : null;
	if (group == null || marble == null || trackCx == null || span == null) return null;
	const target: TPatternTarget = { marbleId: group.marbleId, from: span.from, to: span.to, group };
	const { kind } = group.pattern;
	const pattern = patternOfKind(kind);
	const isRail = pattern?.takes === 'silence';
	const problems = groupProblems(project, result, group);
	const count = hitsInRange(marble, span.from, span.to).length;
	const subtitle = isRail ? `Silence on ${marble.name}, ${formatTime(span.from)} to ${formatTime(span.to)}` : `${count} ${count === 1 ? 'hit' : 'hits'} on ${marble.name}, ${formatTime(span.from)} to ${formatTime(span.to)}`;
	const widthRange = pattern?.widthRange;
	return (
		<>
			<InspectorHeader icon={<Folder size={16} strokeWidth={1.7} />} title={group.name} subtitle={subtitle} />
			<TilesPanel cx={cx} targets={[target]} kinds={patternKinds(isRail ? 'silence' : 'notes')} {...(isPatternKind(kind) ? { applied: kind } : {})} verdictKey={verdictKey(target)} problems={problems}>
				{isPatternKind(kind) && widthRange != null ? (
					<div className="mm-insp-grid mm-pattern-fields">
						<SliderField
							id="pattern-width"
							label="Width"
							value={group.pattern.width}
							min={widthRange.min}
							max={widthRange.max}
							step={0.01}
							unit="cm"
							format={(value) => (value * 100).toFixed(0)}
							onCommit={(width) => void trackCx.studio.patterns.apply(target, kind, { width })}
						/>
						<SliderField id="pattern-bounce" label="Bounce" value={group.pattern.bounce} min={0.3} max={0.7} step={0.05} unit="" format={(value) => value.toFixed(2)} onCommit={(bounce) => void trackCx.studio.patterns.apply(target, kind, { bounce })} />
						<SliderField id="pattern-tilt" label="Tilt limit" value={group.pattern.maxTilt ?? MAX_TILT} min={20} max={70} step={5} unit="°" format={(value) => value.toFixed(0)} onCommit={(maxTilt) => void trackCx.studio.patterns.apply(target, kind, { maxTilt })} />
					</div>
				) : null}
				<TiltNote project={project} group={group} />
				<button className="mm-button" onClick={() => trackCx.studio.patterns.flatten(group)} title="Keep these pieces as they are, as a plain Group, and remove the Pattern" type="button">
					Flatten
				</button>
			</TilesPanel>
			{!isRail ? <BarDepthPanel cx={cx} project={project} group={group} /> : null}
		</>
	);
};

/** The one part of a live Pattern's Shape that's free: Width and the fit own the rest, and fitting again keeps a Depth set here */
const BarDepthPanel: React.FC<{ cx: StudioCx; project: TProject; group: TPatternGroup }> = (props) => {
	const { cx, project, group } = props;
	const spec = platformDefinition.params['depth'];
	const bars = project.track.pieces.filter((piece) => piece.type === 'platform' && group.pieceIds.includes(piece.id));
	const [first] = bars;
	if (first == null || spec == null) return null;
	const depthOf = (bar: TPiece): number => bar.params['depth'] ?? spec.default;
	const isShared = bars.every((bar) => Math.abs(depthOf(bar) - depthOf(first)) < 1e-9);
	const withDepth = (bar: TPiece, depth: number): TProjectCommand => ({ type: 'updatePiece', pieceId: bar.id, patch: { params: { ...bar.params, depth } } });
	return (
		<Panel id="pattern.shape" title="Shape" isDense>
			<ScrubField
				id="pattern-depth"
				label="Depth"
				name="Depth"
				value={isShared ? Math.round(depthOf(first) * 1000) / 10 : null}
				unit="cm"
				step={0.1}
				precision={1}
				min={spec.min * 100}
				max={spec.max * 100}
				onCommit={(value) => cx.execute(bars.map((bar) => withDepth(bar, value / 100)))}
			/>
		</Panel>
	);
};

const TilesPanel: React.FC<{ cx: StudioCx; targets: TPatternTarget[]; kinds: TPatternKind[]; applied?: TPatternKind; verdictKey: string; problems?: TPatternProblem[]; children?: React.ReactNode }> = (props) => {
	const { cx, targets, kinds, applied, verdictKey: key, problems = [], children } = props;
	const trackCx = useFeatureState(cx.$trackCx);
	if (trackCx == null) return null;
	return (
		<Panel id="pattern" title="Pattern" isGrid={false}>
			<div className="mm-tile-grid">
				{kinds.map((kind) => (
					<button
						key={kind}
						className="mm-tile"
						data-applied={applied === kind}
						onPointerEnter={() => {
							const [first] = targets;
							if (first != null) trackCx.studio.patterns.hover(first, kind);
						}}
						onPointerLeave={() => trackCx.studio.patterns.endHover()}
						onClick={() => void applyAll(trackCx, targets, kind)}
						title={PATTERNS[kind].title}
						type="button"
					>
						<span className="mm-tile-thumb">
							<PatternGlyph glyph={PATTERNS[kind].glyph} />
						</span>
						<span className="mm-tile-label">{PATTERNS[kind].label}</span>
					</button>
				))}
			</div>
			{children}
			<PatternVerdict trackCx={trackCx} verdictKey={key} problems={problems} />
		</Panel>
	);
};

/** Several marbles work one by one for now: each gets its own Group, and a run says if pieces touch */
async function applyAll(trackCx: TrackCx, targets: TPatternTarget[], kind: TPatternKind): Promise<void> {
	for (const target of targets) await trackCx.studio.patterns.apply(target, kind);
}

/** The line under the tiles: what the Pattern the pointer rests on would do, why it doesn't fit, or what's off with the Group */
const PatternVerdict: React.FC<{ trackCx: TrackCx; verdictKey: string; problems: TPatternProblem[] }> = (props) => {
	const { trackCx, verdictKey: key, problems } = props;
	const verdict = useFeatureState(trackCx.studio.patterns.$verdict);
	const notice = useFeatureState(trackCx.studio.$notice);
	const current = verdict?.key === key ? verdict : null;
	if (current?.isChecking === true) return <p className="mm-pattern-note">Checking the whole song…</p>;
	if (current?.refusal != null) {
		// A click that was refused says so in the notice, with what fits instead
		if (notice?.message.startsWith(current.refusal.words) === true) return null;
		const words = [current.refusal.words, ...current.offers.map((offer) => offer.words)].join(' ');
		return (
			<p className="mm-pattern-problems" title={words}>
				{words}
			</p>
		);
	}
	if (current != null) return <p className="mm-pattern-note">{fitWords(current.verdicts.length, current.movedAfter)}</p>;
	const [first] = problems;
	if (first == null) return null;
	const words = problems.map((problem) => problem.words).join(' ');
	return (
		<p className="mm-pattern-problems" title={words}>
			{problems.length === 1 ? first.words : `${problems.length} problems`}
		</p>
	);
};

function fitWords(hits: number, movedAfter: number): string {
	const fits = hits === 1 ? 'Fits this hit.' : hits === 2 ? 'Fits both hits.' : `Fits all ${hits} hits.`;
	return movedAfter > 0 ? `${fits} ${movedAfter === 1 ? 'The piece' : `The ${movedAfter} pieces`} after it move with the marble.` : `${fits} The song stays as it is.`;
}

const TiltNote: React.FC<{ project: TProject; group: TPatternGroup }> = (props) => {
	const { project, group } = props;
	const tilts = project.track.pieces.filter((piece) => group.pieceIds.includes(piece.id) && piece.type === 'platform').map((piece) => Math.abs(tieOf(piece) != null ? piece.angle : 0) * (180 / Math.PI));
	if (!tilts.length) return null;
	const steepest = Math.max(...tilts);
	if (steepest <= MAX_TILT + 0.5) return null;
	return <p className="mm-pattern-note">Bars tilt up to {steepest.toFixed(0)}°, past the usual {MAX_TILT}°.</p>;
};

const PatternGlyph: React.FC<{ glyph: TPatternGlyph }> = (props) => {
	const { guide, marks, markWidth, marble } = props.glyph;
	return (
		<svg viewBox="0 0 48 36" width="100%" height="100%" fill="none" stroke="currentColor" strokeLinecap="round" aria-hidden>
			{guide != null ? <path d={guide} strokeWidth={0.8} strokeDasharray="1.5 2.5" opacity={0.6} /> : null}
			{marks.map((mark) => (
				<path key={mark} d={mark} strokeWidth={markWidth} />
			))}
			{marble != null ? <circle cx={marble.x} cy={marble.y} r="2" fill="currentColor" stroke="none" /> : null}
		</svg>
	);
};

/** The ghost of the tile the pointer rests on, as Continue's ghosts look */
export const PatternGhost: React.FC<{ trackCx: TrackCx }> = (props) => {
	const { trackCx } = props;
	const preview = useFeatureState(trackCx.studio.patterns.$preview);
	const camera = useFeatureState(trackCx.$camera);
	useFeatureState(trackCx.$viewport);
	if (preview == null) return null;
	return (
		<g className="mm-ghost-in" data-pattern-ghost={preview.kind} data-preview-ms={Math.round(preview.ms)}>
			{preview.pieces.map((piece) => (
				<GhostPiece key={piece.pieceId} trackCx={trackCx} piece={piece} scale={camera.view.scale} isOk={preview.isOk} />
			))}
		</g>
	);
};
