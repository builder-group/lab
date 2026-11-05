"""Follow camera baked from the marble motion.

The camera looks steeply along the wall and travels with the marbles, like the reference short:

1. Follow point per frame. With several marbles the camera frames the group: the follow point is the weighted centre
   of the marbles in flight (a marble weighs 1 while its samples cover the time, up to a moment after its last note
   when another marble plays on (`activeUntil`), and 0.05 before and after) and the distance widens as far as every
   marble needs, never cropping one. With a shared descent curve (`descent`, the common pace y*(t) of the lanes) the
   group centre's height follows it. The distance is measured along the camera's own axes, with its pitch, side and
   roll, around the smoothed target of a first pass, and eases slowly (DISTANCE_TAU).
2. Target: the follow point moved toward where it is at `t + lead` (at most LEAD_LIMIT * distance), smoothed with a
   zero-phase critically damped filter (a forward and a backward pass of a second-order filter with time constant
   0.04 + 0.5 * smoothing seconds), so the camera neither lags nor overshoots. Where smoothing still lets a marble
   drift toward the frame edge (free falls accelerate), the target is pulled along.
3. Placement: the camera stands `distance` from the target at `pitch` from the wall normal, above and to the side
   of the run (the Turn, `side`, by default SIDE_ANGLE from straight below, following the run direction by SIDE_FOLLOW). Seen from there the
   bars show their long sides and tops, the wall recedes like a floor and the two columns run diagonally.
4. Roll: image up is the wall's up direction turned by a slow function of the run direction plus a slow drift
   (ROLL_DRIFT over ROLL_PERIOD), so the columns turn between diagonal and near vertical. Shot markers scale the
   automatic distance by their distance over the rig's with eased transitions (a Push In to 0.7 of the rig distance
   comes to 0.7 of the current framing and frames the leading marble); a shot with a `length` eases back to the rig's
   distance after it unless the next shot comes first.
5. Hold: from `holdAfter`, the run's last hit, the marbles are read at that time and the follow point eases over
   HOLD_EASE seconds to the middle of the run's last HOLD_SPAN seconds, so the film ends on the final pieces rather
   than following a marble down the empty wall. With `holdBowl`, the mouths of the Bowls that catch the marbles
   playing last, it eases instead to BOWL_FRAME of the way from the follow point at the last hit to their mean, so
   the held frame shows the last piece and the marble landing in its Bowl. The run direction and the roll drift
   come to rest with it.

Everything is baked as keyframes on the studio camera (location, rotation, focus distance), so the camera works in
plain Blender. A camera the user edited is taken over and never regenerated unless the app asks.
"""
import math

import bpy
import numpy as np
from mathutils import Euler, Matrix, Vector

from . import anim
from .util import path_depth

