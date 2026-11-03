"""Follow camera baked from the marble motion.

The camera looks steeply along the wall and travels with the marbles, like the reference short:

1. Follow point per frame. With several marbles the camera frames the group while it fits: the follow point is
   the weighted centre of the marbles in flight (a marble weighs 1 while its samples cover the time and 0.05 before
   its release or after its last sample) and the distance widens so every marble fits. When a shared descent curve
   is given (`descent`, the common pace y*(t) of the lanes) the group centre's height follows it instead. The
   distance never exceeds a readable maximum: pieces stay at least MIN_PIECE_FRACTION of the frame width and the
   camera at most ZOOM_LIMIT times its set distance. Where the group no longer fits within that maximum, the camera
   eases over to the focus marble (`focusMarbleId`, else the first marble, which carries the melody lane) and
   lets the others leave the frame.
2. Target: the follow point moved toward where it is at `t + lead` (at most LEAD_LIMIT * distance), smoothed with a
   zero-phase critically damped filter (a forward and a backward pass of a second-order filter with time constant
   0.04 + 0.5 * smoothing seconds), so the camera neither lags nor overshoots. Where smoothing still lets a marble
   drift toward the frame edge (free falls accelerate), the target is pulled along.
3. Placement: the camera stands `distance` from the target at `pitch` from the wall normal, above and to the side
   of the run (SIDE_ANGLE from straight below, following the run direction by SIDE_FOLLOW). Seen from there the
   bars show their long sides and tops, the wall recedes like a floor and the two columns run diagonally.
4. Roll: image up is the wall's up direction turned by a slow function of the run direction plus a slow drift
   (ROLL_DRIFT over ROLL_PERIOD), so the columns turn between diagonal and near vertical. Shot markers add roll and
   set the distance with eased transitions.

5. Loop: in a loop scene the last `blend` seconds blend into the poses one loop length earlier, which are baked
   from before the loop start, so the camera at the loop end is the camera at the loop start. Loop ghosts are not
   followed.

Everything is baked as keyframes on the studio camera (location, rotation, focus distance), so the camera works in
plain Blender. A camera the user edited is taken over and never regenerated unless the app asks.
"""
import math

import bpy
import numpy as np
from mathutils import Euler, Matrix, Vector

from . import anim
from .util import MARBLE_WALL_GAP

# Image roll per radian of run direction, its limit, and a slow drift that turns the columns between diagonal and
# near vertical like the reference
ROLL_FOLLOW = 0.5
ROLL_LIMIT = math.radians(40)
ROLL_DRIFT = math.radians(16)
ROLL_PERIOD = 14.0
# Where the camera stands around the target on the wall: 0 straight below, positive to the right
SIDE_ANGLE = math.radians(150)
SIDE_FOLLOW = 0.3
HEADING_TAU = 1.5
# The lead may move the target at most this fraction of the camera distance ahead of the marble
LEAD_LIMIT = 0.04
# Fraction of the half frame the marble may move away from the target before the camera is pulled along
FRAME_KEEP = 0.55
# Width over height of the framing box; portrait films are 9:16
ASPECT_GUESS = 0.56
SHOT_EASE = 0.8
LENS = 50.0
# Readable maximum distance: a typical piece spans at least this fraction of the frame width, and the camera never
# pulls back further than ZOOM_LIMIT times its set distance
MIN_PIECE_FRACTION = 0.06
ZOOM_LIMIT = 3.0
# Fraction of the half frame width a framed group may use; side-by-side lanes may come closer to the sides than a
# followed marble, which the camera keeps nearer the centre (FRAME_KEEP)
GROUP_KEEP_X = 0.75
# Fraction of the half frame height a framed group may use. Looser than FRAME_KEEP so one marble's bounce does not
# pull the camera back. A Jingle Bells test with 0.8 here and 0.85 for the width grew bars from about 16 % to 23–25 %
# of the frame width; the width stays at 0.75 because 0.85 let a rolled camera crop a marble
GROUP_KEEP_Y = 0.8
SENSOR = 36.0
# Seconds over which the camera eases between framing the group and following the focus marble
GROUP_EASE = 1.2
# A group that needs more than the readable distance for less than this many seconds stays framed
GROUP_SPIKE = 0.3
# A view ray that misses the wall counts this many camera heights away when sizing the wall
FAR_REACH = 12.0
CAMERA_PATHS = ('location', 'rotation_euler')
CAMERA_DATA_PATHS = ('dof.focus_distance',)
SIGNATURE_VERSION = 2


