import type { TMotionFile, TSceneCamera, TSceneDescription } from '@/modules/blender';

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
/**
 * While the follow point falls faster than FALL_START metres per second, the frame looks FALL_AHEAD seconds of the
 * extra speed below it, at most FALL_LIMIT of the camera distance, eased over FALL_EASE seconds; the speed is taken
 * over FALL_WINDOW seconds either side, and the lead lasts FALL_HOLD seconds past the fall
 */
const FALL_START = 0.3;
const FALL_AHEAD = 0.25;
const FALL_LIMIT = 0.15;
const FALL_EASE = 0.6;
const FALL_WINDOW = 0.1;
const FALL_HOLD = 0.5;
const FRAME_KEEP = 0.55;
const ASPECT_GUESS = 0.56;
const SHOT_EASE = 0.8;
const LENS = 50.0;
const MIN_PIECE_FRACTION = 0.06;
const ZOOM_LIMIT = 3.0;
const GROUP_KEEP_X = 0.85;
const GROUP_KEEP_Y = 0.85;
/**
 * A marble spans at least this fraction of the frame width at the readable maximum: 5 % keeps both marbles of Jingle
 * Bells in frame on 95.5 % of the frames with every marble at 4.6 % or more (6 % kept both on 80.8 %)
 */
const MIN_MARBLE_FRACTION = 0.05;
/** Margin on the distance a framed group needs */
const GROUP_MARGIN = 1.1;
/** Seconds over which the camera settles once it holds on the last hit, and the stretch of run before that hit */
const HOLD_EASE = 1.0;
const HOLD_SPAN = 1.0;
/** With Finishes, the held follow point sits this share of the way from the last hit to the Finishes' mouths */
const FINISH_FRAME = 0.5;
/** Time constant in seconds of the group distance, so the zoom changes slowly (at most 0.05 m within a second) */
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
/** Weight in the group centre of a marble past its `activeUntil`, `FINISHED_WEIGHT` in `camera.py` */
const FINISHED_WEIGHT = 0.001;
/** The opening frames the release points and up to this many of the first struck pieces */
const OPENING_PIECES = 3;
/** Seconds after the first hit over which the opening frame eases into the follow */
const OPENING_EASE = 1.5;
/** Steps that centre the opening box in the image */
const OPENING_STEPS = 3;
/**
 * The opening box fits within this share of the readable maximum, as its marbles fall while it holds: Two Marbles'
 * box needs 0.96 of it and lost both marbles at the top of its first frame
 */
const OPENING_ROOM = 0.85;
/**
 * A marble the camera does not lead stays inside EDGE_IN of the half frame (10 % of the frame from its edge) or
 * beyond EDGE_OUT (fully out); in between it would sit cut at the edge, so the frame shifts it in or out
 */