# Image roll per radian of run direction, its limit, and a slow drift that turns the columns between diagonal and
# near vertical like the reference
ROLL_FOLLOW = 0.5
ROLL_LIMIT = math.radians(40)
ROLL_DRIFT = math.radians(16)
ROLL_PERIOD = 14.0
# Where the camera stands around the target on the wall: 0 straight below, positive to the right
SIDE_ANGLE = math.radians(95)
SIDE_FOLLOW = 0.3
HEADING_TAU = 1.5
# The lead may move the target at most this fraction of the camera distance ahead of the marble
LEAD_LIMIT = 0.0235
# While the follow point falls faster than FALL_START metres per second, the frame looks FALL_AHEAD seconds of the
# extra speed below it, at most FALL_LIMIT of the camera distance; the speed is taken over FALL_WINDOW seconds either
# side, the lead lasts FALL_HOLD seconds past the fall and eases over FALL_EASE seconds
FALL_START = 0.3
FALL_AHEAD = 0.25
FALL_LIMIT = 0.088
FALL_EASE = 0.6
FALL_WINDOW = 0.1
FALL_HOLD = 0.5
# Fraction of the half frame the marble may move away from the target before the camera is pulled along
FRAME_KEEP = 0.55
# Width over height of the framing box; portrait films are 9:16
ASPECT_GUESS = 0.56
SHOT_EASE = 0.8
LENS = 85.0
# Fractions of the half frame width and height a framed group may use, seen along the camera's axes
GROUP_KEEP_X = 0.85
GROUP_KEEP_Y = 0.85
# Margin on the distance a framed group needs
GROUP_MARGIN = 1.2
# Weight in the group centre of a marble past its `activeUntil`
FINISHED_WEIGHT = 0.001
SENSOR = 36.0
# Seconds over which the camera settles once it holds on the last hit, and the stretch of the run before that hit
# whose middle it settles on
HOLD_EASE = 1.0
HOLD_SPAN = 1.0
# With Bowls, the held follow point sits this share of the way from the last hit to the Bowls' mouths
BOWL_FRAME = 0.5
# Seconds over which the opening eases away where its box doesn't fit
GROUP_EASE = 1.2
# A zoom need shorter than this many seconds, such as one bounce's peak, is left to the frame's margins
GROUP_SPIKE = 0.3
# Time constant in seconds of the group distance, so the zoom changes slowly
DISTANCE_TAU = 1.8
# In a close shot, the marble in flight with the most notes within LEAD_AHEAD seconds leads the frame; the focus marble
# gets FOCUS_BIAS extra, a lead lasts at least LEAD_HOLD seconds and the frame pans to the next over LEAD_EASE seconds
LEAD_AHEAD = 2.0
FOCUS_BIAS = 0.5
LEAD_HOLD = 1.5
LEAD_EASE = 2.5
# A shot at this fraction of the rig distance or closer frames only the leading marble
PUSH_FOCUS = 0.7
# The opening frames the release points and up to OPENING_PIECES of the first struck pieces (those within LEAD_AHEAD
# seconds of the first hit), centred in the image in OPENING_STEPS steps, and eases into the follow over OPENING_EASE
# seconds after the first hit, so the film opens on the track rather than on marbles over an empty wall
OPENING_PIECES = 3
OPENING_EASE = 1.5
# Seconds after the first hit over which the opening's zoom eases back: slower than its frame, as the zoom never pumps
OPENING_ZOOM_EASE = 6.0
OPENING_STEPS = 3
# The opening stands at most this many times the rig distance away, and no further than a marble still spans this share of the frame width; a box that needs more isn't framed
OPENING_ZOOM = 1.7
OPENING_MARBLE_SHARE = 0.045
# The opening's own margin: tighter than GROUP_MARGIN, as its box holds still pieces rather than marbles that swing out
OPENING_MARGIN = 1.1
# A view ray that misses the wall, or meets it further than this, counts this many camera heights away when sizing
# the wall. A steep pitch (1.15 rad) meets the wall up to about 40 heights away at the far frame corner
FAR_REACH = 60.0
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
                'distance': max(0.05, float(shot.get('distance', camera.get('distance', 0.6)))),
                'length': shot_length(shot.get('length')),
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
        'side': number('side', SIDE_ANGLE, 0.0, 2.0 * math.pi),
        'sway': number('sway', 1.0, 0.0, 1.0),
        'lens': number('lens', LENS, 10.0, 300.0),
        'shots': shots,
        'fstop': float(theme_settings.get('fstop', 4.0)),
        'focus': camera.get('focusMarbleId') if isinstance(camera.get('focusMarbleId'), str) else None,
        'descent': descent_curve(camera.get('descent')),
        'hold': hold_time(camera.get('holdAfter')),
        'bowl': bowl_point(camera.get('holdBowl')),
        # The first struck pieces; `apply_scene` sets them from the pieces
        'opening': None,
    }


def shot_length(value):
    """Seconds a shot holds before the camera eases back to the rig, or None to hold until the next shot"""
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or value <= 0:
        return None
    return float(value)


def hold_time(value):
    """Time of the run's last hit, after which the camera holds on it, or None to follow to the end"""
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        return None
    return float(value)


