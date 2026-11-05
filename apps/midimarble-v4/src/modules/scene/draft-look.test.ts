import { describe, expect, it } from 'vitest';
import { resolveSkinLook } from './skin-catalog';
import { verticalFov } from '@/modules/camera';
import { contrastRatio, draftGlows, draftMarble, draftPieceColors, draftSkinMarks, draftWall, MARBLE_CONTRAST, marbleContrast, noteColor, previewScreenTitleLayout, screenTitleLayout, titleOpacity, TITLE_FADE } from './draft-look';
import { marbleColors } from '@/modules/project';
import { imageToWall } from '@/modules/film/image-to-wall';

describe('draft look', () => {
	it('should use the Blender note wheel by pitch class, C red and G teal', () => {
		expect(noteColor(60)).toBe('#db1f1f');
		expect(noteColor(67)).toBe(noteColor(55));
		expect(noteColor(67)).toBe('#1f9e9e');
	});

	it('should keep a default marble in its hue on a warm wall, not near-black, with the numbers the film has', () => {
		// `check_marble_look.py` holds the same numbers
		expect(draftMarble('brass', '#3478f6').body).toBe('#103782');
		expect(draftMarble('brass', '#ff1a2e', { wallColor: '#ffefc8' }).body).toBe('#a9111f');
		expect(draftMarble('pegboard', '#34c759').body).toBe('#0c6222');
		for (const color of ['#3478f6', '#ff1a2e', '#22ff66']) expect(marbleContrast('brass', color, { wallColor: '#ffefc8' })).toBeGreaterThanOrEqual(MARBLE_CONTRAST);
	});

	it('should draw a Plain wall with no holes on any theme', () => {
		expect(draftWall('pegboard', {}, 'plain').holes).toBeNull();
	});

	it('should approximate marble skins', () => {
		const look = (assetId: string, fields = {}) => resolveSkinLook('pegboard', null, 'marble', { assetId, ...fields });
		expect(draftMarble('pegboard', '#3478f6', {}, look('marble:glass')).finish?.kind).toBe('glass');
		expect(draftMarble('pegboard', '#3478f6', {}, look('marble:metal')).finish?.kind).toBe('metal');
		const magic = draftMarble('pegboard', '#3478f6', {}, look('marble:magic', { glowColor: '#00ff88' }));
		expect(magic.finish).toMatchObject({ kind: 'magic', second: '#00ff88' });
		expect(draftMarble('neon', '#3478f6', {}, look('marble:deep')).tone).toBe('deep');
		expect(draftMarble('pegboard', '#3478f6', {}, look('marble:pearl')).tone).toBe('pearl');
		// The theme's default still chooses by contrast
		expect(draftMarble('pegboard', '#3478f6', {}, resolveSkinLook('pegboard', null, 'marble')).tone).toBe(draftMarble('pegboard', '#3478f6').tone);
	});

	it('should dress a piece by its skin and Color, whatever the theme', () => {
		const platform = { type: 'platform', color: '#3478f6', notePitch: 60 };
		expect(draftPieceColors('brass', { ...platform, skin: { colorSource: 'note' } }).bar).toBe(noteColor(60));
		expect(draftPieceColors('brass', { ...platform, skin: { colorSource: 'marble' } }).bar).toBe('#3478f6');
		expect(draftPieceColors('neon', { ...platform, skin: { glowColor: '#00ff88' } }).bar).toBe('#00ff88');
		expect(draftPieceColors('brass', { type: 'rail', color: '#3478f6', skin: { assetId: 'rail:glow' } })).toEqual(draftPieceColors('neon', { type: 'rail', color: '#3478f6', skin: null }));
		expect(draftPieceColors('neon', { ...platform, skin: null }, {}, { platform: { skin: 'platform:copper' } }).bar).toBe(draftPieceColors('brass', { ...platform, skin: { assetId: 'platform:copper' } }).bar);
		expect(draftSkinMarks('neon', { type: 'platform', skin: { assetId: 'platform:device', variant: 'copper' } })[0]?.color).toBe(draftSkinMarks('neon', { type: 'platform', skin: { assetId: 'platform:device-copper' } })[0]?.color);
	});

	it('should dress pieces per theme, skin and Color by Note', () => {
		const platform = { type: 'platform', color: '#3478f6', skin: null, notePitch: 60 };
		// A lighter tint of the marble's color, so the marble reads over its own platforms
		expect(draftPieceColors('pegboard', platform).bar).toBe('#85aefa');
		expect(draftPieceColors('pegboard', platform, {}, { platform: { colorSource: 'note' } }).bar).toBe(noteColor(60));
		expect(draftPieceColors('brass', platform).bar).toBe(draftPieceColors('brass', { ...platform, skin: { assetId: 'platform:gold' } }).bar);
		expect(draftPieceColors('brass', { ...platform, skin: { assetId: 'platform:copper' } }).bar).not.toBe(draftPieceColors('brass', platform).bar);
		// A chosen skin keeps its color under Color by Note; Brass's Gold spelled out is still its default
		expect(draftPieceColors('brass', { ...platform, skin: { assetId: 'platform:copper' } }, {}, { platform: { colorSource: 'note' } }).bar).toBe(draftPieceColors('brass', { ...platform, skin: { assetId: 'platform:copper' } }).bar);
		expect(draftPieceColors('brass', { ...platform, skin: { assetId: 'platform:gold' } }, {}, { platform: { colorSource: 'note' } }).bar).toBe(noteColor(60));
		expect(draftPieceColors('pegboard', { ...platform, skin: { assetId: 'platform:gold' } }, {}, { platform: { colorSource: 'note' } }).bar).toBe(draftPieceColors('brass', platform).bar);
		expect(draftPieceColors('brass', { type: 'rail', color: '#3478f6', skin: null }, {}, { platform: { colorSource: 'note' } }).bar).not.toBe('#3478f6');
	});

	it('should dress Neon pieces in their saturated hue, with the note color under Color by Note', () => {
		const platform = { type: 'platform', color: '#3478f6', skin: null, notePitch: 60 };
		expect(draftPieceColors('neon', platform).bar).toBe('#1f6dff');
		expect(draftPieceColors('neon', platform, {}, { platform: { colorSource: 'note' } }).bar).toBe('#ff1f1f');
		// A gray marble's pieces turn a cool blue-white instead of a random hue
		expect(draftPieceColors('neon', { ...platform, color: '#808080' }).bar).toBe('#d1e6ff');
		expect(draftPieceColors('neon', { type: 'rail', color: '#3478f6', skin: null }).bar).toBe('#1f6dff');
	});

	it('should draw Neon marbles pearl white with a rim in their hue, apart from their own glowing platforms', () => {
		for (const color of ['#3478f6', '#f08a24', '#d94f4f', '#808080']) {
			const marble = draftMarble('neon', color);
			const platform = draftPieceColors('neon', { type: 'platform', color, skin: null });
			const windmill = draftPieceColors('neon', { type: 'windmill', color, skin: null });
			expect(marble.rim).toBe(platform.bar);
			// A bright glow can be as light as white, so the marble stands apart from it by color: near-white against a strong hue
			expect(saturation(marble.body)).toBeLessThan(0.25);
			expect(saturation(platform.bar)).toBeGreaterThan(color === '#808080' ? 0.15 : 0.8);
			expect(luminance(marble.body)).toBeGreaterThan(luminance(platform.bar));
			// And it is at least 3:1 lighter than the dark mounts, bodies and wall around it
			expect(contrast(marble.body, platform.nub)).toBeGreaterThanOrEqual(3);
			expect(contrast(marble.body, windmill.bar)).toBeGreaterThanOrEqual(3);
			expect(contrast(marble.body, draftWall('neon').color)).toBeGreaterThanOrEqual(3);
		}
		expect(draftGlows('neon')).toBe(true);
		expect(draftGlows('pegboard')).toBe(false);
	});

	it('should keep every marble 3:1 apart from its wall and its own pieces in every theme', () => {
		for (const theme of ['pegboard', 'brass', 'neon']) {
			for (const color of [...marbleColors, '#808080']) {
				const marble = draftMarble(theme, color);
				const platform = draftPieceColors(theme, { type: 'platform', color, skin: null });
				expect(contrastRatio(marble.body, draftWall(theme).color)).toBeGreaterThanOrEqual(MARBLE_CONTRAST);
				// Pegboard marbles sit on the bar; Neon's on its deep body inside the glowing edge; Brass's read by color on dark gold
				if (theme === 'pegboard') expect(contrastRatio(marble.body, platform.bar)).toBeGreaterThanOrEqual(MARBLE_CONTRAST);
				// The film paints Pegboard's platform in the marble color itself, not the Draft Preview's tint of it
				if (theme === 'pegboard') expect(contrastRatio(marble.body, color)).toBeGreaterThanOrEqual(MARBLE_CONTRAST);
				expect(marbleContrast(theme, color)).toBeGreaterThanOrEqual(MARBLE_CONTRAST);
			}
		}
		// Light walls get deep marbles in the marble's hue, the dark Neon wall pearl ones with a rim
		expect(draftMarble('pegboard', '#3478f6').tone).toBe('deep');
		expect(draftMarble('brass', '#ff9f0a').tone).toBe('pearl');
		expect(draftMarble('neon', '#ff9f0a').tone).toBe('pearl');
		expect(draftMarble('brass', '#3478f6').rim).toBeNull();
	});

	it("should turn a marble pearl on a dark project wall", () => {
		// The review's copy of Pegboard with a blue wall: the blue marble went pearl-or-deep, whichever reads more
		expect(draftMarble('pegboard', '#3478f6', { wallColor: '#1a1a1a' }).tone).toBe('pearl');
	});

	it('should draw each Brass skin with its own shape cue in the Draft Preview', () => {
		const skin = (id: string) => ({ type: 'platform', skin: { assetId: `platform:${id}` } });
		const colors = (id: string) => draftSkinMarks('pegboard', skin(id)).map((mark) => mark.color);
		// Plain bars get chrome end caps, Device its trim-colored ends and a grille, Key its white key, Knob its red lens
		expect(draftSkinMarks('brass', { type: 'platform', skin: null })).toHaveLength(2);
		expect(colors('copper')).toEqual(colors('gold'));
		expect(draftPieceColors('pegboard', { ...skin('copper'), color: '#3478f6' }).bar).not.toBe(draftPieceColors('pegboard', { ...skin('gold'), color: '#3478f6' }).bar);
		expect(colors('device-copper')[0]).not.toBe(colors('device')[0]);
		expect(draftSkinMarks('neon', skin('device'))).toHaveLength(9);
		expect(colors('key')).toEqual(['#dcdee0']);
		expect(colors('knob')).toEqual(['#e0261c']);
		// The lens sits at the low end of the bar
		const left = draftSkinMarks('brass', { ...skin('knob'), angle: 0.3 })[0];
		const right = draftSkinMarks('brass', { ...skin('knob'), angle: -0.3 })[0];
		expect(left?.x1).toBeLessThan(0);
		expect(right?.x0).toBeGreaterThan(0);
		// Pegboard and Neon pieces without a Brass skin draw no marks, and only platforms carry them
		expect(draftSkinMarks('pegboard', { type: 'platform', skin: null })).toEqual([]);
		expect(draftSkinMarks('brass', { type: 'rail', skin: null })).toEqual([]);
	});

	it('should give Pegboard peg holes, Brass a plain wall and Neon a dark navy one', () => {
		expect(draftWall('pegboard').holes).not.toBeNull();
		expect(draftWall('brass').holes).toBeNull();
		expect(draftWall('neon')).toEqual({ color: '#141a2a', holes: null });
		expect(draftWall('unknown')).toEqual(draftWall('pegboard'));
	});
});

