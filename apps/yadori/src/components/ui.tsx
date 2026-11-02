import { CircleHelp, X } from 'lucide-react';
import React from 'react';
import { quantity } from '../lib/format';

export const Button: React.FC<
	React.ButtonHTMLAttributes<HTMLButtonElement> & {
		variant?: 'primary' | 'ghost' | 'danger';
		icon?: React.ReactNode;
	}
> = ({ variant, icon, children, className = '', ...props }) => (
	<button type="button" className={`button ${variant ?? ''} ${className}`} {...props}>
		{icon}
		{children}
	</button>
);
export const IconButton: React.FC<
	React.ButtonHTMLAttributes<HTMLButtonElement> & { label: string }
> = ({ label, children, ...props }) => (
	<button type="button" className="icon-button" title={label} aria-label={label} {...props}>
		{children}
	</button>
);
export const Modal: React.FC<{
	title: string;
	onClose(): void;
	children: React.ReactNode;
	wide?: boolean;
}> = ({ title, onClose, children, wide }) => {
	const ref = React.useRef<HTMLDialogElement>(null);
	React.useEffect(() => {
		const dialog = ref.current;
		const previous = document.activeElement;
		dialog?.showModal();
		dialog
			?.querySelector<HTMLElement>(
				'input:not([type="checkbox"]):not(:disabled),textarea:not(:disabled),select:not(:disabled)'
			)
			?.focus();
		return () => {
			dialog?.close();
			if (previous instanceof HTMLElement && previous.isConnected)
				previous.focus({ preventScroll: true });
		};
	}, []);
	return (
		<dialog
			ref={ref}
			className={`modal ${wide ? 'wide' : ''}`}
			onCancel={(event) => {
				event.preventDefault();
				onClose();
			}}
			onClick={(event) => {
				if (event.target === ref.current) onClose();
			}}
		>
			<div className="modal-heading">
				<h2>{title}</h2>
				<IconButton label="Close" onClick={onClose}>
					<X size={16} />
				</IconButton>
			</div>
			<div className="modal-body">{children}</div>
		</dialog>
	);
};
export const Field: React.FC<{ label: string; children: React.ReactNode; help?: string }> = ({
	label,
	children,
	help
}) => (
	<label className="field">
		<span>
			{label}
			{help && <Help text={help} />}
		</span>
		{children}
	</label>
);
export const Help: React.FC<{ text: string }> = ({ text }) => (
	<span className="help" tabIndex={0} aria-label={text}>
		<CircleHelp size={13} />
		<span role="tooltip">{text}</span>
	</span>
);
export const TextField: React.FC<{
	label: string;
	value: string;
	onChange(value: string): void;
	placeholder?: string;
	required?: boolean;
	multiline?: boolean;
}> = ({ label, value, onChange, placeholder, required, multiline }) => {
	const ref = React.useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);
	React.useLayoutEffect(() => {
		if (ref.current && document.activeElement !== ref.current) ref.current.value = value;
	}, [value]);
	const save = (event: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>): void => {
		const next = event.currentTarget.value;
		if (required && !next.trim()) {
			event.currentTarget.value = value;
			return;
		}
		if (next !== value) onChange(next);
	};
	const keys = (event: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>): void => {
		if (event.key === 'Escape') {
			event.preventDefault();
			event.stopPropagation();
			event.currentTarget.value = value;
			event.currentTarget.blur();
		} else if (event.key === 'Enter' && (!multiline || event.metaKey || event.ctrlKey)) {
			event.preventDefault();
			event.stopPropagation();
			event.currentTarget.blur();
		}
	};
	return (
		<Field label={label}>
			{multiline ? (
				<textarea
					ref={(node) => {
						ref.current = node;
					}}
					defaultValue={value}
					onBlur={save}
					onKeyDown={keys}
					placeholder={placeholder}
				/>
			) : (
				<input
					ref={(node) => {
						ref.current = node;
					}}
					defaultValue={value}
					onBlur={save}
					onKeyDown={keys}
					placeholder={placeholder}
				/>
			)}
		</Field>
	);
};
export const NumberField: React.FC<{
	label: string;
	value: number | null;
	onChange(value: number | null): void;
	unit?: string;
	suffix?: string;
	min?: number;
	required?: boolean;
	help?: string;
}> = ({ label, value, onChange, unit, suffix, min = 0, required, help }) => {
	const ref = React.useRef<HTMLInputElement>(null);
	React.useLayoutEffect(() => {
		if (ref.current && document.activeElement !== ref.current)
			ref.current.value = value == null ? '' : String(value);
	}, [value]);
	return (
		<Field label={label} help={help}>
			<div className="number-control">
				<input
					ref={ref}
					type="number"
					min={min}
					step="any"
					defaultValue={value ?? ''}
					placeholder="—"
					onKeyDown={(event) => {
						if (event.key === 'Escape') {
							event.preventDefault();
							event.stopPropagation();
							event.currentTarget.value = value == null ? '' : String(value);
							event.currentTarget.blur();
						} else if (event.key === 'Enter') {
							event.preventDefault();
							event.stopPropagation();
							event.currentTarget.blur();
						}
					}}
					onBlur={(event) => {
						const text = event.currentTarget.value.trim();
						const next = text ? Number(text) : null;
						if (
							event.currentTarget.validity.badInput ||
							(next == null && required) ||
							(next != null && (!Number.isFinite(next) || next < min))
						) {
							event.currentTarget.value = value == null ? '' : String(value);
							return;
						}
						if (next !== value) onChange(next);
					}}
				/>
				{(unit ?? suffix) && <span>{unit ?? suffix}</span>}
			</div>
		</Field>
	);
};
export const RequirementQuantity: React.FC<{
	value: number;
	unit: string;
	unknownCount?: number;
}> = ({ value, unit, unknownCount = 0 }) => (
	<span
		title={
			unknownCount
				? `${unknownCount} run ${unknownCount === 1 ? 'length is' : 'lengths are'} not specified`
				: undefined
		}
	>
		{unknownCount && value === 0 ? (
			<span className="quantity-unknown">Unknown</span>
		) : (
			<>
				{quantity(value, unit)}
				{unknownCount > 0 && <span className="quantity-unknown"> + ?</span>}
			</>
		)}
	</span>
);