def bowl_point(value):
    """Mean wall point of the Bowls the held ending frames, as a (2,) array, or None"""
    if not isinstance(value, list):
        return None
    points = []
    for point in value:
        try:
            x, y = float(point['x']), float(point['y'])
        except (KeyError, TypeError, ValueError):
            continue
        if math.isfinite(x) and math.isfinite(y):
            points.append((x, y))
    if not points:
        return None
    return np.array([sum(x for x, _ in points) / len(points), sum(y for _, y in points) / len(points)])


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


def opening_pieces(pieces):
    """The first OPENING_PIECES pieces by their first hit that strike within LEAD_AHEAD seconds of the first hit, as
    (time, x, y) tuples sorted by that time, or None"""
    struck = []
    for piece in pieces:
        times = [float(time) for time in (piece.get('hitTimes') or []) if math.isfinite(float(time))]
        if not times:
            continue
        struck.append((min(times), float(piece['position']['x']), float(piece['position']['y'])))
    struck.sort(key=lambda item: item[0])
    if not struck:
        return None
    first = struck[0][0]
    return [item for item in struck if item[0] <= first + LEAD_AHEAD + 1e-9][:OPENING_PIECES]


def in_flight(marble, motion, times):
    """Whether the camera frames the marble at each time: from its first sample to its last, or to `activeUntil`
    once its lane has finished playing"""
    end = motion[-1, 0]
    if marble.get('activeUntil') is not None:
        end = min(end, float(marble['activeUntil']))
    return (times >= motion[0, 0] - 1e-9) & (times <= end + 1e-9)


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
        inside = in_flight(marble, motion, times)
        # A marble that has finished playing falls away fast, so even a small weight would drag the centre
        finished = marble.get('activeUntil') is not None and times > float(marble['activeUntil']) + 1e-9
        weight = np.where(inside, 1.0, np.where(finished, FINISHED_WEIGHT, 0.05))
        total[:, 0] += x * weight
        total[:, 1] += y * weight
        weights += weight
        depth = max(depth, path_depth(marble))
    if not weights.any():
        return None, depth
    return total / weights[:, None], depth


def marble_point(marble, motions, times):
    motion = motions.get(marble['id'])
    if motion is None or not len(motion):
        return None
    return np.stack([np.interp(times, motion[:, 0], motion[:, 1]), np.interp(times, motion[:, 0], motion[:, 2])], axis=1)


def focus_marble(marbles, motions, focus):
    """The marble the camera keeps in a close shot: the chosen one, else the first with motion"""
    moving = [marble for marble in marbles if motions.get(marble['id']) is not None and len(motions[marble['id']])]
    chosen = next((marble for marble in moving if marble['id'] == focus), None)
    return chosen or (moving[0] if moving else None)


def lead_shares(marbles, motions, times, focus, fps):
    """Per marble with motion, its share of the point the camera follows in a close shot: the marble in
    flight with the most notes (`hitTimes`) within LEAD_AHEAD seconds leads, the focus marble wins a tie, a marble
    without notes counts only while in flight, a lead lasts at least LEAD_HOLD seconds, and the frame eases from one
    leading marble to the next over LEAD_EASE seconds"""
    moving = [marble for marble in marbles if motions.get(marble['id']) is not None and len(motions[marble['id']])]
    chosen = focus_marble(marbles, motions, focus)
    scores = np.zeros((len(moving), len(times)))
    for which, marble in enumerate(moving):
        hits = np.sort(np.asarray(marble.get('hitTimes') or [], dtype=np.float64))
        ahead = np.searchsorted(hits, times + LEAD_AHEAD, side='right') - np.searchsorted(hits, times, side='right')
        score = 1.0 + (FOCUS_BIAS if marble is chosen else 0.0) + ahead
        scores[which] = np.where(in_flight(marble, motions[marble['id']], times), score, 0.0)
    leader = np.zeros(len(times), dtype=np.int64)
    previous = next((which for which, marble in enumerate(moving) if marble is chosen), 0)
    for index in range(len(times)):
        if scores[:, index].max() > 0.0:
            previous = int(np.argmax(scores[:, index]))
        leader[index] = previous
    # A lead shorter than LEAD_HOLD keeps the marble that led before it
    shortest = int(round(LEAD_HOLD * fps))
    start = 0
    for index in range(1, len(times) + 1):
        if index < len(times) and leader[index] == leader[start]:
            continue
        if start > 0 and index - start < shortest:
            leader[start:index] = leader[start - 1]
        start = index
    return [np.clip(critically_damped((leader == which).astype(np.float64)[:, None], fps, LEAD_EASE / 3)[:, 0], 0.0, 1.0)
            for which in range(len(moving))]


