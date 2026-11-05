// Compose keyboard map. Tools use single letters like Figma and Paper (V, H, O, P, B, W), U draws a tunnel with
// the path tool, ⇧I opens the Insert library like Figma's assets, the build assists
// keep theirs (N, ⇧N, R, M, A, Tab), ⇧1 to ⇧3 frame like Figma, F turns Follow on and off like Logic's Catch Playhead and
// T stays free for tapping hits.

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
	/** A rail is being drawn with the path tool */
	isDrawing?: boolean;
	/** The selection holds a piece, or a hit with a platform, that ↑ ↓ can tilt */
	canTilt?: boolean;
	/** The selection holds notes, whose piano roll owns 0 to 9 for handing them over */
	hasNotes?: boolean;
}

/** Tools of the Compose tool rail, then the pieces the Insert library arms */
export type TComposeTool = 'select' | 'hand' | 'marble' | 'platform' | 'path' | 'windmill' | 'bowl';

/** Piece the path tool draws; the inspector switches a drawn path between both */
export type TPathType = 'rail' | 'tunnel';

export type TComposeKeyAction =
	| { type: 'zoom'; factor: number }
	| { type: 'zoom100' }
	| { type: 'fit'; target: 'all' | 'selection' }
	| { type: 'tool'; tool: TComposeTool; pathType?: TPathType }
	| { type: 'library' }
	| { type: 'next' }
	| { type: 'buildTrack' }
	| { type: 'acceptGhosts' }
	| { type: 'escape' }
	| { type: 'delete' }
	| { type: 'nudge'; degrees: number }
	| { type: 'repeat' }
	| { type: 'mirror' }
	| { type: 'fix' }
	| { type: 'finishPath' }
	| { type: 'undoPathPoint' }
	| { type: 'follow' };

/** Tool keys, shared by the rail tooltips, the Insert tiles and the command palette */
export const toolKeys: { tool: TComposeTool; code: string; key: string }[] = [
	{ tool: 'select', code: 'KeyV', key: 'V' },
	{ tool: 'hand', code: 'KeyH', key: 'H' },
	{ tool: 'marble', code: 'KeyO', key: 'O' },
	{ tool: 'platform', code: 'KeyP', key: 'P' },
	{ tool: 'path', code: 'KeyB', key: 'B' },
	{ tool: 'windmill', code: 'KeyW', key: 'W' }
];

/** F turns Follow on and off, shared by the canvas toggle's tooltip and the command palette */
export const followKey = { code: 'KeyF', key: 'F' };

/** U arms the path tool with the tunnel type, like Figma's shape tools that share one rail slot */
export const tunnelPathKey = { code: 'KeyU', key: 'U' };

/** Piece type each placing tool puts down with a click or drag; the path tool draws instead */
export const toolPieceType: Partial<Record<TComposeTool, string>> = { platform: 'platform', windmill: 'windmill', bowl: 'bowl' };

/** The action a key press asks for, or null when Compose leaves it to the studio or the browser */
export function composeKeyAction(input: TKeyInput, context: TKeyContext): TComposeKeyAction | null {
	const key = input.key.toLowerCase();
	if (input.metaKey && !input.ctrlKey && !input.altKey) {
		if (key === '=' || key === '+') return { type: 'zoom', factor: 2 };
		if (key === '-') return { type: 'zoom', factor: 0.5 };
		if (key === '0') return { type: 'zoom100' };
		return null;
	}
	if (input.metaKey || input.ctrlKey || input.altKey) return null;
	if (input.shiftKey && (input.code === 'Digit1' || input.code === 'Digit2')) {
		return { type: 'fit', target: input.code === 'Digit1' ? 'all' : 'selection' };
	}
	if (context.isDrawing === true) {
		if (input.key === 'Enter') return { type: 'finishPath' };
		if (input.key === 'Backspace' || input.key === 'Delete') return { type: 'undoPathPoint' };
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
		// ← → always step hits (Previous and Next Hit); ↑ ↓ always tilt, raising the value like any scrub field
		case 'ArrowUp':
		case 'ArrowDown':
			if (context.canTilt !== true) return null;
			return { type: 'nudge', degrees: (input.key === 'ArrowUp' ? 1 : -1) * (input.shiftKey ? 5 : 1) };
	}
	if (input.shiftKey) {
		if (input.code === 'KeyI') return { type: 'library' };
		return input.code === 'KeyN' ? { type: 'buildTrack' } : null;
	}
	if (input.code === followKey.code) return { type: 'follow' };

	const tool = toolKeys.find((item) => item.code === input.code);
	if (tool != null) return tool.tool === 'path' ? { type: 'tool', tool: 'path', pathType: 'rail' } : { type: 'tool', tool: tool.tool };
	if (input.code === tunnelPathKey.code) return { type: 'tool', tool: 'path', pathType: 'tunnel' };
	switch (key) {
		case 'n':
			return { type: 'next' };
		case 'r':
			return { type: 'repeat' };
		case 'm':
			return { type: 'mirror' };
		case 'a':
			return { type: 'fix' };
	}
	return null;
}
