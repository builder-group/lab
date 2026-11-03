import { ChevronsUpDown } from 'lucide-react';
import React from 'react';

/** Pop-up button: a native select drawn like an AppKit pop-up button */
export const Select: React.FC<TSelectProps> = (props) => {
	const { id, value, options, onChange } = props;
	return (
		<span className="mm-select">
			<select id={id} value={value} onChange={(event) => onChange(event.target.value)}>
				{options.map((option) => (
					<option key={option.value} value={option.value}>
						{option.label}
					</option>
				))}
			</select>
			<ChevronsUpDown size={12} strokeWidth={2} />
		</span>
	);
};

interface TSelectProps {
	id: string;
	value: string;
	options: { value: string; label: string }[];
	onChange: (value: string) => void;
}
