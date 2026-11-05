import { describe, expect, it } from 'vitest';
import type { TVec2 } from '@/modules/project';
import { worldToScreen, type TView } from './view';
import {
	createViewMotion,
	deadZoneGoal,
	FOLLOW_RATE,
	FOLLOW_SETTINGS,
	followMarble,
	isSettled,
	keepInView,
	NAVIGATE_RATE,
	smoothLead,
	springStep,
	stepViewMotion
} from './view-follow';

const viewport = { width: 800, height: 600 };
const view: TView = { center: { x: 0, y: 0 }, scale: 1000 };

describe('springStep', () => {
	it('arrives without overshoot', () => {
		let value = 0;
		let velocity = 0;
		let largest = 0;
		for (let i = 0; i < 120; i++) {
			[value, velocity] = springStep(value, velocity, 1, NAVIGATE_RATE, 1 / 60);
			largest = Math.max(largest, value);
		}
		expect(largest).toBeLessThanOrEqual(1 + 1e-9);
		expect(value).toBeCloseTo(1, 4);
	});

	it('takes the same path at any frame rate', () => {
		const run = (steps: number): number => {
			let state: [number, number] = [0, 0];
			for (let i = 0; i < steps; i++) state = springStep(state[0], state[1], 1, FOLLOW_RATE, 0.5 / steps);
			return state[0];
		};
		expect(run(30)).toBeCloseTo(run(144), 9);
	});

	it('moves less than a tenth of the way in the first frame, so a goal change never jumps', () => {
		const [value] = springStep(0, 0, 1, NAVIGATE_RATE, 1 / 60);
		expect(value).toBeGreaterThan(0);
		expect(value).toBeLessThan(0.1);
	});
});

describe('deadZoneGoal', () => {
	it('keeps the goal while the point moves inside the dead zone', () => {
		const half = { x: 0.4, y: 0.3 };
		const inside: TVec2 = { x: half.x * 0.3, y: half.y * (FOLLOW_SETTINGS.anchor.y - 0.15) };
		expect(deadZoneGoal(view.center, view.scale, viewport, inside)).toEqual(view.center);
	});

	it('moves only by how far the point left the dead zone', () => {
		const half = 0.3;
		const zoneBottom = (FOLLOW_SETTINGS.anchor.y - FOLLOW_SETTINGS.deadZone.y) * half;
		const goal = deadZoneGoal(view.center, view.scale, viewport, { x: 0, y: zoneBottom - 0.01 });
		expect(goal.x).toBe(0);
		expect(goal.y).toBeCloseTo(-0.01, 9);
	});
});

describe('smoothLead', () => {
	it('eases toward the look-ahead and stays within its limit', () => {
		let lead = { x: 0, y: 0 };
		const first = smoothLead(lead, { x: 0, y: -10 }, view.scale, viewport, 1 / 60);
		expect(first.y).toBeLessThan(0);
		expect(first.y).toBeGreaterThan(-0.01);
		for (let i = 0; i < 600; i++) lead = smoothLead(lead, { x: 0, y: -10 }, view.scale, viewport, 1 / 60);
		expect(lead.y).toBeCloseTo(-0.3 * FOLLOW_SETTINGS.leadLimit, 4);
	});
});

describe('keepInView', () => {
	it('moves the center just enough to bring the point inside the edge', () => {
		const center = keepInView(view.center, view.scale, viewport, { x: 0, y: -1 });
		expect(worldToScreen({ center, scale: view.scale }, viewport, { x: 0, y: -1 }).y).toBeCloseTo(600 - 30, 6);
		expect(keepInView(view.center, view.scale, viewport, { x: 0.1, y: 0.1 })).toEqual(view.center);
	});
});

describe('Follow', () => {
	/** Marble falling at `speed` m/s with a sideways zigzag, followed for `seconds` at 60 fps */
	function simulate(speed: number, seconds: number, zigzag = 0.1): { views: TView[]; positions: TVec2[] } {
		const motion = createViewMotion(view);
		const views: TView[] = [];
		const positions: TVec2[] = [];
		const dt = 1 / 60;
		for (let i = 0; i < seconds * 60; i++) {
			const t = i * dt;
			const position = { x: zigzag * Math.sin(t * 4), y: -speed * t };
			const velocity = { x: zigzag * 4 * Math.cos(t * 4), y: -speed };
			followMarble(motion, position, velocity, viewport, dt);
			const stepped = stepViewMotion(motion, dt, FOLLOW_RATE);
			motion.center = keepInView(stepped.center, stepped.scale, viewport, position);
			views.push({ center: motion.center, scale: stepped.scale });
			positions.push(position);
		}
		return { views, positions };
	}

	it('never changes the zoom', () => {
		const { views } = simulate(0.8, 4);
		expect(views.every((item) => item.scale === view.scale)).toBe(true);
	});

	it('leaves the view still while the marble zigzags inside the dead zone', () => {
		const { views } = simulate(0, 3, 0.04);
		expect(views.every((item) => Math.abs(item.center.x) < 1e-9)).toBe(true);
	});

	it('keeps the marble in view without a jump larger than a few pixels per frame', () => {
		const { views, positions } = simulate(1.2, 6);
		let largest = 0;
		views.forEach((item, index) => {
			const screen = worldToScreen(item, viewport, positions[index] ?? { x: 0, y: 0 });
			expect(screen.y).toBeGreaterThanOrEqual(-1e-6);
			expect(screen.y).toBeLessThanOrEqual(600 + 1e-6);
			const previous = views[index - 1];
			if (previous != null) largest = Math.max(largest, Math.abs(item.center.y - previous.center.y) * item.scale);
		});
		// 1.2 m/s at 1000 px/m is 20 px per frame of travel; the view never moves much faster than the marble
		expect(largest).toBeLessThan(26);
	});

	it('settles once the marble stops', () => {
		const motion = createViewMotion(view);
		followMarble(motion, { x: 0, y: -0.5 }, { x: 0, y: 0 }, viewport, 1 / 60);
		for (let i = 0; i < 240; i++) stepViewMotion(motion, 1 / 60, FOLLOW_RATE);
		expect(isSettled(motion)).toBe(true);
	});
});

describe('navigation', () => {
	it('glides to the goal view, zoom included, and settles', () => {
		const motion = createViewMotion(view);
		motion.goal = { center: { x: 1, y: -2 }, scale: 500 };
		const first = stepViewMotion(motion, 1 / 60, NAVIGATE_RATE);
		expect(first.center.y).toBeGreaterThan(-0.2);
		for (let i = 0; i < 90; i++) stepViewMotion(motion, 1 / 60, NAVIGATE_RATE);
		expect(isSettled(motion)).toBe(true);
	});
});
