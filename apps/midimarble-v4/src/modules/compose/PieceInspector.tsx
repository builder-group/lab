import { useFeatureState } from 'feature-react/state';
import { createState } from 'feature-state';
import { Anchor, Unlink2, WandSparkles } from 'lucide-react';
import React from 'react';
import { HelpTip, InspectorHeader, LinkRow, Panel, ScrubField, SelectField, StatusPill } from '@/components';
import type { TComponents, TEntity, TProject, TProjectCommand, TVec2 } from '@/modules/project';
import { bowlCatch, getPieceDefinition, isMusicalPiece, RAIL_LAYOUTS, railLayoutInfo, resolvePiecePath, soundsHit, unanchorPiece, unlinkPiece, type TRailLayout, type TResolvedPiece, type TSimulationResult } from '@/modules/simulation';
import { formatTime, noteName } from '@/modules/studio/format';
import { toHitKey } from '@/modules/studio/selection';
import { lookProblems, struckPieces, type TPreflightIssue } from '@/modules/design/export-preflight';
import { useRunPreflight } from '@/modules/design/ExportPreflight';
import type { StudioCx } from '@/modules/studio/StudioCx';
import { normalizeSurfaceAngle, toDegrees, toRadians } from './angles';
import { attachState, isPathPieceType, pathPieceTypes, withPathType, withRailLayout, type TPathPieceType } from './attach-edit';
import { PieceIcon } from './piece-icons';
import { pieceParamPanels, showsLinkPanel } from './piece-panels';
import { pathRide, pathRun, pieceKind, pieceTime, turnPathRun, withPathRun, worldRunSlope } from './scene';
import { pieceAngle } from './step-loop';
import type { TPieceFixCheck } from './AssistCx';
import { timingStatus, type TTimingStatus } from './timing-status';

/**
 * Inspector for selected pieces like Figma UI3: a header with the tie and the timing pill, then Position, the
 * link panel of a linked piece (Plays or Follows) and the collapsed Hitbox and Physics panels
 */
