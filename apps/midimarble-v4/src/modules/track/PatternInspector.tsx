import { useFeatureState } from 'feature-react/state';
import { Spline } from 'lucide-react';
import React from 'react';
import { InspectorHeader, Panel, ScrubField, SliderField } from '@/components';
import { isPatternGroup, type TGroup, type TPiece, type TPatternGroup, type TProject, type TProjectCommand, formatTime, tieOf } from '@/modules/project';
import { groupProblems, hitsInRange, isPatternKind, MAX_TILT, patternOfKind, patternSpan, type TPatternProblem } from '@/modules/building';
import { platformDefinition } from '@/modules/simulation';
import type { StudioCx } from '@/modules/studio';
import { restWords } from './bar';
import { GroupIcon } from './GroupIcon';
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
	const subtitle = isRail ? `${restWords(span.to - span.from)} on ${marble.name}, ${formatTime(span.from)} to ${formatTime(span.to)}` : `${count} ${count === 1 ? 'note' : 'notes'} on ${marble.name}, ${formatTime(span.from)} to ${formatTime(span.to)}`;
	const widthRange = pattern?.widthRange;
	const hasFields = isPatternKind(kind) && widthRange != null;
	// A Curved Rail has nothing to set: no empty Pattern section under it
	const hasPanel = hasFields || problems.length > 0 || !isRail;
	return (
		<>
			<InspectorHeader icon={<GroupIcon group={group} size={16} />} title={group.name} subtitle={subtitle} />
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
							<SliderField id="pattern-tilt" label="Tilt limit" value={group.pattern.maxTilt ?? MAX_TILT} min={20} max={70} step={5} unit="°" format={(value) => value.toFixed(0)} onCommit={(maxTilt) => void trackCx.studio.patterns.apply(target, kind, { maxTilt })} />
						</div>
					) : null}
					<TiltNote project={project} group={group} />
					<GroupProblems problems={problems} />
				</Panel>
			) : null}
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
