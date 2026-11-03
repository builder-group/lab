export const HEADER_WIDTH = 232;
export const RULER_HEIGHT = 24;
export const ROW_HEIGHT = 44;
export const SONG_ROW_HEIGHT = 40;
// Transport bar above the ruler
export const TRANSPORT_HEIGHT = 40;
// Camera track of the Film workspace, the last track
export const CAMERA_ROW_HEIGHT = 32;
// One semitone of an expanded track
export const NOTE_ROW_HEIGHT = 12;
// Keyboard strip at the right of an expanded track header
export const KEYBOARD_WIDTH = 40;
export const MIN_ZOOM = 20;
export const MAX_ZOOM = 800;
export const MIN_HEIGHT = 120;

/** Height that shows every track with a little room, like a video editor sizing its timeline to the tracks */
export function fittedHeight(rowsHeight: number): number {
	const content = TRANSPORT_HEIGHT + RULER_HEIGHT + Math.max(rowsHeight, ROW_HEIGHT) + 20;
	return Math.round(Math.min(Math.max(content, 150), window.innerHeight * 0.45));
}

export function clampZoom(zoom: number): number {
	return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
}

/** Zoom slider position from 0 to 1 on a logarithmic scale, so each step feels the same, like Final Cut */
export function zoomToSlider(zoom: number): number {
	return Math.log(clampZoom(zoom) / MIN_ZOOM) / Math.log(MAX_ZOOM / MIN_ZOOM);
}

export function sliderToZoom(position: number): number {
	return MIN_ZOOM * (MAX_ZOOM / MIN_ZOOM) ** Math.min(1, Math.max(0, position));
}

/** Label spacing of at least 56 px, with minor ticks between labels */
export function rulerSteps(zoom: number): { step: number; minor: number } {
	const steps: [number, number][] = [
		[0.1, 2],
		[0.25, 5],
		[0.5, 5],
		[1, 4],
		[2, 4],
		[5, 5],
		[10, 5],
		[15, 3],
		[30, 3],
		[60, 4]
	];
	const [step, divisions] = steps.find(([candidate]) => candidate * zoom >= 56) ?? [60, 4];
	return { step, minor: step / divisions };
}

export function formatRulerTime(seconds: number, step: number): string {
	const minutes = Math.floor(seconds / 60);
	const rest = seconds - minutes * 60;
	const decimals = step < 0.5 ? 2 : step < 1 ? 1 : 0;
	const text = rest.toFixed(decimals);
	return `${minutes}:${text.padStart(decimals > 0 ? decimals + 3 : 2, '0')}`;
}

export function round(value: number): number {
	return Math.round(value * 10000) / 10000;
}
