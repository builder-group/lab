import type { TVec2 } from '@/modules/project';

// 2D wall view math. World units are metres with y up; screen units are CSS pixels with y down.

/** Camera looking at the wall. `scale` is CSS pixels per metre. */
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
	// Centre the content in the padded area, which may be off the viewport centre
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

// MARK: - Dot grid

/** Hole spacing of the pegboard at real scale, 2.5 cm */
export const PEG_PITCH = 0.025;
// The coarse layer stays between these spacings; the fine layer at half the spacing fades in as it grows
const MIN_SPACING = 18;

export interface TGridLayers {
	/** Spacing of the always visible layer in CSS pixels */
	size: number;
	/** Background position of a tile whose dot sits at its centre */
	offset: TVec2;
	/** Spacing of the fading layer, half of `size` */
	fineSize: number;
	fineOffset: TVec2;
	/** Opacity of the fine layer from 0 to 1 */
	fineAlpha: number;
	/** World spacing of the coarse layer in metres */
	pitch: number;
}

/**
 * Dot grid layers for the CSS pegboard. Spacing doubles in powers of two of the peg pitch, so dots
 * keep their world positions while zooming and the fine layer fades in or out between densities.
 */
export function gridLayers(view: TView, viewport: TViewport): TGridLayers {
	const level = Math.ceil(Math.log2(MIN_SPACING / (PEG_PITCH * view.scale)) - 1e-9);
	const pitch = PEG_PITCH * 2 ** level;
	const size = pitch * view.scale;
	const fineSize = size / 2;
	const fineAlpha = Math.min(1, Math.max(0, (fineSize - MIN_SPACING / 2) / (MIN_SPACING / 2)));
	const origin = worldToScreen(view, viewport, { x: 0, y: 0 });
	return {
		size,
		offset: { x: mod(origin.x - size / 2, size), y: mod(origin.y - size / 2, size) },
		fineSize,
		fineOffset: { x: mod(origin.x - fineSize / 2, fineSize), y: mod(origin.y - fineSize / 2, fineSize) },
		fineAlpha,
		pitch
	};
}

function mod(value: number, size: number): number {
	return ((value % size) + size) % size;
}