def mix_points(marbles, motions, times, shares):
    """The marbles with motion at `times`, weighted by `shares`, as an (n, 2) array"""
    moving = [marble for marble in marbles if motions.get(marble['id']) is not None and len(motions[marble['id']])]
    total = np.zeros((len(times), 2))
    weights = np.zeros(len(times))
    for marble, share in zip(moving, shares):
        total += marble_point(marble, motions, times) * share[:, None]
        weights += share
    return total / np.maximum(weights, 1e-9)[:, None]


def in_flight_count(marbles, motions, times):
    count = np.zeros(len(times))
    for marble in marbles:
        motion = motions.get(marble['id'])
        if motion is not None and len(motion):
            count += in_flight(marble, motion, times)
    return count


def drift_times(times, hold):
    """Times that drive the roll drift: the film time, easing to a stop over HOLD_EASE seconds once the camera holds"""
    if hold is None:
        return times
    past = np.maximum(times - hold, 0.0)
    return np.minimum(times, hold) + HOLD_EASE * (1.0 - np.exp(-past / HOLD_EASE))


def view_turn(times, heading, hold, base_side=SIDE_ANGLE, sway=1.0):
    """Side angle around the target and image roll per frame, from the Turn, the run direction and the slow drift.
    Sway scales what moves on its own: at 0 the side holds the Turn and the wall's up stays straight up in the image."""
    side = base_side + sway * SIDE_FOLLOW * heading
    drift = ROLL_DRIFT * np.sin(2 * math.pi * drift_times(times, hold) / ROLL_PERIOD)
    roll = sway * (np.clip(ROLL_FOLLOW * heading, -ROLL_LIMIT, ROLL_LIMIT) + drift)
    return side, roll


def view_axes(side, roll, pitch):
    """Image right and up and the unit direction from the target toward the camera per frame, (n, 3) arrays each, as
    `bake` places the camera and `look_rotation` turns it"""
    count = len(side)
    toward = np.stack([np.sin(side) * math.sin(pitch), np.full(count, -math.cos(pitch)),
                       -np.cos(side) * math.sin(pitch)], axis=1)
    forward = -toward
    up = np.stack([-np.sin(roll), np.zeros(count), np.cos(roll)], axis=1)
    right = np.cross(forward, up)
    flat = np.linalg.norm(right, axis=1) < 1e-8
    if flat.any():
        right[flat] = np.cross(forward[flat], np.array([0.0, -1.0, 0.0]))
    right /= np.linalg.norm(right, axis=1)[:, None]
    image_up = np.cross(right, forward)
    image_up /= np.linalg.norm(image_up, axis=1)[:, None]
    return right, image_up, toward


def spread_need(marbles, motions, times, centre, lens, axes):
    """Distance at which every marble in flight stays inside the framing box around the centre, per frame.

    Each marble's offset from the centre is seen along the camera's axes, so the steep view's foreshortening and the
    roll count: an offset across the image needs reach_x per metre of distance, one up the image `reach`, and an
    offset toward the camera that much more distance."""
    reach = SENSOR / 2 / lens * GROUP_KEEP_Y
    reach_x = SENSOR / 2 / lens * GROUP_KEEP_X * ASPECT_GUESS
    right, image_up, toward = axes
    required = np.zeros(len(times))
    for marble in marbles:
        motion = motions.get(marble['id'])
        if motion is None or not len(motion):
            continue
        inside = in_flight(marble, motion, times)
        dx = np.interp(times, motion[:, 0], motion[:, 1]) - centre[:, 0]
        dy = np.interp(times, motion[:, 0], motion[:, 2]) - centre[:, 1]
        across = np.abs(dx * right[:, 0] + dy * right[:, 2])
        high = np.abs(dx * image_up[:, 0] + dy * image_up[:, 2])
        along = dx * toward[:, 0] + dy * toward[:, 2]
        need = along + np.maximum(across / reach_x, high / reach) * GROUP_MARGIN
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


