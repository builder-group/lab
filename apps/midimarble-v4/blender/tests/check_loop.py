"""Headless seamless-loop check on the `loop` fixture.

Expects the package written by `tsx scripts/export-blender-fixture.ts loop .local/loop/package brass 30` (the
`blender:loop` script runs both). Applies the scene, then checks that the frame at the loop end repeats the first
frame: camera pose and focus, the ghost marble where the marble starts, the marble itself out of view, piece hit
values at rest. Renders stills at the loop start and end and compares them, renders the film at the fast preset,
plays it twice in a row with FFmpeg's concat demuxer and measures the image change across the seam against the
changes between neighbouring frames. Outputs go to `.local/loop/`: `loop-fast.mp4`, `loop-twice.mp4`,
`seam-sheet.png` (four frames before and after the seam), `start.png` and `end.png`.

Run: Blender --background --factory-startup --python-exit-code 1 --python blender/tests/check_loop.py
"""
import json
import shutil
import subprocess
import sys
from pathlib import Path

import bpy
import numpy as np
from bpy_extras.object_utils import world_to_camera_view

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from mm_worker import render  # noqa: E402
from mm_worker.ops import Worker  # noqa: E402
from mm_worker.util import MANAGED_COLLECTION  # noqa: E402

OUT = Path(__file__).resolve().parents[2] / '.local' / 'loop'
PACKAGE = OUT / 'package'
WIDTH = 720

summary = []


def check(condition, message):
    if not condition:
        raise AssertionError(message)
    summary.append('ok  ' + message)


def holder(mm_id):
    collection = bpy.data.collections[MANAGED_COLLECTION]
    return next(obj for obj in collection.objects if obj.get('mm_id') == mm_id and obj.type == 'EMPTY')


def in_view(scene, obj, margin=0.0):
    view = world_to_camera_view(scene, scene.camera, obj.matrix_world.translation)
    return view.z > 0 and -margin <= view.x <= 1 + margin and -margin <= view.y <= 1 + margin


def tool(name):
    return shutil.which(name) or '/opt/homebrew/bin/' + name


