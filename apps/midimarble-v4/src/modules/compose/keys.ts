// Compose keyboard map. Tools and the step loop use single letters like Blender and Figma; piece types
// sit on 1 to 4 in tool bar order. ⇧1 and ⇧2 frame like Figma, and T stays free for tapping hits.

export interface TKeyInput {
	key: string;
	code: string;
	shiftKey: boolean;
	metaKey: boolean;
	ctrlKey: boolean;
	altKey: boolean;
}

export interface TKeyContext {
	/** The selection holds pieces */
	hasPieces: boolean;
	/** The selection holds anything */
	hasSelection: boolean;
	/** Ghost pieces are on the canvas */
	hasGhosts: boolean;
}

export type TComposeKeyAction =
	| { type: 'zoom'; factor: number }
	| { type: 'fit'; target: 'all' | 'selection' }
	| { type: 'tool'; tool: 'select' | 'hand' }
	| { type: 'pieceType'; pieceType: string }
	| { type: 'next' }
	| { type: 'acceptGhosts' }
	| { type: 'escape' }
	| { type: 'delete' }
	| { type: 'nudge'; degrees: number }
	| { type: 'repeat' }
	| { type: 'mirror' }
	| { type: 'autoPlace' }
	| { type: 'pin' };

/** Piece types in tool bar order with their number keys */
export const pieceKeys: { type: string; code: string; key: string }[] = [
	{ type: 'platform', code: 'Digit1', key: '1' },
	{ type: 'rail', code: 'Digit2', key: '2' },
	{ type: 'tunnel', code: 'Digit3', key: '3' },
	{ type: 'windmill', code: 'Digit4', key: '4' }
];

/** The action a key press asks for, or null when Compose leaves it to the studio or the browser */
export function composeKeyAction(input: TKeyInput, context: TKeyContext): TComposeKeyAction | null {
	const key = input.key.toLowerCase();
	if (input.metaKey && !input.ctrlKey && !input.altKey) {
		if (key === '=' || key === '+') return { type: 'zoom', factor: 2 };
		if (key === '-') return { type: 'zoom', factor: 0.5 };
		return null;
	}
	if (input.metaKey || input.ctrlKey || input.altKey) return null;
	if (input.shiftKey && (input.code === 'Digit1' || input.code === 'Digit2')) {
		return { type: 'fit', target: input.code === 'Digit1' ? 'all' : 'selection' };
	}

	switch (input.key) {
		case 'Enter':
			// With nothing selected and nothing offered, Return keeps its timeline meaning: back to the start
			return context.hasSelection || context.hasGhosts ? { type: 'next' } : null;
		case 'Tab':
			return context.hasGhosts && !input.shiftKey ? { type: 'acceptGhosts' } : null;
		case 'Escape':
			return { type: 'escape' };
		case 'Backspace':
		case 'Delete':
			return context.hasPieces ? { type: 'delete' } : null;
		case 'ArrowLeft':
		case 'ArrowRight':
			if (!context.hasPieces) return null;
			// Positive angles turn counter-clockwise, so Right turns the bar clockwise like a dial
			return { type: 'nudge', degrees: (input.key === 'ArrowRight' ? -1 : 1) * (input.shiftKey ? 5 : 1) };
	}
	if (input.shiftKey) return null;

	const piece = pieceKeys.find((item) => item.code === input.code);
	if (piece != null) return { type: 'pieceType', pieceType: piece.type };
	switch (key) {
		case 'v':
			return { type: 'tool', tool: 'select' };
		case 'h':
			return { type: 'tool', tool: 'hand' };
		case 'n':
			return { type: 'next' };
		case 'r':
			return { type: 'repeat' };
		case 'm':
			return { type: 'mirror' };
		case 'a':
			return { type: 'autoPlace' };
		case 'p':
			return context.hasPieces ? { type: 'pin' } : null;
	}
	return null;
}
