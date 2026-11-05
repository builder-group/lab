import React from 'react';

/**
 * Window rects of the visible elements carrying `attribute`, keyed by its value, for overlays that point at parts
 * of the window. Measures only when something could have moved them: an anchor or its parents resized, the DOM or an
 * inline style changed, something scrolled, or a transition is under way. Null turns it off.
 */
export function useAnchorRects(attribute: string | null, value?: string): TAnchorRect[] {
	const [rects, setRects] = React.useState<TAnchorRect[]>([]);

	React.useEffect(() => {
		if (attribute == null) return;
		let frame = 0;
		let last = '';
		let watched = new Set<Element>();
		const selector = value == null ? `[${attribute}]` : `[${attribute}="${value}"]`;
		const schedule = (): void => {
			if (frame === 0) frame = requestAnimationFrame(measure);
		};
		const resizes = new ResizeObserver(schedule);
		const measure = (): void => {
			frame = 0;
			const next: TAnchorRect[] = [];
			const elements = new Set<Element>();
			for (const element of document.querySelectorAll(selector)) {
				// A panel growing beside an anchor moves it without resizing it, so its parents are watched too
				for (let node: Element | null = element; node != null; node = node.parentElement) elements.add(node);
				const box = element.getBoundingClientRect();
				if (box.width < 1 || box.height < 1) continue;
				next.push({ key: element.getAttribute(attribute) ?? '', left: box.left, top: box.top, right: box.right, bottom: box.bottom, width: box.width, height: box.height });
			}
			for (const element of watched) if (!elements.has(element)) resizes.unobserve(element);
			for (const element of elements) if (!watched.has(element)) resizes.observe(element);
			watched = elements;
			const signature = next.map((rect) => `${rect.key}:${Math.round(rect.left)},${Math.round(rect.top)},${Math.round(rect.width)},${Math.round(rect.height)}`).join('|');
			if (signature !== last) {
				last = signature;
				setRects(next);
			}
			if (isTransitioning()) schedule();
		};
		const mutations = new MutationObserver(schedule);
		mutations.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: [attribute, 'style', 'class'] });
		window.addEventListener('scroll', schedule, { capture: true, passive: true });
		window.addEventListener('resize', schedule);
		schedule();
		return () => {
			cancelAnimationFrame(frame);
			resizes.disconnect();
			mutations.disconnect();
			window.removeEventListener('scroll', schedule, { capture: true });
			window.removeEventListener('resize', schedule);
			setRects([]);
		};
	}, [attribute, value]);

	return attribute == null ? noRects : rects;
}

const noRects: TAnchorRect[] = [];

/** A transition moves an anchor with no event along the way; a looping animation never ends, so it doesn't count */
function isTransitioning(): boolean {
	return document.getAnimations().some((animation) => animation.playState === 'running' && animation.effect?.getComputedTiming().iterations !== Infinity);
}

export interface TAnchorRect {
	key: string;
	left: number;
	top: number;
	right: number;
	bottom: number;
	width: number;
	height: number;
}