const EDGE_IN = 0.8;
const EDGE_OUT = 1.15;
/** A marble that cannot be kept in is pushed out only once it comes this close to the edge (6 % of the frame) */
const EDGE_NEAR = 0.88;
/** The leading marble stays within this fraction of the half frame when the frame shifts for another */
const LEADER_KEEP = 0.8;
/** Below this share of the leading marble the frame is panning between marbles, which sets the pace alone */
const LEAD_SETTLED = 0.75;
/** Seconds over which the frame shifts a marble in or out at the edge */
const EDGE_EASE = 0.45;
/** Seconds around each frame over which the largest shift a marble needs at the edge holds */
const EDGE_HOLD = 0.5;
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
	const settings = settingsFrom(input.camera, input.pieceLength, input.opening ?? null);
	const marbles = input.marbles;
	const frameEnd = Math.max(1, Math.ceil(input.duration * fps - 1e-6));
	const count = frameEnd + 1;
	const times = new Float64Array(count);
	for (let index = 0; index < count; index++) times[index] = index / fps;
	const aspect = renderAspect(input.frame);
	// The group's size in frame depends on where the camera looks from and at: a first pass with the camera straight
	// and sized around the group's centre gives the run direction and the smoothed target that size the second
	const straight = groupFraming(
		marbles,
		times,
		settings,
		fps,
		aspect,
		new Float64Array(count),
		null
	);
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
	const { side, roll } = viewTurn(times, smoothHeading, framing.roll, settings.hold, settings.sway);
	// Seen through this view, the marble the camera leads stays in and another goes fully in or fully out, never cut at the edge
	if (framing.shares != null) {
		const axes = Array.from(times, (_, index) =>
			viewAxes(side[index] ?? 0, roll[index] ?? 0, settings.pitch)
		);
		keepClearOfEdges(
			marbles,
			times,
			framing.sample,
			[targetX, targetY],
			distance,
			axes,
			framing.shares,
			settings.lens,
			aspect,
			fps
		);
	}

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
		pieceLength: typicalPieceLength(description.pieces),
		opening: openingPieces(description.pieces),
		marbles: description.marbles.map((marble) => ({
			id: marble.id,
			radius: marble.radius,
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
	/** Median bar or blade length, `typical_piece_length` in `scene.py` */
	pieceLength: number | null;
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
	sway: number;
	lens: number;
	shots: { time: number; roll: number; distance: number; length: number | null }[];
	focus: string | null;
	/** Time of the run's last hit, after which the camera holds on it; null follows to the end */
	hold: number | null;
	/** Mean mouth of the Finishes the held ending frames, or null */
	finish: [number, number] | null;
	descent: { time: Float64Array; y: Float64Array } | null;
	pieceLength: number | null;
	opening: TOpeningPiece[] | null;
}

interface TFraming {
	current: [Float64Array, Float64Array];
	ahead: [Float64Array, Float64Array];
	depth: number;
	distance: Float64Array;
	/** Shot roll per frame */
	roll: Float64Array;
	/** Times the marbles are read at, the film time up to the hold */
	sample: Float64Array;
	/** Per marble with motion, its share of the follow point where the group does not fit; null for one marble */
	shares: Float64Array[] | null;
	/** How much of the fall lead applies per frame: none while a group is framed */
	fallScale: Float64Array;
}

function settingsFrom(
	camera: TSceneCamera,
	pieceLength: number | null,
	opening: TOpeningPiece[] | null
): TSettings {
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
		sway: number(camera.sway, 1.0, 0.0, 1.0),
		lens: LENS,
		shots,
		focus: camera.focusMarbleId ?? null,
		hold:
			typeof camera.holdAfter === 'number' && Number.isFinite(camera.holdAfter)
				? camera.holdAfter
				: null,
		finish: finishPoint(camera.holdFinish),
		descent:
			descent.length >= 2
				? {
						time: Float64Array.from(descent, (point) => point[0]),
						y: Float64Array.from(descent, (point) => point[1])
					}
				: null,
		pieceLength,
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

/** `view_turn`: side angle around the target and image roll per frame; sway scales all but the shots */
function viewTurn(
	times: Float64Array,
	heading: Float64Array,
	shotRoll: Float64Array,
	hold: number | null,
	sway: number
): { side: Float64Array; roll: Float64Array } {
	const side = new Float64Array(times.length);
	const roll = new Float64Array(times.length);
	for (let index = 0; index < times.length; index++) {
		const turn = heading[index] ?? 0;
		side[index] = Math.PI + sway * (SIDE_ANGLE - Math.PI + SIDE_FOLLOW * turn);
		roll[index] =
			sway * (clamp(ROLL_FOLLOW * turn, -ROLL_LIMIT, ROLL_LIMIT) + ROLL_DRIFT * Math.sin((2 * Math.PI * driftTime(times[index] ?? 0, hold)) / ROLL_PERIOD)) +
			(shotRoll[index] ?? 0);
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
	const turn = viewTurn(times, heading, roll, hold, settings.sway);
	// Sized around the smoothed target when the first pass gave one, else around the group's centre
	const axes = Array.from(times, (_, index) =>
		viewAxes(turn.side[index] ?? 0, turn.roll[index] ?? 0, settings.pitch)
	);
	const raw = spreadNeed(marbles, sample, aim ?? centre, settings.lens, turn, settings.pitch);
	// The opening frame widens the zoom to its pieces; whether the group fits still counts the marbles alone
	const opening = openingFrame(marbles, times, sample, settings, fps, axes, limit);
	const zoomNeed = raw.slice();
	if (opening != null) {
		for (let index = 0; index < count; index++) {
			const wanted = (opening.need[index] ?? 0) * (opening.weight[index] ?? 0);
			zoomNeed[index] = Math.max(zoomNeed[index] ?? 0, wanted);
		}
	}
	const need = held(held(zoomNeed, fps, GROUP_SPIKE / 2, 'median'), fps, 1.0, 'max');
	// A Wide shot widens the readable maximum by its scale, so the group it frames fits for longer; within it the
	// group is also sized around its own centre, as the first pass's target may still be on the leading marble
	const wide = scale.map((value) => Math.max(value, 1.0));
	const isWide = wide.some((value) => value > 1.0);
	const around =
		isWide && aim != null ? spreadNeed(marbles, sample, centre, settings.lens, turn, settings.pitch) : raw;
	const over = withoutShortRuns(
		Array.from(raw, (value, index) => {
			const fit = (wide[index] ?? 1) > 1.0 ? Math.min(value, around[index] ?? value) : value;
			return fit > limit * (wide[index] ?? 1);
		}),
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
	// A framed group has no room to lead one marble's fall; a close shot frames the leading marble alone
	const isGroup = marbles.filter(hasMotion).length > 1;
	const fallScale = new Float64Array(count);
	for (let index = 0; index < count; index++) {
		const push = clamp((1 - (scale[index] ?? 1)) / (1 - PUSH_FOCUS), 0.0, 1.0);
		fallScale[index] = isGroup ? 1.0 - (weight[index] ?? 0) * (1 - push) : 1.0;
	}
	// The zoom follows what the group needs up to the readable maximum and stays there where the group no longer
	// fits, slowly, so the frame neither pulls back to a survey nor jumps back in when it switches to one marble
	const groupDistance = need.map((value, index) => clamp(value, base, upper * (wide[index] ?? 1)));
	const distance = criticallyDamped(groupDistance, fps, DISTANCE_TAU);
	// A closer shot scales the automatic distance; a Wide shot stands at least its scale of the rig distance away and
	// as far as the group needs within its wider maximum
	for (let index = 0; index < count; index++) {
		const shot = scale[index] ?? 1;
		const framed = clamp(distance[index] ?? 0, base, upper * (wide[index] ?? 1));
		distance[index] = Math.max(framed * Math.min(shot, 1.0), base * shot);
	}
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
				centre[axis][index] = w * point + (1 - w) * (centre[axis][index] ?? 0);
				ahead[axis][index] = w * point + (1 - w) * (ahead[axis][index] ?? 0);
			}
		}
	}
	const shares = marbles.some(hasMotion) ? leadShares(marbles, sample, settings.focus, fps) : null;
	if (hold != null) {
		settle(centre, times, hold, settings.finish);
		settle(ahead, times, hold, settings.finish);
	}
	return { current: centre, ahead, depth, distance, roll, sample, shares, fallScale };
}

/**
 * `opening_frame`: until the first hit the camera frames the box around the marbles in flight and the first struck
 * pieces, so the film opens on the track rather than on marbles over an empty wall, and eases into the follow over
 * OPENING_EASE seconds after it. Returns the box centre, the distance the box needs and the weight of the opening per
 * frame; the weight eases to 0 where the box needs more than the readable maximum.
 */
function openingFrame(
	marbles: TFollowMarble[],
	times: Float64Array,
	sample: Float64Array,
	settings: TSettings,
	fps: number,
	axes: TAxes[],
	limit: number
): { point: [Float64Array, Float64Array]; need: Float64Array; weight: Float64Array } | null {
	const pieces = settings.opening;
	if (pieces == null || !pieces.length) return null;
	const first = Math.min(...pieces.map((piece) => piece.time));
	const count = times.length;
	const reach = (CAMERA_SENSOR / 2 / settings.lens) * GROUP_KEEP_Y;
	const reachX = (CAMERA_SENSOR / 2 / settings.lens) * GROUP_KEEP_X * ASPECT_GUESS;
	const moving = marbles.filter(hasMotion);
	const points = moving.map((marble) => marblePoint(marble, sample));
	const pointX = new Float64Array(count);
	const pointY = new Float64Array(count);
	const need = new Float64Array(count);
	const ramp = new Float64Array(count);
	const fits = new Float64Array(count).fill(1.0);
	for (let index = 0; index < count; index++) {
		ramp[index] = 1.0 - smoothstep(((times[index] ?? 0) - first) / OPENING_EASE);
		if ((ramp[index] ?? 0) <= 0) continue;
		const xs = pieces.map((piece) => piece.x);
		const ys = pieces.map((piece) => piece.y);
		// Marbles waiting at their release point count too, as the film shows them there
		moving.forEach((marble, which) => {
			if (!inside(marble, Math.max(sample[index] ?? 0, marble.motion.time[0] ?? 0))) return;
			xs.push(points[which]?.[0][index] ?? 0);
			ys.push(points[which]?.[1][index] ?? 0);
		});
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
				widest = Math.max(widest, along + Math.max(across / reachX, high / reach) * GROUP_MARGIN);
			});
			return widest;
		};
		// Centre the box in the image rather than on the wall: the steep view enlarges what lies near the camera
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
		fits[index] = widest <= limit * OPENING_ROOM ? 1.0 : 0.0;
	}
	const eased = criticallyDamped(fits, fps, GROUP_EASE / 3);
	const weight = new Float64Array(count);
	for (let index = 0; index < count; index++)
		weight[index] = clamp(eased[index] ?? 0, 0.0, 1.0) * (ramp[index] ?? 0);
	return { point: [pointX, pointY], need, weight };
}

