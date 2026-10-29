import { Globe2, Music2 } from 'lucide-react';
import React from 'react';
import type { TProject } from '../project';
import { ProjectTitles } from './ProjectTitles';
import type { TPropertiesPanelProps } from './PropertiesPanel';
import { NumberField, PropertySection, RangeField, TextInput } from './PropertyFields';

export const ProjectProperties: React.FC<TProjectPropertiesProps> = (props) => {
	const { project, performance, onUpdateProject } = props;
	const contentEnd = React.useMemo(() => {
		let end = Math.max(
			0.1,
			...project.notes.map((note) => note.time + note.duration),
			...(project.camera?.keyframes.map((keyframe) => keyframe.time) ?? []),
			...(project.scene?.keyframes?.map((keyframe) => keyframe.time) ?? []),
			...(project.titles?.map((title) => title.time + title.duration) ?? []),
			...(project.marbles?.map((marble) => marble.startTime ?? 0) ?? []),
			...project.objects.map((object) => object.trajectoryAnchor?.time ?? 0)
		);
		for (const tempo of project.tempos ?? []) end = Math.max(end, tempo.time);
		for (const track of project.tracks) {
			for (const control of track.controls ?? []) end = Math.max(end, control.time);
			for (const bend of track.pitchBends ?? []) end = Math.max(end, bend.time);
		}
		return end;
	}, [project]);
	return (
		<>
			<PropertySection
				title="Scene"
				icon={<Globe2 size={12} />}
				help={<p>Grid tempo sets musical snapping. MIDI notes keep their recorded times.</p>}
			>
				<label className="property-row">
					<span>Name</span>
					<TextInput
						label="Project name"
						value={project.name}
						onChange={(name) => onUpdateProject({ name })}
					/>
				</label>
				<div className="property-grid">
					<NumberField
						label="Duration"
						value={project.duration}
						min={contentEnd}
						max={120}
						step={0.1}
						suffix="s"
						onChange={(duration) => onUpdateProject({ duration })}
					/>
					<NumberField
						label="Grid tempo"
						value={project.bpm}
						min={10}
						max={1000}
						step={1}
						suffix="BPM"
						onChange={(bpm) => onUpdateProject({ bpm })}
					/>
				</div>
				<label className="property-row">
					<span>Format</span>
					<select
						aria-label="Project aspect ratio"
						value={project.aspectRatio}
						onChange={(event) =>
							onUpdateProject({ aspectRatio: event.target.value as TProject['aspectRatio'] })
						}
					>
						<option value="9:16">9:16 · Portrait</option>
						<option value="16:9">16:9 · Landscape</option>
						<option value="1:1">1:1 · Square</option>
					</select>
				</label>
			</PropertySection>
			<PropertySection
				title="Physics"
				help={
					<p>
						Default bounce applies to newly linked instruments. Existing objects keep their own
						bounce.
					</p>
				}
			>
				<NumberField
					label="Gravity"
					value={project.gravity}
					min={0.1}
					max={40}
					step={0.1}
					suffix="m/s²"
					onChange={(gravity) => onUpdateProject({ gravity })}
				/>
				<RangeField
					label="Default bounce"
					value={project.restitution}
					min={0}
					max={1}
					step={0.01}
					onChange={(restitution) => onUpdateProject({ restitution })}
				/>
			</PropertySection>
			<PropertySection
				title="Sound mix"
				icon={<Music2 size={12} />}
				help={
					<p>
						Rolling and contact sounds follow physical contact. MIDI instruments follow the music
						timeline.
					</p>
				}
			>
				<RangeField
					label="Music volume"
					value={Math.round((project.audio?.musicVolume ?? 0.9) * 100)}
					min={0}
					max={100}
					suffix="%"
					onChange={(value) =>
						onUpdateProject({
							audio: {
								surfaceVolume: 0.45,
								surfacesEnabled: true,
								...project.audio,
								musicVolume: value / 100
							}
						})
					}
				/>
				<RangeField
					label="Rolling volume"
					value={Math.round((project.audio?.surfaceVolume ?? 0.45) * 100)}
					min={0}
					max={100}
					suffix="%"
					onChange={(value) =>
						onUpdateProject({
							audio: {
								musicVolume: 0.9,
								surfacesEnabled: true,
								...project.audio,
								surfaceVolume: value / 100
							}
						})
					}
				/>
				<div className="property-checks">
					<label>
						<input
							type="checkbox"
							checked={project.audio?.surfacesEnabled ?? true}
							onChange={(event) =>
								onUpdateProject({
									audio: {
										musicVolume: 0.9,
										surfaceVolume: 0.45,
										...project.audio,
										surfacesEnabled: event.target.checked
									}
								})
							}
						/>{' '}
						Surface sounds
					</label>
				</div>
			</PropertySection>
			<PropertySection title="Titles" defaultOpen={false}>
				<ProjectTitles
					project={project}
					time={props.time}
					onUpdate={(titles) => onUpdateProject({ titles })}
				/>
			</PropertySection>
			<PropertySection title="Scene statistics" defaultOpen={false}>
				<div className="property-readout">
					{project.objects.length} objects · {project.notes.length} notes · {project.tracks.length}{' '}
					tracks
				</div>
				<div className="property-readout">
					{
						project.objects.filter(
							(object) => object.binding != null || object.trajectoryAnchor != null
						).length
					}{' '}
					linked ·{' '}
					{
						project.objects.filter(
							(object) => object.binding == null && object.trajectoryAnchor == null
						).length
					}{' '}
					world objects
				</div>
				{performance != null && (
					<div className="property-readout">
						{performance.impacts.length} contacts · {Math.round(1 / performance.dt)} Hz physics
					</div>
				)}
			</PropertySection>
		</>
	);
};

type TProjectPropertiesProps = Pick<
	TPropertiesPanelProps,
	'project' | 'performance' | 'time' | 'onUpdateProject'
>;