export const PieceInspector: React.FC<TPieceInspectorProps> = (props) => {
	const { cx, project, ids } = props;
	const result = useFeatureState(cx.simulation.$result);
	// Pieces another marble hits, from the problem model the hit summary and Layers read
	const preflight = useRunPreflight(cx, project);
	const struck = React.useMemo(() => (preflight != null ? struckPieces(preflight) : new Map<string, TPreflightIssue[]>()), [preflight]);
	const looks = React.useMemo(() => (preflight != null ? lookProblems(preflight) : new Map<string, TPreflightIssue[]>()), [preflight]);
	const entities = project.entities.filter((entity) => ids.includes(entity.id) && entity.components.piece != null);
	const first = entities[0];
	if (first == null) return null;
	const type = first.components.piece?.type ?? 'platform';
	const definition = getPieceDefinition(type);
	const isSingle = entities.length === 1;
	const label = definition?.label ?? type;
	const isSameType = entities.every((entity) => entity.components.piece?.type === type);
	const kind = pieceKind(first.components.piece ?? { type });
	const isPath = kind === 'path' || kind === 'tube';
	const resolved = result?.pieces.find((item) => item.entityId === first.id);
	const attach = attachState(project, first);
	const isFree = entities.every((entity) => entity.components.hitLink == null);

	const angles = entities.map(pieceAngle).filter((angle) => angle != null);
	const sharedAngle = angles.length > 0 && angles.every((angle) => Math.abs(angle - (angles[0] ?? 0)) < 1e-9) ? (angles[0] ?? null) : null;
	const lengths = entities.map((entity) => resolvedParam(entity, 'length'));
	const sharedLength = lengths.every((length) => length === lengths[0]) ? (lengths[0] ?? null) : null;
	const link = isSingle ? first.components.hitLink : undefined;
	const transform = isSingle ? first.components.transform : undefined;

	// Scrubs preview through the simulation without history; a release commits one edit
	function preview(edit: TPieceEdit): void {
		cx.simulation.startPreview(applyPieceEdit(project, entities, edit).project);
	}
	function commit(edit: TPieceEdit): void {
		cx.execute(applyPieceEdit(project, entities, edit).commands);
		cx.simulation.endPreview();
	}
	const cancel = (): void => cx.simulation.endPreview();

	const angleEdit = (degrees: number): TPieceEdit => ({ angle: toRadians(degrees) });
	const lengthEdit = (centimetres: number): TPieceEdit => ({ params: { length: centimetres / 100 } });
	const contactEdit = (percent: number): TPieceEdit => ({ hitLink: { contactAt: percent / 100 } });
	const positionEdit = (axis: 'x' | 'y', centimetres: number): TPieceEdit => ({ position: { [axis]: centimetres / 100 } });

	const title = isSingle ? (first.name ?? label) : isSameType ? `${entities.length} ${label}s` : `${entities.length} Pieces`;
	const subtitle = isSingle ? tieLabel(project, first) : isSameType ? 'Multiple selection' : 'Different piece types';
	const position = transform?.position ?? resolved?.position ?? null;
	const hitBy = isSingle ? struck.get(first.id) : undefined;
	const look = isSingle ? looks.get(first.id) : undefined;
	const status = isSingle ? lookStatus(struckStatus(pieceStatus(project, first, resolved, result), hitBy), look) : null;
	const isBowl = kind === 'catcher';
	const isBowlMissed = isBowl && status?.tone === 'bad';

	return (
		<>
			<InspectorHeader
				icon={<PieceIcon type={isSameType ? type : 'platform'} size={16} />}
				title={title}
				subtitle={subtitle}
				onRename={isSingle ? (name) => cx.execute([{ type: 'upsertEntity', entity: { ...first, name } }]) : undefined}
				status={status == null ? null : <StatusPill tone={status.tone} label={status.label} detail={status.detail} />}
				fix={
					// The Fix-it sits under the problem
					status == null || link == null ? null : (status.tone === 'bad' || status.tone === 'warn') && soundsHit(type, link) && look == null ? (
						<ReplaceButton cx={cx} laneId={link.laneId} hitId={link.hitId} />
					) : (resolved?.status === 'blocked' && !soundsHit(type, link)) || hitBy != null || isBowlMissed || look != null ? (
						<FixPieceButton cx={cx} entityId={first.id} isPlatform={soundsHit(type, link)} />
					) : null
				}
			/>
			{entities.every((entity) => isPathPieceType(entity.components.piece?.type)) ? <PathTypeSection cx={cx} project={project} entities={entities} /> : null}
			<Panel id="piece.position" title="Position">
				{isSingle && position != null ? (
					<>
						<ScrubField
							id="piece-x"
							label="X"
							name="X"
							value={Math.round(position.x * 1000) / 10}
							unit="cm"
							step={0.1}
							precision={1}
							disabled={!isFree}
							onPreview={(value) => preview(positionEdit('x', value))}
							onCommit={(value) => commit(positionEdit('x', value))}
							onCancel={cancel}
						/>
						<ScrubField
							id="piece-y"
							label="Y"
							name="Y"
							value={Math.round(position.y * 1000) / 10}
							unit="cm"
							step={0.1}
							precision={1}
							disabled={!isFree}
							onPreview={(value) => preview(positionEdit('y', value))}
							onCommit={(value) => commit(positionEdit('y', value))}
							onCancel={cancel}
						/>
					</>
				) : null}
				{(!isPath || isFree) && !isBowl ? (
					<ScrubField
						id="piece-angle"
						label="∠"
						name="Angle"
						value={sharedAngle == null ? null : Math.round(toDegrees(kind === 'box' ? normalizeSurfaceAngle(sharedAngle) : sharedAngle) * 10) / 10}
						unit="°"
						step={0.5}
						precision={1}
						min={kind === 'box' ? -90 : -360}
						max={kind === 'box' ? 90 : 360}
						onPreview={(value) => preview(angleEdit(value))}
						onCommit={(value) => commit(angleEdit(value))}
						onCancel={cancel}
					/>
				) : null}
				{kind === 'box' && isSameType ? (
					<ScrubField
						id="piece-length"
						label="L"
						name="Length"
						value={sharedLength == null ? null : Math.round(sharedLength * 1000) / 10}
						unit="cm"
						step={0.1}
						precision={1}
						min={(definition?.params['length']?.min ?? 0.02) * 100}
						max={(definition?.params['length']?.max ?? 0.3) * 100}
						onPreview={(value) => preview(lengthEdit(value))}
						onCommit={(value) => commit(lengthEdit(value))}
						onCancel={cancel}
					/>
				) : null}
				{isPath && isSingle && resolved != null && first.components.path?.nodes == null ? <PathRunFields cx={cx} project={project} entity={first} piece={resolved} /> : null}
				{link != null && attach.kind === 'linked' && kind === 'box' ? (
					<ScrubField
						id="piece-contact"
						label="Lands At"
						name="Where along the platform the marble lands"
						value={Math.round(link.contactAt * 100)}
						unit="%"
						step={0.5}
						min={0}
						max={100}
						onPreview={(value) => preview(contactEdit(value))}
						onCommit={(value) => commit(contactEdit(value))}
						onCancel={cancel}
					/>
				) : null}
			</Panel>
			{showsLinkPanel(entities) ? <AttachSection cx={cx} project={project} entity={first} /> : null}
			{isSameType && definition != null ? <ParamsSections cx={cx} project={project} entities={entities} type={type} railLayout={sharedRailLayout(entities)} /> : null}
		</>
	);
};

