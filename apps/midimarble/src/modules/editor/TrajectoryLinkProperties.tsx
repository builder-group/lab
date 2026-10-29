import { Focus, Link2, Unlink2 } from 'lucide-react';
import React from 'react';
import {
	formatTime,
	getProjectMarbles,
	noteName,
	type TProject,
	type TSceneObject
} from '../project';
import { getStrikePoint, getStrikePointPatch, type TStrikePoint } from './object-editing';
import { NumberField, PropertySection } from './PropertyFields';

/** MIDI anchors follow a note; time anchors follow the same motion without creating a sound. */
export const TrajectoryLinkProperties: React.FC<TTrajectoryLinkPropertiesProps> = (props) => {
	const { project, object, time, onUpdateObject, onLink, onUnlink, onBeginLink, onSeek } = props;
	const note = project.notes.find((item) => item.id === object.binding?.noteId);
	const anchorTime = object.trajectoryAnchor?.time ?? note?.time;
	const linked = object.binding != null || object.trajectoryAnchor != null;
	const marbles = getProjectMarbles(project);
	function attachAtPlayhead() {
		onUpdateObject({
			binding: null,
			marbleId: object.marbleId ?? 'main',
			trajectoryAnchor: { time, offset: [0, 0, 0] }
		});
	}
	return (
		<PropertySection
			title="Trajectory link"
			icon={<Link2 size={12} />}
			help={
				<>
					<p>
						World objects keep their position. Linked objects follow upstream trajectory changes.
						Unlink keeps the current world position.
					</p>
					<p>
						Link an instrument to a note using the picker or drag its scene-tree row onto a timeline
						note. MIDI keeps its own sound timing.
					</p>
					<p>
						Follow at playhead attaches the object to a trajectory time. Rails add rolling sound and
						attach by their entrance.
					</p>
				</>
			}
		>
			<div className={`property-banner ${linked ? 'is-linked' : 'world'}`}>
				{linked ? <Link2 size={14} /> : <Unlink2 size={14} />}
				<div>
					<strong>
						{object.trajectoryAnchor != null
							? `Trajectory · ${formatTime(object.trajectoryAnchor.time)}`
							: note != null
								? `${noteName(note.midi)} · ${formatTime(note.time)}`
								: 'World object'}
					</strong>
					<span>{linked ? 'Follows upstream motion changes' : 'Fixed in world space'}</span>
				</div>
			</div>
			<fieldset className="property-fieldset" disabled={object.locked}>
				{marbles.length > 1 && (
					<label className="property-row">
						<span>Marble</span>
						<select
							aria-label="Trajectory owner marble"
							value={object.marbleId ?? (linked ? 'main' : 'auto')}
							title="Automatic follows the note's track. Follow time defaults to the primary marble."
							onChange={(event) =>
								onUpdateObject({
									marbleId: event.target.value === 'auto' ? undefined : event.target.value
								})
							}
						>
							{!linked && <option value="auto">Automatic from note</option>}
							{marbles.map((marble, index) => (
								<option key={marble.id} value={marble.id}>
									{marble.name ?? `Marble ${index + 1}`}
								</option>
							))}
						</select>
					</label>
				)}
				{object.trajectoryAnchor != null && (
					<NumberField
						label="Follow time"
						value={object.trajectoryAnchor.time}
						min={0}
						max={project.duration}
						step={1 / 60}
						suffix="s"
						onChange={(next) => {
							if (object.trajectoryAnchor)
								onUpdateObject({ trajectoryAnchor: { ...object.trajectoryAnchor, time: next } });
						}}
					/>
				)}
				{linked && object.kind === 'bar' && (
					<label className="property-row">
						<span>Strike point</span>
						<select
							aria-label="Instrument strike point"
							value={getStrikePoint(object)}
							title="Choose where the marble meets the key along its length."
							onChange={(event) => {
								const point = event.currentTarget.value as TStrikePoint;
								if (point === 'custom') return;
								const patch = getStrikePointPatch(object, point);
								if (patch != null) onUpdateObject(patch);
							}}
						>
							<option value="center">Center</option>
							<option value="tip">Near tip</option>
							<option value="mount">Near mount</option>
							{getStrikePoint(object) === 'custom' && <option value="custom">Custom offset</option>}
						</select>
					</label>
				)}
				{!linked && (
					<>
						<button type="button" className="button subtle full" onClick={attachAtPlayhead}>
							<Link2 size={12} /> Follow at playhead · {formatTime(time)}
						</button>
						{object.kind !== 'rail' && (
							<>
								<NoteLinkPicker key={object.id} project={project} onLink={onLink} />
								<button type="button" className="button subtle full" onClick={onBeginLink}>
									<Focus size={12} /> Pick note in timeline
								</button>
							</>
						)}
					</>
				)}
				{linked && (
					<div className="property-actions">
						<button type="button" className="button subtle" onClick={onUnlink}>
							<Unlink2 size={12} /> Unlink
						</button>
						{anchorTime != null && (
							<button type="button" className="button subtle" onClick={() => onSeek(anchorTime)}>
								<Focus size={12} /> Go to {object.trajectoryAnchor != null ? 'time' : 'note'}
							</button>
						)}
					</div>
				)}
			</fieldset>
		</PropertySection>
	);
};

interface TTrajectoryLinkPropertiesProps {
	project: TProject;
	object: TSceneObject;
	time: number;
	onUpdateObject(patch: Partial<TSceneObject>): void;
	onLink(noteId: string): void;
	onUnlink(): void;
	onBeginLink(): void;
	onSeek(time: number): void;
}

const NoteLinkPicker: React.FC<{ project: TProject; onLink(noteId: string): void }> = (props) => {
	const { project, onLink } = props;
	const [choice, setChoice] = React.useState('');
	const available = React.useMemo(() => {
		const assigned = new Set(
			project.objects.flatMap((object) => (object.binding == null ? [] : [object.binding.noteId]))
		);
		return project.notes.filter((note) => !assigned.has(note.id)).sort((a, b) => a.time - b.time);
	}, [project.notes, project.objects]);
	const selected = available.find((note) => note.id === choice)?.id ?? available[0]?.id ?? '';
	if (!available.length)
		return (
			<p className="property-hint">
				{project.notes.length
					? 'All notes have an object linked. Add a note or use Follow time.'
					: 'Add or import MIDI notes to link an instrument.'}
			</p>
		);
	return (
		<div className="property-link-picker property-link-row">
			<select
				aria-label="Note to link object to"
				value={selected}
				onChange={(event) => setChoice(event.target.value)}
			>
				{available.map((note) => (
					<option key={note.id} value={note.id}>
						{formatTime(note.time)} · {noteName(note.midi)}
					</option>
				))}
			</select>
			<button type="button" className="button subtle" onClick={() => onLink(selected)}>
				<Link2 size={12} /> Link note
			</button>
		</div>
	);
};
