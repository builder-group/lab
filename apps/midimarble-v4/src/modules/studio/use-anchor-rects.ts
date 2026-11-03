import React from 'react';

/**
 * Window rects of the visible elements carrying `attribute`, keyed by its value, for overlays that point at parts
 * of the window. A frame loop keeps them current while panels resize or scroll; null turns it off.
 */
export function useAnchorRects(attribute: string | null, value?: string): TAnchorRect[] {
	const [rects, setRects] = React.useState<TAnchorRect[]>([]);

	React.useEffect(() => {
		if (attribute == null) return;
		let frame = 0;
		let last = '';
		const selector = value == null ? `[${attribute}]` : `[${attribute}="${value}"]`;
		const measure = (): void => {
			const next: TAnchorRect[] = [];
			for (const element of document.querySelectorAll(selector)) {
				const box = element.getBoundingClientRect();
				if (box.width < 1 || box.height < 1) continue;
				next.push({ key: element.getAttribute(attribute) ?? '', left: box.left, top: box.top, right: box.right, bottom: box.bottom, width: box.width, height: box.height });
			}
			const signature = next.map((rect) => `${rect.key}:${Math.round(rect.left)},${Math.round(rect.top)},${Math.round(rect.width)},${Math.round(rect.height)}`).join('|');
			if (signature !== last) {
				last = signature;
				setRects(next);
			}
			frame = requestAnimationFrame(measure);
		};
		frame = requestAnimationFrame(measure);
		return () => {
			cancelAnimationFrame(frame);
			setRects([]);
		};
	}, [attribute, value]);

	return attribute == null ? noRects : rects;
}

const noRects: TAnchorRect[] = [];

export interface TAnchorRect {
	key: string;
	left: number;
	top: number;
	right: number;
	bottom: number;
	width: number;
	height: number;
}
