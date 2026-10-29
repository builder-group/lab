import {
	Camera,
	Circle,
	Copy,
	Globe2,
	Lightbulb,
	Music2,
	Settings2,
	Shapes,
	Trash2
} from 'lucide-react';
import React from 'react';
import {
	getProjectMarbles,
	noteName,
	type TCameraSettings,
	type TNote,
	type TPerformance,
	type TProject,
	type TSceneObject,
	type TSceneStyle
} from '../project';
import { CameraProperties } from './CameraProperties';
import type { TEditorEntity } from './editor-types';
import { LightingProperties } from './LightingProperties';
import { MarbleProperties } from './MarbleProperties';
import { NoteProperties, TrackProperties } from './MusicProperties';
import { ObjectProperties } from './ObjectProperties';
import { ProjectProperties } from './ProjectProperties';

export const PropertiesPanel: React.FC<TPropertiesPanelProps> = (props) => {
	const { entity, project, object, note, onDelete, onDuplicate } = props;
	const title = propertyTitles[entity];
	const icon = propertyIcons[entity];
	let selectionName = title;
	if (entity === 'object') selectionName = object?.name ?? title;
	else if (entity === 'note' && note != null) selectionName = noteName(note.midi);
	else if (entity === 'track')
		selectionName = project.tracks.find((track) => track.id === props.trackId)?.name ?? title;
	else if (entity === 'marble')
		selectionName =
			getProjectMarbles(project).find((marble) => marble.id === (props.selectedMarbleId ?? 'main'))
				?.name ?? title;
	return (
		<aside className="properties-panel" aria-label="Selection properties">
			<div className="panel-heading">
				<span>
					<Settings2 size={13} /> Properties
				</span>
				<span className="subtle-label">{title}</span>
			</div>
			<div className="properties-scroll">
				<div className="property-identity">
					{icon}
					<div>
						<strong>{selectionName ?? title}</strong>
						<span>
							{entity === 'object' ? object?.kind : entity === 'note' ? 'MIDI note' : project.name}
						</span>
					</div>
					{entity === 'object' && object != null && (
						<button
							type="button"
							className="icon-button small"
							aria-label="Duplicate selected object"
							title="Duplicate object · Shift D"
							onClick={onDuplicate}
						>
							<Copy size={13} />
						</button>
					)}
					{((entity === 'object' && object != null) || (entity === 'note' && note != null)) && (
						<button
							type="button"
							className="icon-button small danger"
							aria-label={`Delete selected ${entity}`}
							title={`Delete ${entity}`}
							onClick={onDelete}
							disabled={entity === 'object' && object?.locked}
						>
							<Trash2 size={13} />
						</button>
					)}
				</div>
				{entity === 'object' && object != null && <ObjectProperties {...props} object={object} />}
				{entity === 'note' && note != null && <NoteProperties {...props} note={note} />}
				{entity === 'track' && <TrackProperties {...props} />}
				{entity === 'camera' && <CameraProperties {...props} />}
				{entity === 'marble' && <MarbleProperties {...props} />}
				{entity === 'lighting' && (
					<LightingProperties
						project={project}
						time={props.time}
						selectedKeyframeId={props.lightingKeyframeId}
						onUpdateProject={props.onUpdateProject}
						onSelectKeyframe={props.onSelectLightingKeyframe}
						onAddKeyframe={props.onAddLightingKeyframe}
						onDeleteKeyframe={props.onDeleteLightingKeyframe}
						onSeek={props.onSeek}
						onPreview={props.onPreviewLighting}
						onUseRenderedPreview={props.onUseRenderedPreview}
					/>
				)}
				{entity === 'project' && <ProjectProperties {...props} />}
				{((entity === 'object' && object == null) || (entity === 'note' && note == null)) && (
					<p className="property-hint">
						Select{' '}
						{entity === 'object'
							? 'an object in the viewport or scene tree'
							: 'a note in the timeline'}{' '}
						to edit its properties.
					</p>
				)}
			</div>
		</aside>
	);
};

export interface TPropertiesPanelProps {
	entity: TEditorEntity;
	project: TProject;
	performance: TPerformance | null;
	object: TSceneObject | null;
	note: TNote | null;
	keyframeId: string | null;
	lightingKeyframeId: string | null;
	onSelectLightingKeyframe(id: string | null): void;
	onAddLightingKeyframe(): void;
	onDeleteLightingKeyframe(id: string): void;
	onPreviewLighting?(scene: TSceneStyle | null): void;
	onUseRenderedPreview?(): void;
	trackId?: string | null;
	selectedMarbleId?: string | null;
	onSelectMarble?(id: string): void;
	time: number;
	onUpdateProject(patch: Partial<TProject>): void;
	onUpdateObject(patch: Partial<TSceneObject>): void;
	onUpdateNote(id: string, patch: Partial<TNote>): void;
	onAddAtNote?(noteId: string): void;
	onSelectObject?(id: string): void;
	onLink(noteId: string): void;
	onUnlink(): void;
	onBeginLink(): void;
	onDelete(): void;
	onDuplicate(): void;
	onSeek(time: number): void;
	cameraAnimationReady: boolean;
	onChangeCameraSpace(space: NonNullable<TCameraSettings['keyframeSpace']>): void;
	onAddCameraKeyframe(): void;
	onSelectCameraKeyframe(id: string | null): void;
}

const propertyTitles: Record<TEditorEntity, string> = {
	project: 'Scene',
	object: 'Object',
	note: 'Note',
	track: 'Music track',
	camera: 'Camera',
	marble: 'Marble',
	lighting: 'Lighting'
};
const propertyIcons: Record<TEditorEntity, React.ReactNode> = {
	project: <Globe2 size={18} />,
	object: <Shapes size={18} />,
	note: <Music2 size={18} />,
	track: <Music2 size={18} />,
	camera: <Camera size={18} />,
	marble: <Circle size={18} />,
	lighting: <Lightbulb size={18} />
};
