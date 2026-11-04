import { describe, expect, it } from 'vitest';
import { verticalFov } from '@/modules/camera';
import { draftPieceColors, draftWall, noteColor, screenTitleLayout, titleOpacity, TITLE_FADE } from './draft-look';
import { imageToWall } from './film-camera';

describe('draft look', () => {
	it('should use the Blender note wheel by pitch class, C red and G teal', () => {
		expect(noteColor(60)).toBe('#db1f1f');
		expect(noteColor(67)).toBe(noteColor(55));
		expect(noteColor(67)).toBe('#1f9e9e');
	});

	it('should dress pieces per theme, skin and Colour by Note', () => {
		const platform = { type: 'platform', color: '#3478f6', skin: null, notePitch: 60 };
		// A lighter tint of the marble's colour, so the marble reads over its own platforms
		expect(draftPieceColors('pegboard', platform, false).bar).toBe('#85aefa');
		expect(draftPieceColors('pegboard', platform, true).bar).toBe(noteColor(60));
		expect(draftPieceColors('brass', platform, false).bar).toBe(draftPieceColors('brass', { ...platform, skin: { assetId: 'brass:gold', link: 'linked' } }, false).bar);
		expect(draftPieceColors('brass', { ...platform, skin: { assetId: 'brass:copper', link: 'linked' } }, false).bar).not.toBe(draftPieceColors('brass', platform, false).bar);
		expect(draftPieceColors('brass', { ...platform, skin: { assetId: 'brass:knob', link: 'linked' } }, true).nub).toBe(noteColor(60));
		expect(draftPieceColors('brass', { type: 'rail', color: '#3478f6', skin: null }, true).bar).not.toBe('#3478f6');
	});

	it('should give Pegboard peg holes and Brass a plain wall', () => {
		expect(draftWall('pegboard').holes).not.toBeNull();
		expect(draftWall('brass').holes).toBeNull();
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
	it('should find the wall point under the frame centre and edge of a camera facing the wall', () => {
		// Prepare: one metre in front of the wall, looking into it with z up
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
