import { Check, ChevronDown, Plus, Search, X } from 'lucide-react';
import React from 'react';
import { Popover } from '../../components/Popover';
import { QuestionHint } from '../../components/QuestionHint';
import { getCapability, type TCableRun, type TEndpoint, type TProject } from '../project/model';

export const ConductorEditor: React.FC<{
	project: TProject;
	run: TCableRun;
	coreCount: number;
	onChange: (conductors: TCableRun['conductors']) => void;
}> = ({ project, run, coreCount, onChange }) => {
	const [adding, setAdding] = React.useState(false);
	const [fromKey, setFromKey] = React.useState('');
	const [toKey, setToKey] = React.useState('');
	const choices = React.useMemo(() => {
		const parts = new Map(project.parts.map((part) => [part.id, part]));
		return project.instances.flatMap((instance) => {
			const part = parts.get(instance.partId);
			if (!part || part.buildState !== 'in-build') return [];
			return (getCapability(part, 'electrical')?.ports ?? []).map((port) => ({
				key: JSON.stringify([instance.id, port.id]),
				endpoint: { instanceId: instance.id, portId: port.id },
				label: `${instance.label || part.name} · ${port.name}${port.direction === 'bidirectional' ? '' : ` (${port.direction})`}`,
				kind: port.kind
			}));
		});
	}, [project.parts, project.instances]);

	function key(endpoint: TEndpoint): string {
		return JSON.stringify([endpoint.instanceId, endpoint.portId]);
	}
	function select(value: string, onSelect: (endpoint: TEndpoint) => void): void {
		const choice = choices.find((c) => c.key === value);
		if (choice) onSelect(choice.endpoint);
	}
	function add(): void {
		const from = choices.find((c) => c.key === fromKey);
		const to = choices.find((c) => c.key === toKey);
		if (!from || !to || fromKey === toKey) return;
		const coreIndex = Array.from({ length: coreCount }, (_, i) => i).find(
			(i) => !run.conductors.some((c) => c.coreIndex === i)
		);
		if (coreIndex == null) return;
		const name =
			from.kind === 'live'
				? 'L'
				: from.kind === 'neutral'
					? 'N'
					: from.kind === 'earth'
						? 'PE'
						: `Core ${coreIndex + 1}`;
		onChange([
			...run.conductors,
			{ id: crypto.randomUUID(), name, coreIndex, from: from.endpoint, to: to.endpoint }
		]);
		setAdding(false);
		setFromKey('');
		setToKey('');
	}
	return (
		<div className="canvas-conductors">
			<div className="canvas-conductors-heading">
				<span>Core mapping</span>
				<QuestionHint
					variant="help"
					label="Physical cable and cores"
					content="Each row maps one conductor between terminals. One multicore cable counts its physical length once in the parts list."
				/>
				<small>
					{run.conductors.length} / {coreCount} cores
				</small>
			</div>
			{run.conductors.map((conductor, index) => (
				<div className="canvas-conductor" key={conductor.id}>
					<div className="canvas-conductor-heading">
						<span>
							Core {conductor.coreIndex + 1}
							{conductor.name ? ` · ${conductor.name}` : ''}
						</span>
						{index > 0 && (
							<button
								className="canvas-icon"
								title="Remove conductor"
								aria-label={`Remove core ${conductor.coreIndex + 1}`}
								onClick={() => onChange(run.conductors.filter((c) => c.id !== conductor.id))}
							>
								<X size={12} />
							</button>
						)}
					</div>
					<EndpointPicker
						aria-label={`Core ${conductor.coreIndex + 1} from terminal`}
						value={key(conductor.from)}
						onChange={(e) =>
							select(e.target.value, (from) =>
								onChange(
									run.conductors.map((c) =>
										c.id === conductor.id
											? { ...c, from, to: key(from) === key(c.to) ? c.from : c.to }
											: c
									)
								)
							)
						}
						choices={choices}
					/>
					<span className="canvas-conductor-arrow">↓</span>
					<EndpointPicker
						aria-label={`Core ${conductor.coreIndex + 1} to terminal`}
						value={key(conductor.to)}
						onChange={(e) =>
							select(e.target.value, (to) =>
								onChange(
									run.conductors.map((c) =>
										c.id === conductor.id
											? { ...c, to, from: key(to) === key(c.from) ? c.to : c.from }
											: c
									)
								)
							)
						}
						choices={choices}
					/>
				</div>
			))}
			{run.conductors.length < coreCount && !adding && (
				<button className="canvas-text-button" onClick={() => setAdding(true)}>
					<Plus size={12} /> Add conductor
				</button>
			)}
			{adding && (
				<div className="canvas-conductor">
					<EndpointPicker
						aria-label="New conductor from terminal"
						value={fromKey}
						onChange={(e) => setFromKey(e.target.value)}
						choices={choices}
					/>
					<span className="canvas-conductor-arrow">↓</span>
					<EndpointPicker
						aria-label="New conductor to terminal"
						value={toKey}
						onChange={(e) => setToKey(e.target.value)}
						choices={choices}
					/>
					<div className="canvas-conductor-actions">
						<button
							className="canvas-button primary"
							disabled={!fromKey || !toKey || fromKey === toKey}
							onClick={add}
						>
							Add core
						</button>
						<button className="canvas-text-button" onClick={() => setAdding(false)}>
							Cancel
						</button>
					</div>
				</div>
			)}
		</div>
	);
};

