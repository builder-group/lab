import type { TVec2 } from '@/modules/project';

// 2D wall view math. World units are meters with y up; screen units are CSS pixels with y down.

/** Camera looking at the wall. `scale` is CSS pixels per meter. */
export interface TView {
	center: TVec2;
	scale: number;
}

export interface TViewport {
	width: number;
	height: number;
}

export interface TBounds {
	minX: number;
	minY: number;
	maxX: number;
	maxY: number;
}

/** 100% shows the wall at physical size on a 96 dpi screen */
export const ZOOM_100_SCALE = 3779.5;
export const MIN_SCALE = 20;
export const MAX_SCALE = 40000;

export function worldToScreen(view: TView, viewport: TViewport, point: TVec2): TVec2 {
	return {
		x: (point.x - view.center.x) * view.scale + viewport.width / 2,
		y: viewport.height / 2 - (point.y - view.center.y) * view.scale
	};
}

export function screenToWorld(view: TView, viewport: TViewport, point: TVec2): TVec2 {
	return {
		x: (point.x - viewport.width / 2) / view.scale + view.center.x,
		y: (viewport.height / 2 - point.y) / view.scale + view.center.y
	};
}

export function clampScale(scale: number): number {
	return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
}

/** Zooms by `factor` while keeping the world point under `anchor` fixed, like Figma */
export function zoomAt(view: TView, viewport: TViewport, anchor: TVec2, factor: number): TView {
	const scale = clampScale(view.scale * factor);
	const world = screenToWorld(view, viewport, anchor);
	return {
		scale,
		center: {
			x: world.x - (anchor.x - viewport.width / 2) / scale,
			y: world.y - (viewport.height / 2 - anchor.y) / scale
		}
	};
}

/** Moves the content by a screen delta, so dragging right moves the wall right */
export function panBy(view: TView, dx: number, dy: number): TView {
	return { scale: view.scale, center: { x: view.center.x - dx / view.scale, y: view.center.y + dy / view.scale } };
}

/** View that shows `bounds` with `padding` CSS pixels around it, never closer than `maxScale` */
export function fitBounds(bounds: TBounds, viewport: TViewport, padding: TPadding, maxScale = 4000): TView {
	const width = Math.max(1, viewport.width - padding.left - padding.right);
	const height = Math.max(1, viewport.height - padding.top - padding.bottom);
	const spanX = Math.max(1e-4, bounds.maxX - bounds.minX);
	const spanY = Math.max(1e-4, bounds.maxY - bounds.minY);
	const scale = clampScale(Math.min(width / spanX, height / spanY, maxScale));
	// Center the content in the padded area, which may be off the viewport center
	const offsetX = (padding.left - padding.right) / 2 / scale;
	const offsetY = (padding.bottom - padding.top) / 2 / scale;
	return {
		scale,
		center: { x: (bounds.minX + bounds.maxX) / 2 - offsetX, y: (bounds.minY + bounds.maxY) / 2 - offsetY }
	};
}

export interface TPadding {
	top: number;
	right: number;
	bottom: number;
	left: number;
}

export function boundsOf(points: Iterable<TVec2>): TBounds | null {
	let bounds: TBounds | null = null;
	for (const point of points) {
		if (bounds == null) bounds = { minX: point.x, minY: point.y, maxX: point.x, maxY: point.y };
		else {
			bounds.minX = Math.min(bounds.minX, point.x);
			bounds.minY = Math.min(bounds.minY, point.y);
			bounds.maxX = Math.max(bounds.maxX, point.x);
			bounds.maxY = Math.max(bounds.maxY, point.y);
		}
	}
	return bounds;
}

/** True when every corner of `bounds` is inside the viewport with `margin` CSS pixels to spare */
export function isBoundsVisible(view: TView, viewport: TViewport, bounds: TBounds, margin = 0): boolean {
	const topLeft = worldToScreen(view, viewport, { x: bounds.minX, y: bounds.maxY });
	const bottomRight = worldToScreen(view, viewport, { x: bounds.maxX, y: bounds.minY });
	return (
		topLeft.x >= margin &&
		topLeft.y >= margin &&
		bottomRight.x <= viewport.width - margin &&
		bottomRight.y <= viewport.height - margin
	);
}

// MARK: - Floating bars

/** A screen rectangle in CSS pixels */
export interface TScreenRect {
	x: number;
	y: number;
	width: number;
	height: number;
}

/**
 * Where a floating bar of `size`, centered on its `left`, goes near `anchor` without covering any of
 * `obstacles`: under the anchor, under the obstacles, beside them or above the anchor, whichever fits in the
 * viewport first. Falls back to the anchor, kept inside the viewport.
 */
export function placeBar(anchor: TVec2, size: { width: number; height: number }, obstacles: TScreenRect[], viewport: TViewport, gap = 10): { left: number; top: number } {
	const margin = 8;
	const clampLeft = (left: number): number => Math.min(Math.max(left, size.width / 2 + margin), viewport.width - size.width / 2 - margin);
	const clampTop = (top: number): number => Math.min(Math.max(top, 48), viewport.height - size.height - margin);
	const covers = (left: number, top: number): boolean =>
		obstacles.some((rect) => left - size.width / 2 < rect.x + rect.width && left + size.width / 2 > rect.x && top < rect.y + rect.height && top + size.height > rect.y);
	const fits = (left: number, top: number): boolean => top >= 0 && top + size.height <= viewport.height && left - size.width / 2 >= 0 && left + size.width / 2 <= viewport.width;
	const first = { left: clampLeft(anchor.x), top: clampTop(anchor.y) };
	if (!obstacles.length) return first;
	const minX = Math.min(...obstacles.map((rect) => rect.x));
	const maxX = Math.max(...obstacles.map((rect) => rect.x + rect.width));
	const maxY = Math.max(...obstacles.map((rect) => rect.y + rect.height));
	const candidates = [
		first,
		{ left: clampLeft(anchor.x), top: maxY + gap },
		{ left: maxX + gap + size.width / 2, top: clampTop(anchor.y) },
		{ left: minX - gap - size.width / 2, top: clampTop(anchor.y) },
		{ left: clampLeft(anchor.x), top: anchor.y - size.height - 3 * gap }
	];
	return candidates.find((item) => fits(item.left, item.top) && !covers(item.left, item.top)) ?? first;
}

const POPOVER_INSET = 8;

/** Where a floating panel sits: beside its control, level with it, inside the canvas with an inset; it scrolls when taller */
export function popoverFrame(anchor: Pick<DOMRect, 'top'>, bounds: Pick<DOMRect, 'left' | 'right' | 'top' | 'bottom'>, size: { width: number; height: number }, side: 'start' | 'end'): { left: number; top: number; maxHeight: number } {
	const maxHeight = Math.max(0, bounds.bottom - bounds.top - POPOVER_INSET * 2);
	const height = Math.min(size.height, maxHeight);
	const top = Math.max(bounds.top + POPOVER_INSET, Math.min(anchor.top - 12, bounds.bottom - height - POPOVER_INSET));
	const left = side === 'start' ? bounds.left + POPOVER_INSET : Math.max(bounds.left + POPOVER_INSET, bounds.right - size.width - POPOVER_INSET);
	return { left, top, maxHeight };
}
