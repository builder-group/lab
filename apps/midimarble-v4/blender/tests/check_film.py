"""Headless look and film check in the brass theme.

Builds a synthetic but representative run (a zigzag of platform hits on brackets, a rail at the end and a spinning
windmill), renders stills at hit times with Eevee and Cycles, then renders a film through `render_film` with a test
soundtrack and checks the MP4 with ffprobe. Then renders the same film with the draft preset (Workbench) and checks its
size, soundtrack and colours. Outputs are copied to `.local/look/` for review.

Run: Blender --background --factory-startup --python-exit-code 1 --python blender/tests/check_film.py [-- --quick]
"""
import json
import math
import shutil
import struct
import subprocess
import sys
import tempfile
import time
import wave
from pathlib import Path

import bpy
import numpy as np
from bpy_extras.object_utils import world_to_camera_view

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from mm_worker import render  # noqa: E402
from mm_worker.ops import Worker  # noqa: E402
from mm_worker.util import MANAGED_COLLECTION  # noqa: E402

FPS = 60.0
PHYSICS_HZ = 240.0
GRAVITY = 9.81
RADIUS = 0.008
HITS = 14
FIRST_HIT = 0.45
HIT_GAP = 0.32
COLUMN_X = 0.045
ROW_DROP = 0.05
PLATFORM = {'length': 0.055, 'thickness': 0.008, 'depth': 0.03}
TILT = 0.28
RAIL_TIME = 1.1
DURATION = FIRST_HIT + (HITS - 1) * HIT_GAP + RAIL_TIME + 0.9
OUT = Path(__file__).resolve().parents[2] / '.local' / 'look'
QUICK = '--quick' in sys.argv

summary = []


def check(condition, message):
    if not condition:
        raise AssertionError(message)
    summary.append('ok  ' + message)


def build_run():
    """Marble records [t, x, y, angle], hit points, rail path and timing of a zigzag between two columns"""
    hits = []
    for index in range(HITS):
        side = -1 if index % 2 == 0 else 1
        hits.append((FIRST_HIT + index * HIT_GAP, side * COLUMN_X, -index * ROW_DROP))
    rail_start = (hits[-1][1] + 0.02 * -1, hits[-1][2] - 0.07)
    rail_path = [rail_start, (rail_start[0] + 0.12, rail_start[1] - 0.012), (rail_start[0] + 0.24, rail_start[1] - 0.035)]
    wire = 0.0016 + 0.0025
    times = np.arange(0.0, DURATION + 1e-9, 1 / PHYSICS_HZ)
    x = np.empty_like(times)
    y = np.empty_like(times)
    release = (hits[0][1] - 0.01, hits[0][2] + 0.12, 0.1)
    landing = hits[-1][0] + 0.3
    for index, t in enumerate(times):
        if t <= release[2]:
            x[index], y[index] = release[0], release[1]
        elif t <= hits[0][0]:
            span = hits[0][0] - release[2]
            u = t - release[2]
            vy = (hits[0][2] - release[1] + GRAVITY / 2 * span * span) / span
            x[index] = release[0] + (hits[0][1] - release[0]) * u / span
            y[index] = release[1] + vy * u - GRAVITY / 2 * u * u
        elif t <= hits[-1][0]:
            k = min(int((t - hits[0][0]) / HIT_GAP), HITS - 2)
            (t0, x0, y0), (t1, x1, y1) = hits[k], hits[k + 1]
            u, span = t - t0, t1 - t0
            vy = (y1 - y0 + GRAVITY / 2 * span * span) / span
            x[index] = x0 + (x1 - x0) * u / span
            y[index] = y0 + vy * u - GRAVITY / 2 * u * u
        else:
            # Hop onto the rail, then roll along it and come to rest at its end
            on_rail = point_on_rail(rail_path, 0.0, RADIUS + wire)
            if t <= landing:
                u, span = t - hits[-1][0], landing - hits[-1][0]
                vy = (on_rail[1] - hits[-1][2] + GRAVITY / 2 * span * span) / span
                x[index] = hits[-1][1] + (on_rail[0] - hits[-1][1]) * u / span
                y[index] = hits[-1][2] + vy * u - GRAVITY / 2 * u * u
            else:
                progress = min(1.0, (t - landing) / RAIL_TIME)
                eased = progress * (2 - progress)
                x[index], y[index] = point_on_rail(rail_path, eased * 0.95, RADIUS + wire)
    travelled = np.concatenate([[0.0], np.cumsum(np.hypot(np.diff(x), np.diff(y)))])
    angle = -travelled / RADIUS
    records = np.stack([times, x, y, angle], axis=1).astype('<f4')
    return records, hits, rail_path