def decode(path, size=None):
    """Frames of a video or image as an (n, h, w, 3) float array"""
    command = [tool('ffmpeg'), '-v', 'error', '-i', str(path)]
    if size:
        command += ['-vf', 'scale=%d:%d' % size]
    # Passthrough keeps one output frame per coded frame; the concat file starts its video a little after its audio
    command += ['-fps_mode', 'passthrough', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']
    raw = subprocess.run(command, capture_output=True, check=True).stdout
    probe = subprocess.run([tool('ffprobe'), '-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height',
                            '-of', 'json', str(path)], capture_output=True, text=True, check=True)
    stream = json.loads(probe.stdout)['streams'][0]
    width, height = size or (stream['width'], stream['height'])
    return np.frombuffer(raw, dtype=np.uint8).reshape(-1, height, width, 3).astype(np.float64)


def main():
    description = json.loads((PACKAGE / '.cache' / 'scene.json').read_text())
    loop = description['loop']
    check(loop is not None, 'the fixture is a loop (%.3f s to %.3f s)' % (loop['start'], loop['end']))
    bpy.ops.wm.read_homefile(use_empty=True)
    worker = Worker(PACKAGE)
    report = worker.handle('apply_scene', {'descriptionPath': '.cache/scene.json'})
    check(report['camera'] == 'baked' and report['loop'] is not None, 'the loop scene applies with a baked camera')
    scene = bpy.context.scene
    fps = description['fps']
    start_frame, end_frame = round(loop['start'] * fps), round(loop['end'] * fps)
    check(scene.frame_end == end_frame, 'the scene ends on the loop end frame %d' % end_frame)

    ghost_description = next(item for item in description['marbles'] if item.get('ghostOf'))
    marble = holder(ghost_description['ghostOf'])
    ghost = holder(ghost_description['id'])
    pieces = [holder(piece['id']) for piece in description['pieces']]

    def state(frame):
        scene.frame_set(frame)
        return {
            'camera': scene.camera.matrix_world.copy(),
            'focus': scene.camera.data.dof.focus_distance,
            'marble': marble.matrix_world.translation.copy(),
            'ghost': ghost.matrix_world.translation.copy(),
            'marbleInView': in_view(scene, marble, 0.05),
            'hits': [float(piece.get('mm_hit', 0.0)) for piece in pieces],
        }

    first, last, seam = state(start_frame), state(end_frame - 1), state(end_frame)
    location_error = (seam['camera'].translation - first['camera'].translation).length
    rotation_error = seam['camera'].to_quaternion().rotation_difference(first['camera'].to_quaternion()).angle
    check(location_error < 1e-5 and rotation_error < 1e-5 and abs(seam['focus'] - first['focus']) < 1e-4,
          'camera keys at both ends match (%.1e m, %.1e rad)' % (location_error, rotation_error))
    ghost_error = (seam['ghost'] - first['marble']).length
    check(ghost_error < 5e-4, 'the ghost at the end is where the marble starts (%.2f mm)' % (ghost_error * 1000))
    check(first['marbleInView'], 'the marble is in view on the first frame')
    check(not last['marbleInView'] and not seam['marbleInView'], 'the marble has left the view on the last frame')
    check(max(seam['hits']) < 0.01 and max(first['hits']) < 0.01, 'no piece reacts at either end')
    # The ghost is hidden until its replay begins at the release point, and appears there out of view
    ghost_start = float(np.fromfile(PACKAGE / ghost_description['motionPath'], dtype='<f4')[0])
    ghost_skin = next(child for child in ghost.children if child.get('mm_visibility'))
    waiting = [frame for frame in range(start_frame, end_frame) if frame / fps < ghost_start - 1e-6]
    shown = [frame for frame in waiting if (scene.frame_set(frame) or not ghost_skin.hide_render)]
    check(waiting and not shown, 'the ghost is hidden on all %d frames before its replay' % len(waiting))
    entry_frame = waiting[-1] + 1
    scene.frame_set(entry_frame)
    check(not ghost_skin.hide_render and not in_view(scene, ghost, 0.05),
          'the ghost appears out of view at frame %d (%.2f s)' % (entry_frame, entry_frame / fps))

    # Stills at the first frame and at the loop end look the same
    OUT.mkdir(parents=True, exist_ok=True)
    render.render_still(scene, OUT / 'start.png', loop['start'], WIDTH, 'eevee', 16)
    render.render_still(scene, OUT / 'end.png', loop['end'], WIDTH, 'eevee', 16)
    start_image, end_image = decode(OUT / 'start.png')[0], decode(OUT / 'end.png')[0]
    still_difference = float(np.abs(start_image - end_image).mean())
    check(still_difference < 1.0, 'stills at the loop start and end differ by %.3f of 255 on average' % still_difference)

    # The film plays the loop range; played twice, the seam changes the image no more than neighbouring frames do
    started = worker.handle('render_film', {'preset': 'fast', 'outputPath': 'renders/loop-fast.mp4',
                                            'audioPath': 'renders/soundtrack.wav', 'jobId': 'loop-check'})
    expected = round((loop['end'] - loop['start']) * 30)
    check(started['frames'] == expected, 'the fast film renders %d frames of the loop' % expected)
    envelope = render.wait_for_job(PACKAGE, 'loop-check', timeout=3600)
    check(envelope['ok'], 'render_film finishes: %s' % envelope.get('error'))
    film = OUT / 'loop-fast.mp4'
    shutil.copy(envelope['result']['path'], film)
    concat = OUT / 'concat.txt'
    concat.write_text("file '%s'\nfile '%s'\n" % (film, film))
    twice = OUT / 'loop-twice.mp4'
    subprocess.run([tool('ffmpeg'), '-y', '-v', 'error', '-f', 'concat', '-safe', '0', '-i', str(concat), '-c', 'copy', str(twice)],
                   check=True)
    frames = decode(twice, (180, 320))
    check(len(frames) == 2 * expected, 'the doubled film has %d frames' % len(frames))
    steps = np.abs(np.diff(frames, axis=0)).mean(axis=(1, 2, 3))
    seam_step = float(steps[expected - 1])
    around = np.concatenate([steps[expected - 16:expected - 1], steps[expected:expected + 15]])
    check(seam_step <= max(1.5 * float(np.median(around)), float(around.max())),
          'the seam step %.2f is within neighbouring steps (median %.2f, max %.2f)' % (seam_step, np.median(around), around.max()))
    film_frames = decode(film, (180, 320))
    film_difference = float(np.abs(film_frames[0] - decode(OUT / 'end.png', (180, 320))[0]).mean())
    summary.append('first film frame vs end still: %.2f of 255 (H.264 and still differ in encoding)' % film_difference)
    summary.append('steps around the seam: %s | %.2f | %s' % (
        ' '.join('%.2f' % value for value in steps[expected - 5:expected - 1]), seam_step,
        ' '.join('%.2f' % value for value in steps[expected:expected + 4])))

    sheet = OUT / 'seam-sheet.png'
    subprocess.run([tool('ffmpeg'), '-y', '-v', 'error', '-i', str(twice), '-vf',
                    "select='between(n\\,%d\\,%d)',scale=240:-2,tile=8x1:padding=4:color=white" % (expected - 4, expected + 3),
                    '-frames:v', '1', '-fps_mode', 'passthrough', str(sheet)], check=True)
    check(sheet.is_file(), 'contact sheet of the seam written')
    print('\n'.join(summary))
    print('CHECK PASSED: %d assertions' % sum(1 for line in summary if line.startswith('ok')))


main()