/**
 * The platform's ∠, L and Lands At beside its hit, so stepping through hits leaves the tilt in reach. The same fields and
 * edits as the piece's own Position panel; Hitbox, Physics and Skin stay on the platform.
 */
export const PlatformFields: React.FC<{ cx: StudioCx; project: TProject; entity: TEntity }> = (props) => {
	const { cx, project, entity } = props;
	const definition = getPieceDefinition(entity.components.piece?.type ?? 'platform');
	const angle = pieceAngle(entity);
	const link = entity.components.hitLink;
	const preview = (edit: TPieceEdit): void => cx.simulation.startPreview(applyPieceEdit(project, [entity], edit).project);
	const commit = (edit: TPieceEdit): void => {
		cx.execute(applyPieceEdit(project, [entity], edit).commands);
		cx.simulation.endPreview();
	};
	const cancel = (): void => cx.simulation.endPreview();
	return (
		<>
			<ScrubField
				id="hit-platform-angle"
				label="∠"
				name="Angle"
				value={angle == null ? null : Math.round(toDegrees(normalizeSurfaceAngle(angle)) * 10) / 10}
				unit="°"
				step={0.5}
				precision={1}
				min={-90}
				max={90}
				onPreview={(value) => preview({ angle: toRadians(value) })}
				onCommit={(value) => commit({ angle: toRadians(value) })}
				onCancel={cancel}
			/>
			<ScrubField
				id="hit-platform-length"
				label="L"
				name="Length"
				value={Math.round(resolvedParam(entity, 'length') * 1000) / 10}
				unit="cm"
				step={0.1}
				precision={1}
				min={(definition?.params['length']?.min ?? 0.02) * 100}
				max={(definition?.params['length']?.max ?? 0.3) * 100}
				onPreview={(value) => preview({ params: { length: value / 100 } })}
				onCommit={(value) => commit({ params: { length: value / 100 } })}
				onCancel={cancel}
			/>
			{link != null ? (
				<ScrubField
					id="hit-platform-contact"
					label="Lands At"
					name="Where along the platform the marble lands"
					value={Math.round(link.contactAt * 100)}
					unit="%"
					step={0.5}
					min={0}
					max={100}
					onPreview={(value) => preview({ hitLink: { contactAt: value / 100 } })}
					onCommit={(value) => commit({ hitLink: { contactAt: value / 100 } })}
					onCancel={cancel}
				/>
			) : null}
		</>
	);
};

interface TPieceInspectorProps {
	cx: StudioCx;
	project: TProject;
	ids: string[];
}

/**
 * Place Again under a Blocked, Missed or Stopped platform's status pill, or an early or late one a drag left where it
 * lies, like an Xcode Fix-it: places this platform again on its own, as one undo step
 */
export const ReplaceButton: React.FC<{ cx: StudioCx; laneId: string; hitId: string }> = (props) => {
	const { cx, laneId, hitId } = props;
	const compose = useFeatureState(cx.$compose);
	const replacing = useFeatureState(compose?.assist.$replacing ?? NO_REPLACING);
	return (
		<button
			className="mm-fix-it mm-fix-it-label"
			disabled={compose == null || replacing != null}
			onClick={() => void compose?.assist.replace([`${laneId}/${hitId}`])}
			title="Place this platform again so the marble lands on time"
			type="button"
		>
			{/* The placing wand, as in the step bar */}
			<WandSparkles size={12} strokeWidth={1.9} />
			Place Again
		</button>
	);
};

/**
 * The Fix-it beside a piece that follows a marble and is Blocked or hit by another marble. Its what-if runs as
 * soon as the piece shows, like Xcode's Fix-its, so the button offers only what will work: Place Again (a bridge
 * suggested again for its gap), Move Clear or Delete (a Blocked piece the run passes through and never uses) for
 * scenery, Place Again for a platform another marble hits (that marble's platform before the hit tilts again).
 * When nothing passes it stays dimmed with the reason as its tooltip. One undo step either way.
 */