def settings_from(description_camera, theme_settings):
    camera = description_camera or {}

    def number(name, fallback, low, high):
        value = camera.get(name, fallback)
        if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
            return fallback
        return min(high, max(low, float(value)))

    shots = []
    for shot in camera.get('shots') or []:
        try:
            shots.append({
                'time': float(shot['time']),
                'kind': str(shot.get('kind', 'follow')),
                'roll': float(shot.get('roll', 0.0)),
                'distance': max(0.05, float(shot.get('distance', camera.get('distance', 0.6)))),
            })
        except (KeyError, TypeError, ValueError):
            continue
    shots.sort(key=lambda shot: shot['time'])
    return {
        'mode': camera.get('mode', 'rig'),
        'distance': number('distance', 0.6, 0.05, 20.0),
        'pitch': number('pitch', 0.7, 0.0, 1.45),
        'lead': number('lead', 0.15, 0.0, 2.0),
        'smoothing': number('smoothing', 0.6, 0.0, 1.0),
        'lens': number('lens', LENS, 10.0, 300.0),
        'shots': shots,
        'fstop': float(theme_settings.get('fstop', 4.0)),
        'focus': camera.get('focusMarbleId') if isinstance(camera.get('focusMarbleId'), str) else None,
        'descent': descent_curve(camera.get('descent')),
        # Typical piece length on the wall; `apply_scene` sets it from the pieces
        'pieceLength': None,
    }


def descent_curve(value):
    """Shared descent pace as an (n, 2) array of [time, y] sorted by time, or None"""
    if not isinstance(value, list):
        return None
    points = []
    for point in value:
        try:
            time_value, y = float(point['time']), float(point['y'])
        except (KeyError, TypeError, ValueError):
            continue
        if math.isfinite(time_value) and math.isfinite(y):
            points.append((time_value, y))
    if len(points) < 2:
        return None
    points.sort()
    return np.array(points)


def width_per_metre(lens, aspect):
    """Frame width per metre of camera distance; the sensor spans the longer image side"""
    return SENSOR * min(aspect, 1.0) / lens


def readable_distance(settings, aspect):
    """Largest distance at which the run still reads"""
    limit = settings['distance'] * ZOOM_LIMIT
    piece = settings.get('pieceLength')
    if piece:
        limit = min(limit, piece / (MIN_PIECE_FRACTION * width_per_metre(settings['lens'], aspect)))
    return max(limit, settings['distance'])


def follow_points(marbles, motions, times):
    """Weighted centre of the marbles at each time; returns an (n, 2) array and the depth of the marble plane"""
    total = np.zeros((len(times), 2))
    weights = np.zeros(len(times))
    depth = 0.0
    for marble in marbles:
        motion = motions.get(marble['id'])
        if motion is None or not len(motion):
            continue
        x = np.interp(times, motion[:, 0], motion[:, 1])
        y = np.interp(times, motion[:, 0], motion[:, 2])
        inside = (times >= motion[0, 0] - 1e-9) & (times <= motion[-1, 0] + 1e-9)
        weight = np.where(inside, 1.0, 0.05)
        total[:, 0] += x * weight
        total[:, 1] += y * weight
        weights += weight
        depth = max(depth, float(marble['radius']) + MARBLE_WALL_GAP)
    if not weights.any():
        return None, depth
    return total / weights[:, None], depth


def marble_point(marble, motions, times):
    motion = motions.get(marble['id'])
    if motion is None or not len(motion):
        return None
    return np.stack([np.interp(times, motion[:, 0], motion[:, 1]), np.interp(times, motion[:, 0], motion[:, 2])], axis=1)


def focus_marble(marbles, motions, focus):
    """The marble the camera keeps when the group does not fit: the chosen one, else the first with motion"""
    moving = [marble for marble in marbles if motions.get(marble['id']) is not None and len(motions[marble['id']])]
    chosen = next((marble for marble in moving if marble['id'] == focus), None)
    return chosen or (moving[0] if moving else None)


def in_flight_count(marbles, motions, times):
    count = np.zeros(len(times))
    for marble in marbles:
        motion = motions.get(marble['id'])
        if motion is not None and len(motion):
            count += (times >= motion[0, 0] - 1e-9) & (times <= motion[-1, 0] + 1e-9)
    return count


