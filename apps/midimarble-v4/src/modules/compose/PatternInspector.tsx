import { useFeatureState } from 'feature-react/state';
import { Folder, Spline } from 'lucide-react';
import React from 'react';
import { InspectorHeader, Panel, SliderField } from '@/components';
import { isPatternGroup, type TPatternGroup, type TProject } from '@/modules/project';
import { hitsInRange, MAX_TILT, PATTERN_LABELS, type TPatternKind, type TPatternProblem } from '@/modules/simulation';
import { formatTime } from '@/modules/studio/format';
import { toGroupKey, toRangeKey } from '@/modules/studio/selection';
import type { StudioCx } from '@/modules/studio/StudioCx';
import type { ComposeCx } from './ComposeCx';
import { GhostPiece } from './GhostLayer';
import { patternTargets, type TPatternTarget } from './PatternsCx';

const BAR_KINDS: TPatternKind[] = ['zigzag', 'staircase'];
const RAIL_KINDS: TPatternKind[] = ['longRail'];

/** The Pattern tiles for selected hits: "9 Hits" in the header above them, one result however they were selected */
export const PatternTiles: React.FC<{ cx: StudioCx; project: TProject }> = (props) => {
	const { cx, project } = props;
	const selection = useFeatureState(cx.$selection);
	const workspace = useFeatureState(cx.$workspace);
	const targets = patternTargets(project, selection);
	if (workspace !== 'compose' || !targets.length) return null;
	return <TilesPanel cx={cx} targets={targets} kinds={BAR_KINDS} failureKey={toRangeKey(targets[0]?.laneId ?? '', targets[0]?.from ?? 0, targets[0]?.to ?? 0)} />;
};

/** A silence dragged out in the strip */
export const PatternRangeInspector: React.FC<{ cx: StudioCx; project: TProject; target: { laneId: string; from: number; to: number } }> = (props) => {
	const { cx, project, target } = props;
	const lane = project.music.lanes.find((item) => item.id === target.laneId);
	return (
		<>
			<InspectorHeader icon={<Spline size={16} strokeWidth={1.7} />} title={`${(target.to - target.from).toFixed(1)} s`} subtitle={`Silence on ${lane?.name ?? 'a marble'}`} />
			<TilesPanel cx={cx} targets={[target]} kinds={RAIL_KINDS} failureKey={toRangeKey(target.laneId, target.from, target.to)} />
		</>
	);
};

/** A Group: its tiles with Width and Bounce, like Blender's Adjust Last Operation. Using them fits it again */
export const GroupInspector: React.FC<{ cx: StudioCx; project: TProject; groupId: string }> = (props) => {
	const { cx, project, groupId } = props;
	const compose = useFeatureState(cx.$compose);
	const group = project.groups?.filter(isPatternGroup).find((item) => item.id === groupId);
	const lane = project.music.lanes.find((item) => item.id === group?.laneId);
	if (group == null || lane == null || compose == null) return null;
	const target: TPatternTarget = { laneId: group.laneId, from: group.from, to: group.to, group };
	const isRail = group.kind === 'longRail';
	const count = hitsInRange(lane, group.from, group.to).length;
	const subtitle = isRail ? `Silence on ${lane.name}, ${formatTime(group.from)} to ${formatTime(group.to)}` : `${count} ${count === 1 ? 'hit' : 'hits'} on ${lane.name}, ${formatTime(group.from)} to ${formatTime(group.to)}`;
	const widthRange = group.kind === 'staircase' ? { min: 0.05, max: 0.16 } : { min: 0.1, max: 0.26 };
	return (
		<>
			<InspectorHeader icon={<Folder size={16} strokeWidth={1.7} />} title={group.name} subtitle={subtitle} />
			<TilesPanel cx={cx} targets={[target]} kinds={isRail ? RAIL_KINDS : BAR_KINDS} applied={group.kind} failureKey={toGroupKey(group.id)} problems={group.problems ?? []}>
				{!isRail ? (
					<div className="mm-insp-grid mm-pattern-fields">
						<SliderField
							id="pattern-width"
							label="Width"
							value={group.width}
							min={widthRange.min}
							max={widthRange.max}
							step={0.01}
							unit="cm"
							format={(value) => (value * 100).toFixed(0)}
							onCommit={(width) => void compose.patterns.apply(target, group.kind, { width })}
						/>
						<SliderField id="pattern-bounce" label="Bounce" value={group.bounce} min={0.3} max={0.7} step={0.05} unit="" format={(value) => value.toFixed(2)} onCommit={(bounce) => void compose.patterns.apply(target, group.kind, { bounce })} />
						<SliderField id="pattern-tilt" label="Tilt limit" value={group.maxTilt ?? MAX_TILT} min={20} max={70} step={5} unit="°" format={(value) => value.toFixed(0)} onCommit={(maxTilt) => void compose.patterns.apply(target, group.kind, { maxTilt })} />
					</div>
				) : null}
				<TiltNote project={project} group={group} />
				<button className="mm-button" onClick={() => compose.patterns.flatten(group)} title="Keep these pieces as they are, as a plain Group, and remove the Pattern" type="button">
					Flatten
				</button>
			</TilesPanel>
		</>
	);
};

