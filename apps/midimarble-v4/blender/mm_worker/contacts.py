"""Contact frames and tunnel visibility for marble playback.

Contact frames: a bounce is fast, so a frame a few milliseconds before or after a hit already shows the marble well
clear of its piece and the hit looks like it happened in mid-air. The worker therefore warps the marble's
playback time locally so every hit falls exactly on a frame of the snap grid. The grid is 1/30 s when the frame
rate is a multiple of 30, so the hit shows at both 30 and 60 fps output; otherwise it is the frame rate. The
shift is at most half a grid step (17 ms at 30 fps), applied with a triangular blend over a short window that
never reaches a neighbouring hit, so the motion stays continuous and hit sounds stay within 17 ms of their frame.
Hit values (`mm_hit`) use the same snapped times, so reactions start on the contact frame.

Tunnels: the marble is hidden while it is fully inside a tunnel; `mm_visible` on the marble holder drives the
default skin's visibility.
"""
import math

import numpy as np

WARP_WINDOW = 0.12


def snap_grid(fps):
    if fps >= 30 and abs(fps / 30 - round(fps / 30)) < 1e-6:
        return 1 / 30
    return 1 / fps


def snap(time, grid):
    return round(time / grid) * grid


def marble_contacts(motion, radius, pieces):
    """Hit times of `pieces` that this marble makes: the marble is at the piece when the hit happens"""
    if not len(motion):
        return []
    contacts = []
    for piece in pieces:
        params = piece.get('params') or {}
        reach = float(params.get('length', 0.0)) / 2 + float(params.get('bladeLength', 0.0)) + \
            float(params.get('hubRadius', 0.0)) + float(params.get('thickness', 0.01)) + 2 * radius
        px, py = float(piece['position']['x']), float(piece['position']['y'])
        for hit in piece.get('hitTimes') or []:
            if not motion[0, 0] <= hit <= motion[-1, 0]:
                continue
            x = np.interp(hit, motion[:, 0], motion[:, 1])
            y = np.interp(hit, motion[:, 0], motion[:, 2])
            if math.hypot(x - px, y - py) <= reach:
                contacts.append(float(hit))
    return sorted(set(contacts))


def with_contact_samples(motion, contacts):
    """Inserts a sample at each contact, extrapolated from the incoming flight. Physics samples straddle a
    bounce, and interpolating between them would cut off the bottom of the bounce by a few millimetres."""
    if len(motion) < 3 or not contacts:
        return motion
    rows = []
    for hit in contacts:
        index = int(np.searchsorted(motion[:, 0], hit))
        if index < 2 or index >= len(motion) or abs(motion[index, 0] - hit) < 1e-7 or abs(motion[index - 1, 0] - hit) < 1e-7:
            continue
        before, earlier = motion[index - 1], motion[index - 2]
        rate = (before - earlier) / (before[0] - earlier[0])
        rows.append(before + rate * (hit - before[0]))
    if not rows:
        return motion
    merged = np.vstack([motion, np.array(rows)])
    return merged[np.argsort(merged[:, 0], kind='stable')]


def warp(times, contacts, grid):
    """Sample times that put each contact exactly on its nearest grid frame"""
    warped = np.array(times, dtype=np.float64)
    for index, hit in enumerate(contacts):
        target = snap(hit, grid)
        shift = hit - target
        if abs(shift) < 1e-9:
            continue
        before = contacts[index - 1] if index > 0 else -math.inf
        after = contacts[index + 1] if index + 1 < len(contacts) else math.inf
        window = min(WARP_WINDOW, 0.45 * (hit - before), 0.45 * (after - hit))
        if window <= abs(shift):
            continue
        weight = np.clip(1 - np.abs(times - target) / window, 0.0, 1.0)
        warped += shift * weight
    return warped


def tunnel_visibility(x, y, radius, pieces):
    """1 where the marble is visible, 0 where it is fully inside a tunnel"""
    visible = np.ones(len(x))
    for piece in pieces:
        if piece.get('type') != 'tunnel' or len(piece.get('path') or []) < 2:
            continue
        params = piece.get('params') or {}
        support = float(params.get('radius', 0.002))
        bore = float(params.get('bore', 0.004))
        line = offset_path([(float(p['x']), float(p['y'])) for p in piece['path']], radius + support)
        distance, along, total = distance_along(np.stack([x, y], axis=1), line)
        inside = (distance < radius + bore) & (along > radius * 1.2) & (along < total - radius * 1.2)
        visible[inside] = 0.0
    return visible


def offset_path(points, distance):
    result = []
    for index, point in enumerate(points):
        previous = points[max(0, index - 1)]
        following = points[min(len(points) - 1, index + 1)]
        tx, ty = following[0] - previous[0], following[1] - previous[1]
        length = math.hypot(tx, ty) or 1.0
        nx, ny = -ty / length, tx / length
        if ny < 0:
            nx, ny = -nx, -ny
        result.append((point[0] + nx * distance, point[1] + ny * distance))
    return result


def distance_along(points, line):
    """Distance of each point to a polyline, the arc length of its closest point and the polyline length"""
    best = np.full(len(points), np.inf)
    along = np.zeros(len(points))
    travelled = 0.0
    for (ax, ay), (bx, by) in zip(line, line[1:]):
        segment = np.array([bx - ax, by - ay])
        length = float(np.hypot(*segment)) or 1e-9
        relative = points - np.array([ax, ay])
        t = np.clip(relative @ segment / (length * length), 0.0, 1.0)
        closest = np.array([ax, ay]) + t[:, None] * segment
        distance = np.hypot(*(points - closest).T)
        better = distance < best
        best = np.where(better, distance, best)
        along = np.where(better, travelled + t * length, along)
        travelled += length
    return best, along, travelled
