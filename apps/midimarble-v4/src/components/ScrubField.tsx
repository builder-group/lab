import React from 'react';

/**
 * Numeric field whose label scrubs the value when dragged, like Figma. Scrubbing reports previews and
 * commits once on release; typing commits on Return or blur. Shift scrubs ten times faster.
 */
export const ScrubField: React.FC<TScrubFieldProps> = (props) => {
	const { id, label, value, unit, step, precision = 0, min = Number.NEGATIVE_INFINITY, max = Number.POSITIVE_INFINITY, onPreview, onCommit, onCancel } = props;
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

	return (
		<div className="mm-field">
			<label
				htmlFor={id}
				className="cursor-ew-resize touch-none"
				onPointerDown={(event) => {
					if (event.button !== 0) return;
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
			<div className="relative">
				<input
					id={id}
					className="mm-input mm-mono pr-6"
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
				<span className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 text-[11px] text-[var(--text-tertiary)]">{unit}</span>
			</div>
		</div>
	);
};

interface TScrubFieldProps {
	id: string;
	label: string;
	/** Null shows the field as mixed */
	value: number | null;
	unit: string;
	/** Value change per pixel dragged */
	step: number;
	/** Decimal places shown and kept */
	precision?: number;
	min?: number;
	max?: number;
	onPreview?: (value: number) => void;
	onCommit: (value: number) => void;
	onCancel?: () => void;
}

function format(value: number, precision: number): string {
	const text = value.toFixed(precision);
	return /^-0(\.0+)?$/.test(text) ? text.slice(1) : text;
}
