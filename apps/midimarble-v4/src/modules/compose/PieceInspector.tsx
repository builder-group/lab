import { useFeatureState } from 'feature-react/state';
import React from 'react';
import { ScrubField } from '@/components';
import type { TComponents, TEntity, TProject, TProjectCommand } from '@/modules/project';
import { getPieceDefinition, type THitResult, type TResolvedPiece } from '@/modules/simulation';
import { formatTime, noteName } from '@/modules/studio/format';
import type { StudioCx } from '@/modules/studio/StudioCx';
import { normalizeSurfaceAngle, toDegrees, toRadians } from './angles';
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

	return (
		<div className="flex flex-col gap-1 py-2">
			<div className="mm-section-title">{isSingle ? label : `${entities.length} ${label}s`}</div>
			<div className="flex flex-col gap-1.5 px-3">
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
				{link != null ? (
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
					<label htmlFor="piece-pinned">Pinned</label>
					<label className="flex items-center gap-2 text-[12px] text-[var(--text-secondary)]">
						<input
							id="piece-pinned"
							type="checkbox"
							className="accent-[var(--accent)]"
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
						Keep in place <span className="text-[var(--text-tertiary)]">P</span>
					</label>
				</div>
			</div>
			{isSingle && link != null ? (
				<HitSection
					project={project}
					laneId={link.laneId}
					hitId={link.hitId}
					piece={result?.pieces.find((item) => item.entityId === first.id)}
					hit={result?.hits.find((item) => item.pieceEntityId === first.id || (item.laneId === link.laneId && item.hitId === link.hitId))}
				/>
			) : null}
		</div>
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
		<>
			<div className="mm-section-title mt-1 border-t border-[var(--separator)] pt-3">Hit</div>
			<div className="flex flex-col gap-1 px-3">
				<InfoRow label="Time">
					<span className="mm-mono">{note == null ? 'Missing' : formatTime(note.time)}</span>
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
					{timing.detail != null ? <span className="mm-mono ml-1 text-[var(--text-secondary)]">· {timing.detail}</span> : null}
				</InfoRow>
				{timing.reason != null ? <div className="pl-[84px] text-[11px] leading-snug text-[var(--text-secondary)]">{timing.reason}</div> : null}
			</div>
		</>
	);
};

interface THitSectionProps {
	project: TProject;
	laneId: string;
	hitId: string;
	piece: TResolvedPiece | undefined;
	hit: THitResult | undefined;
}

const InfoRow: React.FC<{ label: string; children: React.ReactNode }> = (props) => {
	const { label, children } = props;
	return (
		<div className="mm-field">
			<span className="text-right text-[var(--text-secondary)]">{label}</span>
			<span className="flex min-w-0 items-center text-[12px]">{children}</span>
		</div>
	);
};

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