def spread_need(marbles, motions, times, centre, lens):
    """Distance at which every marble in flight stays inside the framing box around the centre, per frame"""
    reach = SENSOR / 2 / lens * GROUP_KEEP_Y
    reach_x = SENSOR / 2 / lens * GROUP_KEEP_X * ASPECT_GUESS
    required = np.zeros(len(times))
    for marble in marbles:
        motion = motions.get(marble['id'])
        if motion is None or not len(motion):
            continue
        inside = (times >= motion[0, 0] - 1e-9) & (times <= motion[-1, 0] + 1e-9)
        dx = np.abs(np.interp(times, motion[:, 0], motion[:, 1]) - centre[:, 0])
        dy = np.abs(np.interp(times, motion[:, 0], motion[:, 2]) - centre[:, 1])
        need = np.maximum(dx / reach_x, dy / reach) * 1.1
        required = np.maximum(required, np.where(inside, need, 0.0))
    return required


def paced_height(marbles, motions, times, centre_y, descent):
    """The group's height from the shared descent pace, which has no per-lane bounces. It applies while several
    marbles are in flight within the curve's time range, and stays within a quarter of the marbles' vertical spread
    from their midpoint, so a lane that briefly falls ahead does not pull the frame off the group."""
    heights = [np.interp(times, motion[:, 0], motion[:, 2]) for motion in
               (motions.get(marble['id']) for marble in marbles) if motion is not None and len(motion)]
    if len(heights) < 2:
        return centre_y
    low, high = np.min(heights, axis=0), np.max(heights, axis=0)
    middle, quarter = (low + high) / 2, (high - low) / 4
    paced = np.clip(np.interp(times, descent[:, 0], descent[:, 1]), middle - quarter, middle + quarter)
    covered = (times >= descent[0, 0]) & (times <= descent[-1, 0]) & (in_flight_count(marbles, motions, times) >= 2)
    return np.where(covered, paced, centre_y)


def without_short_runs(flags, shortest):
    """`flags` with every run of True shorter than `shortest` samples cleared"""
    result = flags.copy()
    start = None
    for index, flag in enumerate(list(flags) + [False]):
        if flag and start is None:
            start = index
        elif not flag and start is not None:
            if index - start < shortest:
                result[start:index] = False
            start = None
    return result


def held(values, fps, seconds, reduce=np.max):
    """`reduce` of the values within `seconds` around each frame, such as the widest zoom need of the last second"""
    window = max(1, int(round(fps * seconds)))
    padded = np.concatenate([np.full(window, values[0]), values, np.full(window, values[-1])])
    return np.array([reduce(padded[index:index + 2 * window + 1]) for index in range(len(values))])


def group_framing(marbles, motions, times, settings, fps, aspect):
    """Follow points (current and `lead` ahead), distance and shot roll per time, or None without motion.

    A group weight is 1 while the group fits the readable maximum and eases to 0 where the camera follows the focus
    marble alone; it blends both the follow point and the distance."""
    centre, depth = follow_points(marbles, motions, times)
    ahead, _ = follow_points(marbles, motions, times + settings['lead'])
    if centre is None:
        return None
    descent = settings.get('descent')
    if descent is not None:
        centre[:, 1] = paced_height(marbles, motions, times, centre[:, 1], descent)
        ahead[:, 1] = paced_height(marbles, motions, times + settings['lead'], ahead[:, 1], descent)
    base, shot_roll = shot_values(times, settings['distance'], settings['shots'])
    limit = readable_distance(settings, aspect)
    raw = spread_need(marbles, motions, times, centre, settings['lens'])
    # Hold the widest need for a second so the zoom does not breathe with every bounce; a running median first drops
    # momentary spikes, such as one marble's bounce peak, that the frame margins absorb
    need = held(held(raw, fps, GROUP_SPIKE / 2, np.median), fps, 1.0)
    # The group stops fitting where it would need more than the readable distance for longer than GROUP_SPIKE (the
    # frame margins absorb a shorter excursion); the camera then leaves it a second early, so it is on the focus
    # marble when the zoom would top out, and returns only when the group fits again for two seconds
    over = without_short_runs(raw > limit, int(round(GROUP_SPIKE * fps)))
    fits = 1.0 - held(over.astype(np.float64), fps, 1.0)
    weight = critically_damped(fits[:, None], fps, GROUP_EASE / 3)[:, 0]
    weight = np.clip(weight, 0.0, 1.0)
    group_distance = np.clip(need, base, np.maximum(base, limit))
    distance = critically_damped((base + weight * (group_distance - base))[:, None], fps, 0.5)[:, 0]
    distance = np.minimum(distance, np.maximum(base, limit))
    focus = focus_marble(marbles, motions, settings.get('focus'))
    if focus is not None and len(marbles) > 1:
        focus_now = marble_point(focus, motions, times)
        focus_ahead = marble_point(focus, motions, times + settings['lead'])
        centre = weight[:, None] * centre + (1 - weight[:, None]) * focus_now
        ahead = weight[:, None] * ahead + (1 - weight[:, None]) * focus_ahead
    return {'current': centre, 'ahead': ahead, 'depth': depth, 'distance': distance, 'roll': shot_roll}