export const FixPieceButton: React.FC<{ cx: StudioCx; entityId: string; isPlatform: boolean }> = (props) => {
	const { cx, entityId, isPlatform } = props;
	const compose = useFeatureState(cx.$compose);
	const replacing = useFeatureState(compose?.assist.$replacing ?? NO_REPLACING);
	const checks = useFeatureState(compose?.assist.$pieceFixes ?? NO_CHECKS);
	const result = useFeatureState(cx.simulation.$result);
	const revision = useFeatureState(cx.$history)?.present.revision;
	const [isApplying, setIsApplying] = React.useState(false);
	React.useEffect(() => {
		if (replacing == null && result?.revision === revision) compose?.assist.checkPieceFix(entityId);
	}, [compose, entityId, replacing, result, revision]);
	const check = checks[entityId];
	const fix = check != null && check.revision === revision ? check.fix : null;
	const works = fix?.commands != null || fix?.rebuildFrom != null;
	function run(): void {
		if (compose == null || !works) return;
		setIsApplying(true);
		void compose.assist.fixPiece(entityId).finally(() => setIsApplying(false));
	}
	const fallback = isPlatform ? 'Place Again' : 'Move Clear';
	const label = fix == null ? 'Checking…' : (fix.label ?? fallback);
	const title = fix == null ? 'Trying the fix on a copy of the track first' : fix.rebuildFrom != null ? fix.message : works ? 'Tried on a copy of the track first: it breaks no hit and adds no problem' : fix.message;
	return (
		<button className="mm-fix-it mm-fix-it-label" disabled={compose == null || replacing != null || isApplying || !works} onClick={run} title={title} type="button">
			{isPlatform ? <WandSparkles size={12} strokeWidth={1.9} /> : null}
			{label}
		</button>
	);
};

/**
 * "Hit by Bass" when another marble hits the piece and its own status is fine, so the problem the summary lists
 * shows on the piece too; a Blocked, Missed or Stopped status says more and stays
 */
function struckStatus(status: TTimingStatus | null, hitBy: TPreflightIssue[] | undefined): TTimingStatus | null {
	const first = hitBy?.[0];
	if (first == null || status?.tone === 'bad') return status;
	const marble = first.by ?? 'Another Marble';
	return { tone: 'warn', label: `Hit by ${marble}`, detail: hitBy?.map((issue) => `${issue.title}. ${issue.detail ?? ''}`.trim()).join('\n') ?? '' };
}

/** "Hit Twice" or "Touching" when nothing more serious shows, so the problem the list names shows on the piece too */
function lookStatus(status: TTimingStatus | null, look: TPreflightIssue[] | undefined): TTimingStatus | null {
	const first = look?.[0];
	if (first == null || status?.tone === 'bad' || status?.tone === 'warn') return status;
	return { tone: 'warn', label: first.label ?? first.title, detail: look?.map((issue) => `${issue.title}. ${issue.detail ?? ''}`.trim()).join('\n') ?? '' };
}

const NO_REPLACING = createState<{ done: number; total: number } | null>(null);
const NO_CHECKS = createState<Record<string, TPieceFixCheck>>({});

/** The header subtitle, the piece's tie as words.md names it: `Plays C4 · 0:03.2`, `Follows Marble 1 at 0:03.2` or `None` */
function tieLabel(project: TProject, entity: TEntity): string {
	const attach = attachState(project, entity);
	if (attach.kind === 'free') return 'None';
	const lane = project.music.lanes.find((item) => item.id === attach.laneId);
	if (attach.kind === 'anchored') return `Follows ${lane?.name ?? 'a marble'} at ${formatTime(attach.time)}`;
	const index = lane?.hits.findIndex((item) => item.id === attach.hitId) ?? -1;
	const hit = lane?.hits[index];
	const note = hit?.pitch != null ? noteName(hit.pitch) : `Hit ${index + 1}`;
	return hit == null ? 'Plays a note' : `Plays ${note} · ${formatTime(hit.time)}`;
}

