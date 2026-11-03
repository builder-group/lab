import { CircleHelp } from 'lucide-react';
import React from 'react';

/** Small question mark that explains a control on hover or focus, so panels need no prose */
export const HelpTip: React.FC<{ text: string; side?: 'left' | 'right' }> = (props) => {
	const { text, side = 'left' } = props;
	return (
		<span className="mm-help" tabIndex={0} aria-label={text} data-side={side}>
			<CircleHelp size={12} strokeWidth={1.8} />
			<span className="mm-help-bubble" role="tooltip">
				{text}
			</span>
		</span>
	);
};
