import type { TMotionFile, TSceneCamera, TSceneDescription } from '@/modules/scene';

/**
 * TypeScript port of the follow camera in `blender/mm_worker/camera.py`, which stays the source of the film. Given
 * the scene description the app sends to `apply_scene` and its motion files, `bakeFollowCamera` computes the pose
 * the worker bakes for every film frame: same constants, same smoothing, same group and focus logic. Track's
 * Camera view samples the result per animation frame.
 *
 * Coordinates are Blender's: x along the wall, y into the wall (the camera stands at y < 0),
 * z up. Wall coordinates (x, y) map to Blender (x, z); the distance from the wall is -y.
 *
 * Keep in step with `camera.py`. The `camera:check` script compares this port against the keyframes Blender bakes.
 */

// Constants mirror camera.py; see the comments there
const ROLL_FOLLOW = 0.5;
const ROLL_LIMIT = radians(40);
const ROLL_DRIFT = radians(16);
const ROLL_PERIOD = 14.0;
/** The Turn of a project that sets none: `SIDE_ANGLE` in `camera.py` */
export const SIDE_ANGLE = radians(95);
const SIDE_FOLLOW = 0.3;
const HEADING_TAU = 1.5;
const LEAD_LIMIT = 0.0235;
/**
 * While the follow point falls faster than FALL_START meters per second, the frame looks FALL_AHEAD seconds of the
 * extra speed below it, at most FALL_LIMIT of the camera distance, eased over FALL_EASE seconds; the speed is taken
 * over FALL_WINDOW seconds either side, and the lead lasts FALL_HOLD seconds past the fall
 */
const FALL_START = 0.3;
const FALL_AHEAD = 0.25;
const FALL_LIMIT = 0.088;
const FALL_EASE = 0.6;
const FALL_WINDOW = 0.1;
const FALL_HOLD = 0.5;
const FRAME_KEEP = 0.55;
const ASPECT_GUESS = 0.56;
const SHOT_EASE = 0.8;
const LENS = 85;
const GROUP_KEEP_X = 0.85;
const GROUP_KEEP_Y = 0.85;
/** Margin on the distance a framed group needs */
const GROUP_MARGIN = 1.2;
/** Seconds over which the camera settles once it holds on the last hit, and the stretch of run before that hit */
const HOLD_EASE = 1.0;
const HOLD_SPAN = 1.0;
/** With Bowls, the held follow point sits this share of the way from the last hit to the Bowls' mouths */
const BOWL_FRAME = 0.5;
/** Time constant in seconds of the group distance, so the zoom changes slowly */
const DISTANCE_TAU = 1.8;
/** Seconds ahead over which a marble's upcoming hits count toward leading the frame */
const LEAD_AHEAD = 2.0;
/** Extra score of the focus marble, so the melody leads on a tie */
const FOCUS_BIAS = 0.5;
/** A marble leads at least this many seconds before another takes over */
const LEAD_HOLD = 1.5;
/** Seconds over which the frame pans from one leading marble to the next */
const LEAD_EASE = 2.5;
/** A shot at this fraction of the rig distance or closer frames only the leading marble */
const PUSH_FOCUS = 0.7;
/** Weight in the group center of a marble past its `activeUntil`, `FINISHED_WEIGHT` in `camera.py` */
const FINISHED_WEIGHT = 0.001;
/** The opening frames the release points and up to this many of the first struck pieces */
const OPENING_PIECES = 3;
/** Seconds after the first hit over which the opening frame eases into the follow */
const OPENING_EASE = 1.5;
/** Seconds after the first hit over which the opening's zoom eases back: slower than its frame, as the zoom never pumps */
const OPENING_ZOOM_EASE = 6.0;
/** Steps that center the opening box in the image */
const OPENING_STEPS = 3;
/** The opening stands at most this many times the rig distance away, and no further than a marble still spans this share of the frame width; a box that needs more isn't framed */
const OPENING_ZOOM = 1.7;
const OPENING_MARBLE_SHARE = 0.045;
/** The opening's own margin: tighter than GROUP_MARGIN, as its box holds still pieces rather than marbles that swing out */
const OPENING_MARGIN = 1.1;
export const CAMERA_SENSOR = 36.0;
const GROUP_EASE = 1.2;
const GROUP_SPIKE = 0.3;
/** Gap between a marble and the wall, `MARBLE_WALL_GAP` in `mm_worker/util.py` */
const MARBLE_WALL_GAP = 0.0005;
export const CAMERA_CLIP_START = 0.01;
export const CAMERA_CLIP_END = 100.0;

/**
 * Bakes the follow camera for frames 0 to `ceil(duration * fps)` like `camera.bake`, or returns null when the
 * description has no rig camera or no marble moves (Blender then frames the run with a static front camera).
 */
export function bakeFollowCamera(input: TFollowCameraInput): TCameraTrack | null {
	if (input.camera == null || input.camera.mode === 'manual') return null;
	const fps = input.fps;
	const settings = settingsFrom(input.camera, input.opening ?? null);
	const marbles = input.marbles;
	const frameEnd = Math.max(1, Math.ceil(input.duration * fps - 1e-6));
	const count = frameEnd + 1;
	const times = new Float64Array(count);
	for (let index = 0; index < count; index++) times[index] = index / fps;
	const aspect = renderAspect(input.frame);
	// The group's size in frame depends on where the camera looks from and at: a first pass with the camera straight
	// and sized around the group's center gives the run direction and the smoothed target that size the second
	const straight = groupFraming(
		marbles,
		times,
		settings,
		fps,
		new Float64Array(count),
		null
	);
	if (straight == null) return null;
	const firstPass = followTarget(straight, settings, fps, times);
	const framing = groupFraming(marbles, times, settings, fps, firstPass.heading, [
		firstPass.targetX,
		firstPass.targetY
	]);
	if (framing == null) return null;
	const { depth, distance } = framing;
	const [currentX, currentY] = framing.current;
	const { targetX, targetY, heading: smoothHeading } = followTarget(framing, settings, fps, times);
	// The camera stands below and to the side of the target, looking up along the run; the side follows the run
	// direction so the view keeps looking along it, and the image rolls slowly on its own and with the run
	const { side, roll } = viewTurn(times, smoothHeading, settings.hold, settings.side, settings.sway);

	const pitch = settings.pitch;
	const position = new Float64Array(count * 3);
	const rotation = new Float64Array(count * 4);
	const focus = new Float64Array(count);
	for (let index = 0; index < count; index++) {
		const foot: TVec3 = [Math.sin(side[index] ?? 0), 0.0, -Math.cos(side[index] ?? 0)];
		const up: TVec3 = [-Math.sin(roll[index] ?? 0), 0.0, Math.cos(roll[index] ?? 0)];
		const aim: TVec3 = [targetX[index] ?? 0, -depth, targetY[index] ?? 0];
		const along = Math.sin(pitch);
		const out = Math.cos(pitch);
		const reachOut = distance[index] ?? 0;
		const location: TVec3 = [
			aim[0] + (foot[0] * along + 0 * out) * reachOut,
			aim[1] + (foot[1] * along + -1.0 * out) * reachOut,
			aim[2] + (foot[2] * along + 0 * out) * reachOut
		];
		position.set(location, index * 3);
		rotation.set(lookRotation(location, aim, up), index * 4);
		focus[index] = Math.hypot(
			(currentX[index] ?? 0) - location[0],
			-depth - location[1],
			(currentY[index] ?? 0) - location[2]
		);
	}
	const track: TCameraTrack = {
		fps,
		frameCount: count,
		position,
		rotation,
		focus,
		target: interleave(targetX, targetY),
		roll,
		distance,
		depth,
		lens: settings.lens,
		aspect
	};
	return track;
}

