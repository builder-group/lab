import React from 'react';
import type { ComposeCx } from '@/modules/compose/ComposeCx';
import type { TInsertItem } from '@/modules/compose/library';

/**
 * Press on a library tile: a release in place arms its tool, a drag past a few pixels takes it out of the
 * popover and drops it where the pointer is released over the wall
 */
export function useInsertDrag(compose: ComposeCx): { state: TInsertGhostState | null; start: (item: TInsertItem, event: React.PointerEvent) => void } {
	const [state, setState] = React.useState<TInsertGhostState | null>(null);
	const cleanupRef = React.useRef<(() => void) | null>(null);

	// Escape or a tool change ends the drag in ComposeCx, so the ghost follows its state
	React.useEffect(
		() =>
			compose.$inserting.listen(({ value }) => {
				if (value != null) return;
				cleanupRef.current?.();
				setState(null);
			}),
		[compose]
	);
	React.useEffect(() => () => cleanupRef.current?.(), []);

	function start(item: TInsertItem, event: React.PointerEvent): void {
		if (event.button !== 0) return;
		event.preventDefault();
		const origin = { x: event.clientX, y: event.clientY };
		let isDragging = false;

		function onMove(move: PointerEvent): void {
			const position = { x: move.clientX, y: move.clientY };
			if (!isDragging) {
				if (Math.hypot(position.x - origin.x, position.y - origin.y) < 4) return;
				isDragging = true;
				compose.beginInsertDrag(item);
			}
			const isOnCanvas = compose.moveInsertDrag(position, move.altKey);
			setState({ item, position, isOnCanvas });
		}
		function onUp(): void {
			remove();
			if (isDragging) compose.endInsertDrag(true);
			else compose.armInsert(item);
			setState(null);
		}
		function remove(): void {
			window.removeEventListener('pointermove', onMove);
			window.removeEventListener('pointerup', onUp);
			window.removeEventListener('pointercancel', onCancel);
			cleanupRef.current = null;
		}
		function onCancel(): void {
			remove();
			if (isDragging) compose.endInsertDrag(false);
			setState(null);
		}
		cleanupRef.current?.();
		window.addEventListener('pointermove', onMove);
		window.addEventListener('pointerup', onUp);
		window.addEventListener('pointercancel', onCancel);
		cleanupRef.current = remove;
	}

	return { state, start };
}

export interface TInsertGhostState {
	item: TInsertItem;
	position: { x: number; y: number };
	/** The canvas shows the piece itself, so the ghost tile hides */
	isOnCanvas: boolean;
}
