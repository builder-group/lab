/** Pointer capture keeps edits working outside their lane; every exit path restores the preview. */
export function pointerGesture(
	target: HTMLElement,
	pointerId: number,
	callbacks: TPointerGestureCallbacks
): () => void {
	let finished = false;
	function finish(cancelled: boolean) {
		if (finished) return;
		finished = true;
		target.removeEventListener('pointermove', move);
		target.removeEventListener('pointerup', end);
		target.removeEventListener('pointercancel', cancel);
		target.removeEventListener('lostpointercapture', cancel);
		document.removeEventListener('keydown', keydown, true);
		document.removeEventListener('contextmenu', contextmenu, true);
		if (target.hasPointerCapture(pointerId)) target.releasePointerCapture(pointerId);
		callbacks.end(cancelled);
	}
	function move(event: PointerEvent) {
		if (event.pointerId === pointerId) callbacks.move(event);
	}
	function end(event: PointerEvent) {
		if (event.pointerId === pointerId) finish(false);
	}
	function cancel() {
		finish(true);
	}
	function keydown(event: KeyboardEvent) {
		if (event.key !== 'Escape') return;
		event.preventDefault();
		event.stopPropagation();
		finish(true);
	}
	function contextmenu(event: MouseEvent) {
		event.preventDefault();
		event.stopPropagation();
		finish(true);
	}
	target.setPointerCapture(pointerId);
	target.addEventListener('pointermove', move);
	target.addEventListener('pointerup', end);
	target.addEventListener('pointercancel', cancel);
	target.addEventListener('lostpointercapture', cancel);
	document.addEventListener('keydown', keydown, true);
	document.addEventListener('contextmenu', contextmenu, true);
	return cancel;
}
interface TPointerGestureCallbacks {
	move(event: PointerEvent): void;
	end(cancelled: boolean): void;
}
