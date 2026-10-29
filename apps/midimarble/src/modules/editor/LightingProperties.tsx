import { Diamond, Eye, Globe2, Lightbulb, Trash2 } from 'lucide-react';
import React from 'react';
import {
	formatTime,
	type TLightingKeyframe,
	type TLightingState,
	type TProject,
	type TSceneStyle
} from '../project';
import { evaluateLighting } from '../scene';
import {
	ColorField,
	NumberField,
	PropertySection,
	RangeField,
	VectorField
} from './PropertyFields';

export const LightingProperties: React.FC<TLightingPropertiesProps> = (props) => {
	const {
		project,
		time,
		selectedKeyframeId,
		onUpdateProject,
		onSelectKeyframe,
		onAddKeyframe,
		onDeleteKeyframe,
		onSeek,
		onPreview,
		onUseRenderedPreview
	} = props;
	const scene: TSceneStyle = project.scene ?? {
		theme: 'studio',
		...evaluateLighting(undefined, 0),
		bloom: 0.6
	};
	const keys = React.useMemo(
		() => [...(scene.keyframes ?? [])].sort((a, b) => a.time - b.time),
		[scene.keyframes]
	);
	const selected = keys.find((key) => key.id === selectedKeyframeId);
	const values = selected ?? scene;
	const resolved = evaluateLighting(scene, selected?.time ?? time);
	const clearPreview = React.useEffectEvent(() => onPreview?.(null));
	React.useEffect(() => () => clearPreview(), [project, selectedKeyframeId]);
	function previewScene(patch: Partial<TSceneStyle> | null) {
		onPreview?.(patch == null ? null : { ...scene, ...patch });
	}
	function previewValues(patch: Partial<TLightingState> | null) {
		if (patch == null) {
			onPreview?.(null);
			return;
		}
		previewScene(
			selected == null
				? patch
				: {
						keyframes: keys.map((key) => (key.id === selected.id ? { ...key, ...patch } : key))
					}
		);
	}
	function updateScene(patch: Partial<TSceneStyle>) {
		onUpdateProject({ scene: { ...scene, ...patch } });
	}
	function updateKey(patch: Partial<TLightingKeyframe>) {
		if (selected == null) return;
		updateScene({
			keyframes: keys
				.map((key) => (key.id === selected.id ? { ...key, ...patch } : key))
				.sort((a, b) => a.time - b.time)
		});
	}
	function updateValues(patch: Partial<TLightingState>) {
		if (selected) updateKey(patch);
		else updateScene(patch);
	}
	return (
		<React.Fragment key={`${project.id}:${selected?.id ?? 'base'}`}>
			{onUseRenderedPreview != null && (
				<div className="property-hint">
					<button
						type="button"
						className="button subtle full"
						title="Rendered shading shows the scene lights and shadows"
						onClick={onUseRenderedPreview}
					>
						<Eye size={12} /> Use rendered preview
					</button>
				</div>
			)}
			<PropertySection title="Environment" icon={<Globe2 size={12} />}>
				<label className="property-row">
					<span>Studio</span>
					<select
						aria-label="Scene lighting style"
						value={scene.theme}
						onChange={(event) => updateScene({ theme: event.target.value as TSceneStyle['theme'] })}
					>
						<option value="wall">Wall studio</option>
						<option value="studio">Warm studio</option>
					</select>
				</label>
				<label className="property-row">
					<span>View transform</span>
					<select
						aria-label="View transform"
						value={scene.viewTransform ?? 'filmic'}
						onChange={(event) =>
							updateScene({ viewTransform: event.target.value as TSceneStyle['viewTransform'] })
						}
					>
						<option value="filmic">ACES Filmic</option>
						<option value="agx">AgX</option>
						<option value="neutral">Neutral</option>
					</select>
				</label>
				{scene.wallPosition != null ? (
					<NumberField
						label="Wall position"
						value={scene.wallPosition}
						min={-1000}
						max={1000}
						step={0.05}
						suffix="m"
						onChange={(wallPosition) => updateScene({ wallPosition })}
					/>
				) : (
					<NumberField
						label="Wall clearance"
						value={scene.wallClearance ?? (scene.theme === 'wall' ? 0.06 : 0.65)}
						min={0.02}
						max={5}
						step={0.05}
						suffix="m"
						onChange={(wallClearance) => updateScene({ wallClearance })}
					/>
				)}
				<RangeField
					label="Bloom"
					value={scene.bloom}
					min={0}
					max={3}
					step={0.01}
					onPreview={(bloom) => previewScene(bloom == null ? null : { bloom })}
					onChange={(bloom) => updateScene({ bloom })}
				/>
			</PropertySection>
			<PropertySection
				title={selected ? 'Selected lighting key' : 'Base lighting'}
				icon={<Lightbulb size={12} />}
				help={
					<p>
						Key light position is relative to the shot's focus. Move the light in Layout or edit its
						coordinates here. A larger Z shortens shadows on the wall. When lighting is animated,
						select a key to edit its look.
					</p>
				}
			>
				{selected ? (
					<NumberField
						label="Lighting key time"
						value={selected.time}
						min={0}
						max={project.duration}
						step={1 / 30}
						suffix="s"
						onChange={(time) => updateKey({ time })}
					/>
				) : keys.length > 0 ? (
					<div className="property-readout">Base lighting · before the first key</div>
				) : null}
				<ColorField
					label="Background"
					value={values.background}
					onPreview={(background) => previewValues(background == null ? null : { background })}
					onChange={(background) => updateValues({ background })}
				/>
				<ColorField
					label="Key light"
					value={values.keyColor}
					onPreview={(keyColor) => previewValues(keyColor == null ? null : { keyColor })}
					onChange={(keyColor) => updateValues({ keyColor })}
				/>
				<ColorField
					label="Fill light"
					value={values.fillColor}
					onPreview={(fillColor) => previewValues(fillColor == null ? null : { fillColor })}
					onChange={(fillColor) => updateValues({ fillColor })}
				/>
				<RangeField
					label="Key strength"
					value={values.keyIntensity ?? resolved.keyIntensity}
					min={0}
					max={20}
					step={0.05}
					onPreview={(keyIntensity) =>
						previewValues(keyIntensity == null ? null : { keyIntensity })
					}
					onChange={(keyIntensity) => updateValues({ keyIntensity })}
				/>
				<RangeField
					label="Fill strength"
					value={values.fillIntensity ?? resolved.fillIntensity}
					min={0}
					max={3}
					step={0.05}
					onPreview={(fillIntensity) =>
						previewValues(fillIntensity == null ? null : { fillIntensity })
					}
					onChange={(fillIntensity) => updateValues({ fillIntensity })}
				/>
				<RangeField
					label="Environment strength"
					value={values.environmentIntensity ?? resolved.environmentIntensity}
					min={0}
					max={3}
					step={0.05}
					onPreview={(environmentIntensity) =>
						previewValues(environmentIntensity == null ? null : { environmentIntensity })
					}
					onChange={(environmentIntensity) => updateValues({ environmentIntensity })}
				/>
				<VectorField
					label="Key light position"
					value={values.keyPosition ?? resolved.keyPosition}
					min={-100}
					max={100}
					step={0.1}
					suffix="m"
					onChange={(keyPosition) => updateValues({ keyPosition })}
				/>
				<RangeField
					label="Exposure"
					value={values.exposure}
					min={0.05}
					max={3}
					step={0.01}
					onPreview={(exposure) => previewValues(exposure == null ? null : { exposure })}
					onChange={(exposure) => updateValues({ exposure })}
				/>
				{selected && (
					<button
						type="button"
						className="button subtle full danger"
						onClick={() => onDeleteKeyframe(selected.id)}
					>
						<Trash2 size={12} /> Delete lighting key
					</button>
				)}
			</PropertySection>
			<PropertySection
				title="Lighting animation"
				icon={<Diamond size={12} />}
				help={
					<p>
						Key current lighting captures the look at the playhead. Drag Lighting diamonds in the
						timeline to retime the blend. Base lighting applies before the first key.
					</p>
				}
			>
				<button type="button" className="button subtle full" onClick={onAddKeyframe}>
					<Diamond size={12} /> Key current lighting · {formatTime(time)}
				</button>
				{keys.length > 0 && (
					<div className="property-keyframes">
						{keys.map((key, index) => (
							<button
								key={key.id}
								type="button"
								aria-pressed={key.id === selectedKeyframeId}
								className={key.id === selectedKeyframeId ? 'is-selected' : ''}
								onClick={() => {
									onSelectKeyframe(key.id);
									onSeek(key.time);
								}}
							>
								<Diamond size={11} /> <span>Key {index + 1}</span>
								<span>{formatTime(key.time)}</span>
							</button>
						))}
						<button
							type="button"
							aria-pressed={selected == null}
							onClick={() => onSelectKeyframe(null)}
						>
							<Lightbulb size={11} /> <span>Edit base lighting</span>
						</button>
					</div>
				)}
			</PropertySection>
		</React.Fragment>
	);
};

interface TLightingPropertiesProps {
	project: TProject;
	time: number;
	selectedKeyframeId: string | null;
	onUpdateProject(patch: Partial<TProject>): void;
	onSelectKeyframe(id: string | null): void;
	onAddKeyframe(): void;
	onDeleteKeyframe(id: string): void;
	onSeek(time: number): void;
	onPreview?(scene: TSceneStyle | null): void;
	onUseRenderedPreview?(): void;
}
