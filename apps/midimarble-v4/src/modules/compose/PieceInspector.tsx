import { useFeatureState } from 'feature-react/state';
import React from 'react';
import { InfoRow, InspectorHeader, Panel, ScrubField } from '@/components';
import type { TComponents, TEntity, TProject, TProjectCommand, TVec2 } from '@/modules/project';
import { getPieceDefinition, isMusicalPiece, resolvePiecePath, type THitResult, type TResolvedPiece, type TSimulationResult } from '@/modules/simulation';
import { formatTime, noteName } from '@/modules/studio/format';
import type { StudioCx } from '@/modules/studio/StudioCx';
import { normalizeSurfaceAngle, toDegrees, toRadians } from './angles';
import { PieceIcon } from './piece-icons';
import { pathRide, pathRun, pieceKind, pieceTime, turnPathRun, withPathRun, worldRunSlope } from './scene';
import { badgeStatus, badgeStyles, StatusIcon } from './status';

/** Inspector for selected pieces, with compact Figma-style sections */
export const PieceInspector: React.FC<TPieceInspectorProps> = (props) => {
	const { cx, project, ids } = props;
	const result = useFeatureState(cx.simulation.$result);
	const entities = project.entities.filter((entity) => ids.includes(entity.id) && entity.components.piece != null);
	const first = entities[0];
	if (first == null) return null;
	const type = first.components.piece?.type ?? 'platform';
	const definition = getPieceDefinition(type);
	const isSingle = entities.length === 1;
	const label = definition?.label ?? type;
	const isSameType = entities.every((entity) => entity.components.piece?.type === type);
	const kind = pieceKind({ type });
	const isPath = kind === 'path' || kind === 'tube';
	const resolved = result?.pieces.find((item) => item.entityId === first.id);

	const angles = entities.map((entity) => entity.components.hitLink?.angle).filter((angle) => angle != null);
	const sharedAngle = angles.length > 0 && angles.every((angle) => Math.abs(angle - (angles[0] ?? 0)) < 1e-9) ? (angles[0] ?? null) : null;
	const lengths = entities.map((entity) => resolvedParam(entity, 'length'));
	const sharedLength = lengths.every((length) => length === lengths[0]) ? (lengths[0] ?? null) : null;
	const link = isSingle ? first.components.hitLink : undefined;
	const allPinned = entities.every((entity) => entity.components.hitLink?.pinned === true);

	// Scrubs preview through the simulation without history; a release commits one edit
	function preview(edit: TPieceEdit): void {
		cx.simulation.startPreview(applyPieceEdit(project, entities, edit).project);
	}
	function commit(edit: TPieceEdit): void {
		cx.execute(applyPieceEdit(project, entities, edit).commands);
		cx.simulation.endPreview();
	}

	const angleEdit = (degrees: number): TPieceEdit => ({ hitLink: { angle: toRadians(degrees) } });
	const lengthEdit = (centimetres: number): TPieceEdit => ({ params: { length: centimetres / 100 } });
	const contactEdit = (percent: number): TPieceEdit => ({ hitLink: { contactAt: percent / 100 } });

	const lane = project.music.lanes.find((item) => item.id === link?.laneId);
	const hitIndex = lane?.hits.findIndex((item) => item.id === link?.hitId) ?? -1;
	const subtitle = isSingle
		? [label, lane != null && hitIndex >= 0 ? `${lane.name} Hit ${hitIndex + 1}` : null].filter(Boolean).join(' · ')
		: isSameType
			? 'Mixed values are left empty'
			: 'Different piece types';
	const title = isSingle ? (first.name ?? label) : isSameType ? `${entities.length} ${label}s` : `${entities.length} Pieces`;

	return (
		<>
			<InspectorHeader icon={<PieceIcon type={isSameType ? type : 'platform'} size={16} />} title={title} subtitle={subtitle} />
			<Panel id="piece.transform" title="Transform">
				{!isPath ? (
					<ScrubField
						id="piece-angle"
						label="Angle"
						value={sharedAngle == null ? null : Math.round(toDegrees(normalizeSurfaceAngle(sharedAngle)) * 10) / 10}
						unit="°"
						step={0.5}
						precision={1}
						min={-90}
						max={90}
						onPreview={(value) => preview(angleEdit(value))}
						onCommit={(value) => commit(angleEdit(value))}
						onCancel={() => cx.simulation.endPreview()}
					/>
				) : null}
				{kind === 'box' && isSameType ? (
					<ScrubField
						id="piece-length"
						label="Length"
						value={sharedLength == null ? null : Math.round(sharedLength * 1000) / 10}
						unit="cm"
						step={0.1}
						precision={1}
						min={(definition?.params['length']?.min ?? 0.02) * 100}
						max={(definition?.params['length']?.max ?? 0.3) * 100}
						onPreview={(value) => preview(lengthEdit(value))}
						onCommit={(value) => commit(lengthEdit(value))}
						onCancel={() => cx.simulation.endPreview()}
					/>
				) : null}
				{isPath && isSingle && resolved != null ? (
					<PathRunFields cx={cx} project={project} entity={first} piece={resolved} />
				) : null}
				{link != null && !isPath ? (
					<ScrubField
						id="piece-contact"
						label="Contact"
						value={Math.round(link.contactAt * 100)}
						unit="%"
						step={0.5}
						min={0}
						max={100}
						onPreview={(value) => preview(contactEdit(value))}
						onCommit={(value) => commit(contactEdit(value))}
						onCancel={() => cx.simulation.endPreview()}
					/>
				) : null}
				<div className="mm-field">
					<span className="mm-field-label">Pinned</span>
					<label className="flex items-center gap-2">
						<input
							id="piece-pinned"
							type="checkbox"
							className="mm-checkbox"
							checked={allPinned}
							onChange={() => {
								const pin = !allPinned;
								const commands = entities.flatMap((entity): TProjectCommand[] => {
									const hitLink = entity.components.hitLink;
									const contact = result?.pieces.find((piece) => piece.entityId === entity.id)?.contactPoint;
									if (hitLink == null || (pin && contact == null)) return [];
									return [
										{
											type: 'setComponent',
											entityId: entity.id,
											component: {
												name: 'hitLink',
												value: pin ? { ...hitLink, pinned: true, pinnedPosition: contact ?? undefined } : { ...hitLink, pinned: false, pinnedPosition: undefined }
											}
										}
									];
								});
								cx.execute(commands);
							}}
						/>
						Keep in place
						<kbd className="mm-keycap ml-auto">P</kbd>
					</label>
				</div>
			</Panel>
			{isSameType && definition != null ? <ParamsSection cx={cx} project={project} entities={entities} type={type} /> : null}
			{isSingle && isPath && link != null && resolved != null && result != null ? (
				<RideSection project={project} piece={resolved} result={result} laneId={link.laneId} hitId={link.hitId} />
			) : null}
			{isSingle && link != null && !isPath && isMusicalPiece(type) ? (
				<HitSection
					project={project}
					laneId={link.laneId}
					hitId={link.hitId}
					piece={result?.pieces.find((item) => item.entityId === first.id)}
					hit={result?.hits.find((item) => item.pieceEntityId === first.id || (item.laneId === link.laneId && item.hitId === link.hitId))}
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

const HitSection: React.FC<THitSectionProps> = (props) => {
	const { project, laneId, hitId, piece, hit } = props;
	const lane = project.music.lanes.find((item) => item.id === laneId);
	const index = lane?.hits.findIndex((item) => item.id === hitId) ?? -1;
	const note = lane?.hits[index];
	const status = badgeStatus(piece?.status, hit);
	const timing = timingLabel(piece, hit);

	return (
		<Panel id="piece.timing" title="Timing">
				<InfoRow label="Time">
					<span className="mm-tabular">{note == null ? 'Missing' : formatTime(note.time)}</span>
					{note?.pitch != null ? <span className="ml-1.5 text-[var(--text-secondary)]">{noteName(note.pitch)}</span> : null}
				</InfoRow>
				<InfoRow label="Lane">
					<span className="inline-block h-2 w-2 rounded-full" style={{ background: lane?.color }} />
					<span className="ml-1.5 truncate">{lane?.name ?? 'Removed'}</span>
					{index >= 0 ? <span className="ml-1.5 text-[var(--text-secondary)]">Hit {index + 1}</span> : null}
				</InfoRow>
				<InfoRow label="Timing">
					<StatusIcon status={status} />
					<span className="ml-1.5" style={{ color: status == null ? undefined : badgeStyles[status].color }}>
						{timing.title}
					</span>
					{timing.detail != null ? <span className="mm-tabular ml-1 text-[var(--text-secondary)]">· {timing.detail}</span> : null}
				</InfoRow>
				{timing.reason != null ? <div className="mm-caption pl-[84px]">{timing.reason}</div> : null}
		</Panel>
	);
};

interface THitSectionProps {
	project: TProject;
	laneId: string;
	hitId: string;
	piece: TResolvedPiece | undefined;
	hit: THitResult | undefined;
}

function timingLabel(piece: TResolvedPiece | undefined, hit: THitResult | undefined): { title: string; detail?: string; reason?: string } {
	if (piece?.status === 'blocked' || hit?.status === 'blocked') {
		return { title: 'Blocked', reason: 'The run before this hit already passes through this spot, so the piece is left out.' };
	}
	if (piece?.status === 'unreached') return { title: 'Missed', reason: 'The marble never reaches this hit.' };
	if (hit == null) return { title: 'Simulating…' };
	const detail = hit.error == null ? undefined : formatMs(hit.error);
	switch (hit.status) {
		case 'onTime':
			return { title: 'On time', detail };
		case 'drifting':
			return { title: 'Drifting', detail, reason: 'Still within 20 ms, but an earlier change moved it.' };
		case 'missed':
			if (hit.reason === 'resting') return { title: 'Resting', detail, reason: 'The marble rolls or rests onto this piece instead of striking it, so no note sounds.' };
			return hit.error == null
				? { title: 'Missed', reason: 'The marble does not touch this piece.' }
				: { title: 'Missed', detail, reason: hit.error > 0 ? 'The marble arrives too late.' : 'The marble arrives too early.' };
		case 'open':
			return { title: 'Not placed' };
		default:
			return { title: 'Unknown' };
	}
}

function formatMs(seconds: number): string {
	const ms = Math.round(seconds * 10000) / 10;
	return `${ms > 0 ? '+' : ''}${ms === 0 ? '0.0' : ms.toFixed(1)} ms`;
}

// MARK: - Rails and tunnels

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
				label="Length"
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

/** What the marble does on a rail or tunnel, read from the simulation */
const RideSection: React.FC<{ project: TProject; piece: TResolvedPiece; result: TSimulationResult; laneId: string; hitId: string }> = (props) => {
	const { project, piece, result, laneId, hitId } = props;
	const lane = project.music.lanes.find((item) => item.id === laneId);
	const index = lane?.hits.findIndex((item) => item.id === hitId) ?? -1;
	const start = pieceTime(piece) ?? 0;
	const next = lane?.hits.find((hit) => hit.time > start + 1e-3);
	const nextIndex = next != null ? (lane?.hits.indexOf(next) ?? -1) : -1;
	const ride = pathRide(result, piece, laneId, next?.time ?? result.duration);
	const delay = piece.params['entryDelay'] ?? 0;
	const label = getPieceDefinition(piece.type)?.label.toLowerCase() ?? 'piece';
	const status = rideStatus(piece, ride, next?.time ?? null, nextIndex, label);

	return (
		<Panel id="piece.run" title="Run">
				<InfoRow label="Starts">
					<span className="mm-tabular">{formatTime(start)}</span>
					<span className="ml-1.5 truncate text-[var(--text-secondary)]">
						{delay > 0 ? `${Math.round(delay * 1000)} ms after Hit ${index + 1}` : `at Hit ${index + 1}`}
					</span>
				</InfoRow>
				<div className="mm-caption pl-[84px]" style={{ color: status.tone === 'bad' ? 'var(--bad)' : status.tone === 'warn' ? 'var(--warn)' : undefined }}>
					{status.text}
				</div>
		</Panel>
	);
};

function rideStatus(
	piece: TResolvedPiece,
	ride: { enter: number | null; leave: number | null },
	nextTime: number | null,
	nextIndex: number,
	label: string
): { text: string; tone: 'info' | 'warn' | 'bad' } {
	if (piece.status === 'blocked') return { text: `Blocked: the run before it already passes through this ${label}.`, tone: 'bad' };
	if (ride.enter == null) return { text: `The marble never touches the ${label}.`, tone: 'bad' };
	if (ride.leave == null) {
		return nextTime != null
			? { text: `The marble is still on the ${label} at Hit ${nextIndex + 1}.`, tone: 'warn' }
			: { text: `The marble stays on the ${label} to the end.`, tone: 'info' };
	}
	const rides = ride.leave - ride.enter;
	if (nextTime == null) return { text: `Marble leaves the ${label} after ${rides.toFixed(1)} s.`, tone: 'info' };
	const flight = nextTime - ride.leave;
	return { text: `Marble leaves the ${label} after ${rides.toFixed(1)} s, then flies ${flight.toFixed(2)} s to Hit ${nextIndex + 1}.`, tone: 'info' };
}

// MARK: - Parameters

/** Physical parameters of the piece type not shown above, with units people read: cm, mm, ms, rpm */
const ParamsSection: React.FC<{ cx: StudioCx; project: TProject; entities: TEntity[]; type: string }> = (props) => {
	const { cx, project, entities, type } = props;
	const definition = getPieceDefinition(type);
	const names = Object.keys(definition?.params ?? {}).filter((name) => !(type === 'platform' && name === 'length'));
	if (definition == null || !names.length) return null;

	return (
		<Panel id="piece.physics" title="Physics">
				{names.map((name) => {
					const spec = definition.params[name];
					if (spec == null) return null;
					const display = displayUnit(name, spec.unit, spec.integer === true);
					const values = entities.map((entity) => resolvedParam(entity, name));
					const shared = values.every((value) => Math.abs(value - (values[0] ?? 0)) < 1e-12) ? (values[0] ?? null) : null;
					const edit = (value: number): TPieceEdit => ({ params: { [name]: value / display.factor } });
					return (
						<ScrubField
							key={name}
							id={`piece-param-${name}`}
							label={shortLabels[name] ?? spec.label}
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

// Labels that fit the inspector's label column on one line
const shortLabels: Record<string, string> = {
	bladeThickness: 'Blade width',
	motorSpeed: 'Motor',
	entryDelay: 'Delay'
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
		default:
			return { unit: '', factor: 1, step: 0.02, precision: 2 };
	}
}

// MARK: - Edits

interface TPieceEdit {
	hitLink?: Partial<NonNullable<TComponents['hitLink']>>;
	params?: Record<string, number>;
}

/** The same edit for every piece, as a preview project and as the commands that commit it */
function applyPieceEdit(project: TProject, entities: TEntity[], edit: TPieceEdit): { project: TProject; commands: TProjectCommand[] } {
	const commands: TProjectCommand[] = [];
	const edited = new Map<string, TEntity>();
	for (const entity of entities) {
		const components = { ...entity.components };
		if (edit.hitLink != null && components.hitLink != null) {
			components.hitLink = { ...components.hitLink, ...edit.hitLink };
			commands.push({ type: 'setComponent', entityId: entity.id, component: { name: 'hitLink', value: components.hitLink } });
		}
		if (edit.params != null && components.piece != null) {
			components.piece = { ...components.piece, params: { ...components.piece.params, ...edit.params } };
			commands.push({ type: 'setComponent', entityId: entity.id, component: { name: 'piece', value: components.piece } });
		}
		edited.set(entity.id, { ...entity, components });
	}
	return { project: { ...project, entities: project.entities.map((entity) => edited.get(entity.id) ?? entity) }, commands };
}

function resolvedParam(entity: TEntity, name: string): number {
	const piece = entity.components.piece;
	return piece?.params[name] ?? getPieceDefinition(piece?.type ?? '')?.params[name]?.default ?? 0;
}