/**
 * `keep_clear_of_edges`: a marble in flight or waiting at its release point stays inside EDGE_IN of the half frame or beyond EDGE_OUT, never cut at
 * the edge. The leading marble is kept in. Another marble keeps the side it came from while it swings through the
 * band between, a side lasts at least twice EDGE_HOLD, and it goes out wherever keeping it in would take the leading
 * marble past LEADER_KEEP; kept out, it is pushed only once within EDGE_NEAR of the edge. While the frame pans
 * between marbles (the leader arriving from beyond EDGE_OUT, or its share below LEAD_SETTLED while a marble arrives
 * from there) the pan sets
 * the pace alone, and from the hold on nothing shifts. Offsets are seen through the baked view from the look target.
 * The shift each marble needs is held at its largest over EDGE_HOLD seconds around each frame, so the frame stays put
 * while a marble swings near the edge, and eased over EDGE_EASE seconds. Adds the shift to the target in place.
 */
function keepClearOfEdges(
	marbles: TFollowMarble[],
	times: Float64Array,
	sample: Float64Array,
	target: [Float64Array, Float64Array],
	distance: Float64Array,
	axes: TAxes[],
	shares: Float64Array[],
	lens: number,
	aspect: number,
	fps: number
): void {
	const moving = marbles.filter(hasMotion);
	const count = sample.length;
	const points = moving.map((marble) => marblePoint(marble, sample));
	const halfLong = CAMERA_SENSOR / 2 / lens;
	const halfWidth = aspect < 1 ? halfLong * aspect : halfLong;
	const halfHeight = aspect < 1 ? halfLong : halfLong / aspect;
	/** Where an offset from the look target sits in the frame, in half frames (1 at the edge) */
	const place = (index: number, dx: number, dy: number): number => {
		const { right, up, toward } = axes[index] as TAxes;
		const spread = Math.max(
			Math.abs(dx * right[0] + dy * right[2]) / halfWidth,
			Math.abs(dx * up[0] + dy * up[2]) / halfHeight
		);
		const depth = (distance[index] ?? 0) - (dx * toward[0] + dy * toward[2]);
		return depth > 1e-6 ? spread / depth : Number.POSITIVE_INFINITY;
	};
	const leaders = new Int32Array(count);
	for (let index = 0; index < count; index++) {
		let leader = 0;
		shares.forEach((share, which) => {
			if ((share[index] ?? 0) > (shares[leader]?.[index] ?? 0)) leader = which;
		});
		leaders[index] = leader;
	}
	const offset = (which: number, index: number): [number, number] => [
		(points[which]?.[0][index] ?? 0) - (target[0][index] ?? 0),
		(points[which]?.[1][index] ?? 0) - (target[1][index] ?? 0)
	];
	const shortest = pyRound(2 * EDGE_HOLD * fps);
	const shiftX = new Float64Array(count);
	const shiftY = new Float64Array(count);
	// Where each marble sits in the frame, and whether it is arriving: it was beyond EDGE_OUT and has not yet come
	// inside EDGE_IN, as while the frame pans to it from afar
	// A marble waiting at its release point is in the film too
	const isFollowing = (marble: TFollowMarble, index: number): boolean =>
		inside(marble, Math.max(sample[index] ?? 0, marble.motion.time[0] ?? 0)) &&
		(times[index] ?? 0) <= (sample[index] ?? 0) + 1e-9;
	const placesOf = moving.map(() => new Float64Array(count));
	const arrivingOf = moving.map(() => new Uint8Array(count));
	moving.forEach((marble, which) => {
		let isArriving = false;
		for (let index = 0; index < count; index++) {
			if (!isFollowing(marble, index)) continue;
			const now = place(index, ...offset(which, index));
			(placesOf[which] as Float64Array)[index] = now;
			if (now > EDGE_OUT && moving.length > 1) isArriving = true;
			else if (now <= EDGE_IN) isArriving = false;
			(arrivingOf[which] as Uint8Array)[index] = isArriving ? 1 : 0;
		}
	});
	moving.forEach((marble, which) => {
		// Per frame +1 kept in, -1 kept out, 0 free, and how far in half frames it moves to get there
		const side = new Int8Array(count);
		const amount = new Float64Array(count);
		const places = placesOf[which] as Float64Array;
		let isInside = true;
		for (let index = 0; index < count; index++) {
			if (!isFollowing(marble, index)) continue;
			const now = places[index] ?? 0;
			// While the frame pans between marbles every marble moves at the pan's pace
			const leader = leaders[index] ?? 0;
			const isFar = arrivingOf.some((arriving) => arriving[index] === 1);
			if (
				arrivingOf[leader]?.[index] === 1 ||
				(isFar && (shares[leader]?.[index] ?? 0) < LEAD_SETTLED)
			) {
				isInside = now <= EDGE_IN || (isInside && now < EDGE_OUT);
				continue;
			}
			if (which === leader || now <= EDGE_IN) isInside = true;
			else if (now >= EDGE_OUT) isInside = false;
			side[index] = isInside ? 1 : -1;
		}
		const isLed = (index: number): boolean => leaders[index] === which;
		// A side held for less than twice EDGE_HOLD keeps the side before it
		let start = 0;
		for (let index = 1; index <= count; index++) {
			if (index < count && side[index] === side[start]) continue;
			const before = start > 0 ? (side[start - 1] ?? 0) : 0;
			if (before !== 0 && side[start] !== 0 && index - start < shortest) {
				for (let frame = start; frame < index; frame++) if (!isLed(frame)) side[frame] = before;
			}
			start = index;
		}
		const measure = (): void => {
			for (let index = 0; index < count; index++) {
				const now = Number.isFinite(places[index] ?? 0) ? (places[index] ?? 0) : 0.0;
				// A marble kept out is pushed only where it comes within EDGE_NEAR of the edge; further inside, as when the
				// frame meets it head on or it has room short of the safe area, it is left free
				amount[index] =
					side[index] === 1
						? Math.max(now - EDGE_IN, 0.0)
						: side[index] === -1 && now >= EDGE_NEAR
							? Math.max(EDGE_OUT - now, 0.0)
							: 0.0;
			}
		};
		measure();
		// Kept in only while the leading marble stays within LEADER_KEEP with the shift held as it will be; around a
		// frame where it would not, the marble goes out
		const heldIn = held(
			amount.map((value, index) => (side[index] === 1 ? value : 0.0)),
			fps,
			EDGE_HOLD,
			'max'
		);
		const isTooFar = new Float64Array(count);
		for (let index = 0; index < count; index++) {
			const leader = leaders[index] ?? 0;
			const now = places[index] ?? 0;
			if (side[index] !== 1 || isLed(index) || now <= 1e-9 || !Number.isFinite(now)) continue;
			if (!isFollowing(moving[leader] as TFollowMarble, index)) continue;
			const [dx, dy] = offset(which, index);
			const shift = (heldIn[index] ?? 0) / now;
			const [leaderX, leaderY] = offset(leader, index);
			if (place(index, leaderX - shift * dx, leaderY - shift * dy) > LEADER_KEEP)
				isTooFar[index] = 1.0;
		}
		const isOut = held(isTooFar, fps, EDGE_HOLD, 'max');
		for (let index = 0; index < count; index++)
			if ((isOut[index] ?? 0) > 0 && side[index] === 1 && !isLed(index)) side[index] = -1;
		measure();
		const keepIn = held(
			amount.map((value, index) => (side[index] === 1 ? value : 0.0)),
			fps,
			EDGE_HOLD,
			'max'
		);
		const keepOut = held(
			amount.map((value, index) => (side[index] === -1 ? value : 0.0)),
			fps,
			EDGE_HOLD,
			'max'
		);
		for (let index = 0; index < count; index++) {
			const now = places[index] ?? 0;
			if (side[index] === 0 || now <= 1e-9 || !Number.isFinite(now)) continue;
			const [dx, dy] = offset(which, index);
			// Moving the target by `shift` of the offset moves the marble that many of its half frames
			const shift = side[index] === 1 ? (keepIn[index] ?? 0) / now : -(keepOut[index] ?? 0) / now;
			shiftX[index] = (shiftX[index] ?? 0) + shift * dx;
			shiftY[index] = (shiftY[index] ?? 0) + shift * dy;
		}
	});
	const smoothX = criticallyDamped(shiftX, fps, EDGE_EASE / 3);
	const smoothY = criticallyDamped(shiftY, fps, EDGE_EASE / 3);
	for (let index = 0; index < count; index++) {
		target[0][index] = (target[0][index] ?? 0) + (smoothX[index] ?? 0);
		target[1][index] = (target[1][index] ?? 0) + (smoothY[index] ?? 0);
	}
}

/** `finish_point`: the mean wall point of the Finishes the held ending frames, or null */
function finishPoint(points: TSceneCamera['holdFinish']): [number, number] | null {
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
 * over the HOLD_SPAN seconds before it, so the last frames show the final pieces; with `finish`, the Finishes' mean
 * mouth, to FINISH_FRAME of the way from the last hit's point to it, so the frame shows the catch. Changes the arrays
 * in place.
 */
function settle(points: [Float64Array, Float64Array], times: Float64Array, hold: number, finish: [number, number] | null): void {
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
		const mean = finish != null ? from + (finish[axis] - from) * FINISH_FRAME : (middle[axis] ?? 0) / count;
		for (let index = 0; index < times.length; index++) {
			const weight = smoothstep(((times[index] ?? 0) - hold) / HOLD_EASE);
			points[axis][index] = (points[axis][index] ?? 0) * (1 - weight) + mean * weight;
		}
	}
}

/**
 * `fall_lead`: how far below the follow point the camera looks while it falls. Above FALL_START metres per second
 * the frame leads by FALL_AHEAD seconds of the extra speed, at most FALL_LIMIT of the camera distance, eased over
 * FALL_EASE seconds, so a falling marble sits above the centre with the pieces it falls toward in frame. Over the
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