def critically_damped(values, fps, tau):
    """Zero-phase smoothing: a critically damped second-order filter run forward then backward"""
    if tau <= 0 or len(values) < 3:
        return values.copy()
    omega = 1.0 / tau
    dt = 1.0 / fps

    def run(series):
        out = np.empty_like(series)
        position = series[0].copy()
        velocity = np.zeros_like(position)
        steps = 4
        h = dt / steps
        for index in range(len(series)):
            for _ in range(steps):
                acceleration = omega * omega * (series[index] - position) - 2 * omega * velocity
                velocity = velocity + acceleration * h
                position = position + velocity * h
            out[index] = position
        return out

    # Pad both ends with linear extrapolation so the filter does not drag the ends toward a standing start
    pad = min(len(values) - 1, max(2, int(3 * tau * fps)))
    start_velocity = values[1] - values[0]
    end_velocity = values[-1] - values[-2]
    before = values[0] - start_velocity * np.arange(pad, 0, -1)[:, None]
    after = values[-1] + end_velocity * np.arange(1, pad + 1)[:, None]
    padded = np.concatenate([before, values, after])
    forward = run(padded)
    return run(forward[::-1])[::-1][pad:pad + len(values)]


def shot_values(times, base_distance, shots):
    """Distance and extra roll per time from shot markers, eased over SHOT_EASE seconds after each marker"""
    distance = np.full(len(times), base_distance)
    roll = np.zeros(len(times))
    previous_distance, previous_roll = base_distance, 0.0
    for shot in shots:
        progress = np.clip((times - shot['time']) / SHOT_EASE, 0.0, 1.0)
        eased = progress * progress * (3 - 2 * progress)
        after = times >= shot['time']
        distance = np.where(after, previous_distance + (shot['distance'] - previous_distance) * eased, distance)
        roll = np.where(after, previous_roll + (shot['roll'] - previous_roll) * eased, roll)
        previous_distance, previous_roll = shot['distance'], shot['roll']
    return distance, roll


def look_rotation(position, target, up):
    forward = (target - position).normalized()
    right = forward.cross(up)
    if right.length < 1e-8:
        right = forward.cross(Vector((0.0, -1.0, 0.0)))
    right.normalize()
    camera_up = right.cross(forward).normalized()
    # Camera axes: x right, y up, looking along -z
    basis = Matrix((right, camera_up, -forward)).transposed()
    return basis.to_quaternion()