/** Camera pose at `time` in seconds, interpolated between baked frames and held outside them */
export function sampleCameraTrack(
	track: TCameraTrack,
	time: number,
	out: TCameraPose = createCameraPose()
): TCameraPose {
	const frame = clamp(time * track.fps, 0, track.frameCount - 1);
	const index = Math.min(Math.floor(frame), Math.max(0, track.frameCount - 2));
	const next = Math.min(index + 1, track.frameCount - 1);
	const t = frame - index;
	for (let axis = 0; axis < 3; axis++) {
		out.position[axis] = lerp(
			track.position[index * 3 + axis] ?? 0,
			track.position[next * 3 + axis] ?? 0,
			t
		);
	}
	// Shortest-path normalized lerp; Blender interpolates the Euler keys linearly, which agrees closely at 1/fps steps
	const sign = dot4(track.rotation, index * 4, track.rotation, next * 4) < 0 ? -1 : 1;
	let length = 0;
	for (let axis = 0; axis < 4; axis++) {
		const value = lerp(
			track.rotation[index * 4 + axis] ?? 0,
			sign * (track.rotation[next * 4 + axis] ?? 0),
			t
		);
		out.rotation[axis] = value;
		length += value * value;
	}
	length = Math.sqrt(length) || 1;
	for (let axis = 0; axis < 4; axis++) out.rotation[axis] = (out.rotation[axis] ?? 0) / length;
	out.focus = lerp(track.focus[index] ?? 0, track.focus[next] ?? 0, t);
	out.lens = track.lens;
	return out;
}

export function createCameraPose(): TCameraPose {
	return { position: [0, 0, 0], rotation: [1, 0, 0, 0], focus: 1, lens: LENS };
}

/**
 * Vertical field of view in degrees for a frame of `aspect` (width / height). With Blender's `AUTO` sensor fit the
 * 36 mm sensor spans the longer image side.
 */
export function verticalFov(lens: number, aspect: number): number {
	const halfLong = CAMERA_SENSOR / 2 / lens;
	const halfVertical = aspect >= 1 ? halfLong / aspect : halfLong;
	return (2 * Math.atan(halfVertical) * 180) / Math.PI;
}

/** Input for `bakeFollowCamera` from a scene description and its motion files, the way `apply_scene` reads them */
export function followCameraInput(
	description: TSceneDescription,
	motionFiles: TMotionFile[]
): TFollowCameraInput {
	const files = new Map(motionFiles.map((file) => [file.path, file.bytes]));
	return {
		fps: description.fps,
		duration: description.duration,
		frame: description.frame,
		camera: description.camera ?? null,
		opening: openingPieces(description.pieces),
		marbles: description.marbles.map((marble) => ({
			id: marble.id,
			radius: marble.radius,
			...(marble.pathDepth != null ? { pathDepth: marble.pathDepth } : {}),
			activeUntil: marble.activeUntil,
			hitTimes: marble.hitTimes,
			motion: decodeMotion(files.get(marble.motionPath))
		}))
	};
}

export interface TFollowCameraInput {
	fps: number;
	/** Seconds; the last frame is `ceil(duration * fps)` */
	duration: number;
	frame: { width: number; height: number };
	camera: TSceneCamera | null;
	/** First struck pieces, `openingPieces`; the opening frames them with the release points */
	opening?: TOpeningPiece[] | null;
	marbles: TFollowMarble[];
}

/** A piece's first hit time and its position on the wall */
export interface TOpeningPiece {
	time: number;
	x: number;
	y: number;
}

export interface TFollowMarble {
	id: string;
	radius: number;
	/** How far out from the wall its path runs; absent: right at the wall */
	pathDepth?: number;
	/** `activeUntil` of the scene marble: the camera stops framing it then */
	activeUntil?: number;
	/** Times of the marble's notes, sorted; the marble with more notes ahead leads the frame */
	hitTimes?: number[];
	motion: TMotion;
}

/** Marble samples in wall meters, as the worker reads them from the Float32 motion file */
export interface TMotion {
	time: Float64Array;
	x: Float64Array;
	y: Float64Array;
}

export interface TCameraTrack {
	fps: number;
	/** Frames 0 to frameCount - 1 at `fps` */
	frameCount: number;
	/** Blender world location per frame, xyz */
	position: Float64Array;
	/** Blender world rotation per frame as a quaternion, wxyz; the camera looks along its local -z with y up */
	rotation: Float64Array;
	/** Distance to the followed point per frame, the depth-of-field focus */
	focus: Float64Array;
	/** Look target on the wall per frame, xy in wall meters */
	target: Float64Array;
	/** Image roll per frame in radians */
	roll: Float64Array;
	/** Camera distance from the target per frame */
	distance: Float64Array;
	/** Distance of the marble plane from the wall */
	depth: number;
	/** Focal length in mm on the 36 mm sensor */
	lens: number;
	/** Film frame width over height */
	aspect: number;
}

export interface TCameraPose {
	position: TVec3;
	/** wxyz */
	rotation: [number, number, number, number];
	focus: number;
	lens: number;
}

type TVec3 = [number, number, number];

interface TSettings {
	distance: number;
	pitch: number;
	lead: number;
	smoothing: number;
	side: number;
	sway: number;
	lens: number;
	shots: { time: number; distance: number; length: number | null }[];
	focus: string | null;
	/** Time of the run's last hit, after which the camera holds on it; null follows to the end */
	hold: number | null;
	/** Mean mouth of the Bowls the held ending frames, or null */
	bowl: [number, number] | null;
	descent: { time: Float64Array; y: Float64Array } | null;
	opening: TOpeningPiece[] | null;
}

interface TFraming {
	current: [Float64Array, Float64Array];
	ahead: [Float64Array, Float64Array];
	depth: number;
	distance: Float64Array;
	/** How much of the fall lead applies per frame: none while a group is framed */
	fallScale: Float64Array;
	/** Weight of the opening frame per frame, null without one */
	openingWeight: Float64Array | null;
}

