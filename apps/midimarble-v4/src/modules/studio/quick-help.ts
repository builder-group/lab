import type { TWorkspace } from './StudioCx';

/**
 * Regions Quick Help labels in place, like GarageBand's Quick Help. An element marks its region with
 * `data-quick-help`; the label sits beside it as `placement` says, moved by `dx` and `dy` where neighbours would
 * overlap. Controls explain themselves with their own tooltips; these lines only name the regions.
 */
export const quickHelpRegions: TQuickHelpRegion[] = [
	{ id: 'workspace', title: 'Compose and Film', line: 'Build the run in Compose, then choose the look and export in Film', placement: 'right' },
	{ id: 'layers', title: 'Layers', line: 'Everything in the project: the song, marbles, pieces and camera', placement: 'below', align: 'start' },
	{ id: 'library', title: 'Library', line: 'Pieces to place, and themes and skins for the film', placement: 'below', align: 'start', dy: 72 },
	{ id: 'tools', title: 'Tools', line: 'Move and Hand, then the pieces you can place', placement: 'right', dy: 120 },
	{ id: 'wall', title: 'Wall', line: 'Marbles fall here and play their notes on the pieces', placement: 'center', workspace: 'compose' },
	{ id: 'wall', title: 'Preview', line: 'The film as Blender renders it at the playhead', placement: 'center', workspace: 'design' },
	{ id: 'inspector', title: 'Inspector', line: 'Settings of the selection, or the Project when nothing is selected', placement: 'center' },
	{ id: 'hitSummary', title: 'Hit Summary', line: 'Says when every hit is on time; click it to find a problem', placement: 'above', align: 'start' },
	{ id: 'transport', title: 'Transport', line: 'Play, step from hit to hit and see the time', placement: 'above' },
	{ id: 'tracks', title: 'Tracks', line: 'The song and one track per marble, along the time', placement: 'right' },
	{ id: 'song', title: 'Song', line: 'The music; each marble plays some of its notes', placement: 'right', dx: 236 },
	{ id: 'blender', title: 'Blender', line: 'Renders the film; its menu opens the scene in Blender', placement: 'below', align: 'end', dy: 116 },
	{ id: 'agent', title: 'Agent', line: 'Ask for a theme, a skin or a change in plain words', placement: 'below', align: 'end', dy: 58 },
	{ id: 'export', title: 'Export Film…', line: 'Makes the movie file once the run plays well', placement: 'below', align: 'end' }
];

export interface TQuickHelpRegion {
	id: string;
	title: string;
	line: string;
	placement: 'below' | 'above' | 'right' | 'center';
	align?: 'start' | 'end';
	dx?: number;
	dy?: number;
	// Regions whose meaning changes with the workspace
	workspace?: TWorkspace;
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
