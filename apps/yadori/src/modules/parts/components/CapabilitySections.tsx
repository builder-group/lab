import { Plus, Upload, X } from 'lucide-react';
import React from 'react';
import { Button, Field, IconButton, NumberField, TextField } from '../../../components/ui';
import * as desktop from '../../../environment/desktop';
import {
	type TAppearanceCapability,
	type TCableCapability,
	type TDimensionsCapability,
	type TJsonValue,
	type TPart,
	type TProject
} from '../../project/model';
import type { PartsCx } from '../PartsCx';
import { PartArtwork } from './PartArtwork';

export const DimensionsSection: React.FC<{ part: TPart; cx: PartsCx }> = ({ part, cx }) => {
	const dimensions = part.capabilities['dimensions'] as TDimensionsCapability | undefined;
	if (!dimensions) return null;
	const patch = (value: Partial<TDimensionsCapability>): void =>
		cx.update(part, {
			capabilities: { ...part.capabilities, dimensions: { ...dimensions, ...value } }
		});
	return (
		<>
			<div className="form-columns three">
				<NumberField
					label="Width"
					unit="mm"
					value={dimensions.widthMm}
					onChange={(widthMm) => patch({ widthMm })}
				/>
				<NumberField
					label="Height"
					unit="mm"
					value={dimensions.heightMm}
					onChange={(heightMm) => patch({ heightMm })}
				/>
				<NumberField
					label="Depth"
					unit="mm"
					value={dimensions.depthMm}
					onChange={(depthMm) => patch({ depthMm })}
				/>
			</div>
			<label className="checkbox-field">
				<input
					type="checkbox"
					checked={dimensions.verified}
					onChange={(e) => patch({ verified: e.target.checked })}
				/>
				Checked against documentation
			</label>
		</>
	);
};
export const CableSection: React.FC<{ part: TPart; cx: PartsCx }> = ({ part, cx }) => {
	const cable = part.capabilities['cable'] as TCableCapability | undefined;
	if (!cable) return null;
	const patch = (value: Partial<TCableCapability>): void =>
		cx.update(part, { capabilities: { ...part.capabilities, cable: { ...cable, ...value } } });
	return (
		<div className="form-columns">
			<NumberField
				label="Conductor area"
				value={cable.crossSectionMm2}
				unit="mm²"
				onChange={(crossSectionMm2) => patch({ crossSectionMm2 })}
			/>
			<NumberField
				label="Conductors"
				value={cable.coreCount}
				min={1}
				required
				onChange={(coreCount) => patch({ coreCount: Math.round(coreCount ?? 1) })}
			/>
			<NumberField
				label="Outside diameter"
				value={cable.outerDiameterMm}
				unit="mm"
				onChange={(outerDiameterMm) => patch({ outerDiameterMm })}
			/>
			<NumberField
				label="Rated current"
				value={cable.ratedCurrentA}
				unit="A"
				onChange={(ratedCurrentA) => patch({ ratedCurrentA })}
			/>
			<NumberField
				label="Voltage rating"
				value={cable.voltageRatingV}
				unit="V"
				onChange={(voltageRatingV) => patch({ voltageRatingV })}
			/>
			<Field label="Conductor">
				<select
					value={cable.conductor}
					onChange={(e) => patch({ conductor: e.target.value as TCableCapability['conductor'] })}
				>
					<option value="copper">Copper</option>
					<option value="aluminium">Aluminium</option>
					<option value="unknown">Unknown</option>
				</select>
			</Field>
			<TextField
				label="Colour"
				value={cable.color ?? ''}
				placeholder="#e34545"
				onChange={(color) => patch({ color: color || null })}
			/>
			<label className="checkbox-field">
				<input
					type="checkbox"
					checked={cable.verified}
					onChange={(e) => patch({ verified: e.target.checked })}
				/>
				Checked against documentation
			</label>
		</div>
	);
};
export const AppearanceSection: React.FC<{ part: TPart; project: TProject; cx: PartsCx }> = ({
	part,
	project,
	cx
}) => {
	const appearance = part.capabilities['appearance'] as TAppearanceCapability | undefined;
	const [busy, setBusy] = React.useState(false);
	if (!appearance) return null;
	const patch = (value: Partial<TAppearanceCapability>): void =>
		cx.update(part, {
			capabilities: { ...part.capabilities, appearance: { ...appearance, ...value } }
		});
	async function upload(): Promise<void> {
		if (!appearance) return;
		setBusy(true);
		try {
			const asset = await desktop.addProjectAsset(project.id);
			if (!asset || cx.session.$project.get()?.id !== project.id) return;
			const current = cx.session.$project.get()?.parts.find((p) => p.id === part.id);
			if (!current) return;
			cx.session.execute(
				[
					{ type: 'asset.add', asset: { ...asset, sourceUrl: null, attribution: null } },
					{
						type: 'part.update',
						id: part.id,
						patch: {
							capabilities: {
								...current.capabilities,
								appearance: { ...appearance, assetId: asset.id }
							}
						}
					}
				],
				'Add artwork'
			);
		} catch (error) {
			cx.session.notify(String(error));
		} finally {
			setBusy(false);
		}
	}
	return (
		<>
			<div className="artwork-editor">
				<PartArtwork part={part} project={project} />
				<div>
					<Button
						icon={<Upload size={14} />}
						onClick={() => void upload()}
						disabled={busy || !desktop.isDesktop()}
					>
						{busy ? 'Importing…' : 'Choose image or SVG'}
					</Button>
					<Field label="Projection">
						<select
							value={appearance.projection}
							onChange={(e) =>
								patch({ projection: e.target.value as TAppearanceCapability['projection'] })
							}
						>
							<option value="front">Front</option>
							<option value="top">Top</option>
							<option value="side">Side</option>
						</select>
					</Field>
				</div>
			</div>
			<p className="field-hint">Terminal positions are adjusted directly on the canvas.</p>
		</>
	);
};
export const PropertiesSection: React.FC<{ part: TPart; cx: PartsCx }> = ({ part, cx }) => {
	const [adding, setAdding] = React.useState(false);
	const [name, setName] = React.useState('');
	return (
		<>
			<div className="property-list">
				{part.properties.map((property) => (
					<div className="property-row" key={property.id}>
						<span>
							{property.name}
							{property.unit && <small> · {property.unit}</small>}
						</span>
						<input
							aria-label={property.name}
							key={JSON.stringify(property.value)}
							defaultValue={
								typeof property.value === 'object'
									? JSON.stringify(property.value)
									: String(property.value ?? '')
							}
							onBlur={(e) => {
								const raw = e.currentTarget.value;
								let value: TJsonValue = raw;
								if (typeof property.value !== 'string') {
									try {
										value = JSON.parse(raw) as TJsonValue;
										if (property.value !== null && typeof value !== typeof property.value)
											throw new Error('Keep the property type.');
									} catch {
										e.currentTarget.value = JSON.stringify(property.value);
										cx.session.notify(
											`Enter a valid ${typeof property.value === 'object' ? 'JSON value' : typeof property.value} for ${property.name}.`
										);
										return;
									}
								}
								cx.update(part, {
									properties: part.properties.map((p) =>
										p.id === property.id ? { ...p, value } : p
									)
								});
							}}
						/>
						<IconButton
							label={`Remove ${property.name}`}
							onClick={() =>
								cx.update(part, { properties: part.properties.filter((p) => p.id !== property.id) })
							}
						>
							<X size={12} />
						</IconButton>
					</div>
				))}
			</div>
			{adding ? (
				<form
					className="inline-form"
					onSubmit={(e) => {
						e.preventDefault();
						if (!name.trim()) return;
						cx.update(part, {
							properties: [
								...part.properties,
								{
									id: crypto.randomUUID(),
									name: name.trim(),
									value: '',
									unit: null,
									sourceId: null
								}
							]
						});
						setName('');
						setAdding(false);
					}}
				>
					<input
						autoFocus
						value={name}
						onChange={(e) => setName(e.target.value)}
						placeholder="Property name"
					/>
					<Button type="submit">Add</Button>
					<IconButton label="Cancel" onClick={() => setAdding(false)}>
						<X size={13} />
					</IconButton>
				</form>
			) : (
				<Button variant="ghost" icon={<Plus size={13} />} onClick={() => setAdding(true)}>
					Add property
				</Button>
			)}
		</>
	);
};
