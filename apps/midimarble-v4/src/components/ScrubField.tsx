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
		format: formatValue,
		parse,
		onPreview,
		onCommit,
		onCancel
	} = props;
	const show = (next: number): string => (formatValue != null ? formatValue(next) : format(next, precision));
	const text = value == null ? '' : show(value);
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
		const parsed = parse != null ? (parse(draft) ?? Number.NaN) : Number(draft.replace(',', '.').replace(/[^\d.+-]/g, ''));
		if (draft.trim() === '' || !Number.isFinite(parsed)) {
			setDraft(text);
			return;
		}
		onCommit(clamp(parsed));
	}

	const isGlyph = typeof label === 'string' && label.length <= 1;
	const [fieldRef, isCompact] = useCompactUnit(unit, draft.length);

	return (
		<div ref={fieldRef} className="mm-ifield" data-disabled={disabled} data-span={span} data-compact={isCompact}>
			<label
				htmlFor={id}
				className="mm-ifield-label"
				data-scrub={!disabled}
				data-glyph={isGlyph}
				// A name that already explains the field stays that one sentence, rather than a stack of clauses
				title={name.length > NAME_ONLY_LENGTH ? name : `${name}${unit.length > 0 ? ` (${unit})` : ''}${disabled ? '' : ': drag to change, hold Shift for larger steps'}`}
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
					setDraft(show(scrub.current));
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
				// The value it holds always shows whole, leaving the rest for the unit
				style={{ minWidth: `calc(${Math.max(draft.length, 3)}ch + 8px)` }}
				value={draft}
				placeholder={value == null ? 'Mixed' : undefined}
				inputMode={parse != null ? 'text' : 'decimal'}
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

// Longer than a field's name, a `name` is a sentence of its own
const NAME_ONLY_LENGTH = 24;

/**
 * True when the field is too narrow for its label, its value and the unit, so the unit steps aside and the value stays
 * whole; the label's tooltip still names the unit
 */
function useCompactUnit(unit: string, valueLength: number): [React.RefObject<HTMLDivElement | null>, boolean] {
	const ref = React.useRef<HTMLDivElement>(null);
	const [value, setValue] = React.useState(false);
	React.useLayoutEffect(() => {
		const field = ref.current;
		if (field == null || !unit.length) return;
		const measure = (): void => {
			const label = field.querySelector<HTMLElement>('.mm-ifield-label');
			const input = field.querySelector('input');
			const unitElement = field.querySelector<HTMLElement>('.mm-ifield-unit');
			if (label == null || input == null || unitElement == null) return;
			const minValue = Number.parseFloat(getComputedStyle(input).minWidth) || 0;
			setValue(label.offsetWidth + minValue + unitElement.offsetWidth > field.clientWidth);
		};
		measure();
		const observer = new ResizeObserver(measure);
		observer.observe(field);
		return () => observer.disconnect();
	}, [unit, valueLength]);
	return [ref, value];
}

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
	/**
	 * Own text for the value and its reader, such as the timeline LCD's `m:ss.cc` for times; null from `parse`
	 * rejects the text. `precision` still sets how finely a typed or scrubbed value is kept.
	 */
	format?: (value: number) => string;
	parse?: (text: string) => number | null;
	onPreview?: (value: number) => void;
	onCommit: (value: number) => void;
	onCancel?: () => void;
}

function format(value: number, precision: number): string {
	const text = value.toFixed(precision);
	return /^-0(\.0+)?$/.test(text) ? text.slice(1) : text;
}

