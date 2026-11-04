import { createState } from 'feature-state';
import { sampleCameraTrack } from '@/modules/camera';
import type { TProject, TProjectCommand, TVec2 } from '@/modules/project';
import type { StudioCx } from '@/modules/studio/StudioCx';
import { toDecorKey, toMadeInBlenderKey } from '@/modules/studio/selection';
import { $blenderObjects, addDecorCommands, assetDecorSource, builtInSource, moveDecorClear, type TDecorSource } from './decor';
import { decorItem, themeDecorSet } from './decor-catalog';
import { DEFAULT_SCATTER_DENSITY, scatterDecorCommands } from './decor-scatter';
import { previewPointToWall } from './design-commands';
import { filmCamera, imageToWall } from './film-camera';
import { baseThemeOf } from './project-themes';

// Decor's edits that need the studio: what the Add menu, Insert, ⌘K and the viewer's drops share.

/** A new decoration at a point of the frame in 0..1 image coordinates at the playhead, selected, as one edit */
export function placeDecor(cx: StudioCx, source: TDecorSource, u = 0.5, v = 0.5): boolean {
	const project = cx.project;
	if (project == null) return false;
	const point = previewPointToWall(project, cx.simulation.$result.get(), cx.$playhead.get(), u, v);
	const { commands, decorId } = addDecorCommands(project, source, point);
	if (!cx.execute(commands)) return false;
	cx.$workspace.set('design');
	cx.$selection.set([toDecorKey(decorId)]);
	return true;
}

/** A library item as a decoration: a built-in one by its id, a project's item by its asset path; null for anything else */
export function libraryDecorSource(cx: StudioCx, asset: { id: string; scope: string }): TDecorSource | null {
	const item = [...cx.library.$projectItems.get(), ...cx.library.$globalItems.get()].find((candidate) => candidate.id === asset.id && candidate.scope === asset.scope);
	if (item?.manifest?.role !== 'decoration') return null;
	return assetDecorSource(item.id, item.manifest.label, item.manifest.fittedParams);
}

/** Move Clear for a decoration, or a notice when no spot near it is free */
export function moveDecorClearAction(cx: StudioCx, decorId: string): void {
	const project = cx.project;
	const result = cx.simulation.$result.get();
	if (project == null || result == null) return;
	const fix = moveDecorClear(project, result, decorId);
	if (fix == null) {
		cx.notify('No free spot within 40 cm. Move it by hand, or give it In and Out');
		return;
	}
	cx.execute(fix.commands);
}

/** Selects an object in the Blender window, opening it first */
export function revealMadeInBlender(cx: StudioCx, name: string): void {
	cx.$selection.set([toMadeInBlenderKey(name)]);
	void cx.design.openInBlender([name]);
}

// MARK: - Scatter Decor

/** Scatter Decor's small panel over the viewer: its settings while it is open, null when closed */
export interface TScatterPanel {
	sources: string[];
	density: number;
	seed: number;
	/** How many items the latest scatter placed */
	count: number;
	/** The undo step the panel's scatters fold into */
	group: number | null;
}

export const $scatterPanel = createState<TScatterPanel | null>(null);

/** What Scatter Decor starts with: the theme's Decor set, its own or its base's. With an empty one you pick the items in the panel */
export function defaultScatterSources(project: TProject): string[] {
	const { design } = project;
	const own = design.themes?.find((theme) => theme.id === design.theme)?.decorSet;
	return [...(own ?? themeDecorSet(baseThemeOf(design)))];
}

/** Opens the panel and scatters with its first settings */
export function openScatterPanel(cx: StudioCx, sources?: string[]): void {
	const project = cx.project;
	if (project == null) return;
	cx.$workspace.set('design');
	const panel: TScatterPanel = { sources: sources ?? defaultScatterSources(project), density: DEFAULT_SCATTER_DENSITY, seed: 1, count: 0, group: null };
	$scatterPanel.set(panel);
	if (panel.sources.length > 0) runScatter(cx, panel);
}

/** Scatters with the panel's settings; everything the panel does until it closes is one undo step */
export function runScatter(cx: StudioCx, panel: TScatterPanel): void {
	const items = panel.sources.flatMap((source) => {
		const resolved = resolveDecorSource(cx, source);
		return resolved != null ? [resolved] : [];
	});
	const count = scatter(cx, items, panel.density, panel.seed, panel.group);
	if (count == null) return;
	$scatterPanel.set({ ...panel, count, group: panel.group ?? cx.editGroup });
}