def point_on_rail(path, fraction, lift):
    lengths = [math.dist(a, b) for a, b in zip(path, path[1:])]
    target = fraction * sum(lengths)
    for (a, b), length in zip(zip(path, path[1:]), lengths):
        if target <= length or (a, b) == (path[-2], path[-1]):
            u = min(1.0, target / length)
            px, py = a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u
            tx, ty = (b[0] - a[0]) / length, (b[1] - a[1]) / length
            nx, ny = -ty, tx
            if ny < 0:
                nx, ny = -nx, -ny
            return px + nx * lift, py + ny * lift
        target -= length
    return path[-1]


def write_package(root, records, hits, rail_path):
    motion = root / '.cache' / 'motion'
    motion.mkdir(parents=True, exist_ok=True)
    records.tofile(motion / 'marble-1.bin')
    pieces = []
    for index, (t, hx, hy) in enumerate(hits):
        # Tilt each platform toward the other column so the bounce crosses over
        angle = TILT if hx < 0 else -TILT
        nx, ny = -math.sin(angle), math.cos(angle)
        offset = RADIUS + PLATFORM['thickness'] / 2
        pieces.append({
            'id': 'platform-%02d' % index, 'name': 'Platform %d' % (index + 1), 'type': 'platform',
            'params': PLATFORM, 'position': {'x': hx - nx * offset, 'y': hy - ny * offset}, 'angle': angle,
            'wallOffset': 0.0, 'hitTimes': [t], 'motionPath': None, 'sampleCount': 0, 'skin': None,
            'color': '#3b6fd9',
        })
    pieces.append({
        'id': 'rail-1', 'name': 'Rail', 'type': 'rail', 'params': {'radius': 0.0025, 'gap': 0.01, 'entryDelay': 0},
        'position': {'x': rail_path[0][0], 'y': rail_path[0][1]}, 'angle': 0.0, 'wallOffset': 0.0, 'hitTimes': [],
        'motionPath': None, 'sampleCount': 0, 'skin': None, 'color': '#3b6fd9',
        'path': [{'x': px, 'y': py} for px, py in rail_path],
    })
    times = np.arange(0.0, DURATION + 1e-9, 1 / PHYSICS_HZ)
    windmill = np.stack([times, 2.2 * times], axis=1).astype('<f4')
    windmill.tofile(motion / 'windmill-1.bin')
    pieces.append({
        'id': 'windmill-1', 'name': 'Windmill', 'type': 'windmill',
        'params': {'bladeCount': 4, 'bladeLength': 0.045, 'bladeThickness': 0.006, 'hubRadius': 0.008, 'depth': 0.03},
        'position': {'x': 0.16, 'y': hits[5][2]}, 'angle': 0.0, 'wallOffset': 0.0, 'hitTimes': [],
        'motionPath': '.cache/motion/windmill-1.bin', 'sampleCount': len(windmill), 'skin': None, 'color': '#3b6fd9',
    })
    description = {
        'version': 1, 'projectId': 'film-check', 'revision': 1, 'fps': FPS, 'duration': DURATION,
        'frame': {'width': 1080, 'height': 1920}, 'theme': 'brass',
        'marbles': [{'id': 'marble-1', 'name': 'Marble', 'radius': RADIUS, 'color': '#2f62d8',
                     'motionPath': '.cache/motion/marble-1.bin', 'sampleCount': len(records)}],
        'pieces': pieces,
        'camera': {'mode': 'rig', 'distance': 0.8, 'pitch': 0.45, 'lead': 0.2, 'smoothing': 0.6, 'shots': []},
    }
    (root / '.cache' / 'scene.json').write_text(json.dumps(description))
    write_soundtrack(root / 'renders' / 'soundtrack.wav', [hit[0] for hit in hits])


def write_soundtrack(path, hit_times, rate=48000):
    """A short bell-like ping per hit, rising in pitch, as a stereo 16-bit WAV"""
    path.parent.mkdir(parents=True, exist_ok=True)
    samples = np.zeros(int(DURATION * rate))
    for index, hit in enumerate(hit_times):
        start = int(hit * rate)
        length = min(len(samples) - start, int(0.6 * rate))
        t = np.arange(length) / rate
        frequency = 440 * 2 ** ((index % 8) * 2 / 12)
        samples[start:start + length] += 0.3 * np.sin(2 * np.pi * frequency * t) * np.exp(-t * 7)
    pcm = (np.clip(samples, -1, 1) * 32767).astype('<i2')
    with wave.open(str(path), 'wb') as output:
        output.setnchannels(2)
        output.setsampwidth(2)
        output.setframerate(rate)
        output.writeframes(np.repeat(pcm, 2).tobytes())