function settingsFrom(
	camera: TSceneCamera,
	opening: TOpeningPiece[] | null
): TSettings {
	const number = (value: unknown, fallback: number, low: number, high: number): number =>
		typeof value !== 'number' || !Number.isFinite(value)
			? fallback
			: Math.min(high, Math.max(low, value));
	const shots = camera.shots
		.map((shot) => ({
			time: shot.time,
			distance: Math.max(0.05, shot.distance ?? camera.distance ?? 0.6),
			length:
				typeof shot.length === 'number' && Number.isFinite(shot.length) && shot.length > 0
					? shot.length
					: null
		}))
		.sort((a, b) => a.time - b.time);
	const descent = (camera.descent ?? [])
		.filter((point) => Number.isFinite(point.time) && Number.isFinite(point.y))
		.map((point) => [point.time, point.y] as const)
		.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
	return {
		distance: number(camera.distance, 0.6, 0.05, 20.0),
		pitch: number(camera.pitch, 0.7, 0.0, 1.45),
		lead: number(camera.lead, 0.15, 0.0, 2.0),
		smoothing: number(camera.smoothing, 0.6, 0.0, 1.0),
		side: number(camera.side, SIDE_ANGLE, 0.0, 2 * Math.PI),
		sway: number(camera.sway, 1.0, 0.0, 1.0),
		lens: LENS,
		shots,
		focus: camera.focusMarbleId ?? null,
		hold:
			typeof camera.holdAfter === 'number' && Number.isFinite(camera.holdAfter)
				? camera.holdAfter
				: null,
		bowl: bowlPoint(camera.holdBowl),
		descent:
			descent.length >= 2
				? {
						time: Float64Array.from(descent, (point) => point[0]),
						y: Float64Array.from(descent, (point) => point[1])
					}
				: null,
		opening: opening != null && opening.length > 0 ? opening : null
	};
}

/**
 * `opening_pieces` in `camera.py`: the first OPENING_PIECES pieces by their first hit that strike within LEAD_AHEAD
 * seconds of the first hit, sorted by that time
 */
export function openingPieces(pieces: TSceneDescription['pieces']): TOpeningPiece[] {
	const struck: TOpeningPiece[] = [];
	for (const piece of pieces) {
		const times = (piece.hitTimes ?? []).filter((time) => Number.isFinite(time));
		if (!times.length) continue;
		struck.push({ time: Math.min(...times), x: piece.position.x, y: piece.position.y });
	}
	struck.sort((a, b) => a.time - b.time);
	const first = struck[0]?.time ?? 0;
	return struck.filter((piece) => piece.time <= first + LEAD_AHEAD + 1e-9).slice(0, OPENING_PIECES);
}

/** Frame width over height of the render resolution `studio.set_resolution` sets */
function renderAspect(frame: { width: number; height: number }): number {
	const aspect = frame.width / frame.height;
	if (aspect < 1) return 1080 / Math.max(1, pyRound(1080 / aspect));
	return pyRound(1080 * aspect) / 1080;
}

function hasMotion(marble: TFollowMarble): boolean {
	return marble.motion.time.length > 0;
}

/** `in_flight` in `camera.py`: from the first sample to the last, or to `activeUntil` once the lane has finished */
function inside(marble: TFollowMarble, time: number): boolean {
	const motion = marble.motion.time;
	const end = Math.min(motion[motion.length - 1] ?? 0, marble.activeUntil ?? Infinity);
	return time >= (motion[0] ?? 0) - 1e-9 && time <= end + 1e-9;
}

function followPoints(
	marbles: TFollowMarble[],
	times: Float64Array
): { point: [Float64Array, Float64Array] | null; depth: number } {
	const totalX = new Float64Array(times.length);
	const totalY = new Float64Array(times.length);
	const weights = new Float64Array(times.length);
	let depth = 0.0;
	for (const marble of marbles) {
		if (!hasMotion(marble)) continue;
		const x = interp(times, marble.motion.time, marble.motion.x);
		const y = interp(times, marble.motion.time, marble.motion.y);
		for (let index = 0; index < times.length; index++) {
			// A marble that has finished playing falls away fast, so even a small weight would drag the center
			const time = times[index] ?? 0;
			const isFinished = marble.activeUntil != null && time > marble.activeUntil + 1e-9;
			const weight = inside(marble, time) ? 1.0 : isFinished ? FINISHED_WEIGHT : 0.05;
			totalX[index] = (totalX[index] ?? 0) + (x[index] ?? 0) * weight;
			totalY[index] = (totalY[index] ?? 0) + (y[index] ?? 0) * weight;
			weights[index] = (weights[index] ?? 0) + weight;
		}
		depth = Math.max(depth, marble.pathDepth ?? marble.radius + MARBLE_WALL_GAP);
	}
	if (!weights.some((weight) => weight !== 0)) return { point: null, depth };
	for (let index = 0; index < times.length; index++) {
		totalX[index] = (totalX[index] ?? 0) / (weights[index] ?? 0);
		totalY[index] = (totalY[index] ?? 0) / (weights[index] ?? 0);
	}
	return { point: [totalX, totalY], depth };
}

function marblePoint(marble: TFollowMarble, times: Float64Array): [Float64Array, Float64Array] {
	return [
		interp(times, marble.motion.time, marble.motion.x),
		interp(times, marble.motion.time, marble.motion.y)
	];
}

function focusMarble(marbles: TFollowMarble[], focus: string | null): TFollowMarble | null {
	const moving = marbles.filter(hasMotion);
	return moving.find((marble) => marble.id === focus) ?? moving[0] ?? null;
}

/**
 * `lead_shares`: per marble with motion, its share of the point the camera follows in a close shot. The
 * marble in flight with the most notes within LEAD_AHEAD seconds leads (the focus marble wins a tie, and a marble
 * without notes counts only while in flight), a lead lasts at least LEAD_HOLD seconds, and the frame eases from one
 * leading marble to the next over LEAD_EASE seconds.
 */
function leadShares(
	marbles: TFollowMarble[],
	times: Float64Array,
	focus: string | null,
	fps: number
): Float64Array[] {
	const moving = marbles.filter(hasMotion);
	const chosen = focusMarble(marbles, focus);
	const count = times.length;
	const leader = new Int32Array(count);
	let previous = Math.max(0, moving.indexOf(chosen as TFollowMarble));
	for (let index = 0; index < count; index++) {
		const time = times[index] ?? 0;
		let best = -1;
		let bestScore = 0.0;
		moving.forEach((marble, which) => {
			if (!inside(marble, time)) return;
			let score = 1.0 + (marble === chosen ? FOCUS_BIAS : 0.0);
			for (const hit of marble.hitTimes ?? [])
				if (hit > time && hit <= time + LEAD_AHEAD) score += 1.0;
			if (score > bestScore) {
				best = which;
				bestScore = score;
			}
		});
		if (best >= 0) previous = best;
		leader[index] = previous;
	}
	// A lead shorter than LEAD_HOLD keeps the marble that led before it
	const shortest = pyRound(LEAD_HOLD * fps);
	let start = 0;
	for (let index = 1; index <= count; index++) {
		if (index < count && leader[index] === leader[start]) continue;
		if (start > 0 && index - start < shortest) leader.fill(leader[start - 1] ?? 0, start, index);
		start = index;
	}
	return moving.map((_, which) => {
		const share = criticallyDamped(
			Float64Array.from(leader, (value) => (value === which ? 1.0 : 0.0)),
			fps,
			LEAD_EASE / 3
		);
		return share.map((value) => clamp(value, 0.0, 1.0));
	});
}