/** The header pill: the hit's timing for a platform that plays a note, what the marble does for a rail or tunnel */
function pieceStatus(project: TProject, entity: TEntity, resolved: TResolvedPiece | undefined, result: TSimulationResult | null): TTimingStatus | null {
	const link = entity.components.hitLink;
	const type = entity.components.piece?.type ?? '';
	if (link == null) return null;
	const attach = attachState(project, entity);
	if (attach.kind === 'linked' && isMusicalPiece(type)) {
		const hit = result?.hits.find((item) => item.pieceEntityId === entity.id || (item.laneId === link.laneId && item.hitId === link.hitId));
		const lane = project.music.lanes.find((item) => item.id === link.laneId);
		const pitch = lane?.hits.find((item) => item.id === link.hitId)?.pitch;
		return timingStatus(resolved, hit, { marble: lane?.name, note: pitch == null ? undefined : noteName(pitch), piece: entity.name ?? undefined });
	}
	const kind = pieceKind(entity.components.piece ?? { type });
	if ((kind === 'path' || kind === 'tube' || kind === 'generated') && resolved != null && result != null) return rideStatus(project, resolved, result, link.laneId);
	if (kind === 'catcher' && resolved != null && result != null) return bowlStatus(project, entity, resolved, result, link.laneId);
	if (resolved?.status === 'blocked') return timingStatus(resolved, undefined, { marble: project.music.lanes.find((item) => item.id === link.laneId)?.name });
	return null;
}

/** Whether the Bowl catches its marble: Catches, Missed, Bounces Out or Blocked, read from the simulation */
function bowlStatus(project: TProject, entity: TEntity, piece: TResolvedPiece, result: TSimulationResult, laneId: string): TTimingStatus {
	const marble = project.music.lanes.find((item) => item.id === laneId)?.name ?? 'The marble';
	const caught = bowlCatch(result, entity.id);
	const enters = piece.entryTime != null ? `Opens at ${formatTime(piece.entryTime)}.\n` : '';
	switch (caught.status) {
		case 'caught':
			return {
				tone: 'good',
				label: 'Catches',
				detail: `${enters}${marble} lands in it at ${formatTime(caught.enterTime ?? 0)}.`
			};
		case 'escaped':
			return { tone: 'bad', label: 'Bounces Out', detail: `${enters}${marble} lands in it and bounces out.` };
		case 'blocked':
			return { tone: 'bad', label: 'Blocked', detail: `${marble} already passes through this spot earlier in its run` };
		case 'missed':
			return { tone: 'bad', label: 'Missed', detail: `${enters}${marble} falls past it without landing in it, or the film ends first.` };
	}
}

/** What the marble does on a rail or tunnel, read from the simulation */
function rideStatus(project: TProject, piece: TResolvedPiece, result: TSimulationResult, laneId: string): TTimingStatus {
	const lane = project.music.lanes.find((item) => item.id === laneId);
	const start = pieceTime(piece) ?? 0;
	const next = lane?.hits.find((hit) => hit.time > start + 1e-3);
	const nextIndex = next != null ? (lane?.hits.indexOf(next) ?? -1) : -1;
	const ride = pathRide(result, piece, laneId, next?.time ?? result.duration);
	const label = getPieceDefinition(piece.type)?.label.toLowerCase() ?? 'piece';
	const marble = lane?.name ?? 'The marble';
	const starts = `Starts at ${formatTime(start)}.`;
	if (piece.status === 'blocked') return { tone: 'bad', label: 'Blocked', detail: `${marble} already passes through this spot earlier in its run` };
	if (ride.enter == null) return { tone: 'bad', label: 'Missed', detail: `${starts}\n${marble} passes the ${label} without touching it.` };
	if (ride.leave == null) {
		return next != null
			? { tone: 'warn', label: 'Still Riding', detail: `${starts}\n${marble} is still on the ${label} at hit ${nextIndex + 1}.` }
			: { tone: 'neutral', label: 'Rides to End', detail: `${starts}\n${marble} stays on the ${label} to the end.` };
	}
	const rides = ride.leave - ride.enter;
	const flight = next == null ? '' : `, then falls ${(next.time - ride.leave).toFixed(2)} s to hit ${nextIndex + 1}`;
	return { tone: 'good', label: `Rides ${rides.toFixed(1)} s`, detail: `${starts}\n${marble} leaves the ${label} after ${rides.toFixed(1)} s${flight}.` };
}

/**
 * The piece's tie, as one row that selects what it is tied to: the note a platform plays, or the marble and
 * moment a piece follows. The icon button detaches it in place.
 */
