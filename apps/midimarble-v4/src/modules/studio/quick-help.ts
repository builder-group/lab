import type { TWorkspace } from './StudioCx';

/**
 * Regions Quick Help labels in place, like GarageBand's Quick Help. An element marks its region with
 * `data-quick-help`; the label sits in the wall's gutter on the side of the region (`gutter`), so it points at the
 * region without covering any of its controls. The wall's own label sits at its centre. Controls explain themselves
 * with their own tooltips; these lines only name the regions.
 */
export const quickHelpRegions: TQuickHelpRegion[] = [
	{ id: 'workspace', title: 'Compose and Film', line: 'Compose: the track, hitboxes and timing. Film: skins, camera and titles', gutter: 'left' },
	{ id: 'layers', title: 'Layers', line: 'The Scene and everything in it: the song, marbles and track pieces, in Film also the wall, lights, camera and titles', gutter: 'left' },
	{ id: 'tools', title: 'Tools', line: 'Move and the tools, then Insert, the one place to add something: the track in Compose, titles and Decor in Film', gutter: 'left' },
	{ id: 'wall', title: 'Wall', line: 'Marbles fall here and play their notes on the track', gutter: 'center', workspace: 'compose' },
	{ id: 'wall', title: 'Preview', line: 'The film as Blender renders it at the playhead', gutter: 'center', workspace: 'design' },
	{ id: 'export', title: 'Export Film…', line: 'Makes the movie file once the track plays well', gutter: 'right' },
	{ id: 'agent', title: 'Agent', line: 'Ask for a theme, a skin or a change in plain words', gutter: 'right' },
	{ id: 'blender', title: 'Blender', line: 'Renders the film; its logo shows the state and its menu opens the scene in Blender', gutter: 'right' },
	{ id: 'inspector', title: 'Inspector', line: 'Settings of the selection: its skin, or the Scene with its theme', gutter: 'right' },
	{ id: 'timelineLayers', title: 'Timeline', line: 'The same layers along the time: the song and each marble, in Film also camera and titles', gutter: 'bottom' },
	{ id: 'song', title: 'Song', line: "The only sound; each marble plays some of its notes. Expand it to mute, solo or change a marble's Part", gutter: 'bottom' },
	{ id: 'hitSummary', title: 'Hit Summary', line: 'Says when every hit is on time; click it to find a problem', gutter: 'bottom' },
	{ id: 'transport', title: 'Transport', line: 'Play, step from hit to hit and see the time', gutter: 'bottom' }
];

export interface TQuickHelpRegion {
	id: string;
	title: string;
	line: string;
	/** The wall's edge the label sits against: beside the sidebar, the inspector and title bar, or above the timeline */
	gutter: 'left' | 'right' | 'bottom' | 'center';
	// Regions whose meaning changes with the workspace
	workspace?: TWorkspace;
}

export interface TRect {
	left: number;
	top: number;
	right: number;
	bottom: number;
}

/** Where a label's top left corner goes, in window coordinates */
export interface TLabelPlace {
	left: number;
	top: number;
}

/** Room the wall's floating view controls take at its top */
const WALL_TOP_INSET = 48;

/** Room a label takes in the layout; labels are at most this wide and two lines of text high */
export const QUICK_HELP_LABEL = { width: 220, height: 52, gap: 8 };

/**
 * Lays out the region labels in the wall's gutters, so none covers a control of its region, another label or
 * `reserved` (the Quick Help panel): the wall's own label at its centre, the sidebar's and tool rail's down its left
 * edge, the title bar's and inspector's down its right edge from their region's height, and the timeline's along its
 * bottom edge from their region's left edge. A label whose spot is taken moves down (up for the bottom edge) to the
 * next free one, so a narrow wall stacks them in one column. Without a wall the window takes its place.
 */
