import { useFeatureState } from 'feature-react/state';
import { Anchor, Unlink2, WandSparkles } from 'lucide-react';
import React from 'react';
import { HelpTip, InspectorHeader, LinkRow, Panel, ScrubField, SelectField, StatusPill } from '@/components';
import type { TPiece, TPlace, TProject, TProjectCommand, TVec2 } from '@/modules/project';
import { bowlCatch, getPieceDefinition, isMusicalPiece, isPathPieceType, PIECE_TYPES, RAIL_LAYOUTS, type TPathPieceType, railLayoutInfo, resolvePiecePath, soundsHit, unanchorPiece, unlinkPiece, type TRailLayout, type TResolvedPiece, type TSimulationResult } from '@/modules/simulation';
import { formatTime, freePosition, noteName, toHitKey, tieOf } from '@/modules/project';
import { pieceProblems, struckPieces, type TPreflightIssue, attachState, withPathType, withRailLayout } from '@/modules/building';
import { useRunPreflight, PieceIcon } from '@/modules/canvas';
import type { StudioCx } from '@/modules/studio';
import { normalizeSurfaceAngle, toDegrees, toRadians } from './angles';
import { pieceParamPanels, showsLinkPanel } from './piece-panels';
import { pathRide, pathRun, pieceKind, pieceTime, turnPathRun, withPathRun, worldRunSlope } from '@/modules/scene';
import { selectedPlainGroup } from './group-commands';
import { PlainGroupTiles, plainGroupNotes } from './PatternInspector';
import { pieceAngle } from './step-loop';
import { timingStatus, type TTimingStatus } from './timing-status';

const pathPieceTypes = PIECE_TYPES.filter(isPathPieceType);

/**
 * Inspector for selected pieces like Figma UI3: a header with the tie and the timing pill, then Position, Shape, the
 * collapsed Physics panel and the link panel of a linked piece (Plays or Follows). A skin is Film's Appearance.
 */
