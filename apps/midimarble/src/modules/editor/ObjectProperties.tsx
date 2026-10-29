import { LockKeyhole, Plus, RotateCcw, Shapes, Sparkles, Trash2 } from 'lucide-react';
import React from 'react';
import {
	createCatalogRailPath,
	formatTime,
	noteName,
	objectCatalog,
	type TSceneObject,
	type TVec3
} from '../project';
import { getVisualObjects } from '../scene';
import { getNextUnlinkedNote } from './note-trajectory';
import { getObjectSizePatch } from './object-editing';
import type { TPropertiesPanelProps } from './PropertiesPanel';
import {
	ColorField,
	NumberField,
	PropertySection,
	RangeField,
	TextInput,
	VectorField
} from './PropertyFields';
import { RailProfileEditor } from './RailProfileEditor';
import { TrajectoryLinkProperties } from './TrajectoryLinkProperties';

export const ObjectProperties: React.FC<TObjectPropertiesProps> = (props) => {
	const { project, performance, object, onUpdateObject, onUpdateProject } = props;
	const linkedNote = project.notes.find((item) => item.id === object.binding?.noteId);
	const nextNote = React.useMemo(
		() => (linkedNote == null ? undefined : getNextUnlinkedNote(project, linkedNote.id)),
		[project, linkedNote]
	);
	const marker = performance?.noteMarkers.find((item) => item.noteId === linkedNote?.id);
	const resolved = React.useMemo(
		() => getVisualObjects([object], performance)[0],
		[object, performance]
	);
	const locked = object.locked ?? false;
	function toggleFlag(flag: 'locked' | 'disabled', value: boolean) {
		onUpdateProject({
			objects: project.objects.map((item) =>
				item.id === object.id ? { ...item, [flag]: value } : item
			)
		});
	}
	return (
		<>
			<PropertySection title="Object" icon={<Shapes size={12} />}>
				<label className="property-row">
					<span>Name</span>
					<TextInput
						label="Object name"
						value={object.name}
						disabled={locked}
						onChange={(name) => onUpdateObject({ name })}
					/>
				</label>
				<label className="property-row">
					<span>Model</span>
					<select
						aria-label="Object model variant"
						value={object.modelId ?? objectCatalog.find((model) => model.kind === object.kind)?.id}
						disabled={locked}
						onChange={(event) => {
							const model = objectCatalog.find((item) => item.id === event.target.value);
							if (model) {
								const path =
									model.kind === 'rail'
										? createCatalogRailPath(model.id, object.size[0])
										: object.path;
								onUpdateObject({
									modelId: model.id,
									path,
									roundedNose: model.id === 'key-spoon' ? (object.roundedNose ?? true) : undefined
								});
							}
						}}
					>
						{objectCatalog
							.filter((model) => model.kind === object.kind)
							.map((model) => (
								<option key={model.id} value={model.id}>
									{model.label}
								</option>
							))}
					</select>
				</label>
				{object.kind === 'bar' && (
					<label className="property-row">
						<span>Mount</span>
						<select
							aria-label="Object mounting style"
							value={object.mountStyle ?? (object.modelId === 'key-strip' ? 'folded' : 'pins')}
							disabled={locked}
							onChange={(event) =>
								onUpdateObject({ mountStyle: event.target.value as TSceneObject['mountStyle'] })
							}
						>
							<option value="none">None</option>
							<option value="pins">Pins & bridge</option>
							<option value="folded">Back flange</option>
							<option value="folded-front">Front flange</option>
							<option value="rack">Rail bed</option>
						</select>
					</label>
				)}
				{object.modelId === 'key-spoon' && (
					<label className="property-row">
						<span>Rounded nose</span>
						<input
							type="checkbox"
							aria-label="Rounded spoon nose"
							checked={object.roundedNose ?? false}
							disabled={locked}
							onChange={(event) => onUpdateObject({ roundedNose: event.target.checked })}
						/>
					</label>
				)}
				<div className="property-checks">
					<label>
						<input
							type="checkbox"
							checked={locked}
							onChange={(event) => toggleFlag('locked', event.target.checked)}
						/>
						<LockKeyhole size={11} /> Lock editing
					</label>
					<label>
						<input
							type="checkbox"
							checked={!object.disabled}
							onChange={(event) => toggleFlag('disabled', !event.target.checked)}
						/>{' '}
						In simulation
					</label>
				</div>
				{locked && (
					<p className="property-hint">Unlock the object to edit its shape and transform.</p>
				)}
			</PropertySection>
			<TrajectoryLinkProperties {...props} object={object} />
			{nextNote != null && props.onAddAtNote != null && (
				<button
					className="button full"
					onClick={() => props.onAddAtNote?.(nextNote.id)}
					title="Choose an instrument for the next unlinked note on this track"
				>
					<Plus size={13} /> Fit next note · {noteName(nextNote.midi)} · {formatTime(nextNote.time)}
				</button>
			)}
			<PropertySection title="Transform">
				<fieldset disabled={locked} className="property-fieldset">
					<VectorField
						label={
							object.trajectoryAnchor != null
								? 'Trajectory offset'
								: object.binding != null
									? 'Note offset'
									: 'Location'
						}
						value={object.trajectoryAnchor?.offset ?? object.binding?.offset ?? object.position}
						suffix="m"
						onChange={(position) =>
							onUpdateObject(
								object.trajectoryAnchor != null
									? { trajectoryAnchor: { ...object.trajectoryAnchor, offset: position } }
									: object.binding != null
										? { binding: { ...object.binding, offset: position } }
										: { position }
							)
						}
					/>
					{(object.binding != null || object.trajectoryAnchor != null) && resolved != null && (
						<div className="property-readout">
							World: {resolved.position.map((value) => Number(value.toFixed(2))).join(' · ')} m
						</div>
					)}
					<VectorField
						label="Rotation"
						value={object.rotation.map((value) => (value * 180) / Math.PI) as TVec3}
						suffix="°"
						step={1}
						min={-3600}
						max={3600}
						onChange={(angles) =>
							onUpdateObject({ rotation: angles.map((angle) => (angle * Math.PI) / 180) as TVec3 })
						}
					/>
					<VectorField
						label="Dimensions"
						value={object.size}
						suffix="m"
						min={0.02}
						max={50}
						onChange={(size) => onUpdateObject(getObjectSizePatch(object, size))}
					/>
				</fieldset>
			</PropertySection>
			<PropertySection
				title="Material & response"
				icon={<Sparkles size={12} />}
				help={
					<p>
						Friction uses the higher coefficient of the surface and marble (0.12). Instrument glow
						and flex react to physical impacts; rails keep their material appearance.
					</p>
				}
			>
				<fieldset disabled={locked} className="property-fieldset">
					<label className="property-row">
						<span>Surface</span>
						<select
							aria-label="Object surface material"
							value={object.material}
							onChange={(event) =>
								onUpdateObject({ material: event.target.value as TSceneObject['material'] })
							}
						>
							<option value="wood">Wood</option>
							<option value="metal">Metal</option>
							<option value="rubber">Rubber</option>
							<option value="glass">Glass</option>
						</select>
					</label>
					{object.material === 'metal' && (
						<label className="property-row">
							<span>Finish</span>
							<select
								aria-label="Metal finish"
								value={object.materialFinish ?? 'bare'}
								onChange={(event) =>
									onUpdateObject({
										materialFinish: event.target.value as TSceneObject['materialFinish']
									})
								}
							>
								<option value="bare">Bare metal</option>
								<option value="painted">Painted</option>
							</select>
						</label>
					)}
					{object.kind !== 'rail' && (
						<>
							<label className="property-row">
								<span>Glow response</span>
								<select
									aria-label="Glow response"
									value={object.glowMode ?? 'impact'}
									onChange={(event) =>
										onUpdateObject({ glowMode: event.target.value as 'impact' | 'contact' })
									}
								>
									<option value="impact">Impact pulse</option>
									<option value="contact">While touching</option>
								</select>
							</label>
							{object.glowMode !== 'contact' && (
								<NumberField
									label="Afterglow"
									value={object.glowFade ?? 0.77}
									min={0.05}
									max={3}
									step={0.05}
									suffix="s"
									onChange={(glowFade) => onUpdateObject({ glowFade })}
								/>
							)}
						</>
					)}
					<ColorField
						label="Surface color"
						value={object.color ?? (object.material === 'wood' ? '#a77f52' : '#626777')}
						onChange={(color) => onUpdateObject({ color })}
					/>
					<RangeField
						label="Bounce"
						value={object.restitution}
						min={0}
						max={1}
						step={0.01}
						onChange={(restitution) => onUpdateObject({ restitution })}
					/>
					<NumberField
						label="Surface friction"
						value={object.friction ?? (object.kind === 'rail' && object.path != null ? 0.5 : 0.12)}
						min={0}
						max={2}
						step={0.01}
						onChange={(friction) => onUpdateObject({ friction })}
					/>
					{object.kind !== 'rail' && (
						<>
							<RangeField
								label="Impact flex"
								value={object.flex ?? 0.4}
								min={0}
								max={2}
								step={0.01}
								onChange={(flex) => onUpdateObject({ flex })}
							/>
							<RangeField
								label="Impact glow"
								value={object.emission ?? 0}
								min={0}
								max={5}
								step={0.05}
								onChange={(emission) => onUpdateObject({ emission })}
							/>
							<ColorField
								label="Glow color"
								value={object.glowColor ?? '#88ccff'}
								onChange={(glowColor) => onUpdateObject({ glowColor })}
							/>
						</>
					)}
					{object.kind === 'bar' && (
						<>
							<div className="property-checks">
								<label>
									<input
										type="checkbox"
										checked={object.glowEndColor != null}
										onChange={(event) =>
											onUpdateObject({
												glowEndColor: event.currentTarget.checked
													? (object.glowColor ?? '#88ccff')
													: undefined
											})
										}
									/>
									Two-color glow
								</label>
							</div>
							{object.glowEndColor != null && (
								<>
									<ColorField
										label="Glow end color"
										value={object.glowEndColor}
										onChange={(glowEndColor) => onUpdateObject({ glowEndColor })}
									/>
									<RangeField
										label="Color balance"
										value={object.glowBalance ?? 0.5}
										min={0.05}
										max={0.95}
										step={0.05}
										onChange={(glowBalance) => onUpdateObject({ glowBalance })}
									/>
								</>
							)}
						</>
					)}
				</fieldset>
			</PropertySection>
			{object.kind === 'rail' && <RailProperties object={object} onUpdateObject={onUpdateObject} />}
			{object.binding != null && (
				<PropertySection
					title="Contact check"
					help={
						<p>
							MIDI sets sound timing. Adjust offset, rotation or bounce to refine the physical
							contact.
						</p>
					}
				>
					<div
						className={`property-status ${marker?.error != null && Math.abs(marker.error) <= 1 / 30 ? 'is-good' : ''}`}
					>
						{marker?.error == null
							? 'No matching contact'
							: Math.abs(marker.error) <= 1 / 30
								? `On time · ${Math.round(marker.error * 1000)} ms`
								: `${Math.abs(Math.round(marker.error * 1000))} ms ${marker.error > 0 ? 'late' : 'early'}`}
					</div>
					{object.binding != null && (
						<button
							type="button"
							className="button subtle full"
							disabled={locked}
							onClick={() => {
								if (object.binding != null)
									onUpdateObject({ binding: { ...object.binding, offset: [0, 0, 0] } });
							}}
						>
							<RotateCcw size={12} /> Reset note offset
						</button>
					)}
				</PropertySection>
			)}
		</>
	);
};

