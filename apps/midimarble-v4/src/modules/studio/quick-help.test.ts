import { describe, expect, it } from 'vitest';
import { placeQuickHelpLabels, QUICK_HELP_LABEL, quickHelpRegions, regionsFor, splitShortcut, type TRect } from './quick-help';

describe('splitShortcut function', () => {
	it('should take the shortcut out of a tooltip like a menu key equivalent', () => {
		expect(splitShortcut('Show Agent (⌘J)')).toEqual({ title: 'Show Agent', shortcut: '⌘J' });
		expect(splitShortcut('Play the song (Space)')).toEqual({ title: 'Play the song', shortcut: 'Space' });
	});

	it('should keep words in parentheses that are not a shortcut', () => {
		expect(splitShortcut('Melody (lead)')).toEqual({ title: 'Melody (lead)' });
	});
});

describe('regionsFor function', () => {
	it('should name the wall in Compose and the preview in Film', () => {
		expect(regionsFor('compose').find((region) => region.id === 'wall')?.title).toBe('Wall');
		expect(regionsFor('design').find((region) => region.id === 'wall')?.title).toBe('Preview');
	});

	it('should give every region one line without a period', () => {
		for (const region of quickHelpRegions) expect(region.line.endsWith('.')).toBe(false);
	});
});

describe('placeQuickHelpLabels function', () => {
	// A 1440 × 900 window: sidebar to 240, tool rail to 288, inspector from 1180, title bar to 40, timeline from 640
	const viewport = { width: 1440, height: 900 };
	const wall: TRect = { left: 288, top: 40, right: 1180, bottom: 640 };
	const rects: Record<string, TRect> = {
		workspace: { left: 8, top: 48, right: 232, bottom: 72 },
		layers: { left: 0, top: 80, right: 240, bottom: 400 },
		tools: { left: 240, top: 40, right: 288, bottom: 640 },
		wall,
		inspector: { left: 1180, top: 40, right: 1440, bottom: 640 },
		blender: { left: 1000, top: 8, right: 1080, bottom: 32 },
		agent: { left: 1090, top: 8, right: 1120, bottom: 32 },
		export: { left: 1300, top: 8, right: 1420, bottom: 32 },
		timelineLayers: { left: 0, top: 680, right: 200, bottom: 900 },
		song: { left: 0, top: 680, right: 1440, bottom: 720 },
		hitSummary: { left: 210, top: 644, right: 400, bottom: 672 },
		transport: { left: 640, top: 644, right: 800, bottom: 672 }
	};
	const items = regionsFor('compose').map((region) => ({ region, rect: rects[region.id] as TRect }));
	const panel: TRect = { left: 908, top: 532, right: 1168, bottom: 628 };
	const places = placeQuickHelpLabels(items, wall, viewport, panel);

	function box(id: string): TRect {
		const place = places.get(id);
		if (place == null) throw new Error(`No place for ${id}`);
		return { left: place.left, top: place.top, right: place.left + QUICK_HELP_LABEL.width, bottom: place.top + QUICK_HELP_LABEL.height };
	}
	const overlaps = (a: TRect, b: TRect): boolean => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;

	it('should keep every label inside the wall, off the sidebar, inspector, title bar and timeline', () => {
		for (const { region } of items) {
			const label = box(region.id);
			expect(label.left).toBeGreaterThanOrEqual(wall.left);
			expect(label.right).toBeLessThanOrEqual(wall.right);
			expect(label.top).toBeGreaterThanOrEqual(wall.top);
			expect(label.bottom).toBeLessThanOrEqual(wall.bottom);
		}
	});

	it('should stack labels in one column on a narrow wall without overlaps', () => {
		const narrow: TRect = { left: 288, top: 40, right: 560, bottom: 1000 };
		const tight = placeQuickHelpLabels(items, narrow, viewport, { left: 288, top: 890, right: 548, bottom: 988 });
		const boxes = [...tight.values()].map((place) => ({ left: place.left, top: place.top, right: place.left + QUICK_HELP_LABEL.width, bottom: place.top + QUICK_HELP_LABEL.height }));
		for (const [index, a] of boxes.entries()) for (const b of boxes.slice(index + 1)) expect(overlaps(a, b)).toBe(false);
	});

	it('should not stack labels on each other or on the Quick Help panel', () => {
		const ids = items.map((item) => item.region.id);
		for (const [index, id] of ids.entries()) {
			expect(overlaps(box(id), panel)).toBe(false);
			for (const other of ids.slice(index + 1)) expect(overlaps(box(id), box(other))).toBe(false);
		}
	});
});