export const PieceInspector: React.FC<TPieceInspectorProps> = (props) => {
	const { cx, project, ids } = props;
	const result = useFeatureState(cx.simulation.$result);
	const selection = useFeatureState(cx.$selection);
	// Pieces another marble hits, from the problem model the hit summary and Layers read
	const preflight = useRunPreflight(cx);
	const struck = React.useMemo(() => (preflight != null ? struckPieces(preflight) : new Map<string, TPreflightIssue[]>()), [preflight]);
	const looks = React.useMemo(() => (preflight != null ? pieceProblems(preflight) : new Map<string, TPreflightIssue[]>()), [preflight]);
	const pieces = project.track.pieces.filter((piece) => ids.includes(piece.id));
	const first = pieces[0];
	if (first == null) return null;
	const type = first.type ?? 'platform';
	const definition = getPieceDefinition(type);
	const isSingle = pieces.length === 1;
	const label = definition?.label ?? type;
	const isSameType = pieces.every((piece) => piece.type === type);
	const kind = pieceKind(first);
	const isPath = kind === 'path' || kind === 'tube';
	const resolved = result?.pieces.find((item) => item.pieceId === first.id);
	const attach = attachState(project, first);
	const isFree = pieces.every((piece) => tieOf(piece) == null);

	const angles = pieces.map(pieceAngle);
	const sharedAngle = angles.length > 0 && angles.every((angle) => Math.abs(angle - (angles[0] ?? 0)) < 1e-9) ? (angles[0] ?? null) : null;
	const link = isSingle ? tieOf(first) : undefined;
	const free = isSingle ? freePosition(first) : undefined;

	// Scrubs preview through the simulation without history; a release commits one edit
	function preview(edit: TPieceEdit): void {
		cx.simulation.startPreview(applyPieceEdit(project, pieces, edit).project);
	}
	function commit(edit: TPieceEdit): void {
		cx.execute(applyPieceEdit(project, pieces, edit).commands);
		cx.simulation.endPreview();
	}
	const cancel = (): void => cx.simulation.endPreview();

	const angleEdit = (degrees: number): TPieceEdit => ({ angle: toRadians(degrees) });
	const contactEdit = (percent: number): TPieceEdit => ({ contactAt: percent / 100 });
	const positionEdit = (axis: 'x' | 'y', centimeters: number): TPieceEdit => ({ position: { [axis]: centimeters / 100 } });

	// A plain Group selected as a whole reads by its name, with its tiles below
	const group = selectedPlainGroup(project, selection);
	const groupNotes = group != null ? plainGroupNotes(project, group) : null;
	const title = group?.name ?? (isSingle ? (first.name ?? label) : isSameType ? `${pieces.length} ${label}s` : `${pieces.length} Pieces`);
	const subtitle = group != null ? `Group · ${pieces.length} ${pieces.length === 1 ? 'piece' : 'pieces'}${groupNotes != null ? `, ${groupNotes.count} hits` : ''}` : isSingle ? tieLabel(project, first) : isSameType ? 'Multiple selection' : 'Different piece types';
	const position = free ?? resolved?.position ?? null;
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
				onRename={isSingle ? (name) => cx.execute([{ type: 'addPiece', piece: { ...first, name } }]) : undefined}
				status={status == null ? null : <StatusPill tone={status.tone} label={status.label} detail={status.detail} />}
				fix={
					// Fix sits under the problem
					status == null || link == null ? null : ((status.tone === 'bad' || status.tone === 'warn') && soundsHit(type, link)) || (resolved?.status === 'blocked' && !soundsHit(type, link)) || hitBy != null || isBowlMissed || look != null ? <FixButton cx={cx} pieceId={first.id} /> : null
				}
			/>
			{group != null ? <PlainGroupTiles cx={cx} project={project} group={group} /> : null}
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
				{isPath && isSingle && resolved != null && first.path?.nodes == null ? <PathRunFields cx={cx} project={project} piece={first} resolved={resolved} /> : null}
				{link != null && attach.kind === 'linked' && kind === 'box' ? (
					<ScrubField
						id="piece-contact"
						label="Lands At"
						name="Where along the platform the marble lands"
						value={Math.round((link.contactAt ?? 0.5) * 100)}
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
			{isSameType && definition != null ? <ParamsSections cx={cx} project={project} pieces={pieces} type={type} railLayout={sharedRailLayout(pieces)} /> : null}
			{showsLinkPanel(pieces) ? <AttachSection cx={cx} project={project} piece={first} /> : null}
		</>
	);
};

interface TPieceInspectorProps {
	cx: StudioCx;
	project: TProject;
	ids: string[];
}

/** Fix under a piece's problem pill: says in the notice what it did or why it couldn't, as one undo step */
export const FixButton: React.FC<{ cx: StudioCx; pieceId: string }> = (props) => {
	const { cx, pieceId } = props;
	const trackCx = useFeatureState(cx.$trackCx);
	const fixing = useFeatureState(cx.assist.$fixing);
	return (
		<button className="mm-fix-it mm-fix-it-label" disabled={trackCx == null || fixing != null} onClick={() => void cx.assist.fix(pieceId)} title="Try to clear this problem without breaking a hit" type="button">
			<WandSparkles size={12} strokeWidth={1.9} />
			Fix
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


/** The header subtitle, the piece's tie as words.md names it: `Plays C4 · 0:03.2`, `Follows Marble 1 at 0:03.2` or `None` */
function tieLabel(project: TProject, piece: TPiece): string {
	const attach = attachState(project, piece);
	if (attach.kind === 'free') return 'None';
	const marble = project.marbles.find((item) => item.id === attach.marbleId);
	if (attach.kind === 'anchored') return `Follows ${marble?.name ?? 'a marble'} at ${formatTime(attach.time)}`;
	const index = marble?.hits.findIndex((item) => item.id === attach.hitId) ?? -1;
	const hit = marble?.hits[index];
	const note = hit?.pitch != null ? noteName(hit.pitch) : `Hit ${index + 1}`;
	return hit == null ? 'Plays a note' : `Plays ${note} · ${formatTime(hit.time)}`;
}

/** The header pill: the hit's timing for a platform that plays a note, what the marble does for a rail or tunnel */
function pieceStatus(project: TProject, piece: TPiece, resolved: TResolvedPiece | undefined, result: TSimulationResult | null): TTimingStatus | null {
	const link = tieOf(piece);
	const type = piece.type ?? '';
	if (link == null) return null;
	const attach = attachState(project, piece);
	if (attach.kind === 'linked' && isMusicalPiece(type)) {
		const hit = result?.hits.find((item) => item.pieceId === piece.id || (item.marbleId === link.marbleId && item.hitId === link.hitId));
		const marble = project.marbles.find((item) => item.id === link.marbleId);
		const pitch = marble?.hits.find((item) => item.id === link.hitId)?.pitch;
		return timingStatus(resolved, hit, { marble: marble?.name, note: pitch == null ? undefined : noteName(pitch), piece: piece.name ?? undefined });
	}
	const kind = pieceKind(piece);
	if ((kind === 'path' || kind === 'tube' || kind === 'generated') && resolved != null && result != null) return rideStatus(project, resolved, result, link.marbleId);
	if (kind === 'catcher' && resolved != null && result != null) return bowlStatus(project, piece, resolved, result, link.marbleId);
	if (resolved?.status === 'blocked') return timingStatus(resolved, undefined, { marble: project.marbles.find((item) => item.id === link.marbleId)?.name });
	return null;
}

/** Whether the Bowl catches its marble: Catches, Missed, Bounces Out or Blocked, read from the simulation */
function bowlStatus(project: TProject, piece: TPiece, resolvedPiece: TResolvedPiece, result: TSimulationResult, marbleId: string): TTimingStatus {
	const marble = project.marbles.find((item) => item.id === marbleId)?.name ?? 'The marble';
	const caught = bowlCatch(result, piece.id);
	const enters = resolvedPiece.entryTime != null ? `Opens at ${formatTime(resolvedPiece.entryTime)}.\n` : '';
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
function rideStatus(project: TProject, piece: TResolvedPiece, result: TSimulationResult, marbleId: string): TTimingStatus {
	const marble = project.marbles.find((item) => item.id === marbleId);
	const start = pieceTime(piece) ?? 0;
	const next = marble?.hits.find((hit) => hit.time > start + 1e-3);
	const nextIndex = next != null ? (marble?.hits.indexOf(next) ?? -1) : -1;
	const ride = pathRide(result, piece, marbleId, next?.time ?? result.duration);
	const label = getPieceDefinition(piece.type)?.label.toLowerCase() ?? 'piece';
	const marbleName = marble?.name ?? 'The marble';
	const starts = `Starts at ${formatTime(start)}.`;
	if (piece.status === 'blocked') return { tone: 'bad', label: 'Blocked', detail: `${marbleName} already passes through this spot earlier in its run` };
	if (ride.enter == null) return { tone: 'bad', label: 'Missed', detail: `${starts}\n${marbleName} passes the ${label} without touching it.` };
	if (ride.leave == null) {
		return next != null
			? { tone: 'warn', label: 'Still Riding', detail: `${starts}\n${marbleName} is still on the ${label} at hit ${nextIndex + 1}.` }
			: { tone: 'neutral', label: 'Rides to End', detail: `${starts}\n${marbleName} stays on the ${label} to the end.` };
	}
	const rides = ride.leave - ride.enter;
	const flight = next == null ? '' : `, then falls ${(next.time - ride.leave).toFixed(2)} s to hit ${nextIndex + 1}`;
	return { tone: 'good', label: `Rides ${rides.toFixed(1)} s`, detail: `${starts}\n${marbleName} leaves the ${label} after ${rides.toFixed(1)} s${flight}.` };
}

/**
 * The piece's tie, as one row that selects what it is tied to: the note a platform plays, or the marble and
 * moment a piece follows. The icon button detaches it in place.
 */
const AttachSection: React.FC<{ cx: StudioCx; project: TProject; piece: TPiece }> = (props) => {
	const { cx, project, piece } = props;
	const attach = attachState(project, piece);
	if (attach.kind === 'free') return null;
	const marble = project.marbles.find((item) => item.id === attach.marbleId);
	const hitIndex = marble?.hits.findIndex((item) => item.id === attach.hitId) ?? -1;
	const hit = marble?.hits[hitIndex];

	function detach(): void {
		const result = cx.simulation.$result.get();
		if (result == null) return;
		const [isOk, error, value] = attach.kind === 'linked' ? unlinkPiece(project, result, piece.id) : unanchorPiece(project, result, piece.id);
		if (!isOk) {
			cx.notify(error.message);
			return;
		}
		cx.execute(value.commands);
	}

	function openHit(): void {
		if (attach.kind === 'free') return;
		cx.$selection.set([toHitKey(attach.marbleId, attach.hitId)]);
		if (!cx.$playing.get() && hit != null) cx.$playhead.set(hit.time);
	}

	function openMarble(): void {
		if (attach.kind !== 'anchored') return;
		const marble = project.marbles.find((item) => item.id === attach.marbleId);
		if (marble != null) cx.$selection.set([marble.id]);
		if (!cx.$playing.get()) cx.$playhead.set(attach.time);
	}

	const marbleDot = <span className="inline-block h-2 w-2 shrink-0 rounded-full" style={{ background: marble?.labelColor }} />;

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
					title={`Select ${marble?.name ?? 'the marble'}`}
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
							{marble?.name ?? 'Marble'}
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
const PathTypeFields: React.FC<{ cx: StudioCx; project: TProject; pieces: TPiece[] }> = (props) => {
	const { cx, project, pieces } = props;
	const types = new Set(pieces.map((piece) => piece.type));
	const current = types.size === 1 ? [...types][0] : null;
	const layouts = new Set(pieces.map((piece) => piece.layout ?? 'path'));
	const layout = layouts.size === 1 ? [...layouts][0] : null;

	function switchTo(type: TPathPieceType): void {
		const switched: TPiece[] = [];
		for (const piece of pieces) switched.push(withPathType(piece, type, [...project.track.pieces, ...switched]));
		const commands = switched.filter((piece, index) => piece !== pieces[index]).map((piece): TProjectCommand => ({ type: 'addPiece', piece }));
		if (commands.length > 0) cx.execute(commands);
	}

	function setLayout(value: TRailLayout): void {
		if (cx.execute(pieces.map((piece): TProjectCommand => ({ type: 'addPiece', piece: withRailLayout(piece, value) })))) cx.$trackCx.get()?.revealOnceSimulated(pieces.map((piece) => piece.id));
	}

	return (
		<>
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
		</>
	);
};

/** Length and slope of a rail or tunnel run, edited by scaling and turning it around the entry */
const PathRunFields: React.FC<{ cx: StudioCx; project: TProject; piece: TPiece; resolved: TResolvedPiece }> = (props) => {
	const { cx, project, piece, resolved: resolvedPiece } = props;
	const type = piece.type ?? 'rail';
	const controls = resolvePiecePath(type, piece.path?.points);
	const run = pathRun(controls);
	const world = worldRunSlope(resolvedPiece, controls);

	const withLength = (centimeters: number): TVec2[] => withPathRun(controls, centimeters / 100, run.slope);
	const withSlope = (degrees: number): TVec2[] => turnPathRun(controls, -(toRadians(degrees) - world.slope) * world.direction);
	const pathProject = (points: TVec2[]): TProject => ({
		...project,
		track: { ...project.track, pieces: project.track.pieces.map((item) => (item.id === piece.id ? { ...item, path: { points } } : item)) }
	});
	const commitPath = (points: TVec2[]): void => {
		cx.execute([{ type: 'updatePiece', pieceId: piece.id, patch: { path: { points } } }]);
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

// MARK: - Shape and Physics

/** The piece type's parameters in two panels: its size, open like Position, and how it behaves, collapsed */
const ParamsSections: React.FC<{ cx: StudioCx; project: TProject; pieces: TPiece[]; type: string; railLayout: TRailLayout | undefined }> = (props) => {
	const { type, railLayout, cx, project, pieces } = props;
	const panels = pieceParamPanels(type, railLayout);
	const isPath = pieces.every((piece) => isPathPieceType(piece.type));
	return (
		<>
			{panels.shape.length > 0 || isPath ? (
				<ParamsPanel {...props} id="piece.shape" title="Shape" help="The piece's size, which skins in Film follow. Depth is how far it stands out of the wall; a marble never feels it. The rest is the hitbox, what a marble touches." names={panels.shape} isOpen>
					{isPath ? <PathTypeFields cx={cx} project={project} pieces={pieces} /> : null}
				</ParamsPanel>
			) : null}
			{panels.physics.length > 0 ? <ParamsPanel {...props} id="piece.physics" title="Physics" names={panels.physics} /> : null}
		</>
	);
};

/** One panel of parameters, collapsed unless `isOpen`, with units people read: cm, mm, ms, rpm */
const ParamsPanel: React.FC<{ cx: StudioCx; project: TProject; pieces: TPiece[]; type: string; id: string; title: string; help?: string; names: string[]; isOpen?: boolean; children?: React.ReactNode }> = (props) => {
	const { cx, project, pieces, type, id, title, help, names, isOpen = false, children } = props;
	const definition = getPieceDefinition(type);
	if (definition == null) return null;

	return (
		<Panel id={id} title={title} accessory={help != null ? <HelpTip text={help} /> : undefined} defaultCollapsed={!isOpen} isDense>
			{children}
			{names.map((name) => {
				const spec = definition.params[name];
				if (spec == null) return null;
				const label = spec.short ?? spec.label;
				const display = displayUnit(name, spec.unit, spec.integer === true);
				const values = pieces.map((piece) => resolvedParam(piece, name));
				const shared = values.every((value) => Math.abs(value - (values[0] ?? 0)) < 1e-12) ? (values[0] ?? null) : null;
				const edit = (value: number): TPieceEdit => ({ params: { [name]: value / display.factor } });
				return (
					<ScrubField
						key={name}
						id={`piece-param-${name}`}
						label={label}
						name={spec.label}
						span={label.length > 9 ? 2 : undefined}
						value={shared == null ? null : Math.round(shared * display.factor * 10 ** display.precision) / 10 ** display.precision}
						unit={display.unit}
						step={display.step}
						precision={display.precision}
						min={spec.min * display.factor}
						max={spec.max * display.factor}
						onPreview={(value) => cx.simulation.startPreview(applyPieceEdit(project, pieces, edit(value)).project)}
						onCommit={(value) => {
							cx.execute(applyPieceEdit(project, pieces, edit(value)).commands);
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
			// A piece's Shape reads in one unit, centimeters; only the wires' fine sizes are millimeters
			return name === 'radius' || name === 'gap' || name === 'bore'
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
	/** Where a tied piece's marble lands along it */
	contactAt?: number;
	params?: Record<string, number>;
	angle?: number;
	/** Free position, ignored for tied pieces */
	position?: Partial<TVec2>;
}

/**
 * The same edit for every piece, as a preview project and as the commands that commit it. An edited tie drops a pin,
 * so the piece follows its hit.
 */
function applyPieceEdit(project: TProject, pieces: TPiece[], edit: TPieceEdit): { project: TProject; commands: TProjectCommand[] } {
	const commands: TProjectCommand[] = [];
	const edited = new Map<string, TPiece>();
	for (const piece of pieces) {
		const patch: { angle?: number; place?: TPlace; params?: Record<string, number> } = {};
		const link = tieOf(piece);
		if (link != null && (edit.contactAt != null || edit.angle != null)) {
			if (edit.contactAt != null) patch.place = { ...link, contactAt: edit.contactAt };
			if (edit.angle != null) patch.angle = edit.angle;
		} else if (piece.place.kind === 'free' && (edit.angle != null || edit.position != null)) {
			if (edit.position != null) patch.place = { kind: 'free', position: { ...piece.place.position, ...edit.position } };
			if (edit.angle != null) patch.angle = edit.angle;
		}
		if (edit.params != null) patch.params = { ...piece.params, ...edit.params };
		if (Object.keys(patch).length > 0) commands.push({ type: 'updatePiece', pieceId: piece.id, patch });
		edited.set(piece.id, { ...piece, ...patch });
	}
	return { project: { ...project, track: { ...project.track, pieces: project.track.pieces.map((piece) => edited.get(piece.id) ?? piece) } }, commands };
}

/** The layout all these rails share, Drawn when none is set, or undefined when they differ */
function sharedRailLayout(pieces: TPiece[]): TRailLayout | undefined {
	const layouts = new Set(pieces.map((piece) => piece.layout ?? 'path'));
	return layouts.size === 1 ? [...layouts][0] : undefined;
}

function resolvedParam(piece: TPiece, name: string): number {
	return piece.params[name] ?? getPieceDefinition(piece.type)?.params[name]?.default ?? 0;
}