/** `mix_points`: the marbles with motion at `times`, weighted by `shares` */
function mixPoints(
	marbles: TFollowMarble[],
	times: Float64Array,
	shares: Float64Array[]
): [Float64Array, Float64Array] {
	const totalX = new Float64Array(times.length);
	const totalY = new Float64Array(times.length);
	const weights = new Float64Array(times.length);
	marbles.filter(hasMotion).forEach((marble, which) => {
		const [x, y] = marblePoint(marble, times);
		const share = shares[which] as Float64Array;
		for (let index = 0; index < times.length; index++) {
			const weight = share[index] ?? 0;
			totalX[index] = (totalX[index] ?? 0) + (x[index] ?? 0) * weight;
			totalY[index] = (totalY[index] ?? 0) + (y[index] ?? 0) * weight;
			weights[index] = (weights[index] ?? 0) + weight;
		}
	});
	for (let index = 0; index < times.length; index++) {
		const total = Math.max(weights[index] ?? 0, 1e-9);
		totalX[index] = (totalX[index] ?? 0) / total;
		totalY[index] = (totalY[index] ?? 0) / total;
	}
	return [totalX, totalY];
}

/** `drift_times`: the film time, easing to a stop over HOLD_EASE seconds once the camera holds */
function driftTime(time: number, hold: number | null): number {
	if (hold == null) return time;
	const past = Math.max(time - hold, 0.0);
	return Math.min(time, hold) + HOLD_EASE * (1.0 - Math.exp(-past / HOLD_EASE));
}

/** `view_turn`: side angle around the target from the Turn and the run, and image roll per frame; sway scales what moves on its own */
function viewTurn(
	times: Float64Array,
	heading: Float64Array,
	hold: number | null,
	baseSide: number,
	sway: number
): { side: Float64Array; roll: Float64Array } {
	const side = new Float64Array(times.length);
	const roll = new Float64Array(times.length);
	for (let index = 0; index < times.length; index++) {
		const turn = heading[index] ?? 0;
		side[index] = baseSide + sway * SIDE_FOLLOW * turn;
		roll[index] = sway * (clamp(ROLL_FOLLOW * turn, -ROLL_LIMIT, ROLL_LIMIT) + ROLL_DRIFT * Math.sin((2 * Math.PI * driftTime(times[index] ?? 0, hold)) / ROLL_PERIOD));
	}
	return { side, roll };
}

/** `view_axes`: image right and up and the unit direction from the target toward the camera for one frame */
interface TAxes {
	right: TVec3;
	up: TVec3;
	toward: TVec3;
}

function viewAxes(side: number, roll: number, pitch: number): TAxes {
	const toward: TVec3 = [
		Math.sin(side) * Math.sin(pitch),
		-Math.cos(pitch),
		-Math.cos(side) * Math.sin(pitch)
	];
	const forward: TVec3 = [-toward[0], -toward[1], -toward[2]];
	let right = cross(forward, [-Math.sin(roll), 0.0, Math.cos(roll)]);
	if (Math.hypot(...right) < 1e-8) right = cross(forward, [0.0, -1.0, 0.0]);
	right = normalize(right);
	return { right, up: normalize(cross(right, forward)), toward };
}

/**
 * `spread_need`: distance at which every marble in flight stays inside the framing box around the center, with each
 * offset seen along the camera's axes
 */
function spreadNeed(
	marbles: TFollowMarble[],
	times: Float64Array,
	center: [Float64Array, Float64Array],
	lens: number,
	turn: { side: Float64Array; roll: Float64Array },
	pitch: number
): Float64Array {
	const reach = (CAMERA_SENSOR / 2 / lens) * GROUP_KEEP_Y;
	const reachX = (CAMERA_SENSOR / 2 / lens) * GROUP_KEEP_X * ASPECT_GUESS;
	const required = new Float64Array(times.length);
	const axes = Array.from(times, (_, index) =>
		viewAxes(turn.side[index] ?? 0, turn.roll[index] ?? 0, pitch)
	);
	for (const marble of marbles) {
		if (!hasMotion(marble)) continue;
		const [x, y] = marblePoint(marble, times);
		for (let index = 0; index < times.length; index++) {
			if (!inside(marble, times[index] ?? 0)) continue;
			const dx = (x[index] ?? 0) - (center[0][index] ?? 0);
			const dy = (y[index] ?? 0) - (center[1][index] ?? 0);
			const { right, up, toward } = axes[index] as { right: TVec3; up: TVec3; toward: TVec3 };
			const across = Math.abs(dx * right[0] + dy * right[2]);
			const high = Math.abs(dx * up[0] + dy * up[2]);
			const along = dx * toward[0] + dy * toward[2];
			const need = along + Math.max(across / reachX, high / reach) * GROUP_MARGIN;
			required[index] = Math.max(required[index] ?? 0, need);
		}
	}
	return required;
}

function pacedHeight(
	marbles: TFollowMarble[],
	times: Float64Array,
	centerY: Float64Array,
	descent: { time: Float64Array; y: Float64Array }
): Float64Array {
	const moving = marbles.filter(hasMotion);
	if (moving.length < 2) return centerY;
	const heights = moving.map((marble) => interp(times, marble.motion.time, marble.motion.y));
	const paced = interp(times, descent.time, descent.y);
	const first = descent.time[0] ?? 0;
	const last = descent.time[descent.time.length - 1] ?? 0;
	const result = new Float64Array(times.length);
	for (let index = 0; index < times.length; index++) {
		let low = Number.POSITIVE_INFINITY;
		let high = Number.NEGATIVE_INFINITY;
		for (const height of heights) {
			low = Math.min(low, height[index] ?? 0);
			high = Math.max(high, height[index] ?? 0);
		}
		const middle = (low + high) / 2;
		const quarter = (high - low) / 4;
		const time = times[index] ?? 0;
		let flying = 0;
		for (const marble of marbles) if (hasMotion(marble) && inside(marble, time)) flying++;
		const isCovered = time >= first && time <= last && flying >= 2;
		result[index] = isCovered
			? clamp(paced[index] ?? 0, middle - quarter, middle + quarter)
			: (centerY[index] ?? 0);
	}
	return result;
}

function held(
	values: Float64Array,
	fps: number,
	seconds: number,
	reduce: 'max' | 'median'
): Float64Array {
	const window = Math.max(1, pyRound(fps * seconds));
	const count = values.length;
	const result = new Float64Array(count);
	const span = new Float64Array(2 * window + 1);
	for (let index = 0; index < count; index++) {
		for (let offset = 0; offset <= 2 * window; offset++) {
			const source = clamp(index - window + offset, 0, count - 1);
			span[offset] = values[source] ?? 0;
		}
		if (reduce === 'max') {
			let best = Number.NEGATIVE_INFINITY;
			for (const value of span) best = Math.max(best, value);
			result[index] = best;
		} else {
			span.sort();
			result[index] = span[window] ?? 0;
		}
	}
	return result;
}

