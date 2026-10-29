import React from 'react';
import { getTrackInstrumentOptions, type TInstrumentOption } from '../music';
import type { TTrack } from '../project';

export const InstrumentSelect: React.FC<TInstrumentSelectProps> = (props) => {
	const { track, onChange } = props;
	const groups = React.useMemo(() => {
		const result = new Map<string, TInstrumentOption[]>();
		for (const option of getTrackInstrumentOptions(track)) {
			const family = option.family ?? 'Drum kits';
			const options = result.get(family) ?? [];
			options.push(option);
			result.set(family, options);
		}
		return result;
	}, [track]);
	return (
		<select
			aria-label="Track instrument"
			value={track.instrument}
			onChange={(event) => onChange(Number(event.target.value))}
		>
			{Array.from(groups, ([family, options]) => (
				<optgroup key={family} label={family}>
					{options.map((option) => (
						<option key={option.value} value={option.value}>
							{option.label}
						</option>
					))}
				</optgroup>
			))}
		</select>
	);
};

interface TInstrumentSelectProps {
	track: TTrack;
	onChange(program: number): void;
}