/** Replaces what Scatter Decor placed; the number of items placed, null when the run or its camera isn't there */
export function scatter(cx: StudioCx, items: readonly TDecorSource[], density: number, seed: number, group: number | null = null): number | null {
	const project = cx.project;
	const result = cx.simulation.$result.get();
	const track = project != null && result != null ? filmCamera(project, result).track : null;
	if (project == null || result == null || track == null) {
		cx.notify('The run is still updating. Try Scatter Decor again in a moment');
		return null;
	}
	const { commands, count } = scatterDecorCommands(project, result, track, { items, density, seed, blenderObjects: $blenderObjects.get() });
	if (group != null && cx.editGroup === group) cx.execute(commands, { group });
	else cx.execute(commands);
	return count;
}

function resolveDecorSource(cx: StudioCx, source: string): TDecorSource | null {
	if (decorItem(source) != null) return builtInSource(source);
	const id = /^assets\/(.+)\/asset\.blend$/.exec(source)?.[1];
	const item = cx.library.$projectItems.get().find((candidate) => candidate.id === id);
	return id != null && item != null ? assetDecorSource(id, item.manifest?.label ?? id, item.manifest?.fittedParams) : null;
}

// MARK: - Moving on the wall

/**
 * Drags a selected decoration on the viewer: a press on it starts the move, each step lands through the film camera at
 * the playhead and the whole drag is one undo step. Returns whether the press started a drag, and the click that ends
 * it is the caller's to swallow.
 */
export function startDecorDrag(cx: StudioCx, event: React.PointerEvent<HTMLElement>, decorAt: (point: TVec2) => string | null, onEnd: (wasDragged: boolean) => void): boolean {
	const project = cx.project;
	const result = cx.simulation.$result.get();
	if (project == null || result == null) return false;
	const track = filmCamera(project, result).track;
	if (track == null) return false;
	const pose = sampleCameraTrack(track, cx.$playhead.get());
	const aspect = project.frame.width / project.frame.height;
	const element = event.currentTarget;
	const rect = element.getBoundingClientRect();
	const toWall = (clientX: number, clientY: number): TVec2 | null => imageToWall(pose, aspect, (clientX - rect.left) / rect.width, (clientY - rect.top) / rect.height);
	const start = toWall(event.clientX, event.clientY);
	if (start == null) return false;
	const key = decorAt(start);
	if (key == null || !cx.$selection.get().includes(key)) return false;
	const decorId = key.slice('decor:'.length);
	const origin = project.design.decor?.find((item) => item.id === decorId)?.position;
	if (origin == null) return false;
	const [startX, startY] = [event.clientX, event.clientY];
	const pointerId = event.pointerId;
	let group: number | null = null;
	let wasDragged = false;
	element.setPointerCapture(pointerId);

	function onMove(move: PointerEvent): void {
		if (!wasDragged && Math.hypot(move.clientX - startX, move.clientY - startY) < 3) return;
		const point = toWall(move.clientX, move.clientY);
		const current = cx.project;
		if (point == null || start == null || current == null || origin == null) return;
		wasDragged = true;
		const position = { x: Math.round((origin.x + point.x - start.x) * 10000) / 10000, y: Math.round((origin.y + point.y - start.y) * 10000) / 10000 };
		const commands = updateDecorPosition(current, decorId, position);
		if (group != null && cx.editGroup === group) cx.execute(commands, { group });
		else if (cx.execute(commands)) group = cx.editGroup;
	}

	function onUp(): void {
		element.removeEventListener('pointermove', onMove);
		element.removeEventListener('pointerup', onUp);
		element.removeEventListener('pointercancel', onUp);
		onEnd(wasDragged);
	}

	element.addEventListener('pointermove', onMove);
	element.addEventListener('pointerup', onUp);
	element.addEventListener('pointercancel', onUp);
	return true;
}

function updateDecorPosition(project: TProject, decorId: string, position: TVec2): TProjectCommand[] {
	const list = project.design.decor ?? [];
	return [
		{
			type: 'setDesign',
			design: {
				decor: list.map((item) => {
					if (item.id !== decorId) return item;
					const { scattered: _scattered, ...own } = item;
					return { ...own, position };
				})
			}
		}
	];
}