function groupFraming(
	marbles: TFollowMarble[],
	times: Float64Array,
	settings: TSettings,
	fps: number,
	heading: Float64Array,
	aim: [Float64Array, Float64Array] | null
): TFraming | null {
	const count = times.length;
	// From the hold time on the marbles are read at the hold time, so the camera settles on the last hit
	const hold = settings.hold;
	const sample = hold == null ? times : times.map((time) => Math.min(time, hold));
	const leadTimes = times.map((time) =>
		hold == null ? time + settings.lead : Math.min(time + settings.lead, hold)
	);
	const { point: center, depth } = followPoints(marbles, sample);
	const { point: ahead } = followPoints(marbles, leadTimes);
	if (center == null || ahead == null) return null;
	if (settings.descent != null) {
		center[1] = pacedHeight(marbles, sample, center[1], settings.descent);
		ahead[1] = pacedHeight(marbles, leadTimes, ahead[1], settings.descent);
	}
	// Shots scale the automatic framing: a Push In to 0.7 of the rig distance comes to 0.7 of whatever the camera
	// frames then, so it reads also where a group has widened the frame
	const shotDistance = shotValues(times, settings.distance, settings.shots);
	const scale = shotDistance.map((value) => value / settings.distance);
	const base = settings.distance;
	const turn = viewTurn(times, heading, hold, settings.side, settings.sway);
	// Sized around the smoothed target when the first pass gave one, else around the group's center
	const axes = Array.from(times, (_, index) =>
		viewAxes(turn.side[index] ?? 0, turn.roll[index] ?? 0, settings.pitch)
	);
	const raw = spreadNeed(marbles, sample, aim ?? center, settings.lens, turn, settings.pitch);
	// The opening frame sets the zoom while it leads: its box holds the marbles, and sizing them around its center would widen it again
	const opening = openingFrame(marbles, times, sample, settings, fps, axes);
	const zoomNeed = raw.slice();
	if (opening != null) {
		for (let index = 0; index < count; index++) {
			const weight = opening.weight[index] ?? 0;
			zoomNeed[index] = Math.max((zoomNeed[index] ?? 0) * (1 - weight), (opening.need[index] ?? 0) * weight);
		}
	}
	const need = held(held(zoomNeed, fps, GROUP_SPIKE / 2, 'median'), fps, 1.0, 'max');
	// A close shot frames the leading marble alone, and only then leads one marble's fall
	const isGroup = marbles.filter(hasMotion).length > 1;
	const push = scale.map((value) => clamp((1 - value) / (1 - PUSH_FOCUS), 0.0, 1.0));
	const fallScale = push.map((value) => (isGroup ? value : 1.0));
	// The zoom follows what the group needs, slowly
	const groupDistance = need.map((value) => Math.max(value, base));
	const distance = criticallyDamped(groupDistance, fps, DISTANCE_TAU);
	// The slow zoom would flatten a need that lasts only for the opening, so the opening stands where it needs most
	if (opening != null) {
		let furthest = 0;
		for (let index = 0; index < count && (times[index] ?? 0) <= opening.first; index++) furthest = Math.max(furthest, groupDistance[index] ?? 0, (opening.fit[index] ?? 0) > 0.5 ? (opening.need[index] ?? 0) : 0);
		for (let index = 0; index < count; index++) {
			const share = (opening.fit[index] ?? 0) * (1.0 - smoothstep(((times[index] ?? 0) - opening.first) / OPENING_ZOOM_EASE));
			distance[index] = (distance[index] ?? 0) + share * Math.max(furthest - (distance[index] ?? 0), 0.0);
		}
	}
	// A closer shot scales the automatic distance; a Wide shot stands at least its scale of the rig distance away
	for (let index = 0; index < count; index++) {
		const shot = scale[index] ?? 1;
		distance[index] = Math.max(Math.max(distance[index] ?? 0, base) * Math.min(shot, 1.0), base * shot);
	}
	if (marbles.length > 1) {
		const shares = leadShares(marbles, sample, settings.focus, fps);
		const lead = mixPoints(marbles, sample, shares);
		const leadAhead = mixPoints(marbles, leadTimes, shares);
		for (const axis of [0, 1] as const) {
			for (let index = 0; index < count; index++) {
				const w = 1 - (push[index] ?? 0);
				center[axis][index] = w * (center[axis][index] ?? 0) + (1 - w) * (lead[axis][index] ?? 0);
				ahead[axis][index] =
					w * (ahead[axis][index] ?? 0) + (1 - w) * (leadAhead[axis][index] ?? 0);
			}
		}
	}
	if (opening != null) {
		// The opening frames its box; it leads no fall
		for (let index = 0; index < count; index++)
			fallScale[index] = (fallScale[index] ?? 0) * (1 - (opening.weight[index] ?? 0));
		for (const axis of [0, 1] as const) {
			for (let index = 0; index < count; index++) {
				const w = opening.weight[index] ?? 0;
				const point = opening.point[axis][index] ?? 0;
				center[axis][index] = w * point + (1 - w) * (center[axis][index] ?? 0);
				ahead[axis][index] = w * point + (1 - w) * (ahead[axis][index] ?? 0);
			}
		}
	}
	if (hold != null) {
		settle(center, times, hold, settings.bowl);
		settle(ahead, times, hold, settings.bowl);
	}
	return { current: center, ahead, depth, distance, fallScale, openingWeight: opening?.weight ?? null };
}

/**
 * `opening_frame`: until the first hit the camera frames the box around the release points and the first struck
 * pieces, so the film opens on the track rather than on marbles over an empty wall, and eases into the follow over
 * OPENING_EASE seconds after it. Returns the box center, the distance the box needs and the weight of the opening per
 * frame; the weight eases to 0 where the box needs more than its limit.
 */
