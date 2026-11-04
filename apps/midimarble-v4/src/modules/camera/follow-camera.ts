import type { TMotionFile, TSceneCamera, TSceneDescription, TSceneLoop } from '@/modules/blender';

/**
 * TypeScript port of the follow camera in `blender/mm_worker/camera.py`, which stays the source of the film. Given
 * the scene description the app sends to `apply_scene` and its motion files, `bakeFollowCamera` computes the pose
 * the worker bakes for every film frame: same constants, same smoothing, same group and focus logic. Compose's
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
const SIDE_ANGLE = radians(150);
const SIDE_FOLLOW = 0.3;
const HEADING_TAU = 1.5;
const LEAD_LIMIT = 0.04;
const FRAME_KEEP = 0.55;
const ASPECT_GUESS = 0.56;
const SHOT_EASE = 0.8;
const LENS = 50.0;
const MIN_PIECE_FRACTION = 0.06;
const ZOOM_LIMIT = 3.0;
const GROUP_KEEP_X = 0.85;
const GROUP_KEEP_Y = 0.85;
/** A marble spans at least this fraction of the frame width at the readable maximum */
const MIN_MARBLE_FRACTION = 0.06;
/** Margin on the distance a framed group needs */
const GROUP_MARGIN = 1.1;
/** Seconds over which the camera settles once it holds on the last hit, and the stretch of run before that hit */
const HOLD_EASE = 1.0;
const HOLD_SPAN = 1.0;
/** Time constant in seconds of the group distance, so the zoom changes slowly */
const DISTANCE_TAU = 1.5;
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
/** Weight in the group centre of a marble past its `activeUntil`, `FINISHED_WEIGHT` in `camera.py` */
const FINISHED_WEIGHT = 0.001;
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
	const settings = settingsFrom(input.camera, input.pieceLength);
	const marbles = input.marbles.filter((marble) => marble.ghostOf == null);
	const loop = input.loop;
	const frameEnd = Math.max(1, Math.ceil(input.duration * fps - 1e-6));
	let firstFrame = 0;
	if (loop != null)
		firstFrame = Math.min(firstFrame, Math.floor((loop.start - loop.blend) * fps) - 1);
	const count = frameEnd - firstFrame + 1;
	const times = new Float64Array(count);
	for (let index = 0; index < count; index++) times[index] = (firstFrame + index) / fps;
	const aspect = renderAspect(input.frame);
	if (loop != null) settings.hold = null;
	// The group's size in frame depends on where the camera looks from and at: a first pass with the camera straight
	// and sized around the group's centre gives the run direction and the smoothed target that size the second
	const straight = groupFraming(marbles, times, settings, fps, aspect, new Float64Array(count), null);
	if (straight == null) return null;
	const firstPass = followTarget(straight, settings, fps, times);
	const framing = groupFraming(marbles, times, settings, fps, aspect, firstPass.heading, [
		firstPass.targetX,
		firstPass.targetY
	]);
	if (framing == null) return null;
	const { depth, distance } = framing;
	const [currentX, currentY] = framing.current;
	const { targetX, targetY, heading: smoothHeading } = followTarget(framing, settings, fps, times);
	// The camera stands below and to the side of the target, looking up along the run; the side follows the run
	// direction so the view keeps looking along it, and the image rolls slowly on its own and with the run
	const { side, roll } = viewTurn(times, smoothHeading, framing.roll, settings.hold);

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
	if (loop != null) closeLoop(firstFrame, fps, position, rotation, focus, loop);

	// Keep frames from 0 on, like the keyframes Blender keeps from `frame_start`
	const skip = -firstFrame;
	const kept = count - skip;
	const track: TCameraTrack = {
		fps,
		frameCount: kept,
		position: position.slice(skip * 3),
		rotation: rotation.slice(skip * 4),
		focus: focus.slice(skip),
		target: interleave(targetX.subarray(skip), targetY.subarray(skip)),
		roll: roll.slice(skip),
		distance: distance.slice(skip),
		depth,
		lens: settings.lens,
		aspect,
		loop: loop ?? null
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
	// Shortest-path normalised lerp; Blender interpolates the Euler keys linearly, which agrees closely at 1/fps steps
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
		loop: description.loop ?? null,
		pieceLength: typicalPieceLength(description.pieces),
		marbles: description.marbles.map((marble) => ({
			id: marble.id,
			radius: marble.radius,
			ghostOf: marble.ghostOf,
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
	loop: TSceneLoop | null;
	/** Median bar or blade length, `typical_piece_length` in `scene.py` */
	pieceLength: number | null;
	marbles: TFollowMarble[];
}

export interface TFollowMarble {
	id: string;
	radius: number;
	ghostOf?: string;
	/** `activeUntil` of the scene marble: the camera stops framing it then */
	activeUntil?: number;
	/** Times of the marble's notes, sorted; the marble with more notes ahead leads the frame */
	hitTimes?: number[];
	motion: TMotion;
}

/** Marble samples in wall metres, as the worker reads them from the Float32 motion file */
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
	/** Look target on the wall per frame, xy in wall metres */
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
	loop: TSceneLoop | null;
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
	lens: number;
	shots: { time: number; roll: number; distance: number; length: number | null }[];
	focus: string | null;
	/** Time of the run's last hit, after which the camera holds on it; null follows to the end */
	hold: number | null;
	descent: { time: Float64Array; y: Float64Array } | null;
	pieceLength: number | null;
}

interface TFraming {
	current: [Float64Array, Float64Array];
	ahead: [Float64Array, Float64Array];
	depth: number;
	distance: Float64Array;
	/** Shot roll per frame */
	roll: Float64Array;
}

function settingsFrom(camera: TSceneCamera, pieceLength: number | null): TSettings {
	const number = (value: unknown, fallback: number, low: number, high: number): number =>
		typeof value !== 'number' || !Number.isFinite(value)
			? fallback
			: Math.min(high, Math.max(low, value));
	const shots = camera.shots
		.map((shot) => ({
			time: shot.time,
			roll: shot.roll ?? 0,
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
		lens: LENS,
		shots,
		focus: camera.focusMarbleId ?? null,
		hold:
			typeof camera.holdAfter === 'number' && Number.isFinite(camera.holdAfter)
				? camera.holdAfter
				: null,
		descent:
			descent.length >= 2
				? {
						time: Float64Array.from(descent, (point) => point[0]),
						y: Float64Array.from(descent, (point) => point[1])
					}
				: null,
		pieceLength
	};
}

/** `typical_piece_length` in `scene.py`: median length of the bars and blades on the wall */
export function typicalPieceLength(pieces: TSceneDescription['pieces']): number | null {
	const lengths: number[] = [];
	for (const piece of pieces) {
		const { params } = piece;
		const blade = params['bladeLength'];
		const length = params['length'];
		if (blade != null) lengths.push(2 * blade + 2 * (params['hubRadius'] ?? 0.0));
		else if (piece.type === 'platform' && length != null) lengths.push(length);
	}
	if (!lengths.length) return null;
	lengths.sort((a, b) => a - b);
	const middle = Math.floor(lengths.length / 2);
	return lengths.length % 2
		? (lengths[middle] ?? 0)
		: ((lengths[middle - 1] ?? 0) + (lengths[middle] ?? 0)) / 2;
}

/** Frame width over height of the render resolution `studio.set_resolution` sets */
function renderAspect(frame: { width: number; height: number }): number {
	const aspect = frame.width / frame.height;
	if (aspect < 1) return 1080 / Math.max(1, pyRound(1080 / aspect));
	return pyRound(1080 * aspect) / 1080;
}

function widthPerMetre(lens: number, aspect: number): number {
	return (CAMERA_SENSOR * Math.min(aspect, 1.0)) / lens;
}

/**
 * `readable_distance`: a typical piece spans MIN_PIECE_FRACTION of the frame width, a marble of `radius`
 * MIN_MARBLE_FRACTION, and the camera stands at most ZOOM_LIMIT times its set distance away
 */
function readableDistance(settings: TSettings, aspect: number, radius: number | null): number {
	let limit = settings.distance * ZOOM_LIMIT;
	const width = widthPerMetre(settings.lens, aspect);
	const piece = settings.pieceLength;
	if (piece) limit = Math.min(limit, piece / (MIN_PIECE_FRACTION * width));
	if (radius) limit = Math.min(limit, (2 * radius) / (MIN_MARBLE_FRACTION * width));
	return Math.max(limit, settings.distance);
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
			// A marble that has finished playing falls away fast, so even a small weight would drag the centre
			const time = times[index] ?? 0;
			const isFinished = marble.activeUntil != null && time > marble.activeUntil + 1e-9;
			const weight = inside(marble, time) ? 1.0 : isFinished ? FINISHED_WEIGHT : 0.05;
			totalX[index] = (totalX[index] ?? 0) + (x[index] ?? 0) * weight;
			totalY[index] = (totalY[index] ?? 0) + (y[index] ?? 0) * weight;
			weights[index] = (weights[index] ?? 0) + weight;
		}
		depth = Math.max(depth, marble.radius + MARBLE_WALL_GAP);
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
 * `lead_shares`: per marble with motion, its share of the point the camera follows where the group does not fit. The
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
			for (const hit of marble.hitTimes ?? []) if (hit > time && hit <= time + LEAD_AHEAD) score += 1.0;
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

/** `view_turn`: side angle around the target and image roll per frame */
function viewTurn(
	times: Float64Array,
	heading: Float64Array,
	shotRoll: Float64Array,
	hold: number | null
): { side: Float64Array; roll: Float64Array } {
	const side = new Float64Array(times.length);
	const roll = new Float64Array(times.length);
	for (let index = 0; index < times.length; index++) {
		const turn = heading[index] ?? 0;
		side[index] = SIDE_ANGLE + SIDE_FOLLOW * turn;
		roll[index] =
			clamp(ROLL_FOLLOW * turn, -ROLL_LIMIT, ROLL_LIMIT) +
			ROLL_DRIFT * Math.sin((2 * Math.PI * driftTime(times[index] ?? 0, hold)) / ROLL_PERIOD) +
			(shotRoll[index] ?? 0);
	}
	return { side, roll };
}

/** `view_axes`: image right and up and the unit direction from the target toward the camera for one frame */
function viewAxes(side: number, roll: number, pitch: number): { right: TVec3; up: TVec3; toward: TVec3 } {
	const toward: TVec3 = [Math.sin(side) * Math.sin(pitch), -Math.cos(pitch), -Math.cos(side) * Math.sin(pitch)];
	const forward: TVec3 = [-toward[0], -toward[1], -toward[2]];
	let right = cross(forward, [-Math.sin(roll), 0.0, Math.cos(roll)]);
	if (Math.hypot(...right) < 1e-8) right = cross(forward, [0.0, -1.0, 0.0]);
	right = normalize(right);
	return { right, up: normalize(cross(right, forward)), toward };
}

/**
 * `spread_need`: distance at which every marble in flight stays inside the framing box around the centre, with each
 * offset seen along the camera's axes
 */
function spreadNeed(
	marbles: TFollowMarble[],
	times: Float64Array,
	centre: [Float64Array, Float64Array],
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
			const dx = (x[index] ?? 0) - (centre[0][index] ?? 0);
			const dy = (y[index] ?? 0) - (centre[1][index] ?? 0);
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
	centreY: Float64Array,
	descent: { time: Float64Array; y: Float64Array }
): Float64Array {
	const moving = marbles.filter(hasMotion);
	if (moving.length < 2) return centreY;
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
			: (centreY[index] ?? 0);
	}
	return result;
}

function withoutShortRuns(flags: boolean[], shortest: number): boolean[] {
	const result = flags.slice();
	let start: number | null = null;
	for (let index = 0; index <= flags.length; index++) {
		const flag = index < flags.length ? (flags[index] ?? 0) : false;
		if (flag && start == null) start = index;
		else if (!flag && start != null) {
			if (index - start < shortest) result.fill(false, start, index);
			start = null;
		}
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
	aspect: number,
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
	const { point: centre, depth } = followPoints(marbles, sample);
	const { point: ahead } = followPoints(marbles, leadTimes);
	if (centre == null || ahead == null) return null;
	if (settings.descent != null) {
		centre[1] = pacedHeight(marbles, sample, centre[1], settings.descent);
		ahead[1] = pacedHeight(marbles, leadTimes, ahead[1], settings.descent);
	}
	// Shots scale the automatic framing: a Push In to 0.7 of the rig distance comes to 0.7 of whatever the camera
	// frames then, so it reads also where a group has widened the frame
	const { distance: shotDistance, roll } = shotValues(times, settings.distance, settings.shots);
	const scale = shotDistance.map((value) => value / settings.distance);
	const base = settings.distance;
	const radii = marbles.filter(hasMotion).map((marble) => marble.radius);
	const limit = readableDistance(settings, aspect, radii.length ? Math.min(...radii) : null);
	const upper = Math.max(base, limit);
	const turn = viewTurn(times, heading, roll, hold);
	// Sized around the smoothed target when the first pass gave one, else around the group's centre
	const raw = spreadNeed(marbles, sample, aim ?? centre, settings.lens, turn, settings.pitch);
	const need = held(held(raw, fps, GROUP_SPIKE / 2, 'median'), fps, 1.0, 'max');
	const over = withoutShortRuns(
		Array.from(raw, (value) => value > limit),
		pyRound(GROUP_SPIKE * fps)
	);
	const heldOver = held(
		Float64Array.from(over, (flag) => (flag ? 1 : 0)),
		fps,
		1.0,
		'max'
	);
	const fits = heldOver.map((value) => 1.0 - value);
	const weight = criticallyDamped(fits, fps, GROUP_EASE / 3).map((value) => clamp(value, 0.0, 1.0));
	// The zoom follows what the group needs up to the readable maximum and stays there where the group no longer
	// fits, slowly, so the frame neither pulls back to a survey nor jumps back in when it switches to one marble
	const groupDistance = need.map((value) => clamp(value, base, upper));
	const distance = criticallyDamped(groupDistance, fps, DISTANCE_TAU);
	for (let index = 0; index < count; index++)
		distance[index] = clamp(distance[index] ?? 0, base, upper) * (scale[index] ?? 1);
	if (marbles.length > 1) {
		const shares = leadShares(marbles, sample, settings.focus, fps);
		const lead = mixPoints(marbles, sample, shares);
		const leadAhead = mixPoints(marbles, leadTimes, shares);
		for (const axis of [0, 1] as const) {
			for (let index = 0; index < count; index++) {
				// A close shot frames the leading marble alone
				const push = clamp((1 - (scale[index] ?? 1)) / (1 - PUSH_FOCUS), 0.0, 1.0);
				const w = (weight[index] ?? 0) * (1 - push);
				centre[axis][index] = w * (centre[axis][index] ?? 0) + (1 - w) * (lead[axis][index] ?? 0);
				ahead[axis][index] = w * (ahead[axis][index] ?? 0) + (1 - w) * (leadAhead[axis][index] ?? 0);
			}
		}
	}
	if (hold != null) {
		settle(centre, times, hold);
		settle(ahead, times, hold);
	}
	return { current: centre, ahead, depth, distance, roll };
}

/**
 * `settled`: after the hold time the points ease over HOLD_EASE seconds from the last hit to the middle of the path
 * over the HOLD_SPAN seconds before it, so the last frames show the final pieces. Changes the arrays in place.
 */
function settle(points: [Float64Array, Float64Array], times: Float64Array, hold: number): void {
	let count = 0;
	const middle = [0, 0];
	for (let index = 0; index < times.length; index++) {
		const time = times[index] ?? 0;
		if (time < hold - HOLD_SPAN - 1e-9 || time > hold + 1e-9) continue;
		count++;
		middle[0] = (middle[0] ?? 0) + (points[0][index] ?? 0);
		middle[1] = (middle[1] ?? 0) + (points[1][index] ?? 0);
	}
	if (count === 0 || !times.some((time) => time > hold)) return;
	for (const axis of [0, 1] as const) {
		const mean = (middle[axis] ?? 0) / count;
		for (let index = 0; index < times.length; index++) {
			const weight = smoothstep(((times[index] ?? 0) - hold) / HOLD_EASE);
			points[axis][index] = (points[axis][index] ?? 0) * (1 - weight) + mean * weight;
		}
	}
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
		heading[index] = clamp(isMoving ? Math.atan2(dx, -dy) : 0.0, -Math.PI / 2, Math.PI / 2);
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
 * `shot_events`: the distance and roll the camera eases to from each time on. Every shot's values, and the rig's
 * distance without extra roll once a shot with a length has held that long before the next shot starts.
 */
export function shotEvents(
	shots: readonly { time: number; roll: number; distance: number; length?: number | null }[],
	baseDistance: number
): { time: number; distance: number; roll: number; isRelease: boolean }[] {
	const events: { time: number; distance: number; roll: number; isRelease: boolean }[] = [];
	shots.forEach((shot, index) => {
		events.push({ time: shot.time, distance: shot.distance, roll: shot.roll, isRelease: false });
		const following = shots[index + 1]?.time ?? Infinity;
		const length = shot.length;
		if (length != null && shot.time + length < following - 1e-9)
			events.push({ time: shot.time + length, distance: baseDistance, roll: 0.0, isRelease: true });
	});
	return events;
}

/** `shot_values`: each transition eases over SHOT_EASE seconds from where the previous one has got to */
function shotValues(
	times: Float64Array,
	baseDistance: number,
	shots: TSettings['shots']
): { distance: Float64Array; roll: Float64Array } {
	const distance = new Float64Array(times.length).fill(baseDistance);
	const roll = new Float64Array(times.length);
	let start: [number, number] = [baseDistance, 0.0];
	let goal: [number, number] = [baseDistance, 0.0];
	let startTime = -Infinity;
	for (const event of shotEvents(shots, baseDistance)) {
		const reached = smoothstep((event.time - startTime) / SHOT_EASE);
		start = [start[0] + (goal[0] - start[0]) * reached, start[1] + (goal[1] - start[1]) * reached];
		goal = [event.distance, event.roll];
		startTime = event.time;
		for (let index = 0; index < times.length; index++) {
			const time = times[index] ?? 0;
			if (time < event.time) continue;
			const eased = smoothstep((time - event.time) / SHOT_EASE);
			distance[index] = start[0] + (goal[0] - start[0]) * eased;
			roll[index] = start[1] + (goal[1] - start[1]) * eased;
		}
	}
	return { distance, roll };
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

/**
 * `close_loop`: blends the poses of the last `blend` seconds into the poses one loop length earlier with a smoothstep
 * weight, rotations by quaternion slerp. Changes the arrays in place.
 */
function closeLoop(
	firstFrame: number,
	fps: number,
	position: Float64Array,
	rotation: Float64Array,
	focus: Float64Array,
	loop: TSceneLoop
): void {
	const shift = pyRound((loop.end - loop.start) * fps);
	const blendStart = loop.end - loop.blend;
	for (let index = 0; index < focus.length; index++) {
		const source = index - shift;
		const time = (firstFrame + index) / fps;
		if (time < blendStart - 1e-9 || source < 0) continue;
		const progress = loop.blend <= 0 ? 1.0 : Math.min(1.0, (time - blendStart) / loop.blend);
		const weight = progress * progress * (3 - 2 * progress);
		for (let axis = 0; axis < 3; axis++) {
			position[index * 3 + axis] =
				(position[index * 3 + axis] ?? 0) * (1 - weight) +
				(position[source * 3 + axis] ?? 0) * weight;
		}
		focus[index] = (focus[index] ?? 0) * (1 - weight) + (focus[source] ?? 0) * weight;
		rotation.set(
			slerp(
				rotation.subarray(index * 4, index * 4 + 4),
				rotation.subarray(source * 4, source * 4 + 4),
				weight
			),
			index * 4
		);
	}
}

/** Shortest-path slerp like Blender's `interp_qt_qtqt` */
function slerp(a: Float64Array, b: Float64Array, t: number): number[] {
	let cosom =
		(a[0] ?? 0) * (b[0] ?? 0) +
		(a[1] ?? 0) * (b[1] ?? 0) +
		(a[2] ?? 0) * (b[2] ?? 0) +
		(a[3] ?? 0) * (b[3] ?? 0);
	const sign = cosom < 0 ? -1 : 1;
	cosom *= sign;
	let w0: number;
	let w1: number;
	if (1 - cosom > 0.0001) {
		const omega = Math.acos(cosom);
		const sinom = Math.sin(omega);
		w0 = Math.sin((1 - t) * omega) / sinom;
		w1 = Math.sin(t * omega) / sinom;
	} else {
		w0 = 1 - t;
		w1 = t;
	}
	return [0, 1, 2, 3].map((axis) => w0 * (a[axis] ?? 0) + w1 * sign * (b[axis] ?? 0));
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

/** Python's `round`: halves go to the even neighbour */
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