const AttachSection: React.FC<{ cx: StudioCx; project: TProject; entity: TEntity }> = (props) => {
	const { cx, project, entity } = props;
	const attach = attachState(project, entity);
	if (attach.kind === 'free') return null;
	const lane = project.music.lanes.find((item) => item.id === attach.laneId);
	const hitIndex = lane?.hits.findIndex((item) => item.id === attach.hitId) ?? -1;
	const hit = lane?.hits[hitIndex];

	function detach(): void {
		const result = cx.simulation.$result.get();
		if (result == null) return;
		const [isOk, error, value] = attach.kind === 'linked' ? unlinkPiece(project, result, entity.id) : unanchorPiece(project, result, entity.id);
		if (!isOk) {
			cx.notify(error.message);
			return;
		}
		cx.execute(value.commands);
	}

	function openHit(): void {
		if (attach.kind === 'free') return;
		cx.$selection.set([toHitKey(attach.laneId, attach.hitId)]);
		if (!cx.$playing.get() && hit != null) cx.$playhead.set(hit.time);
	}

	function openMarble(): void {
		if (attach.kind !== 'anchored') return;
		const marble = project.entities.find((item) => item.components.marble?.laneId === attach.laneId);
		if (marble != null) cx.$selection.set([marble.id]);
		if (!cx.$playing.get()) cx.$playhead.set(attach.time);
	}

	const marbleDot = <span className="inline-block h-2 w-2 shrink-0 rounded-full" style={{ background: lane?.color }} />;

	return (
		<Panel
			id="piece.attach"
			title={attach.kind === 'linked' ? 'Plays' : 'Follows'}
			accessory={<HelpTip text="Drop a platform on a note's dot and it plays that note. Drop any piece near the line a marble falls along and it follows that marble without playing. Detach it, or hold ⌥ while dragging, and it stays where it is, tied to nothing." />}
		>
			{attach.kind === 'linked' ? (
				<LinkRow
					title={`Select Hit ${hitIndex + 1}`}
					onOpen={openHit}
					action={
						<button className="mm-icon-button" onClick={detach} title="Detach: keep it where it is, tied to nothing" aria-label="Detach" type="button">
							<Unlink2 size={13} strokeWidth={1.9} />
						</button>
					}
				>
					<span className="inline-flex items-center gap-2">
						{marbleDot}
						<span>
							Hit {hitIndex + 1}
							<span className="mm-insp-secondary">
								{hit?.pitch != null ? ` · ${noteName(hit.pitch)}` : ''} · {formatTime(hit?.time ?? 0)}
							</span>
						</span>
					</span>
				</LinkRow>
			) : (
				<LinkRow
					icon={<Anchor size={13} strokeWidth={1.9} className="shrink-0 text-[var(--text-secondary)]" />}
					title={`Select ${lane?.name ?? 'the marble'}`}
					onOpen={openMarble}
					action={
						<button className="mm-icon-button" onClick={detach} title="Detach: keep it where it is, tied to nothing" aria-label="Detach" type="button">
							<Unlink2 size={13} strokeWidth={1.9} />
						</button>
					}
				>
					<span className="inline-flex items-center gap-2">
						{marbleDot}
						<span>
							{lane?.name ?? 'Marble'}
							<span className="mm-insp-secondary"> · {formatTime(attach.time)}</span>
						</span>
					</span>
				</LinkRow>
			)}
		</Panel>
	);
};

// MARK: - Rails and tunnels

/** Rail or Tunnel for a drawn path, switched in one edit that keeps the path and where it sits */
const PathTypeSection: React.FC<{ cx: StudioCx; project: TProject; entities: TEntity[] }> = (props) => {
	const { cx, project, entities } = props;
	const types = new Set(entities.map((entity) => entity.components.piece?.type));
	const current = types.size === 1 ? [...types][0] : null;
	const layouts = new Set(entities.map((entity) => entity.components.piece?.layout ?? 'path'));
	const layout = layouts.size === 1 ? [...layouts][0] : null;

	function switchTo(type: TPathPieceType): void {
		const switched: TEntity[] = [];
		for (const entity of entities) switched.push(withPathType(entity, type, [...project.entities, ...switched]));
		const commands = switched.filter((entity, index) => entity !== entities[index]).map((entity): TProjectCommand => ({ type: 'upsertEntity', entity }));
		if (commands.length > 0) cx.execute(commands);
	}

	function setLayout(value: TRailLayout): void {
		cx.execute(entities.map((entity): TProjectCommand => ({ type: 'upsertEntity', entity: withRailLayout(entity, value) })));
	}

	return (
		<Panel id="piece.pathType" title="Rail">
			<div className="mm-segmented" data-span="2" role="radiogroup" aria-label="Rail or tunnel">
				{pathPieceTypes.map((type) => (
					<button
						key={type}
						className="inline-flex items-center justify-center gap-1.5"
						role="radio"
						aria-checked={current === type}
						data-active={current === type}
						onClick={() => switchTo(type)}
						type="button"
					>
						<PieceIcon type={type} size={14} />
						{getPieceDefinition(type)?.label ?? type}
					</button>
				))}
			</div>
			{current === 'rail' ? (
				<SelectField
					id="rail-layout"
					label="Layout"
					span={2}
					value={layout ?? ''}
					options={RAIL_LAYOUTS.map((value) => ({ value, label: railLayoutInfo[value].label }))}
					onChange={(value) => setLayout(value as TRailLayout)}
				/>
			) : null}
		</Panel>
	);
};