function openingFrame(
	marbles: TFollowMarble[],
	times: Float64Array,
	sample: Float64Array,
	settings: TSettings,
	fps: number,
	axes: TAxes[]
): { first: number; point: [Float64Array, Float64Array]; need: Float64Array; weight: Float64Array; fit: Float64Array } | null {
	const pieces = settings.opening;
	if (pieces == null || !pieces.length) return null;
	const first = Math.min(...pieces.map((piece) => piece.time));
	const count = times.length;
	const diameter = 2 * Math.max(...marbles.filter(hasMotion).map((marble) => marble.radius));
	const limit = Math.max(settings.distance, Math.min(settings.distance * OPENING_ZOOM, diameter / (OPENING_MARBLE_SHARE * (CAMERA_SENSOR / settings.lens) * ASPECT_GUESS)));
	const reach = (CAMERA_SENSOR / 2 / settings.lens) * GROUP_KEEP_Y;
	const reachX = (CAMERA_SENSOR / 2 / settings.lens) * GROUP_KEEP_X * ASPECT_GUESS;
	// The film shows a marble at its release point until it drops, and it falls inside this box: the box holds still
	// until the first hit, so the smoothed target doesn't drift off it. After that it takes in the marbles as they go on
	const released = marbles.filter((marble) => hasMotion(marble) && (marble.motion.time[0] ?? 0) <= first + 1e-9);
	const stillX = [...pieces.map((piece) => piece.x), ...released.map((marble) => marble.motion.x[0] ?? 0)];
	const stillY = [...pieces.map((piece) => piece.y), ...released.map((marble) => marble.motion.y[0] ?? 0)];
	const points = released.map((marble) => marblePoint(marble, sample));
	const pointX = new Float64Array(count);
	const pointY = new Float64Array(count);
	const need = new Float64Array(count);
	const ramp = new Float64Array(count);
	const fits = new Float64Array(count).fill(1.0);
	for (let index = 0; index < count; index++) {
		ramp[index] = 1.0 - smoothstep(((times[index] ?? 0) - first) / OPENING_EASE);
		if ((ramp[index] ?? 0) <= 0) continue;
		const xs = stillX.slice();
		const ys = stillY.slice();
		if ((times[index] ?? 0) > first) {
			points.forEach(([pathX, pathY]) => {
				xs.push(pathX[index] ?? 0);
				ys.push(pathY[index] ?? 0);
			});
		}
		let x = (Math.min(...xs) + Math.max(...xs)) / 2;
		let y = (Math.min(...ys) + Math.max(...ys)) / 2;
		const { right, up, toward } = axes[index] as TAxes;
		const widestAround = (): number => {
			let widest = 0.0;
			xs.forEach((value, which) => {
				const dx = value - x;
				const dy = (ys[which] ?? 0) - y;
				const across = Math.abs(dx * right[0] + dy * right[2]);
				const high = Math.abs(dx * up[0] + dy * up[2]);
				const along = dx * toward[0] + dy * toward[2];
				widest = Math.max(widest, along + Math.max(across / reachX, high / reach) * OPENING_MARGIN);
			});
			return widest;
		};
		// Center the box in the image rather than on the wall: the steep view enlarges what lies near the camera
		const determinant = right[0] * up[2] - right[2] * up[0];
		for (
			let iteration = 0;
			iteration < OPENING_STEPS && Math.abs(determinant) > 1e-9;
			iteration++
		) {
			const reachOut = clamp(widestAround(), settings.distance, limit);
			let lowX = Number.POSITIVE_INFINITY;
			let highX = Number.NEGATIVE_INFINITY;
			let lowY = Number.POSITIVE_INFINITY;
			let highY = Number.NEGATIVE_INFINITY;
			xs.forEach((value, which) => {
				const dx = value - x;
				const dy = (ys[which] ?? 0) - y;
				const depth = Math.max(reachOut - (dx * toward[0] + dy * toward[2]), 1e-6);
				const imageX = (dx * right[0] + dy * right[2]) / depth;
				const imageY = (dx * up[0] + dy * up[2]) / depth;
				lowX = Math.min(lowX, imageX);
				highX = Math.max(highX, imageX);
				lowY = Math.min(lowY, imageY);
				highY = Math.max(highY, imageY);
			});
			const wantX = ((lowX + highX) / 2) * reachOut;
			const wantY = ((lowY + highY) / 2) * reachOut;
			x += (wantX * up[2] - wantY * right[2]) / determinant;
			y += (wantY * right[0] - wantX * up[0]) / determinant;
		}
		pointX[index] = x;
		pointY[index] = y;
		const widest = widestAround();
		need[index] = widest;
		fits[index] = widest <= limit ? 1.0 : 0.0;
	}
	const eased = criticallyDamped(fits, fps, GROUP_EASE / 3);
	const fit = eased.map((value) => clamp(value, 0.0, 1.0));
	const weight = new Float64Array(count);
	for (let index = 0; index < count; index++) weight[index] = (fit[index] ?? 0) * (ramp[index] ?? 0);
	return { first, point: [pointX, pointY], need, weight, fit };
}

/** `bowl_point`: the mean wall point of the Bowls the held ending frames, or null */
function bowlPoint(points: TSceneCamera['holdBowl']): [number, number] | null {
	const finite = (points ?? []).filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y));
	if (!finite.length) return null;
	let x = 0;
	let y = 0;
	for (const point of finite) {
		x += point.x;
		y += point.y;
	}
	return [x / finite.length, y / finite.length];
}

/**
 * `settled`: after the hold time the points ease over HOLD_EASE seconds from the last hit to the middle of the path
 * over the HOLD_SPAN seconds before it, so the last frames show the final pieces; with `bowl`, the Bowls' mean
 * mouth, to BOWL_FRAME of the way from the last hit's point to it, so the frame shows the catch. Changes the arrays
 * in place.
 */
function settle(points: [Float64Array, Float64Array], times: Float64Array, hold: number, bowl: [number, number] | null): void {
	let count = 0;
	const middle = [0, 0];
	const last = [0, 0];
	for (let index = 0; index < times.length; index++) {
		const time = times[index] ?? 0;
		if (time < hold - HOLD_SPAN - 1e-9 || time > hold + 1e-9) continue;
		count++;
		middle[0] = (middle[0] ?? 0) + (points[0][index] ?? 0);
		middle[1] = (middle[1] ?? 0) + (points[1][index] ?? 0);
		last[0] = points[0][index] ?? 0;
		last[1] = points[1][index] ?? 0;
	}
	if (count === 0 || !times.some((time) => time > hold)) return;
	for (const axis of [0, 1] as const) {
		const from = last[axis] ?? 0;
		const mean = bowl != null ? from + (bowl[axis] - from) * BOWL_FRAME : (middle[axis] ?? 0) / count;
		for (let index = 0; index < times.length; index++) {
			const weight = smoothstep(((times[index] ?? 0) - hold) / HOLD_EASE);
			points[axis][index] = (points[axis][index] ?? 0) * (1 - weight) + mean * weight;
		}
	}
}

/**
 * `fall_lead`: how far below the follow point the camera looks while it falls. Above FALL_START meters per second
 * the frame leads by FALL_AHEAD seconds of the extra speed, at most FALL_LIMIT of the camera distance, eased over
 * FALL_EASE seconds, so a falling marble sits above the center with the pieces it falls toward in frame. Over the
 * HOLD_SPAN seconds before the hold the lead fades out, so the held frame still shows the last pieces.
 */
function fallLead(
	pointY: Float64Array,
	distance: Float64Array,
	fps: number,
	times: Float64Array,
	hold: number | null
): Float64Array {
	const count = pointY.length;
	const window = Math.max(1, pyRound(FALL_WINDOW * fps));
	const lead = new Float64Array(count);
	for (let index = 0; index < count; index++) {
		const ahead = Math.min(count - 1, index + window);
		const behind = Math.max(0, index - window);
		const speed = ((pointY[behind] ?? 0) - (pointY[ahead] ?? 0)) / (Math.max(ahead - behind, 1) / fps);
		lead[index] = Math.min(
			Math.max(speed - FALL_START, 0.0) * FALL_AHEAD,
			FALL_LIMIT * (distance[index] ?? 0)
		);
	}
	// The lead lasts FALL_HOLD seconds past the fall, as the smoothed target slows before the marble lands
	const span = pyRound(FALL_HOLD * fps);
	const kept = new Float64Array(count);
	for (let index = 0; index < count; index++) {
		let deepest = 0.0;
		for (let back = Math.max(0, index - span); back <= index; back++)
			deepest = Math.max(deepest, lead[back] ?? 0);
		kept[index] = deepest;
	}
	const eased = criticallyDamped(kept, fps, FALL_EASE / 3);
	if (hold != null) {
		for (let index = 0; index < count; index++)
			eased[index] =
				(eased[index] ?? 0) *
				(1.0 - smoothstep(((times[index] ?? 0) - (hold - HOLD_SPAN)) / HOLD_SPAN));
	}
	return eased;
}

