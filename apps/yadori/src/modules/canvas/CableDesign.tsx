import { ChevronDown } from 'lucide-react';
import React from 'react';
import { QuestionHint } from '../../components/QuestionHint';
import { openLink } from '../../environment/open-link';
import {
	createPart,
	createRunSizingConfig,
	getCapability,
	getRunCableSizing,
	type TCableRun,
	type TPart,
	type TProject,
	type TRunSizingConfig
} from '../project/model';
import { CanvasCx } from './CanvasCx';
import { InspectorNumberInput } from './InspectorNumberInput';

export const CableDesign: React.FC<{
	cx: CanvasCx;
	project: TProject;
	run: TCableRun;
	material: TPart | null;
}> = React.memo(({ cx, project, run, material }) => {
	const config = React.useMemo(() => run.sizing ?? createRunSizingConfig(), [run.sizing]);
	const result = React.useMemo(
		() => getRunCableSizing(project, { ...run, sizing: config }),
		[project, run, config]
	);
	const cable = material ? getCapability(material, 'cable') : undefined;
	const [loadUnit, setLoadUnit] = React.useState<'a' | 'w'>('a');
	const loadValue =
		loadUnit === 'a'
			? run.currentA
			: run.currentA != null && config.voltageV != null
				? run.currentA * config.voltageV
				: null;
	function sizing(patch: Partial<TRunSizingConfig>): boolean {
		return cx.execute(
			[{ type: 'run.update', id: run.id, patch: { sizing: { ...config, ...patch } } }],
			'Set cable sizing inputs'
		);
	}
	function genericProfile(
		section: number | null,
		conductor: 'copper' | 'aluminium' | 'unknown',
		color = cable?.color ?? null
	): boolean {
		const spec = {
			$schema: 'yadori/electrical-cable@1' as const,
			crossSectionMm2: section,
			coreCount: cable?.coreCount ?? 1,
			conductor,
			color,
			outerDiameterMm: null,
			ratedCurrentA: null,
			voltageRatingV: null,
			verified: false
		};
		const existing = project.parts.find(
			(part) =>
				part.unit === 'm' &&
				part.buildState !== 'archived' &&
				!part.libraryLink &&
				!part.sourceIds.length &&
				!part.brand &&
				JSON.stringify(getCapability(part, 'cable')) === JSON.stringify(spec)
		);
		const profile =
			existing ??
			createPart(
				`${section ?? 'Unspecified'} mm² ${conductor === 'unknown' ? '' : `${conductor} `}${color ?? ''} cable`.replace(
					/\s+/g,
					' '
				),
				{
					unit: 'm',
					quantity: 0,
					buildState: 'in-build',
					capabilities: {
						cable: spec,
						linearMaterial: {
							$schema: 'yadori/linear-material@1',
							unit: 'm',
							continuous: true,
							cutLossMm: 0
						}
					}
				}
			);
		return cx.execute(
			[
				...(existing
					? existing.buildState === 'wishlist'
						? [
								{
									type: 'part.update' as const,
									id: existing.id,
									patch: { buildState: 'in-build' as const }
								}
							]
						: []
					: [{ type: 'part.add' as const, part: profile }]),
				{ type: 'run.update', id: run.id, patch: { materialPartId: profile.id, sizing: config } }
			],
			'Assign cable specification'
		);
	}
	const colors = ['red', 'black', 'blue', 'green-yellow', 'grey'];
	return (
		<div className="canvas-engineering compact-cable-design" aria-label="Cable sizing">
			<div className="canvas-field-grid">
				<DesignNumber
					label="Section"
					suffix="mm²"
					value={cable?.crossSectionMm2 ?? null}
					min={0.001}
					onChange={(value) => genericProfile(value, cable?.conductor ?? 'unknown')}
				/>
				<label className="canvas-field">
					<span>Colour</span>
					<select
						aria-label="Cable colour"
						value={cable?.color ?? ''}
						onChange={(event) =>
							genericProfile(
								cable?.crossSectionMm2 ?? null,
								cable?.conductor ?? 'unknown',
								event.target.value || null
							)
						}
					>
						<option value="">—</option>
						{cable?.color && !colors.includes(cable.color) && (
							<option value={cable.color}>{cable.color}</option>
						)}
						{colors.map((color) => (
							<option key={color} value={color}>
								{color === 'green-yellow'
									? 'Green / yellow'
									: color[0]?.toUpperCase() + color.slice(1)}
							</option>
						))}
					</select>
				</label>
			</div>
			<details className="inspector-toggle sizing-toggle">
				<summary>
					<ChevronDown size={12} />
					Sizing
					<QuestionHint
						variant="help"
						label="DC sizing assumptions"
						content="Voltage-drop estimate only. The displayed cable length is one-way; the return-path setting determines electrical conductor length. Manufacturer minimums, installation ampacity and protection must be checked separately."
					/>
					<span className="inspector-count">
						{result.status === 'ready' ? `${result.recommendedStandardMm2 ?? '—'} mm²` : '—'}
					</span>
				</summary>
				<div className="inspector-toggle-content">
					<div className="canvas-field-grid">
						<label className="canvas-field">
							<span>Circuit</span>
							<select
								aria-label="Sizing circuit"
								value={config.circuit}
								onChange={(event) =>
									sizing({ circuit: event.target.value as TRunSizingConfig['circuit'] })
								}
							>
								<option value="dc">DC</option>
								<option value="ac">AC</option>
								<option value="unknown">Unknown</option>
							</select>
						</label>
						<DesignNumber
							label="Supply"
							suffix="V"
							value={config.voltageV}
							min={0.001}
							onChange={(voltageV) => sizing({ voltageV })}
						/>
					</div>
					<div className="canvas-field-grid">
						<label className="canvas-field">
							<span>Load</span>
							<div className="canvas-number">
								<InspectorNumberInput
									label="Design load"
									value={loadValue}
									min={0}
									disabled={loadUnit === 'w' && config.voltageV == null}
									onCommit={(value) => {
										const currentA =
											value == null
												? null
												: loadUnit === 'a'
													? value
													: config.voltageV
														? value / config.voltageV
														: null;
										return cx.execute(
											[{ type: 'run.update', id: run.id, patch: { currentA, sizing: config } }],
											'Set design load'
										);
									}}
								/>
								<select
									aria-label="Load input unit"
									value={loadUnit}
									onChange={(event) => setLoadUnit(event.target.value as 'a' | 'w')}
								>
									<option value="a">A</option>
									<option value="w">W</option>
								</select>
							</div>
						</label>
						<DesignNumber
							nullable={false}
							label="Drop limit"
							suffix="%"
							value={config.maxDropPercent}
							min={0.001}
							max={99.999}
							onChange={(value) => {
								return value != null ? sizing({ maxDropPercent: value }) : false;
							}}
						/>
					</div>
					<div className="canvas-field-grid">
						<label className="canvas-field">
							<span>Conductor</span>
							<select
								aria-label="Conductor material"
								value={cable?.conductor ?? 'unknown'}
								onChange={(event) =>
									genericProfile(
										cable?.crossSectionMm2 ?? null,
										event.target.value as 'copper' | 'aluminium' | 'unknown'
									)
								}
							>
								<option value="unknown">Unknown</option>
								<option value="copper">Copper</option>
								<option value="aluminium">Aluminium</option>
							</select>
						</label>
						<DesignNumber
							nullable={false}
							label="Temperature"
							suffix="°C"
							min={-20}
							max={105}
							value={config.conductorTemperatureC}
							onChange={(value) => {
								return value != null ? sizing({ conductorTemperatureC: value }) : false;
							}}
						/>
					</div>
					<label className="canvas-field">
						<span>Return path</span>
						<select
							aria-label="Return path"
							value={config.roundTripFactor}
							onChange={(event) => sizing({ roundTripFactor: Number(event.target.value) as 1 | 2 })}
						>
							<option value="2">Equal return · 2 × length</option>
							<option value="1">This wire only · 1 × length</option>
						</select>
					</label>
					<DesignNumber
						label="Fuse"
						suffix="A"
						value={run.fuseA}
						min={0.001}
						onChange={(fuseA) =>
							cx.execute([{ type: 'run.update', id: run.id, patch: { fuseA } }], 'Set fuse')
						}
					/>
					<div className="inspector-sizing-result">
						<div className="canvas-fact">
							<span>Voltage drop</span>
							<b>
								{result.selectedVoltageDropPercent == null
									? '—'
									: `${result.selectedVoltageDropPercent.toFixed(2)}%`}
							</b>
							<QuestionHint
								variant={
									result.status === 'ready' && result.withinVoltageDrop !== false
										? 'help'
										: 'warning'
								}
								label={
									result.status === 'ready'
										? 'Voltage drop calculation'
										: 'Sizing needs information'
								}
								content={
									result.status === 'ready' ? (
										<>
											<p>
												{result.selectedVoltageDropV?.toFixed(3) ?? '—'} V over{' '}
												{result.loopLengthM?.toFixed(2)} m electrical path.
											</p>
											<p>
												{result.withinVoltageDrop === false
													? 'Selected section exceeds the entered drop limit.'
													: 'This result compares cable resistance with the entered target.'}
											</p>
											{result.evidence.map((text) => (
												<p key={text}>{text}</p>
											))}
										</>
									) : (
										(result.reason ?? result.missing.join(' · '))
									)
								}
							/>
						</div>
						{result.status === 'ready' && (
							<div className="canvas-fact">
								<span>Suggested</span>
								<b>
									{result.recommendedStandardMm2 == null
										? '—'
										: `${result.recommendedStandardMm2} mm²`}
								</b>
								{result.recommendedStandardMm2 != null &&
									cable?.crossSectionMm2 !== result.recommendedStandardMm2 && (
										<button
											className="canvas-text-button"
											onClick={() =>
												genericProfile(result.recommendedStandardMm2, cable?.conductor ?? 'unknown')
											}
										>
											Use
										</button>
									)}
							</div>
						)}
					</div>
					<button
						className="canvas-text-button sizing-reference"
						onClick={() =>
							void openLink(
								result.sources[0] ??
									'https://www.victronenergy.com/media/pg/The_Wiring_Unlimited_book/en/theory.html'
							)
						}
					>
						Calculation reference
					</button>
				</div>
			</details>
		</div>
	);
});
const DesignNumber: React.FC<{
	label: string;
	suffix: string;
	value: number | null;
	min?: number;
	max?: number;
	nullable?: boolean;
	onChange(value: number | null): unknown;
}> = ({ label, suffix, value, min = 0, max = Infinity, nullable = true, onChange }) => (
	<label className="canvas-field">
		<span>{label}</span>
		<div className="canvas-number">
			<InspectorNumberInput
				label={`${label} ${suffix}`}
				value={value}
				min={min}
				max={max}
				nullable={nullable}
				onCommit={onChange}
			/>
			<small>{suffix}</small>
		</div>
	</label>
);