const TilesPanel: React.FC<{ cx: StudioCx; targets: TPatternTarget[]; kinds: TPatternKind[]; applied?: TPatternKind; failureKey: string; problems?: TPatternProblem[]; children?: React.ReactNode }> = (props) => {
	const { cx, targets, kinds, applied, failureKey, problems = [], children } = props;
	const compose = useFeatureState(cx.$compose);
	if (compose == null) return null;
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
							if (first != null) compose.patterns.hover(first, kind);
						}}
						onPointerLeave={() => compose.patterns.endHover()}
						onClick={() => void applyAll(compose, targets, kind)}
						title={TILE_TITLES[kind]}
						type="button"
					>
						<span className="mm-tile-thumb">
							<PatternGlyph kind={kind} />
						</span>
						<span className="mm-tile-label">{PATTERN_LABELS[kind]}</span>
					</button>
				))}
			</div>
			{children}
			<PatternProblems compose={compose} failureKey={failureKey} problems={problems} />
		</Panel>
	);
};

/** Several marbles work one by one for now: each gets its own Group, and a run says if pieces touch */
async function applyAll(compose: ComposeCx, targets: TPatternTarget[], kind: TPatternKind): Promise<void> {
	for (const target of targets) await compose.patterns.apply(target, kind);
}

const PatternProblems: React.FC<{ compose: ComposeCx; failureKey: string; problems: TPatternProblem[] }> = (props) => {
	const { compose, failureKey, problems } = props;
	const failure = useFeatureState(compose.patterns.$failure);
	const shown = failure != null && failure.key === failureKey ? failure.problems : problems;
	const [first] = shown;
	if (first == null) return null;
	const words = shown.map((problem) => problem.words).join(' ');
	return (
		<p className="mm-pattern-problems" title={words}>
			{shown.length === 1 ? first.words : `${shown.length} problems`}
		</p>
	);
};

const TiltNote: React.FC<{ project: TProject; group: TPatternGroup }> = (props) => {
	const { project, group } = props;
	const tilts = project.entities.filter((entity) => group.pieceIds.includes(entity.id) && entity.components.piece?.type === 'platform').map((entity) => Math.abs(entity.components.hitLink?.angle ?? 0) * (180 / Math.PI));
	if (!tilts.length) return null;
	const steepest = Math.max(...tilts);
	if (steepest <= MAX_TILT + 0.5) return null;
	return <p className="mm-pattern-note">Bars tilt up to {steepest.toFixed(0)}°, past the usual {MAX_TILT}°.</p>;
};

const TILE_TITLES: Record<TPatternKind, string> = {
	zigzag: 'Two columns: the marble crosses between them on every hit',
	staircase: 'One way across the wall, a step on every hit',
	longRail: 'A rail that holds the marble through the silence and lets go in time for the next note'
};

const PatternGlyph: React.FC<{ kind: TPatternKind }> = (props) => {
	const { kind } = props;
	return (
		<svg viewBox="0 0 48 36" width="100%" height="100%" fill="none" stroke="currentColor" strokeLinecap="round" aria-hidden>
			{kind === 'zigzag' ? (
				<>
					<path d="M15 6 L33 12 L15 18 L33 24 L15 30" strokeWidth={0.8} strokeDasharray="1.5 2.5" opacity={0.6} />
					{[6, 18, 30].map((y) => <path key={y} d={`M9 ${y + 2} L19 ${y - 1}`} strokeWidth={2} />)}
					{[12, 24].map((y) => <path key={y} d={`M29 ${y - 1} L39 ${y + 2}`} strokeWidth={2} />)}
				</>
			) : kind === 'staircase' ? (
				<>
					<path d="M10 7 L19 13 L28 19 L37 25" strokeWidth={0.8} strokeDasharray="1.5 2.5" opacity={0.6} />
					{[[10, 8], [19, 14], [28, 20], [37, 26]].map(([x = 0, y = 0]) => <path key={x} d={`M${x - 5} ${y} L${x + 4} ${y + 2}`} strokeWidth={2} />)}
				</>
			) : (
				<>
					<path d="M8 8 C 16 8, 30 12, 40 16 C 44 18, 44 22, 38 23 C 30 25, 20 25, 14 28" strokeWidth={1.5} />
					<circle cx="8" cy="5" r="2" fill="currentColor" stroke="none" />
				</>
			)}
		</svg>
	);
};

/** The ghost of the tile the pointer rests on, as Continue's ghosts look */
export const PatternGhost: React.FC<{ compose: ComposeCx }> = (props) => {
	const { compose } = props;
	const preview = useFeatureState(compose.patterns.$preview);
	const camera = useFeatureState(compose.$camera);
	useFeatureState(compose.$viewport);
	if (preview == null) return null;
	return (
		<g className="mm-ghost-in" data-pattern-ghost={preview.kind} data-preview-ms={Math.round(preview.ms)}>
			{preview.pieces.map((piece) => (
				<GhostPiece key={piece.entityId} compose={compose} piece={piece} scale={camera.view.scale} isOk />
			))}
		</g>
	);
};