interface TEndpointChoice {
	key: string;
	label: string;
	endpoint: TEndpoint;
	kind: string;
}
const EndpointPicker: React.FC<{
	'aria-label': string;
	'value': string;
	'choices': TEndpointChoice[];
	'onChange'(event: { target: { value: string } }): void;
}> = ({ 'aria-label': label, value, choices, onChange }) => {
	const [anchor, setAnchor] = React.useState<HTMLButtonElement | null>(null);
	const [query, setQuery] = React.useState('');
	const close = React.useCallback(() => setAnchor(null), []);
	const selectedId = React.useId();
	const selected = choices.find((choice) => choice.key === value);
	const results = React.useMemo(() => {
		const text = query.trim().toLocaleLowerCase();
		return choices.filter((choice) => !text || choice.label.toLocaleLowerCase().includes(text));
	}, [choices, query]);
	function leaveWithTab(event: React.KeyboardEvent): boolean {
		if (event.key !== 'Tab') return false;
		setAnchor(null);
		anchor?.focus({ preventScroll: true });
		return true;
	}
	function choose(key: string): void {
		onChange({ target: { value: key } });
		setAnchor(null);
		anchor?.focus({ preventScroll: true });
	}
	return (
		<>
			<button
				type="button"
				className="endpoint-picker-button"
				aria-label={label}
				aria-describedby={selectedId}
				aria-haspopup="dialog"
				aria-expanded={anchor != null}
				onClick={(event) => {
					setQuery('');
					setAnchor(anchor ? null : event.currentTarget);
				}}
			>
				<span id={selectedId}>
					{selected?.label ?? (value ? 'Terminal unavailable' : 'Choose terminal')}
				</span>
				<ChevronDown size={11} />
			</button>
			{anchor && (
				<Popover
					anchor={anchor}
					label={label}
					onClose={close}
					width={300}
					align="end"
					className="endpoint-picker-popover"
				>
					<label className="endpoint-picker-search">
						<Search size={13} />
						<input
							autoFocus
							aria-label="Find terminal"
							placeholder="Find a part or terminal…"
							value={query}
							onChange={(event) => setQuery(event.target.value)}
							onKeyDown={(event) => {
								if (leaveWithTab(event)) return;
								if (event.key === 'Enter' && results[0]) {
									event.preventDefault();
									choose(results[0].key);
								}
								if (event.key === 'ArrowDown') {
									event.preventDefault();
									event.currentTarget
										.closest('.endpoint-picker-popover')
										?.querySelector<HTMLElement>('.endpoint-picker-results button')
										?.focus();
								}
							}}
						/>
					</label>
					<div
						className="endpoint-picker-results"
						onKeyDown={(event) => {
							if (leaveWithTab(event)) return;
							if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
							const elements = Array.from(
									event.currentTarget.querySelectorAll<HTMLButtonElement>('button')
								),
								index = elements.indexOf(document.activeElement as HTMLButtonElement),
								next =
									event.key === 'ArrowDown'
										? Math.min(elements.length - 1, index + 1)
										: Math.max(0, index - 1);
							event.preventDefault();
							elements[next]?.focus();
						}}
					>
						{results.map((choice) => (
							<button type="button" key={choice.key} onClick={() => choose(choice.key)}>
								<span>{choice.label}</span>
								{choice.key === value && <Check size={12} />}
							</button>
						))}
						{results.length === 0 && <p>No matching terminals</p>}
					</div>
				</Popover>
			)}
		</>
	);
};
