import React from 'react';
import { marbleColors, type TProjectCommand } from '@/modules/project';
import type { StudioCx } from './StudioCx';

/** What the system picker offers first: every marble's color, and the red the examples' Melody wears */
const SUGGESTED_COLORS = [...marbleColors, '#c8102e'];
const SUGGESTIONS_ID = 'mm-label-colors';

/**
 * A layer's color, chosen on its icon or dot: the system color picker over it, like a color well. A drag in the picker is one
 * Undo step. Clear Label Color is in the layer's menu, where a layer can do without.
 */
export const LabelColorInput: React.FC<{ cx: StudioCx; color: string | undefined; name: string; commandsFor: (color: string) => TProjectCommand[] }> = (props) => {
	const { cx, color, name, commandsFor } = props;
	const groupRef = React.useRef<number | null>(null);

	function set(next: string): void {
		const commands = commandsFor(next);
		if (groupRef.current != null && cx.editGroup === groupRef.current) cx.execute(commands, { group: groupRef.current });
		else if (cx.execute(commands)) groupRef.current = cx.editGroup;
	}

	return (
		<input
			type="color"
			className="mm-label-color"
			list={SUGGESTIONS_ID}
			title="Color"
			aria-label={`Color of ${name}`}
			value={color ?? '#8e8e93'}
			onChange={(event) => set(event.target.value)}
			onBlur={() => {
				groupRef.current = null;
			}}
			onClick={(event) => event.stopPropagation()}
			onDoubleClick={(event) => event.stopPropagation()}
		/>
	);
};

/** The swatches every color input lists, once per window */
export const LabelColorSuggestions: React.FC = () => (
	<datalist id={SUGGESTIONS_ID}>
		{SUGGESTED_COLORS.map((color) => (
			<option key={color} value={color} />
		))}
	</datalist>
);
