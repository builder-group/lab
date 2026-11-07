import { CircleHelp } from 'lucide-react';
import React from 'react';

/** Small question mark that explains a control on hover or focus, so panels need no prose */
export const HelpTip: React.FC<{ text: string; side?: 'left' | 'right' }> = (props) => {
	const { text, side = 'left' } = props;
	const id = React.useId();
	// Named "Help" with the explanation as its description, so a screen reader announces both on focus
	return (
		<span className="mm-help" tabIndex={0} role="button" aria-label="Help" aria-describedby={id} data-side={side}>
			<CircleHelp size={12} strokeWidth={1.8} aria-hidden />
			<span id={id} className="mm-help-bubble" role="tooltip">
				{text}
			</span>
		</span>
	);
};