/** Length and slope of a rail or tunnel run, edited by scaling and turning it around the entry */
const PathRunFields: React.FC<{ cx: StudioCx; project: TProject; entity: TEntity; piece: TResolvedPiece }> = (props) => {
	const { cx, project, entity, piece } = props;
	const type = entity.components.piece?.type ?? 'rail';
	const controls = resolvePiecePath(type, entity.components.path?.points);
	const run = pathRun(controls);
	const world = worldRunSlope(piece, controls);

	const withLength = (centimetres: number): TVec2[] => withPathRun(controls, centimetres / 100, run.slope);
	const withSlope = (degrees: number): TVec2[] => turnPathRun(controls, -(toRadians(degrees) - world.slope) * world.direction);
	const pathProject = (points: TVec2[]): TProject => ({
		...project,
		entities: project.entities.map((item) => (item.id === entity.id ? { ...item, components: { ...item.components, path: { points } } } : item))
	});
	const commitPath = (points: TVec2[]): void => {
		cx.execute([{ type: 'setComponent', entityId: entity.id, component: { name: 'path', value: { points } } }]);
		cx.simulation.endPreview();
	};

	return (
		<>
			<ScrubField
				id="path-length"
				label="L"
				name="Length"
				value={Math.round(run.length * 1000) / 10}
				unit="cm"
				step={0.2}
				precision={1}
				min={3}
				max={60}
				onPreview={(value) => cx.simulation.startPreview(pathProject(withLength(value)))}
				onCommit={(value) => commitPath(withLength(value))}
				onCancel={() => cx.simulation.endPreview()}
			/>
			<ScrubField
				id="path-slope"
				label="Slope"
				name="Slope"
				value={Math.round(toDegrees(world.slope) * 10) / 10}
				unit="°"
				step={0.25}
				precision={1}
				min={-30}
				max={60}
				onPreview={(value) => cx.simulation.startPreview(pathProject(withSlope(value)))}
				onCommit={(value) => commitPath(withSlope(value))}
				onCancel={() => cx.simulation.endPreview()}
			/>
		</>
	);
};

// MARK: - Hitbox and Physics

/** The piece type's parameters in two collapsed panels: what a marble touches and how the piece behaves */
const ParamsSections: React.FC<{ cx: StudioCx; project: TProject; entities: TEntity[]; type: string; railLayout: TRailLayout | undefined }> = (props) => {
	const { type, railLayout } = props;
	const panels = pieceParamPanels(type, railLayout);
	return (
		<>
			{panels.hitbox.length > 0 ? <ParamsPanel {...props} id="piece.hitbox" title="Hitbox" help="What a marble touches. A skin in Film changes only how the piece looks." names={panels.hitbox} /> : null}
			{panels.physics.length > 0 ? <ParamsPanel {...props} id="piece.physics" title="Physics" names={panels.physics} /> : null}
		</>
	);
};

/** One collapsed panel of parameters, with units people read: cm, mm, ms, rpm */
const ParamsPanel: React.FC<{ cx: StudioCx; project: TProject; entities: TEntity[]; type: string; id: string; title: string; help?: string; names: string[] }> = (props) => {
	const { cx, project, entities, type, id, title, help, names } = props;
	const definition = getPieceDefinition(type);
	if (definition == null) return null;

	return (
		<Panel id={id} title={title} accessory={help != null ? <HelpTip text={help} /> : undefined} defaultCollapsed isDense>
			{names.map((name) => {
				const spec = definition.params[name];
				if (spec == null) return null;
				const label = spec.short ?? spec.label;
				const display = displayUnit(name, spec.unit, spec.integer === true);
				const values = entities.map((entity) => resolvedParam(entity, name));
				const shared = values.every((value) => Math.abs(value - (values[0] ?? 0)) < 1e-12) ? (values[0] ?? null) : null;
				const edit = (value: number): TPieceEdit => ({ params: { [name]: value / display.factor } });
				return (
					<ScrubField
						key={name}
						id={`piece-param-${name}`}
						label={label}
						name={spec.label}
						span={label.length > 7 ? 2 : undefined}
						value={shared == null ? null : Math.round(shared * display.factor * 10 ** display.precision) / 10 ** display.precision}
						unit={display.unit}
						step={display.step}
						precision={display.precision}
						min={spec.min * display.factor}
						max={spec.max * display.factor}
						onPreview={(value) => cx.simulation.startPreview(applyPieceEdit(project, entities, edit(value)).project)}
						onCommit={(value) => {
							cx.execute(applyPieceEdit(project, entities, edit(value)).commands);
							cx.simulation.endPreview();
						}}
						onCancel={() => cx.simulation.endPreview()}
					/>
				);
			})}
		</Panel>
	);
};

