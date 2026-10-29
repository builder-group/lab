import { ChevronDown } from 'lucide-react';
import React from 'react';
import type { TVec3 } from '../project';
import { ContextHelp } from './ContextHelp';

export const NumberField: React.FC<TNumberFieldProps> = (props) => {
	const {
		label,
		ariaLabel,
		value,
		min,
		max,
		step = 0.1,
		suffix,
		compact = false,
		onChange
	} = props;
	function commit(event: React.FocusEvent<HTMLInputElement>) {
		const input = event.currentTarget;
		if (input.value === formatNumber(value)) return;
		const next = input.valueAsNumber;
		if (!Number.isFinite(next)) {
			input.value = formatNumber(value);
			return;
		}
		const clamped = Math.min(max ?? Infinity, Math.max(min ?? -Infinity, next));
		input.value = formatNumber(clamped);
		if (clamped !== value) onChange(clamped);
	}
	return (
		<label className={`number-field${compact ? 'is-compact' : ''}`}>
			{!compact && <span>{label}</span>}
			<div>
				<input
					key={value}
					aria-label={ariaLabel ?? label}
					type="number"
					min={min}
					max={max}
					step={step}
					defaultValue={formatNumber(value)}
					onBlur={commit}
					onKeyDown={(event) => {
						if (!['Escape', 'Enter'].includes(event.key)) return;
						event.preventDefault();
						event.stopPropagation();
						if (event.key === 'Escape') {
							event.currentTarget.value = formatNumber(value);
							event.currentTarget.blur();
						}
						if (event.key === 'Enter') event.currentTarget.blur();
					}}
				/>
				{suffix != null && <small>{suffix}</small>}
			</div>
		</label>
	);
};

interface TNumberFieldProps {
	label: string;
	ariaLabel?: string;
	value: number;
	min?: number;
	max?: number;
	step?: number;
	suffix?: string;
	compact?: boolean;
	onChange(value: number): void;
}

export const RangeField: React.FC<TRangeFieldProps> = (props) => <RangeFieldControl {...props} />;

interface TRangeFieldProps {
	label: string;
	value: number;
	min: number;
	max: number;
	step?: number;
	suffix?: string;
	onPreview?(value: number | null): void;
	onChange(value: number): void;
}

const RangeFieldControl: React.FC<TRangeFieldProps> = (props) => {
	const { label, value, min, max, step = 1, suffix, onChange, onPreview } = props;
	const sliderId = React.useId();
	const [draft, setDraft] = React.useState(value);
	const [previousValue, setPreviousValue] = React.useState(value);
	if (previousValue !== value) {
		setPreviousValue(value);
		setDraft(value);
	}
	const changedRef = React.useRef(false);
	const clearActivePreview = React.useEffectEvent(() => {
		if (changedRef.current) onPreview?.(null);
	});
	React.useEffect(() => () => clearActivePreview(), []);
	React.useLayoutEffect(() => {
		clearActivePreview();
		changedRef.current = false;
	}, [value]);
	function cancel() {
		changedRef.current = false;
		setDraft(value);
		onPreview?.(null);
	}
	function commit(event: React.SyntheticEvent<HTMLInputElement>) {
		if (!changedRef.current) return;
		changedRef.current = false;
		onPreview?.(null);
		const next = Number(event.currentTarget.value);
		if (Number.isFinite(next) && next !== value) onChange(next);
	}
	function commitNumber(next: number) {
		changedRef.current = false;
		setDraft(next);
		onPreview?.(null);
		if (next !== value) onChange(next);
	}
	return (
		<div className="range-field">
			<div className="range-field-header">
				<label htmlFor={sliderId}>{label}</label>
				<NumberField
					label={label}
					ariaLabel={`${label} value`}
					compact
					value={draft}
					min={min}
					max={max}
					step={step}
					suffix={suffix}
					onChange={commitNumber}
				/>
			</div>
			<input
				id={sliderId}
				aria-label={label}
				type="range"
				min={min}
				max={max}
				step={step}
				value={draft}
				onChange={(event) => {
					const next = Number(event.currentTarget.value);
					if (!Number.isFinite(next)) return;
					changedRef.current = true;
					setDraft(next);
					onPreview?.(next);
				}}
				onPointerUp={commit}
				onBlur={commit}
				onKeyUp={commit}
				onPointerCancel={cancel}
				onKeyDown={(event) => {
					if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') {
						cancel();
						return;
					}
					if (event.key !== 'Escape') return;
					event.preventDefault();
					event.stopPropagation();
					cancel();
					event.currentTarget.blur();
				}}
			/>
		</div>
	);
};

export const PropertySection: React.FC<TPropertySectionProps> = (props) => {
	const { title, icon, defaultOpen = true, children, help } = props;
	return (
		<details className="property-section" open={defaultOpen}>
			<summary>
				<ChevronDown size={11} />
				{icon}
				<span>{title}</span>
				{help != null && <ContextHelp label={`${title} help`}>{help}</ContextHelp>}
			</summary>
			<div className="property-section-content">{children}</div>
		</details>
	);
};