/** `follow_target`: look target on the wall per frame and the run direction (heading) the camera turns with */
function followTarget(
	framing: TFraming,
	settings: TSettings,
	fps: number,
	times: Float64Array
): { targetX: Float64Array; targetY: Float64Array; heading: Float64Array } {
	const count = times.length;
	const { distance } = framing;
	const [currentX, currentY] = framing.current;
	const [aheadX, aheadY] = framing.ahead;
	// Lead the marble, but never so far that it leaves the upper part of the frame on fast drops
	const followX = new Float64Array(count);
	const followY = new Float64Array(count);
	for (let index = 0; index < count; index++) {
		const dx = (aheadX[index] ?? 0) - (currentX[index] ?? 0);
		const dy = (aheadY[index] ?? 0) - (currentY[index] ?? 0);
		const length = Math.hypot(dx, dy);
		const limit = LEAD_LIMIT * (distance[index] ?? 0);
		const scale = length > limit ? limit / Math.max(length, 1e-9) : 1.0;
		followX[index] = (currentX[index] ?? 0) + dx * scale;
		followY[index] = (currentY[index] ?? 0) + dy * scale;
	}
	const fall = fallLead(currentY, distance, fps, times, settings.hold);
	for (let index = 0; index < count; index++)
		followY[index] = (followY[index] ?? 0) - (fall[index] ?? 0) * (framing.fallScale[index] ?? 0);
	const tau = 0.04 + 0.5 * settings.smoothing;
	const targetX = criticallyDamped(followX, fps, tau);
	const targetY = criticallyDamped(followY, fps, tau);
	// Pull the target back wherever the marble would leave the inner part of the frame
	const reach = new Float64Array(count);
	for (let index = 0; index < count; index++)
		reach[index] = (((distance[index] ?? 0) * CAMERA_SENSOR) / 2 / settings.lens) * FRAME_KEEP;
	for (let iteration = 0; iteration < 8; iteration++) {
		const excessX = new Float64Array(count);
		const excessY = new Float64Array(count);
		let isAny = false;
		for (let index = 0; index < count; index++) {
			excessX[index] = excess(
				(currentX[index] ?? 0) - (targetX[index] ?? 0),
				(reach[index] ?? 0) * ASPECT_GUESS
			);
			excessY[index] = excess(
				(currentY[index] ?? 0) - (targetY[index] ?? 0),
				(reach[index] ?? 0) * 1.0
			);
			if (excessX[index] !== 0 || excessY[index] !== 0) isAny = true;
		}
		if (!isAny) break;
		const smoothX = criticallyDamped(excessX, fps, 0.08);
		const smoothY = criticallyDamped(excessY, fps, 0.08);
		for (let index = 0; index < count; index++) {
			targetX[index] = (targetX[index] ?? 0) + (smoothX[index] ?? 0) * 1.3;
			targetY[index] = (targetY[index] ?? 0) + (smoothY[index] ?? 0) * 1.3;
		}
	}
	// Safety net for extreme motion: never let a marble leave the frame
	for (let index = 0; index < count; index++) {
		targetX[index] =
			(targetX[index] ?? 0) +
			excess(
				(currentX[index] ?? 0) - (targetX[index] ?? 0),
				(reach[index] ?? 0) * ASPECT_GUESS * 1.5
			);
		targetY[index] =
			(targetY[index] ?? 0) +
			excess((currentY[index] ?? 0) - (targetY[index] ?? 0), (reach[index] ?? 0) * 1.0 * 1.5);
	}
	// Run direction from the smoothed target over one second, then smoothed again for slow heading changes
	const window = Math.max(1, pyRound(0.5 * fps));
	const heading = new Float64Array(count);
	for (let index = 0; index < count; index++) {
		const ahead = Math.min(count - 1, index + window);
		const behind = Math.max(0, index - window);
		const dx = (targetX[ahead] ?? 0) - (targetX[behind] ?? 0);
		const dy = (targetY[ahead] ?? 0) - (targetY[behind] ?? 0);
		const isMoving = Math.hypot(dx, dy) > 1e-4;
		// The opening's target holds still, so its tiny moves name no run direction: the view stays straight until it lets go
		const free = 1 - (framing.openingWeight?.[index] ?? 0);
		heading[index] = free * clamp(isMoving ? Math.atan2(dx, -dy) : 0.0, -Math.PI / 2, Math.PI / 2);
	}
	// While the camera settles on the last hit the target barely moves; the view keeps the run direction it had
	if (settings.hold != null) {
		const settle = settings.hold - window / fps;
		const first = times.findIndex((time) => time > settle);
		if (first > 0) heading.fill(heading[first - 1] ?? 0, first);
	}
	return { targetX, targetY, heading: criticallyDamped(heading, fps, HEADING_TAU) };
}

/** Zero-phase smoothing: a critically damped second-order filter run forward then backward */
function criticallyDamped(values: Float64Array, fps: number, tau: number): Float64Array {
	const count = values.length;
	if (tau <= 0 || count < 3) return values.slice();
	const omega = 1.0 / tau;
	const dt = 1.0 / fps;
	const steps = 4;
	const h = dt / steps;
	const run = (series: Float64Array): Float64Array => {
		const out = new Float64Array(series.length);
		let position = series[0] ?? 0;
		let velocity = 0;
		for (let index = 0; index < series.length; index++) {
			for (let step = 0; step < steps; step++) {
				const acceleration =
					omega * omega * ((series[index] ?? 0) - position) - 2 * omega * velocity;
				velocity = velocity + acceleration * h;
				position = position + velocity * h;
			}
			out[index] = position;
		}
		return out;
	};
	// Pad both ends with linear extrapolation so the filter does not drag the ends toward a standing start
	const pad = Math.min(count - 1, Math.max(2, Math.trunc(3 * tau * fps)));
	const startVelocity = (values[1] ?? 0) - (values[0] ?? 0);
	const endVelocity = (values[count - 1] ?? 0) - (values[count - 2] ?? 0);
	const padded = new Float64Array(count + 2 * pad);
	for (let index = 0; index < pad; index++)
		padded[index] = (values[0] ?? 0) - startVelocity * (pad - index);
	padded.set(values, pad);
	for (let index = 0; index < pad; index++)
		padded[pad + count + index] = (values[count - 1] ?? 0) + endVelocity * (index + 1);
	const forward = run(padded);
	const backward = run(forward.reverse()).reverse();
	return backward.slice(pad, pad + count);
}

function smoothstep(progress: number): number {
	const value = clamp(progress, 0.0, 1.0);
	return value * value * (3 - 2 * value);
}