def ffprobe(path):
    tool = shutil.which('ffprobe') or '/opt/homebrew/bin/ffprobe'
    result = subprocess.run([tool, '-v', 'error', '-show_entries', 'format=duration:stream=codec_type,codec_name,width,height,r_frame_rate',
                             '-of', 'json', str(path)], capture_output=True, text=True, check=True)
    return json.loads(result.stdout)


def check_draft_film(worker, root, scene, final_started):
    """The draft preset renders the same range with Workbench, whatever engine is asked for, and leaves the scene be"""
    engine_before = scene.render.engine
    began = time.perf_counter()
    started = worker.handle('render_film', {'preset': 'draft', 'engine': 'cycles', 'outputPath': 'renders/film-draft.mp4',
                                            'audioPath': 'renders/soundtrack.wav', 'jobId': 'film-draft-check'})
    check(started['engine'] == 'workbench', 'draft preset renders with Workbench even when Cycles is asked for')
    check(scene.render.engine == engine_before, 'draft render leaves the live scene engine at %s' % engine_before)
    envelope = render.wait_for_job(root, 'film-draft-check', timeout=1800)
    check(envelope['ok'], 'draft render_film finishes: %s' % envelope.get('error'))
    result = envelope['result']
    film = OUT / 'brass-film-draft.mp4'
    shutil.copy(result['path'], film)
    probe = ffprobe(film)
    streams = {stream['codec_type']: stream for stream in probe['streams']}
    check(result['engine'] == 'workbench' and (streams['video']['width'], streams['video']['height']) == (720, 1280),
          'draft film is Workbench at 720x1280')
    check(streams['audio']['codec_name'] == 'aac', 'draft film carries the AAC soundtrack')
    check(started['frames'] == final_started['frames'] and started['fps'] == 30, 'draft film covers the same frames as final')
    # A frame at the fourth hit: the blue marble, deep navy against Brass's light wall and gold bars, and the brass
    # bars must read as their colours on the wall
    pixels = film_frame(film, started['width'], started['height'], math.ceil(FIRST_HIT * 30 + 3 * HIT_GAP * 30) / 30)
    red, green, blue = (pixels[..., channel].astype(float) for channel in range(3))
    marble = int(((blue > red + 30) & (blue > green + 15) & (blue < 140)).sum())
    brass = int(((red > blue + 50) & (green > blue + 20)).sum())
    check(marble > 40 and brass > 400, 'draft frame shows the deep blue marble (%d px) and brass bars (%d px)' % (marble, brass))
    summary.append('draft film: %d frames in %.1f s (%.0f ms/frame render), total %.1f s' % (
        result['frames'], result['renderSeconds'], result['msPerFrame'], time.perf_counter() - began))


def check_neon_still(worker, root, scene, seconds):
    """The same run in Neon: a dark wall that reads as navy, pieces whose edges glow in the marble's blue, and a
    marble that stays readable against the wall"""
    path = root / '.cache' / 'scene.json'
    description = json.loads(path.read_text())
    path.write_text(json.dumps(dict(description, theme='neon')))
    report = worker.handle('apply_scene', {'descriptionPath': '.cache/scene.json'})
    check(report['theme'] == 'neon' and report['themed'], 'the run re-themes to neon')
    still = OUT / ('neon-eevee-%.2fs.png' % seconds)
    render.render_still(scene, still, seconds, 540, 'eevee')
    # The film frame is 1080x1920, so a still 540 wide is 960 tall
    pixels = film_frame(still, 540, 960, 0.0)
    red, green, blue = (pixels[..., channel].astype(float) for channel in range(3))
    luminance = 0.2126 * red + 0.7152 * green + 0.0722 * blue
    check(float(np.median(luminance)) < 45 and float(np.median(blue - red)) > 4,
          'neon wall is dark navy (median luminance %.0f)' % np.median(luminance))
    glow = int(((blue > 170) & (blue > red + 60)).sum())
    check(glow > 400, 'neon pieces glow in the marble blue (%d px)' % glow)
    path.write_text(json.dumps(description))
    worker.handle('apply_scene', {'descriptionPath': '.cache/scene.json'})


def film_frame(path, width, height, seconds):
    """One decoded RGB frame of a film as a (height, width, 3) array"""
    tool = shutil.which('ffmpeg') or '/opt/homebrew/bin/ffmpeg'
    data = subprocess.run([tool, '-v', 'error', '-ss', '%.3f' % seconds, '-i', str(path), '-frames:v', '1', '-f', 'rawvideo',
                           '-pix_fmt', 'rgb24', '-'], capture_output=True, check=True).stdout
    return np.frombuffer(data, dtype=np.uint8).reshape(height, width, 3)