interface TPropertySectionProps {
	title: string;
	help?: React.ReactNode;
	icon?: React.ReactNode;
	defaultOpen?: boolean;
	children: React.ReactNode;
}

export const VectorField: React.FC<TVectorFieldProps> = (props) => {
	const {
		label,
		value,
		suffix,
		step = 0.05,
		min = -1000,
		max = 1000,
		hideLabel = false,
		onChange
	} = props;
	return (
		<div className="property-vector">
			{!hideLabel && <span className="property-vector-label">{label}</span>}
			<div className="property-vector-fields">
				{(['X', 'Y', 'Z'] as const).map((axis, index) => (
					<div className={`property-axis axis-${axis.toLowerCase()}`} key={axis}>
						<NumberField
							label={axis}
							ariaLabel={`${label} ${axis}`}
							value={value[index] ?? 0}
							suffix={suffix}
							step={step}
							min={min}
							max={max}
							onChange={(number) => {
								const next: TVec3 = [...value];
								next[index] = number;
								onChange(next);
							}}
						/>
					</div>
				))}
			</div>
		</div>
	);
};

interface TVectorFieldProps {
	label: string;
	value: TVec3;
	suffix?: string;
	step?: number;
	min?: number;
	max?: number;
	hideLabel?: boolean;
	onChange(value: TVec3): void;
}

export const ColorField: React.FC<TColorFieldProps> = (props) => (
	<ColorFieldControl key={props.value} {...props} />
);

interface TColorFieldProps {
	label: string;
	value: string;
	onPreview?(value: string | null): void;
	onChange(value: string): void;
}

const ColorFieldControl: React.FC<TColorFieldProps> = (props) => {
	const { label, value, onChange, onPreview } = props;
	const [draft, setDraft] = React.useState(value);
	const [hex, setHex] = React.useState(value.toUpperCase());
	const changedRef = React.useRef(false);
	const clearPreviewOnUnmount = React.useEffectEvent(() => {
		if (changedRef.current) onPreview?.(null);
	});
	React.useEffect(() => () => clearPreviewOnUnmount(), []);
	function cancel() {
		changedRef.current = false;
		setDraft(value);
		setHex(value.toUpperCase());
		onPreview?.(null);
	}
	function commit(event: React.FocusEvent<HTMLInputElement>) {
		if (!changedRef.current) return;
		const next = parseColor(event.currentTarget.value);
		if (next == null) {
			cancel();
			return;
		}
		changedRef.current = false;
		onPreview?.(null);
		setDraft(next);
		setHex(next.toUpperCase());
		if (next !== value.toLowerCase()) onChange(next);
	}
	function keyDown(event: React.KeyboardEvent<HTMLInputElement>) {
		if (event.nativeEvent.isComposing || !['Escape', 'Enter'].includes(event.key)) return;
		event.preventDefault();
		event.stopPropagation();
		if (event.key === 'Escape') cancel();
		event.currentTarget.blur();
	}
	return (
		<label className="property-row property-color">
			<span>{label}</span>
			<span className="property-color-control">
				<input
					type="color"
					aria-label={label}
					value={draft}
					onChange={(event) => {
						const next = parseColor(event.currentTarget.value);
						if (next == null) return;
						changedRef.current = true;
						setDraft(next);
						setHex(next.toUpperCase());
						onPreview?.(next);
					}}
					onBlur={commit}
					onKeyDown={keyDown}
					onPointerCancel={cancel}
				/>
				<input
					type="text"
					aria-label={`${label} hex`}
					value={hex}
					maxLength={7}
					spellCheck={false}
					onChange={(event) => {
						const text = event.currentTarget.value;
						changedRef.current = true;
						setHex(text);
						const next = parseColor(text);
						if (next != null) setDraft(next);
						onPreview?.(next);
					}}
					onBlur={commit}
					onKeyDown={keyDown}
				/>
			</span>
		</label>
	);
};

function parseColor(text: string): string | null {
	const trimmed = text.trim();
	const color = trimmed.startsWith('#') ? trimmed : `#${trimmed}`;
	return /^#[0-9a-f]{6}$/i.test(color) ? color.toLowerCase() : null;
}

export const TextInput: React.FC<TTextInputProps> = (props) => {
	const { label, value, disabled, onChange } = props;
	return (
		<input
			key={value}
			aria-label={label}
			disabled={disabled}
			defaultValue={value}
			maxLength={100}
			onBlur={(event) => {
				const next = event.currentTarget.value.trim();
				if (next && next !== value) onChange(next);
				else event.currentTarget.value = value;
			}}
			onKeyDown={(event) => {
				if (event.nativeEvent.isComposing || !['Escape', 'Enter'].includes(event.key)) return;
				event.preventDefault();
				event.stopPropagation();
				if (event.key === 'Escape') event.currentTarget.value = value;
				if (event.key === 'Escape' || event.key === 'Enter') event.currentTarget.blur();
			}}
		/>
	);
};

interface TTextInputProps {
	label: string;
	value: string;
	disabled?: boolean;
	onChange(value: string): void;
}

function formatNumber(value: number): string {
	return String(Number(value.toFixed(3)));
}
