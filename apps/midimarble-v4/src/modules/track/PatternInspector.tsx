import { useFeatureState } from 'feature-react/state';
import { Spline } from 'lucide-react';
import React from 'react';
import { InspectorHeader, Panel, ScrubField, SliderField, StatusPill } from '@/components';
import { isPatternGroup, type TGroup, type TPiece, type TPatternGroup, type TProject, type TProjectCommand, formatTime, tieOf } from '@/modules/project';
import { groupProblems, hitsInRange, isPatternKind, MAX_TILT, patternOfKind, patternSpan, type TPatternProblem } from '@/modules/building';
import { getPieceDefinition } from '@/modules/simulation';
import type { StudioCx } from '@/modules/studio';
import { restWords } from './bar';
import { GroupIcon } from './GroupIcon';
import { pieceStatus } from './PieceInspector';
import { type TPatternTarget } from './PatternsCx';

/** An empty rest, from the bar or dragged out in the strip: "Rest · 2.0 s", as the bar says it */
export const PatternRangeInspector: React.FC<{ project: TProject; target: { marbleId: string; from: number; to: number } }> = (props) => {
	const { project, target } = props;
	const marble = project.marbles.find((item) => item.id === target.marbleId);
	return <InspectorHeader icon={<Spline size={16} strokeWidth={1.7} />} title={restWords(target.to - target.from)} subtitle={`${marble?.name ?? 'A marble'}, ${formatTime(target.from)} to ${formatTime(target.to)}`} />;
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

/** A Group: Width and Bounce, like Blender's Adjust Last Operation. Using them fits it again */
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
	// One line: the times are on its block in the strip and in its tooltip
	const subtitle = isRail ? restWords(span.to - span.from) : `${count} ${count === 1 ? 'note' : 'notes'}`;
	const widthRange = pattern?.widthRange;
	const hasFields = isPatternKind(kind) && widthRange != null;
	// A Curved Rail has nothing to set in its Pattern: no empty Pattern section under it, only its Shape's Spread
	const hasPanel = hasFields || problems.length > 0 || !isRail;
	// A Curved Rail has nothing to set, so its header says what the marble does on it, as a piece's does: Rides 1.0 s
	const rail = isRail ? project.track.pieces.find((piece) => group.pieceIds.includes(piece.id)) : undefined;
	const railStatus = rail != null ? pieceStatus(project, rail, result?.pieces.find((item) => item.pieceId === rail.id), result) : null;
	return (
		<>
			<InspectorHeader icon={<GroupIcon group={group} size={16} />} title={group.name} subtitle={subtitle} status={railStatus != null ? <StatusPill tone={railStatus.tone} label={railStatus.label} detail={railStatus.detail} /> : null} />
			{hasPanel ? (
				<Panel id="pattern" title="Pattern" isGrid={false}>
					{hasFields && widthRange != null ? (
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
							<SliderField id="pattern-tilt" label="Tilt Limit" value={group.pattern.maxTilt ?? MAX_TILT} min={20} max={70} step={5} unit="°" format={(value) => value.toFixed(0)} onCommit={(maxTilt) => void trackCx.studio.patterns.apply(target, kind, { maxTilt })} />
						</div>
					) : null}
					<TiltNote project={project} group={group} />
					<GroupProblems problems={problems} />
				</Panel>
			) : null}
			<FreeShapePanel cx={cx} project={project} group={group} isRail={isRail} />
		</>
	);
};

/**
 * The one part of a live Pattern's Shape that's free, as no hitbox reads it: a Zigzag's or Staircase's bar Depth, a Curved
 * Rail's Spread between its two rails in the film. Width and the fit own the rest, and fitting again keeps what's set here
 */
const FreeShapePanel: React.FC<{ cx: StudioCx; project: TProject; group: TPatternGroup; isRail: boolean }> = (props) => {
	const { cx, project, group, isRail } = props;
	const type = isRail ? 'rail' : 'platform';
	const key = isRail ? 'gap' : 'depth';
	const spec = getPieceDefinition(type)?.params[key];
	const pieces = project.track.pieces.filter((piece) => piece.type === type && group.pieceIds.includes(piece.id));
	const [first] = pieces;
	if (first == null || spec == null) return null;
	const name = spec.short ?? spec.label;
	const valueOf = (piece: TPiece): number => piece.params[key] ?? spec.default;
	const isShared = pieces.every((piece) => Math.abs(valueOf(piece) - valueOf(first)) < 1e-9);
	const withValue = (piece: TPiece, value: number): TProjectCommand => ({ type: 'updatePiece', pieceId: piece.id, patch: { params: { ...piece.params, [key]: value } } });
	return (
		<Panel id="pattern.shape" title="Shape" isDense>
			<ScrubField
				id={`pattern-${key}`}
				label={name}
				name={name}
				value={isShared ? Math.round(valueOf(first) * 1000) / 10 : null}
				unit="cm"
				step={0.1}
				precision={1}
				min={spec.min * 100}
				max={spec.max * 100}
				onCommit={(value) => cx.execute(pieces.map((piece) => withValue(piece, value / 100)))}
			/>
		</Panel>
	);
};

/** The line under a Group's settings: what's off with it */
const GroupProblems: React.FC<{ problems: TPatternProblem[] }> = (props) => {
	const { problems } = props;
	const [first] = problems;
	if (first == null) return null;
	const words = problems.map((problem) => problem.words).join(' ');
	return (
		<p className="mm-pattern-problems" title={words}>
			{problems.length === 1 ? first.words : `${problems.length} problems`}
		</p>
	);
};

const TiltNote: React.FC<{ project: TProject; group: TPatternGroup }> = (props) => {
	const { project, group } = props;
	const tilts = project.track.pieces.filter((piece) => group.pieceIds.includes(piece.id) && piece.type === 'platform').map((piece) => Math.abs(tieOf(piece) != null ? piece.angle : 0) * (180 / Math.PI));
	if (!tilts.length) return null;
	const steepest = Math.max(...tilts);
	if (steepest <= MAX_TILT + 0.5) return null;
	return <p className="mm-pattern-note">Bars tilt up to {steepest.toFixed(0)}°, past the usual {MAX_TILT}°.</p>;
};