describe('titleOpacity function', () => {
	it('should show a title without timing for the whole film', () => {
		expect(titleOpacity(0, {})).toBe(1);
		expect(titleOpacity(30, {})).toBe(1);
	});

	it('should fade in after In and out before Out, hidden outside the range', () => {
		const range = { in: 2, out: 6 };
		expect(titleOpacity(1.9, range)).toBe(0);
		expect(titleOpacity(2 + TITLE_FADE / 2, range)).toBeCloseTo(0.5);
		expect(titleOpacity(4, range)).toBe(1);
		expect(titleOpacity(6 - TITLE_FADE / 2, range)).toBeCloseTo(0.5);
		expect(titleOpacity(6, range)).toBe(0);
	});
});

describe('imageToWall function', () => {
	it('should find the wall point under the frame center and edge of a camera facing the wall', () => {
		// Prepare: one meter in front of the wall, looking into it with z up
		const half = Math.SQRT1_2;
		const pose = { position: [0.2, -1, 0.5] as [number, number, number], rotation: [half, half, 0, 0] as [number, number, number, number], focus: 1, lens: 50 };
		const aspect = 9 / 16;

		// Act
		const center = imageToWall(pose, aspect, 0.5, 0.5);
		const top = imageToWall(pose, aspect, 0.5, 0);

		// Assert
		expect(center?.x).toBeCloseTo(0.2);
		expect(center?.y).toBeCloseTo(0.5);
		expect((top?.y ?? 0) - 0.5).toBeCloseTo(Math.tan((verticalFov(50, aspect) * Math.PI) / 360));
	});
});