def main():
    root = Path(tempfile.mkdtemp(prefix='mm-film-')) / 'Film.marble'
    root.mkdir(parents=True)
    OUT.mkdir(parents=True, exist_ok=True)
    bpy.ops.wm.read_homefile(use_empty=True)
    records, hits, rail_path = build_run()
    write_package(root, records, hits, rail_path)
    worker = Worker(root)
    report = worker.handle('apply_scene', {'descriptionPath': '.cache/scene.json'})
    check(report['theme'] == 'brass' and report['camera'] == 'baked', 'brass scene applies with a baked follow camera')
    scene = bpy.context.scene
    marble = next(obj for obj in bpy.data.collections[MANAGED_COLLECTION].objects if obj.get('mm_role') == 'marble')
    views = []
    for frame in range(scene.frame_start, scene.frame_end + 1):
        scene.frame_set(frame)
        view = world_to_camera_view(scene, scene.camera, marble.matrix_world.translation)
        views.append((view.x, view.y))
    views = np.array(views)
    check(views.min() > 0.05 and views.max() < 0.95, 'marble stays in frame for the whole run')
    check(0.4 < float(np.median(views[:, 1])) < 0.7, 'marble sits slightly above frame centre (median %.2f)' % np.median(views[:, 1]))
    rotations = []
    for frame in range(scene.frame_start, scene.frame_end + 1, 6):
        scene.frame_set(frame)
        rotations.append(scene.camera.matrix_world.to_euler('XYZ').y)
    check(max(abs(b - a) for a, b in zip(rotations, rotations[1:])) < math.radians(4), 'camera roll changes slowly')

    timings = {}
    # The first whole frame after a hit: the marble touches the bar and the bar shows its dip
    stills = [math.ceil(hits[4][0] * FPS) / FPS, math.ceil(hits[9][0] * FPS) / FPS, hits[-1][0] + 0.6]
    for seconds in stills[:1 if QUICK else 3]:
        began = time.perf_counter()
        path = OUT / ('brass-eevee-%.2fs.png' % seconds)
        render.render_still(scene, path, seconds, 1080, 'eevee')
        timings.setdefault('eevee 1080x1920', []).append(time.perf_counter() - began)
        check(path.is_file(), 'Eevee still at %.2f s' % seconds)
    began = time.perf_counter()
    cycles_path = OUT / ('brass-cycles-%.2fs.png' % stills[0])
    render.render_still(scene, cycles_path, stills[0], 1080, 'cycles', 32 if QUICK else 64)
    timings['cycles 1080x1920'] = [time.perf_counter() - began]
    check(cycles_path.is_file(), 'Cycles still renders')

    began = time.perf_counter()
    started = worker.handle('render_film', {'preset': 'final', 'outputPath': 'renders/film-final.mp4',
                                            'audioPath': 'renders/soundtrack.wav', 'jobId': 'film-check'})
    last = {}
    envelope = render.wait_for_job(root, 'film-check', timeout=3600, on_progress=last.update)
    check(envelope['ok'], 'render_film finishes: %s' % envelope.get('error'))
    result = envelope['result']
    film = OUT / 'brass-film-final.mp4'
    shutil.copy(result['path'], film)
    probe = ffprobe(film)
    streams = {stream['codec_type']: stream for stream in probe['streams']}
    duration = float(probe['format']['duration'])
    check(streams['video']['codec_name'] == 'h264' and (streams['video']['width'], streams['video']['height']) == (1080, 1920),
          'film is H.264 at 1080x1920')
    check(streams['audio']['codec_name'] == 'aac', 'film carries the AAC soundtrack')
    check(abs(duration - started['frames'] / started['fps']) < 0.1 and duration >= 6.0, 'film lasts %.2f s' % duration)
    check(last.get('frames') == started['frames'], 'progress reports frames')
    summary.append('film: %d frames in %.1f s (%.0f ms/frame render), total %.1f s' % (
        result['frames'], result['renderSeconds'], result['msPerFrame'], time.perf_counter() - began))
    check_draft_film(worker, root, scene, started)
    check_neon_still(worker, root, scene, stills[0])
    for name, values in timings.items():
        summary.append('%s: %s' % (name, ', '.join('%.1f s' % value for value in values)))
    shutil.rmtree(root.parent, ignore_errors=True)
    print('\n'.join(summary))
    print('CHECK PASSED: %d assertions' % sum(1 for line in summary if line.startswith('ok')))


main()
