import { ChevronRight, Focus, Link2, Music2 } from 'lucide-react';
import React from 'react';
import { noteName, type TNote, type TTrack } from '../project';
import { InstrumentSelect } from './InstrumentSelect';
import type { TPropertiesPanelProps } from './PropertiesPanel';
import { ColorField, NumberField, PropertySection, TextInput } from './PropertyFields';

export const NoteProperties: React.FC<TNotePropertiesProps> = (props) => {
	const { project, note, onUpdateNote, onUpdateProject, onSeek } = props;
	const track = project.tracks.find((item) => item.id === note.trackId);
	const linked = project.objects.filter((object) => object.binding?.noteId === note.id);
	return (
		<>
			<PropertySection title="Note" icon={<Music2 size={12} />}>
				<div className="property-actions">
					<span className="property-chip">{noteName(note.midi)}</span>
					<button type="button" className="button subtle" onClick={() => onSeek(note.time)}>
						<Focus size={12} /> Go to note
					</button>
				</div>
				<div className="property-grid">
					<NumberField
						label="Start"
						value={note.time}
						min={0}
						max={Math.max(0, project.duration - note.duration)}
						step={1 / 30}
						suffix="s"
						onChange={(time) => onUpdateNote(note.id, { time })}
					/>
					<NumberField
						label="Duration"
						value={note.duration}
						min={0.001}
						max={project.duration - note.time}
						step={1 / 30}
						suffix="s"
						onChange={(duration) => onUpdateNote(note.id, { duration })}
					/>
				</div>
				<div className="property-grid">
					<NumberField
						label="Pitch"
						value={note.midi}
						min={0}
						max={127}
						step={1}
						suffix="MIDI"
						onChange={(midi) => onUpdateNote(note.id, { midi: Math.round(midi) })}
					/>
					<NumberField
						label="Velocity"
						value={Math.round(note.velocity * 127)}
						min={1}
						max={127}
						step={1}
						suffix="/127"
						onChange={(velocity) => onUpdateNote(note.id, { velocity: velocity / 127 })}
					/>
				</div>
				<label className="property-row">
					<span>Track</span>
					<select
						aria-label="Note track"
						value={note.trackId}
						onChange={(event) => onUpdateNote(note.id, { trackId: event.target.value })}
					>
						{project.tracks.map((item) => (
							<option key={item.id} value={item.id}>
								{item.name}
							</option>
						))}
					</select>
				</label>
			</PropertySection>
			{track != null && (
				<PropertySection
					title="Track instrument"
					help={<p>The instrument applies to every note on {track.name}.</p>}
				>
					<label className="property-row">
						<span>Sound</span>
						<InstrumentSelect
							track={track}
							onChange={(instrument) =>
								onUpdateProject({
									tracks: project.tracks.map((item) =>
										item.id === track.id ? { ...item, instrument } : item
									)
								})
							}
						/>
					</label>
				</PropertySection>
			)}
			<PropertySection
				title="Linked scene object"
				icon={<Link2 size={12} />}
				help={
					<p>
						Choose an object for this note, drag a world object from the scene tree onto the note,
						or choose Link on an object. The sound plays at this note's time.
					</p>
				}
			>
				{linked.length > 0 ? (
					linked.map((object) => (
						<button
							key={object.id}
							type="button"
							className="property-banner is-linked linked-object-select"
							aria-label={`Edit ${object.name}`}
							disabled={props.onSelectObject == null}
							onClick={() => props.onSelectObject?.(object.id)}
						>
							<Link2 size={13} />
							<div>
								<strong>{object.name}</strong>
								<span>Edit instrument · follows this note</span>
							</div>
							<ChevronRight size={13} />
						</button>
					))
				) : (
					<div>
						{props.onAddAtNote && (
							<button className="button subtle full" onClick={() => props.onAddAtNote?.(note.id)}>
								Choose an object for this note…
							</button>
						)}
					</div>
				)}
			</PropertySection>
		</>
	);
};

type TNotePropertiesProps = Pick<
	TPropertiesPanelProps,
	'project' | 'onUpdateNote' | 'onUpdateProject' | 'onSeek' | 'onAddAtNote' | 'onSelectObject'
> & { note: TNote };

export const TrackProperties: React.FC<TTrackPropertiesProps> = (props) => {
	const { project, trackId, onUpdateProject } = props;
	const track = project.tracks.find((item) => item.id === trackId);
	if (!track)
		return <p className="property-hint">Select a music track in the timeline to edit its sound.</p>;
	function update(patch: Partial<TTrack>) {
		onUpdateProject({
			tracks: project.tracks.map((item) => (item.id === track?.id ? { ...item, ...patch } : item))
		});
	}
	return (
		<PropertySection title="Music track" icon={<Music2 size={12} />}>
			<label className="property-row">
				<span>Name</span>
				<TextInput label="Track name" value={track.name} onChange={(name) => update({ name })} />
			</label>
			<ColorField label="Track color" value={track.color} onChange={(color) => update({ color })} />
			<label className="property-row">
				<span>Instrument</span>
				<InstrumentSelect track={track} onChange={(instrument) => update({ instrument })} />
			</label>
			<div className="property-checks">
				<label>
					<input
						type="checkbox"
						checked={track.muted}
						onChange={(event) => update({ muted: event.target.checked })}
					/>{' '}
					Mute track
				</label>
				<label>
					<input
						type="checkbox"
						checked={track.solo ?? false}
						onChange={(event) => update({ solo: event.target.checked })}
					/>{' '}
					Solo track
				</label>
			</div>
			<div className="property-readout">
				{project.notes.filter((note) => note.trackId === track.id).length} notes ·{' '}
				{track.percussion ? 'Percussion channel' : 'Melodic instrument'}
			</div>
		</PropertySection>
	);
};

type TTrackPropertiesProps = Pick<TPropertiesPanelProps, 'project' | 'trackId' | 'onUpdateProject'>;