def held(values, fps, seconds, reduce=np.max):
    """`reduce` of the values within `seconds` around each frame, such as the widest zoom need of the last second"""
    window = max(1, int(round(fps * seconds)))
    padded = np.concatenate([np.full(window, values[0]), values, np.full(window, values[-1])])
    return np.array([reduce(padded[index:index + 2 * window + 1]) for index in range(len(values))])


def settled(points, times, hold, bowl=None):
    """Follow points that, after the hold time, ease over HOLD_EASE seconds from the last hit to the middle of the
    path over the HOLD_SPAN seconds before it, so the last frames show the final pieces; with `bowl`, the Bowls'
    mean mouth, to BOWL_FRAME of the way from the last hit's point to it, so the frame shows the catch"""
    span = (times >= hold - HOLD_SPAN - 1e-9) & (times <= hold + 1e-9)
    if not span.any() or not (times > hold).any():
        return points
    middle = points[span].mean(axis=0)
    if bowl is not None:
        last = points[span][-1]
        middle = last + (bowl - last) * BOWL_FRAME
    weight = smoothstep((times - hold) / HOLD_EASE)[:, None]
    return points * (1 - weight) + middle * weight


def group_framing(marbles, motions, times, settings, fps, heading, aim=None):
    """Follow points (current and `lead` ahead) and distance per time, or None without motion.

    `heading` is the run direction the camera turns with and `aim` the smoothed look target, (n, 2), which size the
    group; without an aim the group is sized around its centre. From the hold time on, the marbles are read at the
    hold time, so the camera settles on the last hit."""
    hold = settings.get('hold')
    sample = times if hold is None else np.minimum(times, hold)
    lead_sample = times + settings['lead'] if hold is None else np.minimum(times + settings['lead'], hold)
    centre, depth = follow_points(marbles, motions, sample)
    ahead, _ = follow_points(marbles, motions, lead_sample)
    if centre is None:
        return None
    descent = settings.get('descent')
    if descent is not None:
        centre[:, 1] = paced_height(marbles, motions, sample, centre[:, 1], descent)
        ahead[:, 1] = paced_height(marbles, motions, lead_sample, ahead[:, 1], descent)
    # Shots scale the automatic framing: a Push In to 0.7 of the rig distance comes to 0.7 of whatever the camera frames
    # then, so it reads also where a group has widened the frame
    shot_distance = shot_values(times, settings['distance'], settings['shots'])
    scale = shot_distance / settings['distance']
    base = settings['distance']
    side, roll = view_turn(times, heading, hold, settings['side'], settings['sway'])
    axes = view_axes(side, roll, settings['pitch'])
    raw = spread_need(marbles, motions, sample, centre if aim is None else aim, settings['lens'], axes)
    # The opening frame sets the zoom while it leads: its box holds the marbles, and sizing them around its centre would widen it again
    opening = opening_frame(marbles, motions, times, sample, settings, fps, axes)
    zoom_need = raw if opening is None else np.maximum(raw * (1 - opening['weight']), opening['need'] * opening['weight'])
    # Hold the widest need for a second so the zoom does not breathe with every bounce; a running median first drops
    # momentary spikes, such as one marble's bounce peak, that the frame margins absorb
    need = held(held(zoom_need, fps, GROUP_SPIKE / 2, np.median), fps, 1.0)
    # A close shot frames the leading marble alone, and only then leads one marble's fall
    moving = [marble for marble in marbles if motions.get(marble['id']) is not None and len(motions[marble['id']])]
    push = np.clip((1 - scale) / (1 - PUSH_FOCUS), 0.0, 1.0)
    fall_scale = push if len(moving) > 1 else np.ones(len(times))
    # The zoom follows what the group needs, slowly
    group_distance = np.maximum(need, base)
    distance = critically_damped(group_distance[:, None], fps, DISTANCE_TAU)[:, 0]
    # The slow zoom would flatten a need that lasts only for the opening, so the opening stands where it needs most
    if opening is not None:
        furthest = np.max(np.maximum(group_distance, np.where(opening['fit'] > 0.5, opening['need'], 0.0))[times <= opening['first']], initial=0.0)
        share = opening['fit'] * (1.0 - smoothstep((times - opening['first']) / OPENING_ZOOM_EASE))
        distance = distance + share * np.maximum(furthest - distance, 0.0)
    # A closer shot scales the automatic distance; a Wide shot stands at least its scale of the rig distance away
    distance = np.maximum(np.maximum(distance, base) * np.minimum(scale, 1.0), base * scale)
    if len(marbles) > 1:
        shares = lead_shares(marbles, motions, sample, settings.get('focus'), fps)
        lead = mix_points(marbles, motions, sample, shares)
        lead_ahead = mix_points(marbles, motions, lead_sample, shares)
        keep = (1 - push)[:, None]
        centre = keep * centre + (1 - keep) * lead
        ahead = keep * ahead + (1 - keep) * lead_ahead
    if opening is not None:
        # The opening frames its box; it leads no fall
        fall_scale = fall_scale * (1 - opening['weight'])
        weight = opening['weight'][:, None]
        centre = weight * opening['point'] + (1 - weight) * centre
        ahead = weight * opening['point'] + (1 - weight) * ahead
    if hold is not None:
        bowl = settings.get('bowl')
        centre, ahead = settled(centre, times, hold, bowl), settled(ahead, times, hold, bowl)
    return {'current': centre, 'ahead': ahead, 'depth': depth, 'distance': distance, 'fall_scale': fall_scale, 'opening_weight': None if opening is None else opening['weight']}