function displayUnit(name: string, unit: string, isInteger: boolean): { unit: string; factor: number; step: number; precision: number } {
	if (isInteger) return { unit: '', factor: 1, step: 0.05, precision: 0 };
	switch (unit) {
		case 'm':
			// Wires and walls are millimetres; lengths are centimetres
			return name === 'radius' || name === 'gap' || name === 'bore' || name.endsWith('Thickness') || name === 'thickness'
				? { unit: 'mm', factor: 1000, step: 0.05, precision: 1 }
				: { unit: 'cm', factor: 100, step: 0.1, precision: 1 };
		case 's':
			return { unit: 'ms', factor: 1000, step: 2, precision: 0 };
		case 'rad':
			return { unit: '°', factor: 180 / Math.PI, step: 0.5, precision: 1 };
		case 'rad/s':
			return { unit: 'rpm', factor: 60 / (2 * Math.PI), step: 0.5, precision: 0 };
		case '°':
			return { unit: '°', factor: 1, step: 0.5, precision: 0 };
		default:
			return { unit: '', factor: 1, step: 0.02, precision: 2 };
	}
}

// MARK: - Edits

interface TPieceEdit {
	hitLink?: Partial<NonNullable<TComponents['hitLink']>>;
	params?: Record<string, number>;
	/** Surface angle: the link's for attached pieces, the transform's for free ones */
	angle?: number;
	/** Free position, ignored for attached pieces */
	position?: Partial<TVec2>;
}

/**
 * The same edit for every piece, as a preview project and as the commands that commit it. An edited link drops a pin,
 * so the piece follows its hit.
 */
function applyPieceEdit(project: TProject, entities: TEntity[], edit: TPieceEdit): { project: TProject; commands: TProjectCommand[] } {
	const commands: TProjectCommand[] = [];
	const edited = new Map<string, TEntity>();
	for (const entity of entities) {
		const components = { ...entity.components };
		const linkPatch = edit.hitLink != null || edit.angle != null ? { ...edit.hitLink, ...(edit.angle != null ? { angle: edit.angle } : {}) } : null;
		if (linkPatch != null && components.hitLink != null) {
			const { held: _held, ...link } = components.hitLink;
			components.hitLink = { ...link, ...linkPatch };
			commands.push({ type: 'setComponent', entityId: entity.id, component: { name: 'hitLink', value: components.hitLink } });
		} else if ((edit.angle != null || edit.position != null) && components.hitLink == null && components.transform != null) {
			components.transform = { position: { ...components.transform.position, ...edit.position }, angle: edit.angle ?? components.transform.angle };
			commands.push({ type: 'setComponent', entityId: entity.id, component: { name: 'transform', value: components.transform } });
		}
		if (edit.params != null && components.piece != null) {
			components.piece = { ...components.piece, params: { ...components.piece.params, ...edit.params } };
			commands.push({ type: 'setComponent', entityId: entity.id, component: { name: 'piece', value: components.piece } });
		}
		edited.set(entity.id, { ...entity, components });
	}
	return { project: { ...project, entities: project.entities.map((entity) => edited.get(entity.id) ?? entity) }, commands };
}

/** The layout all these rails share, Drawn when none is set, or undefined when they differ */
function sharedRailLayout(entities: TEntity[]): TRailLayout | undefined {
	const layouts = new Set(entities.map((entity) => entity.components.piece?.layout ?? 'path'));
	return layouts.size === 1 ? [...layouts][0] : undefined;
}

function resolvedParam(entity: TEntity, name: string): number {
	const piece = entity.components.piece;
	return piece?.params[name] ?? getPieceDefinition(piece?.type ?? '')?.params[name]?.default ?? 0;
}
