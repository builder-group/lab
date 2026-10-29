import { Globe2, Plus, Sparkles, Trash2 } from 'lucide-react';
import React from 'react';
import { getProjectMarbles, type TMarbleDefinition } from '../project';
import { getVisualObjects } from '../scene';
import type { TPropertiesPanelProps } from './PropertiesPanel';
import {
	ColorField,
	NumberField,
	PropertySection,
	RangeField,
	TextInput,
	VectorField
} from './PropertyFields';

export const MarbleProperties: React.FC<TMarblePropertiesProps> = (props) => {
	const { project, onUpdateProject, onSelectMarble } = props;
	const marbles = getProjectMarbles(project);
	const marble =
		marbles.find((item) => item.id === (props.selectedMarbleId ?? 'main')) ?? marbles[0];
	if (marble == null) return null;
	const primary = marble.id === 'main';
	function update(patch: Partial<TMarbleDefinition>) {
		if (primary) {
			onUpdateProject({
				launch: patch.launch ?? project.launch,
				marbleColor: patch.color ?? project.marbleColor,
				marbleStyle: patch.style ?? project.marbleStyle,
				marbleEffect: patch.effect ?? project.marbleEffect,
				marbleEffectSpeed: patch.effectSpeed ?? project.marbleEffectSpeed
			});
		} else
			onUpdateProject({
				marbles: project.marbles?.map((item) =>
					item.id === marble?.id ? { ...item, ...patch } : item
				)
			});
	}
	function addMarble() {
		if (!marble || marbles.length >= 9) return;
		const added: TMarbleDefinition = {
			...marble,
			id: crypto.randomUUID(),
			name: `Marble ${marbles.length + 1}`,
			launch: {
				...marble.launch,
				position: [
					marble.launch.position[0] + 0.8,
					marble.launch.position[1],
					marble.launch.position[2]
				]
			},
			color: '#eac954',
			startTime: props.time
		};
		onUpdateProject({ marbles: [...(project.marbles ?? []), added] });
		onSelectMarble?.(added.id);
	}
	function removeMarble() {
		const visual = getVisualObjects(project.objects, props.performance);
		onUpdateProject({
			marbles: project.marbles?.filter((item) => item.id !== marble?.id),
			objects: project.objects.map((object) =>
				object.marbleId !== marble?.id
					? object
					: {
							...object,
							marbleId: undefined,
							trajectoryAnchor: undefined,
							binding: null,
							position: visual.find((item) => item.id === object.id)?.position ?? object.position
						}
			)
		});
		onSelectMarble?.('main');
	}
	return (
		<>
			<PropertySection title="Marble" icon={<Globe2 size={12} />}>
				{!primary && (
					<label className="property-row">
						<span>Name</span>
						<TextInput
							label="Marble name"
							value={marble.name ?? 'Marble'}
							onChange={(name) => update({ name })}
						/>
					</label>
				)}
				<div className="property-actions">
					<button
						type="button"
						className="button subtle"
						onClick={addMarble}
						disabled={marbles.length >= 9}
						title={
							marbles.length >= 9
								? 'This scene has the maximum nine marbles'
								: 'Add a marble at the playhead'
						}
					>
						<Plus size={12} /> Add marble
					</button>
					{!primary && (
						<button type="button" className="button subtle danger" onClick={removeMarble}>
							<Trash2 size={12} /> Remove
						</button>
					)}
				</div>
			</PropertySection>
			<PropertySection title="Appearance" icon={<Sparkles size={12} />}>
				<label className="property-row">
					<span>Finish</span>
					<select
						aria-label="Marble finish"
						value={marble.style ?? 'glass'}
						onChange={(event) =>
							update({ style: event.target.value as TMarbleDefinition['style'] })
						}
					>
						<option value="ribbon">Glass with ribbon</option>
						<option value="glass">Clear glass</option>
						<option value="chrome">Chrome</option>
					</select>
				</label>
				<ColorField
					label="Marble color"
					value={marble.color}
					onChange={(color) => update({ color })}
				/>
				<label className="property-row">
					<span>Shader</span>
					<select
						aria-label="Marble shader effect"
						value={marble.effect ?? 'none'}
						onChange={(event) =>
							update({ effect: event.target.value as TMarbleDefinition['effect'] })
						}
					>
						<option value="none">Natural</option>
						<option value="iridescent">Iridescent</option>
						<option value="flow">Flow</option>
					</select>
				</label>
				{marble.effect != null && marble.effect !== 'none' && (
					<RangeField
						label="Effect speed"
						value={marble.effectSpeed ?? 1}
						min={0}
						max={4}
						step={0.05}
						suffix="×"
						onChange={(effectSpeed) => update({ effectSpeed })}
					/>
				)}
				<NumberField
					label="Radius"
					value={marble.launch.radius}
					min={0.05}
					max={2}
					step={0.01}
					suffix="m"
					onChange={(radius) => update({ launch: { ...marble.launch, radius } })}
				/>
			</PropertySection>
			<PropertySection
				title="Launch"
				help={
					<p>Launch changes rebuild the trajectory and reposition objects linked to this marble.</p>
				}
			>
				{!primary && (
					<NumberField
						label="Start time"
						value={marble.startTime ?? 0}
						min={0}
						max={project.duration}
						step={1 / 60}
						suffix="s"
						onChange={(startTime) => update({ startTime })}
					/>
				)}
				<VectorField
					label="Start position"
					value={marble.launch.position}
					suffix="m"
					onChange={(position) => update({ launch: { ...marble.launch, position } })}
				/>
				<VectorField
					label="Start velocity"
					value={marble.launch.velocity}
					suffix="m/s"
					min={-100}
					max={100}
					onChange={(velocity) => update({ launch: { ...marble.launch, velocity } })}
				/>
			</PropertySection>
		</>
	);
};

type TMarblePropertiesProps = Pick<
	TPropertiesPanelProps,
	'project' | 'performance' | 'time' | 'onUpdateProject' | 'onSelectMarble' | 'selectedMarbleId'
>;