def opening_frame(marbles, motions, times, sample, settings, fps, axes):
    """Until the first hit the camera frames the box around the release points and the first struck pieces, centred in the image, and eases into the follow over OPENING_EASE seconds after
    it. Returns the box centre (n, 2), the distance the box needs and the opening's weight per frame, which eases to 0
    where the box needs more than its limit; or None without opening pieces"""
    pieces = settings.get('opening')
    if not pieces:
        return None
    first = min(piece[0] for piece in pieces)
    count = len(times)
    diameter = 2 * max(float(marble['radius']) for marble in marbles if motions.get(marble['id']) is not None and len(motions[marble['id']]))
    limit = max(settings['distance'], min(settings['distance'] * OPENING_ZOOM, diameter / (OPENING_MARBLE_SHARE * (SENSOR / settings['lens']) * ASPECT_GUESS)))
    reach = SENSOR / 2 / settings['lens'] * GROUP_KEEP_Y
    reach_x = SENSOR / 2 / settings['lens'] * GROUP_KEEP_X * ASPECT_GUESS
    # The film shows a marble at its release point until it drops, and it falls inside this box: the box holds still
    # until the first hit, so the smoothed target doesn't drift off it. After that it takes in the marbles as they go on
    released = [marble for marble in marbles if motions.get(marble['id']) is not None and len(motions[marble['id']]) and motions[marble['id']][0, 0] <= first + 1e-9]
    still_x = [piece[1] for piece in pieces] + [float(motions[marble['id']][0, 1]) for marble in released]
    still_y = [piece[2] for piece in pieces] + [float(motions[marble['id']][0, 2]) for marble in released]
    points = [marble_point(marble, motions, sample) for marble in released]
    right, image_up, toward = axes
    point = np.zeros((count, 2))
    need = np.zeros(count)
    ramp = 1.0 - smoothstep((times - first) / OPENING_EASE)
    fits = np.ones(count)
    for index in range(count):
        if ramp[index] <= 0:
            continue
        xs = list(still_x)
        ys = list(still_y)
        if times[index] > first:
            xs += [float(path[index, 0]) for path in points]
            ys += [float(path[index, 1]) for path in points]
        x = (min(xs) + max(xs)) / 2
        y = (min(ys) + max(ys)) / 2
        rx, rz = right[index, 0], right[index, 2]
        ux, uz = image_up[index, 0], image_up[index, 2]
        tx, tz = toward[index, 0], toward[index, 2]

        def widest_around(x, y):
            widest = 0.0
            for value_x, value_y in zip(xs, ys):
                dx, dy = value_x - x, value_y - y
                across = abs(dx * rx + dy * rz)
                high = abs(dx * ux + dy * uz)
                along = dx * tx + dy * tz
                widest = max(widest, along + max(across / reach_x, high / reach) * OPENING_MARGIN)
            return widest

        # Centre the box in the image rather than on the wall: the steep view enlarges what lies near the camera
        determinant = rx * uz - rz * ux
        for _ in range(OPENING_STEPS):
            if abs(determinant) <= 1e-9:
                break
            reach_out = min(limit, max(settings['distance'], widest_around(x, y)))
            image_x, image_y = [], []
            for value_x, value_y in zip(xs, ys):
                dx, dy = value_x - x, value_y - y
                depth = max(reach_out - (dx * tx + dy * tz), 1e-6)
                image_x.append((dx * rx + dy * rz) / depth)
                image_y.append((dx * ux + dy * uz) / depth)
            want_x = (min(image_x) + max(image_x)) / 2 * reach_out
            want_y = (min(image_y) + max(image_y)) / 2 * reach_out
            x += (want_x * uz - want_y * rz) / determinant
            y += (want_y * rx - want_x * ux) / determinant
        point[index] = (x, y)
        need[index] = widest_around(x, y)
        fits[index] = 1.0 if need[index] <= limit else 0.0
    eased = np.clip(critically_damped(fits[:, None], fps, GROUP_EASE / 3)[:, 0], 0.0, 1.0)
    return {'first': first, 'point': point, 'need': need, 'weight': eased * ramp, 'fit': eased}


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


