import { Camera, Diamond, Trash2 } from 'lucide-react';
import React from 'react';
import { formatTime, type TCameraSettings, type TProject } from '../project';
import type { TPropertiesPanelProps } from './PropertiesPanel';
import { NumberField, PropertySection, RangeField, VectorField } from './PropertyFields';

export const CameraProperties: React.FC<TCameraPropertiesProps> = (props) => {
	const {
		project,
		keyframeId,
		time,
		onUpdateProject,
		onSeek,
		onAddCameraKeyframe,
		onSelectCameraKeyframe,
		cameraAnimationReady,
		onChangeCameraSpace
	} = props;
	const camera = project.camera ?? defaultCamera(project);
	const selected = camera.keyframes.find((keyframe) => keyframe.id === keyframeId);
	const hasKeys = camera.keyframes.length > 0;
	const followsRun = camera.keyframeSpace === 'follow';
	let followHint = 'Follows the marble smoothly at every time, including while scrubbing.';
	if (hasKeys)
		followHint = followsRun
			? 'These settings move the shared center; keys control zoom and framing.'
			: 'World keys control the camera position and target, so follow settings are inactive.';
	function update(patch: Partial<TCameraSettings>) {
		onUpdateProject({ camera: { ...camera, ...patch } });
	}
	function updateKey(patch: Partial<TCameraSettings['keyframes'][number]>) {
		update({
			keyframes: camera.keyframes
				.map((keyframe) => (keyframe.id === keyframeId ? { ...keyframe, ...patch } : keyframe))
				.sort((a, b) => a.time - b.time)
		});
	}
	return (
		<>
			<PropertySection
				title="Camera"
				icon={<Camera size={12} />}
				help={
					<p>
						The frame sets the exported film's shape. Select a camera key to edit its lens and
						framing.
					</p>
				}
			>
				<label className="property-row">
					<span>Frame</span>
					<select
						aria-label="Camera aspect ratio"
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
				{!hasKeys && (
					<RangeField
						label="Field of view"
						value={camera.fov}
						min={10}
						max={110}
						suffix="°"
						onChange={(fov) => update({ fov })}
					/>
				)}
			</PropertySection>
			<PropertySection title="Follow camera" help={<p>{followHint}</p>}>
				{hasKeys && !followsRun && (
					<div className="property-readout">Controlled by world keyframes</div>
				)}
				<fieldset className="property-fieldset" disabled={hasKeys && !followsRun}>
					<label className="property-row">
						<span>{hasKeys && followsRun ? 'Center active marbles' : 'Frame active marbles'}</span>
						<input
							type="checkbox"
							checked={camera.followMarbles ?? false}
							onChange={(event) => update({ followMarbles: event.target.checked })}
						/>
					</label>
					{!hasKeys && (
						<>
							<NumberField
								label="Distance"
								value={camera.distance}
								min={3}
								max={100}
								step={0.1}
								suffix="m"
								onChange={(distance) => update({ distance })}
							/>
							<div className="property-grid">
								<NumberField
									label="Azimuth"
									value={(camera.azimuth * 180) / Math.PI}
									min={-360}
									max={360}
									step={1}
									suffix="°"
									onChange={(angle) => update({ azimuth: (angle * Math.PI) / 180 })}
								/>
								<NumberField
									label="Elevation"
									value={(camera.elevation * 180) / Math.PI}
									min={-88}
									max={88}
									step={1}
									suffix="°"
									onChange={(angle) => update({ elevation: (angle * Math.PI) / 180 })}
								/>
							</div>
						</>
					)}
					<RangeField
						label="Look ahead"
						value={camera.lead}
						min={0}
						max={2}
						step={0.01}
						suffix="s"
						onChange={(lead) => update({ lead })}
					/>
				</fieldset>
			</PropertySection>
			<PropertySection
				title="Camera animation"
				icon={<Diamond size={12} />}
				help={
					<>
						<p>
							Orbit to frame the shot, then key the view. Drag camera diamonds in the timeline to
							retime.
						</p>
						<p>
							World keys store camera position and target. Follow run keys store offsets from the
							moving marble center; a single key follows the run.
						</p>
						<p>Changing space keeps the view at each key; motion between keys may change.</p>
					</>
				}
			>
				<label className="property-row">
					<span>Keyframe space</span>
					<select
						aria-label="Keyframe space"
						value={camera.keyframeSpace ?? 'world'}
						disabled={hasKeys && !cameraAnimationReady}
						onChange={(event) => onChangeCameraSpace(event.target.value as 'world' | 'follow')}
					>
						<option value="world">World</option>
						<option value="follow">Follow run</option>
					</select>
				</label>
				<button
					type="button"
					className="button subtle full"
					disabled={!cameraAnimationReady}
					title={
						cameraAnimationReady
							? 'Capture the current camera view'
							: 'Camera keys are available when the run is ready'
					}
					onClick={onAddCameraKeyframe}
				>
					<Diamond size={12} /> Key current view · {formatTime(time)}
				</button>
				{!cameraAnimationReady && (
					<p className="property-hint">Camera keys are unavailable until the run is ready.</p>
				)}
				{camera.keyframes.length > 0 && (
					<div className="property-keyframes">
						{[...camera.keyframes]
							.sort((a, b) => a.time - b.time)
							.map((keyframe, index) => (
								<button
									type="button"
									key={keyframe.id}
									className={keyframe.id === keyframeId ? 'is-selected' : ''}
									onClick={() => {
										onSelectCameraKeyframe(keyframe.id);
										onSeek(keyframe.time);
									}}
									aria-pressed={keyframe.id === keyframeId}
								>
									<Diamond size={11} />
									<span>Key {index + 1}</span>
									<span>{formatTime(keyframe.time)}</span>
								</button>
							))}
					</div>
				)}
			</PropertySection>
			{selected != null && (
				<PropertySection title="Selected keyframe" icon={<Diamond size={12} />}>
					<NumberField
						label="Key time"
						value={selected.time}
						min={0}
						max={project.duration}
						step={1 / 30}
						suffix="s"
						onChange={(time) => updateKey({ time })}
					/>
					<VectorField
						label={followsRun ? 'Camera offset' : 'Camera position'}
						value={selected.position}
						suffix="m"
						onChange={(position) => updateKey({ position })}
					/>
					<VectorField
						label={followsRun ? 'Look at offset' : 'Look at'}
						value={selected.target}
						suffix="m"
						onChange={(target) => updateKey({ target })}
					/>
					<RangeField
						label="Key field of view"
						value={selected.fov}
						min={10}
						max={110}
						suffix="°"
						onChange={(fov) => updateKey({ fov })}
					/>
					<button
						type="button"
						className="button subtle full danger"
						onClick={() => {
							update({
								keyframes: camera.keyframes.filter((keyframe) => keyframe.id !== selected.id)
							});
							onSelectCameraKeyframe(null);
						}}
					>
						<Trash2 size={12} /> Remove keyframe
					</button>
				</PropertySection>
			)}
		</>
	);
};

type TCameraPropertiesProps = Pick<
	TPropertiesPanelProps,
	| 'project'
	| 'keyframeId'
	| 'time'
	| 'onUpdateProject'
	| 'onSeek'
	| 'onAddCameraKeyframe'
	| 'onSelectCameraKeyframe'
	| 'cameraAnimationReady'
	| 'onChangeCameraSpace'
>;

function defaultCamera(project: TProject): TCameraSettings {
	return {
		fov: 36,
		distance: project.cameraDistance ?? 8.5,
		azimuth: 0.21,
		elevation: 0.24,
		lead: 0.42,
		keyframes: []
	};
}
