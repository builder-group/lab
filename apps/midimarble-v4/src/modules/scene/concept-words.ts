// The one-line meaning of each concept, shown where people meet it and held to `docs/words.md`. Track belongs to the Track workspace;
// Skin, Theme, Decor and Pack to Film.

export const TRACK_HELP = 'Track: what the marbles run on, made of track pieces; each has a hitbox.';
export const SKIN_HELP = 'Skin: how one thing looks.';
export const THEME_HELP = 'Theme: a preset of skins and lights for the whole film; you can still change any part.';
export const DECOR_HELP = 'Decor: extras you add to the scene; marbles pass through them.';

/** Adding a Pack's notice: "Christmas Pack added: 1 theme, 4 skins, 8 decor items. Nothing in your project changed." */
export function packAddedNotice(name: string, counts: { themes: number; skins: number; decor: number }): string {
	const count = (value: number, one: string, many: string): string => `${value} ${value === 1 ? one : many}`;
	const contents = [
		...(counts.themes > 0 ? [count(counts.themes, 'theme', 'themes')] : []),
		...(counts.skins > 0 ? [count(counts.skins, 'skin', 'skins')] : []),
		...(counts.decor > 0 ? [count(counts.decor, 'decor item', 'decor items')] : [])
	];
	const label = /\bpack$/i.test(name) ? name : `${name} Pack`;
	return `${label} added${contents.length > 0 ? `: ${contents.join(', ')}` : ''}. Nothing in your project changed.`;
}
