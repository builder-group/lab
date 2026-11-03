import React from 'react';

/**
 * Numeric field with its label inside, like Figma's X, Y and angle fields. Dragging the label scrubs the
 * value; scrubbing reports previews and commits once on release, typing commits on Return or blur. Shift
 * scrubs and steps ten times faster.
 */
export const ScrubField: React.FC<TScrubFieldProps> = (props) => {
	const {
		id,
		label,
		name,
		value,
		unit,
		step,
		precision = 0,
		min = Number.NEGATIVE_INFINITY,
		max = Number.POSITIVE_INFINITY,
		disabled = false,
		span,
		onPreview,
		onCommit,
		onCancel
	} = props;
	const text = value == null ? '' : format(value, precision);
	const [draft, setDraft] = React.useState(text);
	const [source, setSource] = React.useState(text);
	const scrubRef = React.useRef<{ x: number; start: number; current: number; moved: boolean } | null>(null);
	// Reset the draft during render when the committed value changes elsewhere, such as through undo
	if (source !== text) {
		setSource(text);
		setDraft(text);
	}

	function clamp(next: number): number {
		const rounded = Math.round(next * 10 ** precision) / 10 ** precision;
		return Math.min(max, Math.max(min, rounded));
	}

	function commitDraft(): void {
		if (draft === text) return;
		const parsed = Number(draft.replace(',', '.').replace(/[^\d.+-]/g, ''));
		if (draft.trim() === '' || !Number.isFinite(parsed)) {
			setDraft(text);
			return;
		}
		onCommit(clamp(parsed));
	}

	const isGlyph = typeof label === 'string' && label.length <= 1;

	return (
		<div className="mm-ifield" data-disabled={disabled} data-span={span}>
			<label
				htmlFor={id}
				className="mm-ifield-label"
				data-scrub={!disabled}
				data-glyph={isGlyph}
				title={disabled ? name : `${name}: drag to change, hold Shift for larger steps`}
				onPointerDown={(event) => {
					if (event.button !== 0 || disabled) return;
					event.preventDefault();
					event.currentTarget.setPointerCapture(event.pointerId);
					const start = value ?? 0;
					scrubRef.current = { x: event.clientX, start, current: start, moved: false };
				}}
				onPointerMove={(event) => {
					const scrub = scrubRef.current;
					if (scrub == null) return;
					const dx = event.clientX - scrub.x;
					if (!scrub.moved && Math.abs(dx) < 2) return;
					scrub.moved = true;
					scrub.current = clamp(scrub.start + dx * step * (event.shiftKey ? 10 : 1));
					setDraft(format(scrub.current, precision));
					onPreview?.(scrub.current);
				}}
				onPointerUp={() => {
					const scrub = scrubRef.current;
					scrubRef.current = null;
					if (scrub?.moved === true) onCommit(scrub.current);
				}}
				onPointerCancel={() => {
					scrubRef.current = null;
					setDraft(text);
					onCancel?.();
				}}
			>
				{label}
			</label>
			<input
				id={id}
				aria-label={name}
				disabled={disabled}
				value={draft}
				placeholder={value == null ? 'Mixed' : undefined}
				inputMode="decimal"
				onChange={(event) => setDraft(event.target.value)}
				onBlur={commitDraft}
				onKeyDown={(event) => {
					if (event.key === 'Enter') event.currentTarget.blur();
					if (event.key === 'Escape') {
						setDraft(text);
						requestAnimationFrame(() => (event.target as HTMLInputElement).blur());
					}
					if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
						event.preventDefault();
						const delta = (event.key === 'ArrowUp' ? 1 : -1) * (event.shiftKey ? 10 : 1) * 10 ** -precision;
						onCommit(clamp((value ?? 0) + delta));
					}
				}}
			/>
			{unit.length > 0 ? <span className="mm-ifield-unit">{unit}</span> : null}
		</div>
	);
};

interface TScrubFieldProps {
	id: string;
	/** Short label inside the field: a letter or glyph such as `X` or `∠`, or a short word */
	label: React.ReactNode;
	/** Full name for the tooltip and assistive technology, such as `Angle` */
	name: string;
	/** Null shows the field as mixed */
	value: number | null;
	unit: string;
	/** Value change per pixel dragged */
	step: number;
	/** Decimal places shown and kept */
	precision?: number;
	min?: number;
	max?: number;
	/** Shows the value without letting it change, such as the position of a piece that follows its hit */
	disabled?: boolean;
	/** `2` spans both columns of the inspector grid */
	span?: 2;
	onPreview?: (value: number) => void;
	onCommit: (value: number) => void;
	onCancel?: () => void;
}

function format(value: number, precision: number): string {
	const text = value.toFixed(precision);
	return /^-0(\.0+)?$/.test(text) ? text.slice(1) : text;
}