describe('screenTitleLayout function', () => {
	it('should place and size screen titles like the film encoder, scaled to the preview', () => {
		const film = screenTitleLayout('caption', 0.06, { width: 1080, height: 1920 }, 1920);
		expect(film.center.x).toBe(540);
		expect(film.center.y).toBeCloseTo(288);
		expect(film.fontSize).toBeCloseTo(161.28);
		expect(film.padding).toBeCloseTo(53.76);
		expect(film.shadow).toBeCloseTo(6.72);
		const preview = screenTitleLayout('caption', 0.06, { width: 270, height: 480 }, 1920);
		expect(preview.fontSize).toBeCloseTo(film.fontSize / 4);
		expect(preview.padding).toBeCloseTo(film.padding / 4);
		expect(screenTitleLayout('endCard', 0.08, { width: 270, height: 480 }, 1920).center.y).toBe(240);
		expect(screenTitleLayout('songName', 0.07, { width: 270, height: 480 }, 1920).center.y).toBeCloseTo(168);
	});
});

describe('previewScreenTitleLayout function', () => {
	it('should draw a 4.7 % Song Name under 6 % of the preview frame for a 9 by 16 project', () => {
		// The project frame is an aspect, not pixels: a 4.7 % title must not grow to the encoder's 8 px minimum of a 16 px film
		const frame = { width: 318, height: 566 };
		for (const preset of ['draft', 'final'] as const) {
			const layout = previewScreenTitleLayout(
				'songName',
				0.047,
				frame,
				{ width: 9, height: 16 },
				preset
			);
			const capHeight = layout.fontSize / 1.4;
			expect(capHeight / frame.height).toBeCloseTo(0.047, 3);
			expect(capHeight / frame.height).toBeLessThan(0.06);
			expect(layout.padding).toBeLessThan(frame.height * 0.05);
		}
	});
});