export function placeQuickHelpLabels(
	items: { region: TQuickHelpRegion; rect: TRect }[],
	wall: TRect | null,
	viewport: { width: number; height: number },
	reserved?: TRect
): Map<string, TLabelPlace> {
	const { width, height, gap } = QUICK_HELP_LABEL;
	const area = wall ?? { left: 0, top: 0, right: viewport.width, bottom: viewport.height };
	const minLeft = area.left + gap;
	const maxLeft = Math.max(minLeft, area.right - gap - width);
	// The wall's floating view controls sit along its top edge
	const minTop = area.top + (wall == null ? gap : WALL_TOP_INSET);
	const maxTop = Math.max(minTop, area.bottom - gap - height);
	const taken: TRect[] = reserved == null ? [] : [reserved];
	const places = new Map<string, TLabelPlace>();
	const isFree = (left: number, top: number): boolean => taken.every((box) => left + width + gap <= box.left || box.right + gap <= left || top + height + gap <= box.top || box.bottom + gap <= top);

	function place(id: string, left: number, top: number, direction: 1 | -1): void {
		const x = Math.min(Math.max(left, minLeft), maxLeft);
		let y = Math.min(Math.max(top, minTop), maxTop);
		// Searches along the edge first, then back the other way, and keeps the wanted spot if the wall is full
		const start = y;
		while (!isFree(x, y) && y >= minTop && y <= maxTop) y += direction * 4;
		if (y < minTop || y > maxTop) {
			y = start;
			while (!isFree(x, y) && y >= minTop && y <= maxTop) y -= direction * 4;
			if (y < minTop || y > maxTop) y = start;
		}
		taken.push({ left: x, top: y, right: x + width, bottom: y + height });
		places.set(id, { left: x, top: y });
	}

	const centre = (rect: TRect): number => (rect.top + rect.bottom) / 2 - height / 2;
	const byGutter = (gutter: TQuickHelpRegion['gutter']): { region: TQuickHelpRegion; rect: TRect }[] => items.filter((item) => item.region.gutter === gutter);
	for (const { region } of byGutter('center')) place(region.id, (area.left + area.right) / 2 - width / 2, (area.top + area.bottom) / 2 - height / 2, 1);
	for (const { region, rect } of byGutter('left').sort((a, b) => centre(a.rect) - centre(b.rect))) place(region.id, minLeft, centre(rect), 1);
	for (const { region, rect } of byGutter('right').sort((a, b) => centre(a.rect) - centre(b.rect))) place(region.id, maxLeft, centre(rect), 1);
	for (const { region, rect } of byGutter('bottom').sort((a, b) => a.rect.left - b.rect.left)) place(region.id, rect.left, maxTop, -1);
	return places;
}

export function regionsFor(workspace: TWorkspace): TQuickHelpRegion[] {
	return quickHelpRegions.filter((region) => region.workspace == null || region.workspace === workspace);
}

/** What the Quick Help panel says about the control under the pointer */
export interface TControlHelp {
	title: string;
	detail?: string;
	shortcut?: string;
}

/**
 * The help of the control under the pointer, read from the tooltip it already has: a Figma-style tooltip
 * (`.mm-tooltip`) or a question-mark bubble (`.mm-help-bubble`) inside it, its `title`, or the `aria-label` of a
 * button. Elsewhere in a region the region's line explains where the pointer is.
 */
export function controlHelp(target: Element | null, workspace: TWorkspace): TControlHelp | null {
	for (let node = target; node != null && node.tagName !== 'BODY'; node = node.parentElement) {
		const bubble = [...node.children].find((child) => child.classList.contains('mm-tooltip') || child.classList.contains('mm-help-bubble'));
		if (bubble != null) {
			const help = fromTooltip(bubble);
			if (help != null) return help;
		}
		const region = node.getAttribute('data-quick-help');
		const described = region == null ? undefined : regionsFor(workspace).find((item) => item.id === region);
		const isControl = node.tagName === 'BUTTON' || node.getAttribute('role') === 'button' || node.getAttribute('role') === 'tab';
		// A region's line names it better than a plain element's title, such as a track header titled with its file name
		if (described != null && !isControl) return { title: described.title, detail: described.line };
		const title = node.getAttribute('title');
		if (title != null && title.trim()) return splitShortcut(title.trim());
		const label = node.getAttribute('aria-label');
		if (isControl && label != null && label.trim()) return { title: label.trim() };
		if (described != null) return { title: described.title, detail: described.line };
	}
	return null;
}

/** "Play the song (Space)" as the text and its shortcut, like a menu item's key equivalent */
export function splitShortcut(text: string): TControlHelp {
	const match = /^(.*\S)\s+\(([^()]+)\)$/.exec(text);
	if (match?.[1] == null || match[2] == null || !isShortcut(match[2])) return { title: text };
	return { title: match[1], shortcut: match[2] };
}

function isShortcut(text: string): boolean {
	return text.length <= 12 && (/[⌘⇧⌥⌃⇥⎋↩←→⌫]/.test(text) || /^(Space|Esc|Return|Tab|[A-Z0-9])$/.test(text));
}

function fromTooltip(tooltip: Element): TControlHelp | null {
	const texts: string[] = [];
	let shortcut: string | undefined;
	for (const child of tooltip.childNodes) {
		const text = child.textContent?.trim() ?? '';
		if (!text) continue;
		if (child.nodeName === 'KBD') shortcut = text;
		else texts.push(text);
	}
	const [title, ...detail] = texts;
	if (title == null) return null;
	return { title, detail: detail.length > 0 ? detail.join(' · ') : undefined, shortcut };
}
