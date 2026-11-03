"""Follow camera baked from the marble motion.

The camera looks steeply along the wall and travels with the marbles, like the reference short:

1. Follow point per frame: the weighted centre of the marbles in flight. A marble weighs 1 while its samples
   cover the time and 0.05 before its release or after its last sample, so a single marble that has not been
   released yet still anchors the shot. With several marbles the camera frames their centre; a lead-only choice
   jumps when the lead changes, a weighted centre stays continuous. Several marbles also widen the distance so every
   marble in flight fits the frame.
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

Everything is baked as keyframes on the studio camera (location, rotation, focus distance), so the camera works in
plain Blender. A camera the user edited is taken over and never regenerated unless the app asks.
"""
import math

import bpy
import numpy as np
from mathutils import Matrix, Vector

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
    }


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


def spread_distance(marbles, motions, times, centre, lens, fps):
    """Distance at which every marble in flight stays inside the framing box around the centre"""
    reach = 18.0 / lens * FRAME_KEEP
    required = np.zeros(len(times))
    for marble in marbles:
        motion = motions.get(marble['id'])
        if motion is None or not len(motion):
            continue
        inside = (times >= motion[0, 0] - 1e-9) & (times <= motion[-1, 0] + 1e-9)
        dx = np.abs(np.interp(times, motion[:, 0], motion[:, 1]) - centre[:, 0])
        dy = np.abs(np.interp(times, motion[:, 0], motion[:, 2]) - centre[:, 1])
        need = np.maximum(dx / (reach * ASPECT_GUESS), dy / reach) * 1.15
        required = np.maximum(required, np.where(inside, need, 0.0))
    # Hold the widest need for a second around each frame, then ease it so the zoom breathes slowly
    window = max(1, int(round(fps)))
    padded = np.concatenate([np.full(window, required[0]), required, np.full(window, required[-1])])
    held = np.array([padded[index:index + 2 * window + 1].max() for index in range(len(required))])
    return critically_damped(held[:, None], fps, 0.5)[:, 0]


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
    frames = np.arange(scene.frame_start, scene.frame_end + 1, dtype=np.float64)
    times = frames / fps
    ahead_points, depth = follow_points(marbles, motions, times + settings['lead'])
    current, _ = follow_points(marbles, motions, times)
    if ahead_points is None:
        return 0
    distance, shot_roll = shot_values(times, settings['distance'], settings['shots'])
    distance = np.maximum(distance, spread_distance(marbles, motions, times, current, settings['lens'], fps))
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
    reach = distance * 18.0 / settings['lens'] * FRAME_KEEP
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