/** WCAG contrast ratio of two display colors */
function contrast(a: string, b: string): number {
	const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
	return (high + 0.05) / (low + 0.05);
}

function luminance(color: string): number {
	const value = Number.parseInt(color.slice(1, 7), 16);
	const [r, g, b] = [(value >> 16) & 255, (value >> 8) & 255, value & 255].map((channel) => {
		const c = channel / 255;
		return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
	}) as [number, number, number];
	return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

describe('Gift and Green Glass in the Draft Preview', () => {
	const piece = { type: 'platform', color: '#3478f6', skin: { assetId: 'platform:gift' } };

	it('should draw Gift in its paper with a ribbon cross, in any theme', () => {
		expect(draftPieceColors('neon', piece).bar).toBe('#a01522');
		expect(draftSkinMarks('neon', piece)).toHaveLength(2);
		expect(draftPieceColors('brass', { type: 'platform', color: '#3478f6', skin: null }, {}, { platform: { skin: 'platform:gift' } }).bar).toBe('#a01522');
	});

	it('should take Color: Marble and By Note like every skin', () => {
		const look = { ...piece, skin: { ...piece.skin, colorSource: 'marble' as const } };
		expect(draftPieceColors('brass', look).bar).toBe('#3478f6');
		expect(draftPieceColors('brass', { ...piece, skin: { ...piece.skin, colorSource: 'note' as const }, notePitch: 60 }).bar).toBe(noteColor(60));
	});

	it('should draw a Green Glass marble with green vanes', () => {
		const marble = draftMarble('brass', '#3478f6', {}, resolveSkinLook('brass', { marble: { skin: 'marble:glass-green' } }, 'marble'));
		expect(marble.finish?.kind).toBe('glass');
		expect(saturation(marble.finish?.color ?? '#000000')).toBeGreaterThan(0.8);
	});
});

function saturation(color: string): number {
	const value = Number.parseInt(color.slice(1, 7), 16);
	const channels = [(value >> 16) & 255, (value >> 8) & 255, value & 255];
	const max = Math.max(...channels);
	return max === 0 ? 0 : (max - Math.min(...channels)) / max;
}
