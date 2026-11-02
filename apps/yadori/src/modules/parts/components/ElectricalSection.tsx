import { Plus, Trash2 } from 'lucide-react';
import React from 'react';
import { Button, NumberField, TextField } from '../../../components/ui';
import { type TElectricalCapability, type TPart, type TPort } from '../../project/model';
import type { PartsCx } from '../PartsCx';

export const ElectricalSection: React.FC<{ part: TPart; cx: PartsCx }> = ({ part, cx }) => {
	const capability = part.capabilities['electrical'] as TElectricalCapability | undefined;
	const [expanded, setExpanded] = React.useState<string | null>(null);
	const terminalElementsRef = React.useRef(new Map<string, HTMLDivElement>());
	React.useLayoutEffect(() => {
		if (!expanded) return;
		const row = terminalElementsRef.current.get(expanded);
		if (!row) return;
		row.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
		row.querySelector('input')?.focus({ preventScroll: true });
	}, [expanded]);
	if (!capability) return null;
	function update(ports: TPort[]): void {
		cx.update(part, {
			capabilities: {
				...part.capabilities,
				electrical: { $schema: 'yadori/electrical-device@1', ports }
			}
		});
	}
	function patch(id: string, value: Partial<TPort>): void {
		update(
			(capability?.ports ?? []).map((port) => (port.id === id ? { ...port, ...value } : port))
		);
	}
	return (
		<div className="electrical-section">
			{capability.ports.map((port) => (
				<div
					className="terminal-entry"
					key={port.id}
					ref={(element) => {
						if (element) terminalElementsRef.current.set(port.id, element);
						else terminalElementsRef.current.delete(port.id);
					}}
				>
					<button
						className="terminal-summary"
						onClick={() => setExpanded(expanded === port.id ? null : port.id)}
					>
						<span className={`terminal-dot ${port.kind}`} />
						<strong>{port.name}</strong>
						<span>{port.voltageV == null ? 'Voltage not set' : `${port.voltageV} V`}</span>
						<span className="terminal-kind">{port.direction}</span>
					</button>
					{expanded === port.id && (
						<div className="terminal-fields">
							<TextField
								label="Name"
								value={port.name}
								required
								onChange={(name) => patch(port.id, { name })}
							/>
							<label className="field">
								<span>Terminal</span>
								<select
									value={port.kind}
									onChange={(event) =>
										patch(port.id, { kind: event.target.value as TPort['kind'] })
									}
								>
									{['positive', 'negative', 'live', 'neutral', 'earth', 'signal', 'generic'].map(
										(kind) => (
											<option key={kind} value={kind}>
												{kind}
											</option>
										)
									)}
								</select>
							</label>
							<label className="field">
								<span>Direction</span>
								<select
									value={port.direction}
									onChange={(event) =>
										patch(port.id, { direction: event.target.value as TPort['direction'] })
									}
								>
									<option value="input">Input</option>
									<option value="output">Output</option>
									<option value="bidirectional">Bidirectional</option>
								</select>
							</label>
							<NumberField
								label="Voltage"
								value={port.voltageV}
								unit="V"
								onChange={(voltageV) => patch(port.id, { voltageV })}
							/>
							<TextField
								label="Connector"
								value={port.connector ?? ''}
								onChange={(connector) => patch(port.id, { connector: connector || null })}
							/>
							<NumberField
								label="Maximum current"
								value={port.maxCurrentA}
								unit="A"
								onChange={(maxCurrentA) => patch(port.id, { maxCurrentA })}
							/>
							<NumberField
								label="Minimum conductor area"
								value={port.minCrossSectionMm2}
								unit="mm²"
								onChange={(minCrossSectionMm2) => patch(port.id, { minCrossSectionMm2 })}
							/>
							<NumberField
								label="Maximum conductor area"
								value={port.maxCrossSectionMm2}
								unit="mm²"
								onChange={(maxCrossSectionMm2) => patch(port.id, { maxCrossSectionMm2 })}
							/>
							<label className="checkbox-field">
								<input
									type="checkbox"
									checked={port.multiple}
									onChange={(event) => patch(port.id, { multiple: event.target.checked })}
								/>
								Multiple connections
							</label>
							<label className="checkbox-field">
								<input
									type="checkbox"
									checked={port.verified}
									onChange={(event) => patch(port.id, { verified: event.target.checked })}
								/>
								Checked against documentation
							</label>
							<Button
								variant="danger"
								icon={<Trash2 size={12} />}
								onClick={() => update(capability.ports.filter((entry) => entry.id !== port.id))}
							>
								Remove terminal
							</Button>
						</div>
					)}
				</div>
			))}
			<Button
				variant="ghost"
				icon={<Plus size={13} />}
				onClick={() => {
					const port: TPort = {
						id: crypto.randomUUID(),
						name: 'Terminal',
						kind: 'generic',
						direction: 'bidirectional',
						voltageV: null,
						connector: null,
						minCrossSectionMm2: null,
						maxCrossSectionMm2: null,
						maxCurrentA: null,
						multiple: false,
						verified: false
					};
					update([...capability.ports, port]);
					setExpanded(port.id);
				}}
			>
				Add terminal
			</Button>
			{!capability.ports.length && <span className="section-empty">No terminals yet.</span>}
		</div>
	);
};