def bake(scene, camera, settings, marbles, motions, fps):
    """Writes the follow keyframes; returns the number of frames baked or 0 when there is no motion"""
    # Loop ghosts replay a marble's entry for the next round; the camera reaches them through the loop blend
    marbles = [marble for marble in marbles if not marble.get('ghostOf')]
    loop = settings.get('loop')
    first_frame = scene.frame_start
    if loop:
        # Poses from before the loop start are the blend targets of the loop end
        first_frame = min(first_frame, math.floor((loop['start'] - loop['blend']) * fps) - 1)
    frames = np.arange(first_frame, scene.frame_end + 1, dtype=np.float64)
    times = frames / fps
    aspect = scene.render.resolution_x / max(1, scene.render.resolution_y)
    framing = group_framing(marbles, motions, times, settings, fps, aspect)
    if framing is None:
        return 0
    current, ahead_points, depth = framing['current'], framing['ahead'], framing['depth']
    distance, shot_roll = framing['distance'], framing['roll']
    # Lead the marble, but never so far that it leaves the upper part of the frame on fast drops
    lead_offset = ahead_points - current
    lead_length = np.linalg.norm(lead_offset, axis=1)
    limit = LEAD_LIMIT * distance
    scale = np.where(lead_length > limit, limit / np.maximum(lead_length, 1e-9), 1.0)
    follow = current + lead_offset * scale[:, None]
    tau = 0.04 + 0.5 * settings['smoothing']
    target = critically_damped(follow, fps, tau)
    # Smoothing averages accelerating motion such as a free fall, so the target can fall behind; pull it back
    # wherever the marble would leave the inner part of the frame, then smooth the correction lightly
    reach = distance * SENSOR / 2 / settings['lens'] * FRAME_KEEP
    for _ in range(8):
        offset = current - target
        excess = np.maximum(np.abs(offset) - reach[:, None] * np.array([ASPECT_GUESS, 1.0]), 0.0) * np.sign(offset)
        if not np.any(excess):
            break
        target = target + critically_damped(excess, fps, 0.08) * 1.3
    # Safety net for extreme motion: never let a marble leave the frame
    offset = current - target
    hard = reach[:, None] * np.array([ASPECT_GUESS, 1.0]) * 1.5
    target = target + np.maximum(np.abs(offset) - hard, 0.0) * np.sign(offset)
    # Run direction from the smoothed target over one second, then smoothed again for slow heading changes
    window = max(1, int(round(0.5 * fps)))
    ahead = np.vstack([target[window:], np.repeat(target[-1:], window, axis=0)])
    behind = np.vstack([np.repeat(target[:1], window, axis=0), target[:-window]])
    direction = ahead - behind
    moving = np.linalg.norm(direction, axis=1) > 1e-4
    heading = np.where(moving, np.arctan2(direction[:, 0], -direction[:, 1]), 0.0)
    heading = critically_damped(np.clip(heading, -math.pi / 2, math.pi / 2)[:, None], fps, HEADING_TAU)[:, 0]
    # The camera stands below and to the side of the target, looking up along the run; the side follows the run
    # direction so the view keeps looking along it, and the image rolls slowly on its own and with the run
    side = SIDE_ANGLE + SIDE_FOLLOW * heading
    roll = np.clip(ROLL_FOLLOW * heading, -ROLL_LIMIT, ROLL_LIMIT) + ROLL_DRIFT * np.sin(2 * math.pi * times / ROLL_PERIOD) + shot_roll

    pitch = settings['pitch']
    locations = np.empty((len(frames), 3))
    rotations = np.empty((len(frames), 3))
    focus = np.empty(len(frames))
    previous = None
    out = Vector((0.0, -1.0, 0.0))
    for index in range(len(frames)):
        foot = Vector((math.sin(side[index]), 0.0, -math.cos(side[index])))
        up = Vector((-math.sin(roll[index]), 0.0, math.cos(roll[index])))
        aim = Vector((target[index, 0], -depth, target[index, 1]))
        position = aim + (foot * math.sin(pitch) + out * math.cos(pitch)) * distance[index]
        rotation = look_rotation(position, aim, up)
        euler = rotation.to_euler('XYZ', previous) if previous else rotation.to_euler('XYZ')
        previous = euler
        locations[index] = position
        rotations[index] = tuple(euler)
        marble = Vector((current[index, 0], -depth, current[index, 1]))
        focus[index] = (marble - position).length
    if loop:
        close_loop(frames, locations, rotations, focus, loop, fps)
    kept = frames >= scene.frame_start
    frames, locations, rotations, focus = frames[kept], locations[kept], rotations[kept], focus[kept]

    camera.rotation_mode = 'XYZ'
    channelbag = anim.ensure_channelbag(camera)
    anim.clear_channels(camera, CAMERA_PATHS)
    for axis in range(3):
        anim.write_fcurve(channelbag, 'location', axis, frames, locations[:, axis])
        anim.write_fcurve(channelbag, 'rotation_euler', axis, frames, rotations[:, axis])
    data = camera.data
    data.type = 'PERSP'
    data.lens = settings['lens']
    data.sensor_fit = 'AUTO'
    data.sensor_width = 36.0
    data.clip_start = 0.01
    data.clip_end = 100.0
    data.dof.use_dof = settings['fstop'] > 0
    data.dof.aperture_fstop = max(settings['fstop'], 0.5)
    data.dof.focus_object = None
    data_bag = anim.ensure_channelbag(data, 'MM · camera lens')
    anim.clear_channels(data, CAMERA_DATA_PATHS)
    anim.write_fcurve(data_bag, 'dof.focus_distance', 0, frames, focus)
    write_shot_markers(scene, settings['shots'], fps)
    return len(frames)


