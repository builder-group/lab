import React from 'react';
import { TextField } from '@/components/Field';

/** A slider with a typeable value field beside it, previewing while dragged and committing once on release */
export const SliderField: React.FC<TSliderFieldProps> = (props) => {
	const { id, label, value, min, max, step, unit, format, onPreview, onCommit } = props;
	const [draft, setDraft] = React.useState<number | null>(null);
	const shown = draft ?? value;
	function commit(): void {
		if (draft != null && draft !== value) onCommit(draft);
		setDraft(null);
	}
	return (
		<>
			<div className="mm-insp-slider">
				<input
					id={id}
					aria-label={label}
					className="mm-slider"
					type="range"
					min={min}
					max={max}
					step={step}
					value={shown}
					style={{ '--fill': `${((shown - min) / (max - min)) * 100}%` } as React.CSSProperties}
					onChange={(event) => {
						const next = Number(event.target.value);
						setDraft(next);
						onPreview?.(next);
					}}
					onPointerUp={commit}
					onKeyUp={commit}
					onBlur={commit}
				/>
			</div>
			{/* The value also takes typing, for exact values the short slider cannot reach */}
			<TextField
				id={`${id}-value`}
				label={label}
				name={label}
				value={format(shown)}
				unit={unit}
				allowEmpty={false}
				onCommit={(text) => {
					const typed = Number.parseFloat(text.replace(',', '.'));
					if (!Number.isFinite(typed)) return;
					const next = Math.min(max, Math.max(min, Math.round(typed / step) * step));
					if (next !== value) onCommit(Number(next.toFixed(6)));
				}}
			/>
		</>
	);
};

interface TSliderFieldProps {
	id: string;
	label: string;
	value: number;
	min: number;
	max: number;
	step: number;
	unit: string;
	format: (value: number) => string;
	onPreview?: (value: number) => void;
	onCommit: (value: number) => void;
}