def smoothstep(progress):
    progress = np.clip(progress, 0.0, 1.0)
    return progress * progress * (3 - 2 * progress)


def shot_events(shots, base_distance):
    """(time, distance) the camera eases to from each time on: every shot's, and the rig's once a shot with a length has
    held that long before the next shot starts"""
    events = []
    for index, shot in enumerate(shots):
        events.append((shot['time'], shot['distance']))
        following = shots[index + 1]['time'] if index + 1 < len(shots) else math.inf
        length = shot.get('length')
        if length is not None and shot['time'] + length < following - 1e-9:
            events.append((shot['time'] + length, base_distance))
    return events


def shot_values(times, base_distance, shots):
    """Distance per time from shot markers, eased over SHOT_EASE seconds after each marker. A shot with a length eases
    back to the rig after it; each transition starts where the previous one has got to"""
    distance = np.full(len(times), base_distance)
    start, goal, start_time = base_distance, base_distance, -math.inf
    for time, shot_distance in shot_events(shots, base_distance):
        reached = float(smoothstep((time - start_time) / SHOT_EASE))
        start = start + (goal - start) * reached
        goal, start_time = shot_distance, time
        eased = smoothstep((times - time) / SHOT_EASE)
        distance = np.where(times >= time, start + (goal - start) * eased, distance)
    return distance


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