type TObjectPropertiesProps = Pick<
	TPropertiesPanelProps,
	| 'project'
	| 'performance'
	| 'onUpdateObject'
	| 'onUpdateProject'
	| 'time'
	| 'onLink'
	| 'onUnlink'
	| 'onBeginLink'
	| 'onSeek'
	| 'onAddAtNote'
> & { object: TSceneObject };

const RailProperties: React.FC<{
	object: TSceneObject;
	onUpdateObject(patch: Partial<TSceneObject>): void;
}> = (props) => {
	const { object, onUpdateObject } = props;
	const width = object.size[0];
	const path = React.useMemo(() => object.path ?? [
		[-width / 2, 0, 0], [width / 2, 0, 0]
	] as TVec3[], [object.path, width]);
	return (
		<PropertySection
			title="Rail curve"
			help={
				<>
					<p>
						Drag a handle to shape the rail. Release to rebuild. Arrow keys move 0.01 m; Shift moves
						0.1 m. Escape cancels.
					</p>
					<p>
						The orange handle is the trajectory entrance. The side profile edits local X/Y and
						preserves depth.
					</p>
				</>
			}
		>
			<RailProfileEditor
				key={object.id}
				path={path}
				locked={object.locked}
				onChange={(next) => onUpdateObject({ path: next })}
			/>
			<fieldset className="property-fieldset" disabled={object.locked}>
				<button
					type="button"
					className="button subtle full"
					title="Use the opposite end as the trajectory entrance without changing the curve shape."
					onClick={() => onUpdateObject({ path: [...path].reverse() })}
				>
					Reverse entrance
				</button>
				<button
					type="button"
					className="button subtle full"
					onClick={() =>
						onUpdateObject({
							path: [...path].reverse().map(([x, y, z]): TVec3 => [-x, y, z])
						})
					}
				>
					Mirror profile
				</button>
				<button
					type="button"
					className="button subtle full"
					onClick={() =>
						onUpdateObject({
							path: createCatalogRailPath(object.modelId ?? 'rail-straight', object.size[0])
						})
					}
				>
					<RotateCcw size={12} /> Reset curve
				</button>
				<details>
					<summary className="property-hint">Edit {path.length} control points</summary>
					{path.map((point, index) => (
						// Curve points have no IDs; their index identifies order in the curve.
						// eslint-disable-next-line @eslint-react/no-array-index-key
						<div className="property-path-point" key={`point-${index}`}>
							<div className="property-path-label">
								<span>Point {index + 1}</span>
								<button
									type="button"
									className="icon-button small"
									disabled={path.length <= 2}
									aria-label={`Remove rail point ${index + 1}`}
									onClick={() =>
										onUpdateObject({ path: path.filter((_, pointIndex) => pointIndex !== index) })
									}
								>
									<Trash2 size={11} />
								</button>
							</div>
							<VectorField
								label={`Point ${index + 1}`}
								hideLabel
								value={point}
								min={-100}
								max={100}
								suffix="m"
								onChange={(next) =>
									onUpdateObject({
										path: path.map((item, pointIndex) => (pointIndex === index ? next : item))
									})
								}
							/>
						</div>
					))}
					<button
						type="button"
						className="button subtle full"
						disabled={path.length >= 128}
						onClick={() => {
							const last = path[path.length - 1] ?? [0, 0, 0];
							const previous = path[path.length - 2] ?? [-1, 0, 0];
							const next = last.map((value, index) =>
								Math.max(-100, Math.min(100, value + (value - (previous[index] ?? 0))))
							) as TVec3;
							onUpdateObject({ path: [...path, next] });
						}}
					>
						<Plus size={12} /> Add control point
					</button>
				</details>
			</fieldset>
		</PropertySection>
	);
};
