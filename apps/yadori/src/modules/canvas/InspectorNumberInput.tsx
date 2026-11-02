import React from 'react';

/** Keeps the native editor mounted while saved project values change. Keystrokes do not update project state. */
export const InspectorNumberInput: React.FC<TInspectorNumberInputProps> = ({
	value,
	onCommit,
	label,
	min = -Infinity,
	max = Infinity,
	nullable = true,
	disabled = false
}) => {
	const ref = React.useRef<HTMLInputElement>(null);
	const focusedRef = React.useRef(false);
	const canceledRef = React.useRef(false);
	const committedRef = React.useRef(value);
	React.useLayoutEffect(() => {
		committedRef.current = value;
		if (!focusedRef.current && ref.current) ref.current.value = format(value);
	}, [value]);
	return (
		<input
			ref={ref}
			aria-label={label}
			type="number"
			step="any"
			min={Number.isFinite(min) ? min : undefined}
			max={Number.isFinite(max) ? max : undefined}
			defaultValue={format(value)}
			placeholder="—"
			disabled={disabled}
			onFocus={() => {
				focusedRef.current = true;
				canceledRef.current = false;
			}}
			onBlur={(event) => {
				focusedRef.current = false;
				if (canceledRef.current) {
					canceledRef.current = false;
					event.currentTarget.value = format(committedRef.current);
					return;
				}
				const text = event.currentTarget.value.trim(),
					next = text === '' ? null : Number(text);
				if (
					event.currentTarget.validity.badInput ||
					(next == null && !nullable) ||
					(next != null && (!Number.isFinite(next) || next < min || next > max))
				) {
					event.currentTarget.value = format(committedRef.current);
					return;
				}
				if (next !== committedRef.current && onCommit(next) === false)
					event.currentTarget.value = format(committedRef.current);
			}}
			onKeyDown={(event) => {
				if (event.key === 'Enter') {
					event.preventDefault();
					event.stopPropagation();
					event.currentTarget.blur();
				}
				if (event.key === 'Escape') {
					event.preventDefault();
					event.stopPropagation();
					canceledRef.current = true;
					event.currentTarget.value = format(committedRef.current);
					event.currentTarget.blur();
				}
			}}
		/>
	);
};
interface TInspectorNumberInputProps {
	value: number | null;
	label: string;
	onCommit(value: number | null): unknown;
	min?: number;
	max?: number;
	nullable?: boolean;
	disabled?: boolean;
}
function format(value: number | null): string {
	return value == null ? '' : String(value);
}
