import { useFeatureState } from 'feature-react/state';
import { ArrowUpRight, ChevronDown, RotateCw, Trash2, X } from 'lucide-react';
import React from 'react';
import { QuestionHint } from '../../components/QuestionHint';
import {
	createPart,
	getCapability,
	getFindings,
	getParts,
	getRunLengthM,
	type TCableRun,
	type TPart,
	type TProject
} from '../project/model';
import { CableDesign } from './CableDesign';
import { CanvasCx, getEndpointDisplayPosition } from './CanvasCx';
import { ConductorEditor } from './ConductorEditor';
import { orthogonalRoute, polylineLengthM } from './geometry';
import { InspectorNumberInput } from './InspectorNumberInput';
import '../../styles/canvas-inspector.css';

export const CanvasInspector: React.FC<{ cx: CanvasCx; project: TProject }> = React.memo(
	({ cx, project }) => {
		const selection = useFeatureState(cx.$selection);
		const editPorts = useFeatureState(cx.$editPorts);
		const [custom, setCustom] = React.useState(false);
		const derived = React.useMemo(() => getInspectorDerivations(project), [project]);
		if (!selection) return null;
		const placement =
			selection.kind === 'placement'
				? project.placements.find((entry) => entry.id === selection.id)
				: null;
		const instance = project.instances.find((entry) => entry.id === placement?.instanceId);
		const part = project.parts.find((entry) => entry.id === instance?.partId);
		const run =
			selection.kind === 'run' ? project.runs.find((entry) => entry.id === selection.id) : null;
		if (!part && !run) return null;
		const findings = derived.findings.filter(
			(finding) => finding.targetId === selection.id || finding.targetId === part?.id
		);
		const material = project.parts.find((entry) => entry.id === run?.materialPartId);
		const materialRow = derived.rows.find((row) => row.part.id === material?.id);
		const dimensions = part ? getCapability(part, 'dimensions') : undefined;
		const appearance = part ? getCapability(part, 'appearance') : undefined;
		const ports = part ? (getCapability(part, 'electrical')?.ports ?? []) : [];
		const projection = appearance?.projection ?? 'front';
		const widthKey = projection === 'side' ? 'depthMm' : 'widthMm';
		const heightKey = projection === 'top' ? 'depthMm' : 'heightMm';
		const totalLength = run ? getRunLengthM(project, run) : null;
		function updateRun(patch: Partial<Omit<TCableRun, 'id'>>): boolean {
			return run ? cx.execute([{ type: 'run.update', id: run.id, patch }], 'Edit wire') : false;
		}
		function dimension(key: 'widthMm' | 'heightMm' | 'depthMm', value: number | null): boolean {
			if (!part) return false;
			return cx.execute(
				[
					{
						type: 'part.update',
						id: part.id,
						patch: {
							capabilities: {
								...part.capabilities,
								dimensions: {
									...(dimensions ?? {
										$schema: 'yadori/dimensions@1' as const,
										widthMm: null,
										heightMm: null,
										depthMm: null,
										verified: false
									}),
									[key]: value,
									verified: false
								}
							}
						}
					}
				],
				'Set physical dimensions'
			);
		}
		function addBend(): void {
			if (!run) return;
			let index = 0,
				longest = -1;
			for (let i = 0; i < run.route.length - 1; i++) {
				const a = run.route[i],
					b = run.route[i + 1];
				if (!a || !b) continue;
				const length = Math.hypot(b.x - a.x, b.y - a.y);
				if (length > longest) {
					index = i;
					longest = length;
				}
			}
			const a = run.route[index],
				b = run.route[index + 1];
			if (a && b)
				updateRun({
					route: [
						...run.route.slice(0, index + 1),
						{ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
						...run.route.slice(index + 1)
					]
				});
		}
		return (
			<aside
				className="canvas-inspector figma-inspector"
				aria-label={run ? 'Wire details' : 'Placed part details'}
				onKeyDown={(event) => {
					if (
						event.key === 'Escape' &&
						event.target instanceof HTMLElement &&
						event.target.matches('input,textarea,select')
					)
						event.stopPropagation();
				}}
			>
				<header className="inspector-object-heading">
					<strong>{part?.name ?? run?.name ?? 'Wire'}</strong>
					{findings.length > 0 && (
						<QuestionHint
							label="Selected object checks"
							content={
								<>
									{findings.map((finding) => (
										<p key={finding.id}>
											<strong>{finding.title}</strong>
											<br />
											{finding.detail}
										</p>
									))}
								</>
							}
						/>
					)}
					<button
						className="canvas-icon"
						aria-label="Close canvas inspector"
						onClick={() => cx.$selection.set(null)}
					>
						<X size={13} />
					</button>
				</header>
				{part && placement && (
					<>
						<section className="inspector-section">
							<h3>Position</h3>
							<div className="inspector-grid">
								<SmallNumber
									label="X"
									nullable={false}
									ariaLabel="X position"
									suffix="mm"
									value={placement.xMm}
									min={null}
									onChange={(xMm) => {
										if (xMm == null) return false;
										return cx.execute(
											[{ type: 'placement.update', id: placement.id, patch: { xMm } }],
											'Move part'
										);
									}}
								/>
								<SmallNumber
									label="Y"
									nullable={false}
									ariaLabel="Y position"
									suffix="mm"
									value={placement.yMm}
									min={null}
									onChange={(yMm) => {
										if (yMm == null) return false;
										return cx.execute(
											[{ type: 'placement.update', id: placement.id, patch: { yMm } }],
											'Move part'
										);
									}}
								/>
							</div>
							<div className="inspector-row">
								<label className="canvas-field">
									<span>Rotation</span>
									<select
										aria-label="Rotation"
										value={placement.rotation}
										onChange={(event) =>
											cx.execute(
												[
													{
														type: 'placement.update',
														id: placement.id,
														patch: { rotation: Number(event.target.value) as 0 | 90 | 180 | 270 }
													}
												],
												'Rotate part'
											)
										}
									>
										{[0, 90, 180, 270].map((angle) => (
											<option value={angle} key={angle}>
												{angle}°
											</option>
										))}
									</select>
								</label>
								<button
									className="canvas-icon"
									aria-label="Rotate part 90 degrees"
									onClick={() => cx.rotate()}
								>
									<RotateCw size={13} />
								</button>
							</div>
						</section>
						<section className="inspector-section">
							<h3>
								Layout
								<QuestionHint
									variant="help"
									label="Physical dimensions"
									content={
										<>
											W and H describe the {projection} body view in millimetres. Dimensions belong
											to the part and apply to every unit. Enter body dimensions to establish the
											physical scale.
										</>
									}
								/>
							</h3>
							<div className="inspector-grid">
								<SmallNumber
									label="W"
									ariaLabel="Body width"
									suffix="mm"
									value={dimensions?.[widthKey] ?? null}
									min={0.001}
									onChange={(value) => dimension(widthKey, value)}
								/>
								<SmallNumber
									label="H"
									ariaLabel="Body height"
									suffix="mm"
									value={dimensions?.[heightKey] ?? null}
									min={0.001}
									onChange={(value) => dimension(heightKey, value)}
								/>
							</div>
						</section>
						<details className="inspector-section inspector-toggle">
							<summary>
								<ChevronDown size={12} />
								Appearance
							</summary>
							<div className="inspector-toggle-content">
								<label className="canvas-field">
									<span>View</span>
									<select
										aria-label="Artwork projection"
										value={projection}
										disabled={!appearance}
										onChange={(event) => {
											if (appearance)
												cx.execute(
													[
														{
															type: 'part.update',
															id: part.id,
															patch: {
																capabilities: {
																	...part.capabilities,
																	appearance: {
																		...appearance,
																		projection: event.target.value as 'front' | 'top' | 'side'
																	}
																}
															}
														}
													],
													'Change artwork projection'
												);
										}}
									>
										<option value="front">Front</option>
										<option value="top">Top</option>
										<option value="side">Side</option>
									</select>
								</label>
								<button className="canvas-text-button" onClick={() => cx.openPart(part.id)}>
									Edit artwork
									<ArrowUpRight size={11} />
								</button>
							</div>
						</details>
						{ports.length > 0 && (
							<details className="inspector-section inspector-toggle">
								<summary>
									<ChevronDown size={12} />
									Terminals<span className="inspector-count">{ports.length}</span>
								</summary>
								<div className="inspector-toggle-content">
									<button
										className="canvas-text-button"
										onClick={() => cx.$editPorts.set(!editPorts)}
									>
										{editPorts ? 'Finish positioning' : 'Position on artwork'}
									</button>
									{ports.map((port) => (
										<div className="inspector-terminal" key={port.id}>
											<span>{port.name}</span>
											<small>
												{port.voltageV == null ? (port.connector ?? '—') : `${port.voltageV} V`}
											</small>
											{!appearance?.anchors[port.id] && (
												<QuestionHint
													label={`${port.name} position not set`}
													content="This terminal has no established body position. Place its anchor on the artwork to use it for route measurement."
												/>
											)}
										</div>
									))}
								</div>
							</details>
						)}
						<div className="inspector-footer">
							<button className="canvas-text-button" onClick={() => cx.openPart(part.id)}>
								Open part
								<ArrowUpRight size={11} />
							</button>
							<span />
							<QuestionHint
								variant="help"
								label="Remove from canvas"
								content="Only this placement is removed. The part, its connections and purchase records stay in your project."
							/>
							<button
								className="canvas-icon"
								aria-label="Remove from canvas"
								onClick={() => cx.removeSelection()}
							>
								<Trash2 size={13} />
							</button>
						</div>
					</>
				)}
				{run && (
					<>
						<section className="inspector-section wire-length-section">
							<h3>
								Length
								<QuestionHint
									variant="help"
									label="Cable length basis"
									content="The parts list counts the physical one-way cable, including any allowance, once. The sizing calculator separately accounts for a return path."
								/>
								<strong className="inspector-length-total">
									{totalLength == null ? '—' : totalLength.toFixed(2)} m
								</strong>
							</h3>
							<label className="canvas-field">
								<select
									aria-label="Length basis"
									value={run.lengthBasis}
									onChange={(event) => {
										const lengthBasis = event.target.value as TCableRun['lengthBasis'];
										updateRun({
											lengthBasis,
											lengthM:
												lengthBasis === 'route' ||
												(lengthBasis === 'measured' && run.lengthBasis !== 'measured')
													? null
													: (run.lengthM ??
														(totalLength == null
															? null
															: Math.max(0, totalLength - run.extraLengthM)))
										});
									}}
								>
									<option value="route">Drawn route</option>
									<option value="manual">Manual length</option>
									<option value="measured">Measured length</option>
								</select>
							</label>
							<div className="inspector-grid">
								{run.lengthBasis === 'route' ? (
									<div className="inspector-read-field">
										<span>Route</span>
										<b>{totalLength == null ? '—' : polylineLengthM(run.route).toFixed(2)}</b>
										<small>m</small>
									</div>
								) : (
									<SmallNumber
										label="Base"
										ariaLabel="Base cable length"
										suffix="m"
										value={run.lengthM}
										onChange={(lengthM) => updateRun({ lengthM })}
									/>
								)}
								<SmallNumber
									label="Extra"
									nullable={false}
									ariaLabel="Hidden and service allowance"
									suffix="m"
									value={run.extraLengthM}
									onChange={(extraLengthM) => {
										return extraLengthM != null ? updateRun({ extraLengthM }) : false;
									}}
								/>
							</div>
							{totalLength == null && (
								<div className="inspector-inline-hint">
									<QuestionHint
										label="Length needs information"
										content="Drawn measurements need established body sizes and terminal positions. You can enter a manual or measured cable length instead."
									/>
								</div>
							)}
						</section>
						<section className="inspector-section wire-profile-section">
							<h3>Cable</h3>
							<label className="canvas-field">
								<select
									aria-label="Cable material profile"
									value={run.materialPartId}
									onChange={(event) => {
										const id = event.target.value,
											next = project.parts.find((entry) => entry.id === id);
										cx.execute(
											[
												...(next?.buildState === 'wishlist'
													? [
															{
																type: 'part.update' as const,
																id,
																patch: { buildState: 'in-build' as const }
															}
														]
													: []),
												{ type: 'run.update', id: run.id, patch: { materialPartId: id } }
											],
											'Choose cable profile'
										);
									}}
								>
									{project.parts
										.filter(
											(entry) => entry.buildState !== 'archived' && getCapability(entry, 'cable')
										)
										.map((entry) => (
											<option
												key={entry.id}
												value={entry.id}
												disabled={
													(getCapability(entry, 'cable')?.coreCount ?? 1) <=
													Math.max(...run.conductors.map((conductor) => conductor.coreIndex))
												}
											>
												{entry.name}
											</option>
										))}
								</select>
							</label>
							<CableDesign cx={cx} project={project} run={run} material={material ?? null} />
						</section>
						<details className="inspector-section inspector-toggle">
							<summary>
								<ChevronDown size={12} />
								Connections<span className="inspector-count">{run.conductors.length}</span>
							</summary>
							<div className="inspector-toggle-content">
								<ConductorEditor
									project={project}
									run={run}
									coreCount={material ? (getCapability(material, 'cable')?.coreCount ?? 1) : 1}
									onChange={(conductors) => {
										const first = conductors[0],
											previous = run.conductors[0];
										const changed =
											first &&
											previous &&
											(JSON.stringify(first.from) !== JSON.stringify(previous.from) ||
												JSON.stringify(first.to) !== JSON.stringify(previous.to));
										const from = first ? getEndpointDisplayPosition(project, first.from) : null,
											to = first ? getEndpointDisplayPosition(project, first.to) : null;
										updateRun({
											conductors,
											...(changed && from && to ? { route: orthogonalRoute(from, to) } : {})
										});
									}}
								/>
								<label className="canvas-field">
									<span>Topology</span>
									<select
										value={run.topology}
										onChange={(event) =>
											updateRun({ topology: event.target.value as 'standard' | 'series' })
										}
									>
										<option value="standard">Standard</option>
										<option value="series">Series link</option>
									</select>
								</label>
							</div>
						</details>
						<details className="inspector-section inspector-toggle">
							<summary>
								<ChevronDown size={12} />
								Routing
							</summary>
							<div className="inspector-toggle-content">
								<div className="inspector-action-row">
									<button className="canvas-text-button" onClick={addBend}>
										Add bend
									</button>
									<button
										className="canvas-text-button"
										onClick={() => {
											const from = run.route[0],
												to = run.route.at(-1);
											if (from && to) updateRun({ route: orthogonalRoute(from, to) });
										}}
									>
										Reset route
									</button>
								</div>
							</div>
						</details>
						<details className="inspector-section inspector-toggle">
							<summary>
								<ChevronDown size={12} />
								Purchases
							</summary>
							<div className="inspector-toggle-content">
								{materialRow && (
									<>
										<div className="canvas-fact">
											<span>Needed</span>
											<b>
												{materialRow.requiredQuantity.toFixed(2)} m
												{materialRow.unknownRequirementCount ? ' + ?' : ''}
											</b>
										</div>
										<div className="canvas-fact">
											<span>Bought</span>
											<b>{materialRow.boughtQuantity.toFixed(2)} m</b>
										</div>
										<div className="canvas-fact">
											<span>{materialRow.expectedSpare < 0 ? 'Shortfall' : 'Spare'}</span>
											<b>{Math.abs(materialRow.expectedSpare).toFixed(2)} m</b>
										</div>
									</>
								)}
								<button
									className="canvas-text-button"
									onClick={() => material && cx.openPart(material.id)}
								>
									Open material
									<ArrowUpRight size={11} />
								</button>
								<button className="canvas-text-button" onClick={() => setCustom(!custom)}>
									{custom ? 'Cancel new cable' : 'New cable profile'}
								</button>
								{custom && (
									<CustomCable
										onCreate={(cable) => {
											cx.execute(
												[
													{ type: 'part.add', part: cable },
													{ type: 'run.update', id: run.id, patch: { materialPartId: cable.id } }
												],
												'Create cable profile'
											);
											cx.$materialId.set(cable.id);
											setCustom(false);
										}}
									/>
								)}
							</div>
						</details>
						<div className="inspector-footer">
							<button
								className="canvas-text-button"
								onClick={() => {
									cx.$materialId.set(run.materialPartId);
									cx.$tool.set('wire');
								}}
							>
								Draw another
							</button>
							<span />
							<button
								className="canvas-icon"
								aria-label="Delete wire"
								onClick={() => cx.removeSelection()}
							>
								<Trash2 size={13} />
							</button>
						</div>
					</>
				)}
			</aside>
		);
	}
);
const SmallNumber: React.FC<{
	label: string;
	ariaLabel?: string;
	value: number | null;
	suffix: string;
	min?: number | null;
	nullable?: boolean;
	onChange(value: number | null): unknown;
}> = ({ label, ariaLabel, value, suffix, min = 0, nullable = true, onChange }) => (
	<label className="canvas-field inspector-number-field">
		<div className="canvas-number">
			<span className="inspector-prefix">{label}</span>
			<InspectorNumberInput
				label={`${ariaLabel ?? label} ${suffix}`}
				value={value}
				min={min ?? -Infinity}
				nullable={nullable}
				onCommit={onChange}
			/>
			<small>{suffix}</small>
		</div>
	</label>
);
const CustomCable: React.FC<{ onCreate: (part: TPart) => void }> = ({ onCreate }) => {
	const [name, setName] = React.useState('');
	const [area, setArea] = React.useState('');
	const [color, setColor] = React.useState('red');
	const [cores, setCores] = React.useState('1');
	return (
		<form
			className="canvas-custom-cable"
			onSubmit={(e) => {
				e.preventDefault();
				const crossSectionMm2 = area.trim() === '' ? null : Number(area);
				const coreCount = Number(cores);
				if (
					(crossSectionMm2 != null &&
						(!Number.isFinite(crossSectionMm2) || crossSectionMm2 <= 0)) ||
					!Number.isInteger(coreCount) ||
					coreCount < 1
				)
					return;
				onCreate(
					createPart(name.trim() || `${crossSectionMm2 ?? '?'} mm² · ${color}`, {
						unit: 'm',
						quantity: 0,
						buildState: 'in-build',
						capabilities: {
							cable: {
								$schema: 'yadori/electrical-cable@1',
								crossSectionMm2,
								color,
								coreCount,
								conductor: 'copper',
								outerDiameterMm: null,
								ratedCurrentA: null,
								voltageRatingV: null,
								verified: false
							},
							linearMaterial: {
								$schema: 'yadori/linear-material@1',
								unit: 'm',
								continuous: true,
								cutLossMm: 0
							}
						}
					})
				);
			}}
		>
			<label className="canvas-field">
				<span>Name</span>
				<input value={name} onChange={(e) => setName(e.target.value)} placeholder="Cable profile" />
			</label>
			<div className="canvas-field-grid">
				<label className="canvas-field">
					<span>Cross-section · mm²</span>
					<input
						type="number"
						min="0.1"
						step="any"
						value={area}
						onChange={(e) => setArea(e.target.value)}
					/>
				</label>
				<label className="canvas-field">
					<span>Cores</span>
					<input
						type="number"
						min="1"
						step="1"
						value={cores}
						onChange={(e) => setCores(e.target.value)}
					/>
				</label>
			</div>
			<label className="canvas-field">
				<span>Colour</span>
				<select value={color} onChange={(e) => setColor(e.target.value)}>
					<option value="red">Red</option>
					<option value="black">Black</option>
					<option value="blue">Blue</option>
					<option value="green-yellow">Green / yellow</option>
					<option value="grey">Grey</option>
				</select>
			</label>
			<button className="canvas-button" type="submit">
				Create & use
			</button>
		</form>
	);
};

const inspectorDerivations = new WeakMap<
	TProject,
	{ findings: ReturnType<typeof getFindings>; rows: ReturnType<typeof getParts> }
>();
function getInspectorDerivations(project: TProject): {
	findings: ReturnType<typeof getFindings>;
	rows: ReturnType<typeof getParts>;
} {
	let derived = inspectorDerivations.get(project);
	if (!derived) {
		derived = { findings: getFindings(project), rows: getParts(project) };
		inspectorDerivations.set(project, derived);
	}
	return derived;
}