def fall_lead(point_y, distance, fps, times, hold):
    """How far below the follow point the camera looks while it falls, per frame. Above FALL_START metres per second
    the frame leads by FALL_AHEAD seconds of the extra speed, at most FALL_LIMIT of the camera distance, held FALL_HOLD
    seconds past the fall (the smoothed target slows before the marble lands) and eased over FALL_EASE seconds, so a
    falling marble sits above the centre with the pieces it falls toward in frame. Over the HOLD_SPAN seconds before
    the hold the lead fades out, so the held frame still shows the last pieces."""
    count = len(point_y)
    window = max(1, int(round(FALL_WINDOW * fps)))
    index = np.arange(count)
    ahead = np.minimum(count - 1, index + window)
    behind = np.maximum(0, index - window)
    speed = (point_y[behind] - point_y[ahead]) / (np.maximum(ahead - behind, 1) / fps)
    lead = np.minimum(np.maximum(speed - FALL_START, 0.0) * FALL_AHEAD, FALL_LIMIT * distance)
    span = int(round(FALL_HOLD * fps))
    kept = np.array([lead[max(0, frame - span):frame + 1].max() for frame in range(count)]) if count else lead
    eased = critically_damped(kept[:, None], fps, FALL_EASE / 3)[:, 0]
    if hold is not None:
        eased = eased * (1.0 - smoothstep((times - (hold - HOLD_SPAN)) / HOLD_SPAN))
    return eased


def follow_target(framing, settings, fps, times):
    """Look target on the wall per frame, (n, 2), and the run direction (heading) the camera turns with"""
    current, ahead_points, distance = framing['current'], framing['ahead'], framing['distance']
    # Lead the marble, but never so far that it leaves the upper part of the frame on fast drops
    lead_offset = ahead_points - current
    lead_length = np.linalg.norm(lead_offset, axis=1)
    limit = LEAD_LIMIT * distance
    scale = np.where(lead_length > limit, limit / np.maximum(lead_length, 1e-9), 1.0)
    follow = current + lead_offset * scale[:, None]
    follow[:, 1] -= fall_lead(current[:, 1], distance, fps, times, settings.get('hold')) * framing['fall_scale']
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
    heading = np.clip(heading, -math.pi / 2, math.pi / 2)
    # The opening's target holds still, so its tiny moves name no run direction: the view stays straight until it lets go
    if framing['opening_weight'] is not None:
        heading = (1 - framing['opening_weight']) * heading
    # While the camera settles on the last hit the target barely moves; the view keeps the run direction it had
    hold = settings.get('hold')
    if hold is not None:
        settling = times > hold - window / fps
        if settling.any() and not settling.all():
            heading = np.where(settling, heading[np.argmax(settling) - 1], heading)
    heading = critically_damped(heading[:, None], fps, HEADING_TAU)[:, 0]
    return target, heading


def bake(scene, camera, settings, marbles, motions, fps):
    """Writes the follow keyframes; returns the number of frames baked or 0 when there is no motion"""
    frames = np.arange(scene.frame_start, scene.frame_end + 1, dtype=np.float64)
    times = frames / fps
    # The group's size in frame depends on where the camera looks from and at: a first pass with the camera straight
    # and sized around the group's centre gives the run direction and the smoothed target that size the second
    framing = group_framing(marbles, motions, times, settings, fps, np.zeros(len(times)))
    if framing is None:
        return 0
    aim, heading = follow_target(framing, settings, fps, times)
    framing = group_framing(marbles, motions, times, settings, fps, heading, aim)
    target, heading = follow_target(framing, settings, fps, times)
    current, depth, distance = framing['current'], framing['depth'], framing['distance']
    # The camera stands below and to the side of the target, looking up along the run; the side follows the run
    # direction so the view keeps looking along it, and the image rolls slowly on its own and with the run
    side, roll = view_turn(times, heading, settings.get('hold'), settings['side'], settings['sway'])
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


def write_shot_markers(scene, shots, fps):
    """Shot markers on the timeline, named `MM · <kind>`; markers the user made stay"""
    for marker in list(scene.timeline_markers):
        if marker.name.startswith('MM · '):
            scene.timeline_markers.remove(marker)
    for index, shot in enumerate(shots):
        scene.timeline_markers.new('MM · ' + shot['kind'], frame=int(round(shot['time'] * fps)))
        following = shots[index + 1]['time'] if index + 1 < len(shots) else math.inf
        if shot.get('length') is not None and shot['time'] + shot['length'] < following - 1e-9:
            scene.timeline_markers.new('MM · follow', frame=int(round((shot['time'] + shot['length']) * fps)))


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
