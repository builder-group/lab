import type { TVec2 } from '@/modules/project';
import { clampScale, type TView, type TViewport } from './view';

// Smooth view motion for the Wall view: Follow keeps the marble in sight like the film camera, and stepping to a
// time or a hit glides there instead of jumping. One critically damped spring moves the view's center (and, for
// navigation only, its zoom in log space) toward a goal view. Follow never touches the zoom, so it cannot pump.

export interface TFollowSettings {
	/** Seconds of the marble's velocity the view looks ahead */
	leadTime: number;
	/** Largest look-ahead per axis, as a share of the half view */
	leadLimit: number;
	/** Seconds for the smoothed look-ahead to cover half of a change, so a bounce does not swing the view */
	leadHalfLife: number;
	/** Half size of the box around `anchor` the followed point moves in freely, as a share of the half view */
	deadZone: TVec2;
	/** Where the followed point rests, from the view center, as a share of the half view with y up */
	anchor: TVec2;
	/** The marble never comes closer to the edge than this share of the half view */
	edge: number;
}

/** Look-ahead 0.3 s along the run, a dead zone of 70 % by 40 % of the view, the run kept 10 % inside the edge */
export const FOLLOW_SETTINGS: TFollowSettings = {
	leadTime: 0.3,
	leadLimit: 0.35,
	leadHalfLife: 0.35,
	deadZone: { x: 0.35, y: 0.2 },
	anchor: { x: 0, y: 0.05 },
	edge: 0.1
};

/** Spring rate of Follow: settles in about 0.6 s, close to the film camera's default smoothing */
export const FOLLOW_RATE = 6;
/** Spring rate of navigation such as stepping to a hit: settles in about 0.35 s */
export const NAVIGATE_RATE = 11;

export interface TViewMotion {
	center: TVec2;
	velocity: TVec2;
	/** Natural log of the zoom, which springs evenly at every zoom level */
	logScale: number;
	scaleVelocity: number;
	/** View the spring moves toward */
	goal: TView;
	/** Smoothed look-ahead in wall meters */
	lead: TVec2;
}

/** A motion at rest on `view` */
export function createViewMotion(view: TView): TViewMotion {
	return {
		center: { ...view.center },
		velocity: { x: 0, y: 0 },
		logScale: Math.log(view.scale),
		scaleVelocity: 0,
		goal: { center: { ...view.center }, scale: view.scale },
		lead: { x: 0, y: 0 }
	};
}

/**
 * One step of a critically damped spring toward `goal`, solved exactly so any frame time gives the same path: it
 * arrives without overshoot and keeps its velocity across goal changes, so a moving goal is followed smoothly
 */
export function springStep(value: number, velocity: number, goal: number, rate: number, dt: number): [value: number, velocity: number] {
	const offset = value - goal;
	const decay = Math.exp(-rate * dt);
	const temp = (velocity + rate * offset) * dt;
	return [goal + (offset + temp) * decay, (velocity - rate * temp) * decay];
}

function halfSize(scale: number, viewport: TViewport): TVec2 {
	return { x: viewport.width / 2 / scale, y: viewport.height / 2 / scale };
}

function clamp(value: number, limit: number): number {
	return Math.max(-limit, Math.min(limit, value));
}

/** Eases the look-ahead toward `velocity` × `leadTime`, limited to `leadLimit` of the half view per axis */
export function smoothLead(lead: TVec2, velocity: TVec2, scale: number, viewport: TViewport, dt: number, settings = FOLLOW_SETTINGS): TVec2 {
	const half = halfSize(scale, viewport);
	const target = { x: clamp(velocity.x * settings.leadTime, half.x * settings.leadLimit), y: clamp(velocity.y * settings.leadTime, half.y * settings.leadLimit) };
	const blend = 1 - Math.pow(2, -dt / Math.max(1e-3, settings.leadHalfLife));
	return { x: lead.x + (target.x - lead.x) * blend, y: lead.y + (target.y - lead.y) * blend };
}

/**
 * Goal center that keeps `point` inside the dead zone around the anchor: unchanged while it is inside, moved only by
 * how far it left otherwise, so the view drifts with the run instead of paging
 */
export function deadZoneGoal(goal: TVec2, scale: number, viewport: TViewport, point: TVec2, settings = FOLLOW_SETTINGS): TVec2 {
	const half = halfSize(scale, viewport);
	const axis = (center: number, value: number, anchor: number, zone: number): number => {
		const offset = value - (center + anchor);
		if (offset > zone) return center + offset - zone;
		if (offset < -zone) return center + offset + zone;
		return center;
	};
	return {
		x: axis(goal.x, point.x, settings.anchor.x * half.x, settings.deadZone.x * half.x),
		y: axis(goal.y, point.y, settings.anchor.y * half.y, settings.deadZone.y * half.y)
	};
}

/** Center moved just enough that `point` lies `edge` of the half view inside the view */
export function keepInView(center: TVec2, scale: number, viewport: TViewport, point: TVec2, edge = FOLLOW_SETTINGS.edge): TVec2 {
	const half = halfSize(scale, viewport);
	const reach = { x: half.x * (1 - edge), y: half.y * (1 - edge) };
	return {
		x: Math.min(point.x + reach.x, Math.max(point.x - reach.x, center.x)),
		y: Math.min(point.y + reach.y, Math.max(point.y - reach.y, center.y))
	};
}

/** Follow for one frame: eases the look-ahead and moves the goal center with the marble's look-ahead point */
export function followMarble(motion: TViewMotion, position: TVec2, velocity: TVec2, viewport: TViewport, dt: number, settings = FOLLOW_SETTINGS): void {
	const scale = motion.goal.scale;
	motion.lead = smoothLead(motion.lead, velocity, scale, viewport, dt, settings);
	const point = { x: position.x + motion.lead.x, y: position.y + motion.lead.y };
	motion.goal = { scale: motion.goal.scale, center: deadZoneGoal(motion.goal.center, scale, viewport, point, settings) };
}

/** Advances the spring by `dt` seconds and returns the view to show */
export function stepViewMotion(motion: TViewMotion, dt: number, rate: number): TView {
	const [x, vx] = springStep(motion.center.x, motion.velocity.x, motion.goal.center.x, rate, dt);
	const [y, vy] = springStep(motion.center.y, motion.velocity.y, motion.goal.center.y, rate, dt);
	motion.center = { x, y };
	motion.velocity = { x: vx, y: vy };
	const goalLog = Math.log(motion.goal.scale);
	// A view at its goal zoom keeps that exact zoom, so following never rounds it
	if (motion.logScale === goalLog && motion.scaleVelocity === 0) return { center: { x, y }, scale: motion.goal.scale };
	const [logScale, scaleVelocity] = springStep(motion.logScale, motion.scaleVelocity, goalLog, rate, dt);
	motion.logScale = logScale;
	motion.scaleVelocity = scaleVelocity;
	return { center: { x, y }, scale: clampScale(Math.exp(logScale)) };
}

/** The spring is within a quarter pixel of its goal and nearly still, so it can stop and snap to the goal */
export function isSettled(motion: TViewMotion): boolean {
	const scale = Math.exp(motion.logScale);
	const pixel = 0.25 / scale;
	const distance = Math.hypot(motion.center.x - motion.goal.center.x, motion.center.y - motion.goal.center.y);
	const speed = Math.hypot(motion.velocity.x, motion.velocity.y);
	return distance < pixel && speed < pixel * 4 && Math.abs(motion.logScale - Math.log(motion.goal.scale)) < 1e-3 && Math.abs(motion.scaleVelocity) < 4e-3;
}