/**
 * `shot_events`: the distance the camera eases to from each time on. Every shot's, and the rig's once a shot with a
 * length has held that long before the next shot starts.
 */
export function shotEvents(
	shots: readonly { time: number; distance: number; length?: number | null }[],
	baseDistance: number
): { time: number; distance: number; isRelease: boolean }[] {
	const events: { time: number; distance: number; isRelease: boolean }[] = [];
	shots.forEach((shot, index) => {
		events.push({ time: shot.time, distance: shot.distance, isRelease: false });
		const following = shots[index + 1]?.time ?? Infinity;
		const length = shot.length;
		if (length != null && shot.time + length < following - 1e-9)
			events.push({ time: shot.time + length, distance: baseDistance, isRelease: true });
	});
	return events;
}

/** `shot_values`: each transition eases over SHOT_EASE seconds from where the previous one has got to */
function shotValues(
	times: Float64Array,
	baseDistance: number,
	shots: TSettings['shots']
): Float64Array {
	const distance = new Float64Array(times.length).fill(baseDistance);
	let start = baseDistance;
	let goal = baseDistance;
	let startTime = -Infinity;
	for (const event of shotEvents(shots, baseDistance)) {
		const reached = smoothstep((event.time - startTime) / SHOT_EASE);
		start = start + (goal - start) * reached;
		goal = event.distance;
		startTime = event.time;
		for (let index = 0; index < times.length; index++) {
			const time = times[index] ?? 0;
			if (time < event.time) continue;
			const eased = smoothstep((time - event.time) / SHOT_EASE);
			distance[index] = start + (goal - start) * eased;
		}
	}
	return distance;
}

/** Rotation quaternion (wxyz) whose local -z looks from `position` at `target` with local y toward `up` */
function lookRotation(position: TVec3, target: TVec3, up: TVec3): [number, number, number, number] {
	const forward = normalize([
		target[0] - position[0],
		target[1] - position[1],
		target[2] - position[2]
	]);
	let right = cross(forward, up);
	if (Math.hypot(...right) < 1e-8) right = cross(forward, [0.0, -1.0, 0.0]);
	right = normalize(right);
	const cameraUp = normalize(cross(right, forward));
	// Columns: right, up, -forward
	return matrixToQuaternion(
		[right[0], cameraUp[0], -forward[0]],
		[right[1], cameraUp[1], -forward[1]],
		[right[2], cameraUp[2], -forward[2]]
	);
}

/** Rotation matrix rows to a unit quaternion wxyz */
export function matrixToQuaternion(
	row0: TVec3,
	row1: TVec3,
	row2: TVec3
): [number, number, number, number] {
	const [m00, m01, m02] = row0;
	const [m10, m11, m12] = row1;
	const [m20, m21, m22] = row2;
	const trace = m00 + m11 + m22;
	let w: number;
	let x: number;
	let y: number;
	let z: number;
	if (trace > 0) {
		const s = Math.sqrt(trace + 1.0) * 2;
		w = 0.25 * s;
		x = (m21 - m12) / s;
		y = (m02 - m20) / s;
		z = (m10 - m01) / s;
	} else if (m00 > m11 && m00 > m22) {
		const s = Math.sqrt(1.0 + m00 - m11 - m22) * 2;
		w = (m21 - m12) / s;
		x = 0.25 * s;
		y = (m01 + m10) / s;
		z = (m02 + m20) / s;
	} else if (m11 > m22) {
		const s = Math.sqrt(1.0 + m11 - m00 - m22) * 2;
		w = (m02 - m20) / s;
		x = (m01 + m10) / s;
		y = 0.25 * s;
		z = (m12 + m21) / s;
	} else {
		const s = Math.sqrt(1.0 + m22 - m00 - m11) * 2;
		w = (m10 - m01) / s;
		x = (m02 + m20) / s;
		y = (m12 + m21) / s;
		z = 0.25 * s;
	}
	const length = Math.hypot(w, x, y, z);
	return [w / length, x / length, y / length, z / length];
}

/** `np.interp` for sample times sorted ascending */
function interp(times: Float64Array, xp: Float64Array, fp: Float64Array): Float64Array {
	const out = new Float64Array(times.length);
	const last = xp.length - 1;
	let j = 0;
	for (let index = 0; index < times.length; index++) {
		const x = times[index] ?? 0;
		if (x <= (xp[0] ?? 0)) {
			out[index] = fp[0] ?? 0;
			continue;
		}
		if (x >= (xp[last] ?? 0)) {
			out[index] = fp[last] ?? 0;
			continue;
		}
		if ((xp[j] ?? 0) > x) j = 0;
		while (j < last && (xp[j + 1] ?? 0) <= x) j++;
		const slope = ((fp[j + 1] ?? 0) - (fp[j] ?? 0)) / ((xp[j + 1] ?? 0) - (xp[j] ?? 0));
		out[index] = slope * (x - (xp[j] ?? 0)) + (fp[j] ?? 0);
	}
	return out;
}

function decodeMotion(bytes: Uint8Array | undefined): TMotion {
	if (bytes == null)
		return { time: new Float64Array(0), x: new Float64Array(0), y: new Float64Array(0) };
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const count = Math.floor(bytes.byteLength / 16);
	const motion = {
		time: new Float64Array(count),
		x: new Float64Array(count),
		y: new Float64Array(count)
	};
	for (let index = 0; index < count; index++) {
		motion.time[index] = view.getFloat32(index * 16, true);
		motion.x[index] = view.getFloat32(index * 16 + 4, true);
		motion.y[index] = view.getFloat32(index * 16 + 8, true);
	}
	return motion;
}

function excess(offset: number, reach: number): number {
	return Math.max(Math.abs(offset) - reach, 0.0) * Math.sign(offset);
}

function interleave(x: Float64Array, y: Float64Array): Float64Array {
	const out = new Float64Array(x.length * 2);
	for (let index = 0; index < x.length; index++) {
		out[index * 2] = x[index] ?? 0;
		out[index * 2 + 1] = y[index] ?? 0;
	}
	return out;
}

/** Python's `round`: halves go to the even neighbor */
export function pyRound(value: number): number {
	const floor = Math.floor(value);
	const fraction = value - floor;
	if (fraction > 0.5) return floor + 1;
	if (fraction < 0.5) return floor;
	return floor % 2 === 0 ? floor : floor + 1;
}

function radians(degrees: number): number {
	return (degrees * Math.PI) / 180;
}

function clamp(value: number, low: number, high: number): number {
	return Math.min(high, Math.max(low, value));
}

function lerp(a: number, b: number, t: number): number {
	return a + (b - a) * t;
}

function dot4(a: Float64Array, aOffset: number, b: Float64Array, bOffset: number): number {
	let sum = 0;
	for (let axis = 0; axis < 4; axis++) sum += (a[aOffset + axis] ?? 0) * (b[bOffset + axis] ?? 0);
	return sum;
}

function cross(a: TVec3, b: TVec3): TVec3 {
	return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function normalize(vector: TVec3): TVec3 {
	const length = Math.hypot(...vector);
	return length > 0 ? [vector[0] / length, vector[1] / length, vector[2] / length] : vector;
}