def view_footprint(scene, camera, step=3):
    """Wall area the camera sees over the scene range as ((min_x, min_z), (max_x, max_z)), or None.

    The frame's corner rays are intersected with the wall plane (Blender y = 0). A ray that grazes or misses the wall
    counts up to FAR_REACH camera heights away, so a steep view still gets a wall up to a sensible depth. Poses come
    from the camera's location and rotation F-curves, so baked, edited and static cameras all work."""
    if camera is None or camera.type != 'CAMERA':
        return None
    curves = {}
    if camera.animation_data is not None and camera.animation_data.action is not None:
        from bpy_extras import anim_utils
        channelbag = anim_utils.animdata_get_channelbag_for_assigned_slot(camera.animation_data)
        for fcurve in (channelbag.fcurves if channelbag else []):
            if fcurve.data_path in CAMERA_PATHS:
                curves[(fcurve.data_path, fcurve.array_index)] = fcurve
    corners = [Vector(corner) for corner in camera.data.view_frame(scene=scene)]
    ortho = camera.data.type == 'ORTHO'
    xs, zs = [], []
    for frame in range(scene.frame_start, scene.frame_end + 1, max(1, step)):
        location = Vector([curves[('location', axis)].evaluate(frame) if ('location', axis) in curves
                           else camera.location[axis] for axis in range(3)])
        if len(camera.rotation_mode) == 3:
            rotation = Euler([curves[('rotation_euler', axis)].evaluate(frame) if ('rotation_euler', axis) in curves
                              else camera.rotation_euler[axis] for axis in range(3)], camera.rotation_mode).to_matrix()
        else:
            rotation = camera.matrix_world.to_3x3().normalized()
        height = max(abs(location.y), 1e-3)
        for corner in corners:
            if ortho:
                origin = location + rotation @ Vector((corner.x, corner.y, 0.0))
                direction = rotation @ Vector((0.0, 0.0, -1.0))
            else:
                origin, direction = location, (rotation @ corner).normalized()
            # The wall is the plane y = 0 and the camera stands in front of it at y < 0
            reach = FAR_REACH * height
            if direction.y > 1e-6:
                reach = min(reach, -origin.y / direction.y)
            point = origin + direction * reach
            xs.append(point.x)
            zs.append(point.z)
    if not xs:
        return None
    return (min(xs), min(zs)), (max(xs), max(zs))


def close_loop(frames, locations, rotations, focus, loop, fps):
    """Blends the poses of the last `blend` seconds into the poses one loop length earlier, with a smoothstep
    weight, so the frame at the loop end repeats the first frame and the motion continues smoothly across the seam.
    Rotations are blended as quaternions. Changes the arrays in place."""
    shift = int(round((loop['end'] - loop['start']) * fps))
    blend_start = loop['end'] - loop['blend']
    previous = None
    for index, frame in enumerate(frames):
        source = index - shift
        if frame / fps < blend_start - 1e-9 or source < 0:
            previous = Euler(rotations[index])
            continue
        progress = 1.0 if loop['blend'] <= 0 else min(1.0, (frame / fps - blend_start) / loop['blend'])
        weight = progress * progress * (3 - 2 * progress)
        locations[index] = locations[index] * (1 - weight) + locations[source] * weight
        focus[index] = focus[index] * (1 - weight) + focus[source] * weight
        rotation = Euler(rotations[index]).to_quaternion().slerp(Euler(rotations[source]).to_quaternion(), weight)
        euler = rotation.to_euler('XYZ', previous) if previous else rotation.to_euler('XYZ')
        rotations[index] = tuple(euler)
        previous = euler


def write_shot_markers(scene, shots, fps):
    """Shot markers on the timeline, named `MM · <kind>`; markers the user made stay"""
    for marker in list(scene.timeline_markers):
        if marker.name.startswith('MM · '):
            scene.timeline_markers.remove(marker)
    for shot in shots:
        scene.timeline_markers.new('MM · ' + shot['kind'], frame=int(round(shot['time'] * fps)))


def signature(camera):
    """Fingerprint of what the app last wrote to the camera, including its keyframes"""
    data = camera.data
    keys = anim.keyframe_signature(camera, CAMERA_PATHS)
    values = [SIGNATURE_VERSION, data.type, round(data.lens, 4), round(data.ortho_scale, 6),
              *keys, *anim.keyframe_signature(data, CAMERA_DATA_PATHS)]
    if not keys[1]:
        values += [round(value, 6) for value in (*camera.location, *camera.rotation_euler)]
    return values


def clear(camera):
    """Removes the rig keyframes so the camera can be framed statically again"""
    anim.clear_channels(camera, CAMERA_PATHS)
    if camera.data is not None:
        anim.clear_channels(camera.data, CAMERA_DATA_PATHS)
