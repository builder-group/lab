"""Headless check of the background preview frames job on Jingle Bells.

Expects the package written by `tsx scripts/export-blender-fixture.ts jingle-bells .local/preview/package brass 30`
(the `blender:preview` script runs both). Applies the scene, starts `preview_render` at 10 s, retargets it to 25 s
once a few frames exist and checks the next frames follow the new playhead, then lets it fill the whole song at
Flat Light plus a short Fast refine around the playhead. Reports ms per frame and the time to fill the song, checks
the JPEG size, and that a second start with the same signature only retargets. `--quick` stops after the retarget.

Run: Blender --background --factory-startup --python-exit-code 1 --python blender/tests/check_preview_frames.py
"""
import json
import sys
import time
from pathlib import Path

import bpy

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from mm_worker import live_preview  # noqa: E402
from mm_worker.ops import Worker  # noqa: E402

OUT = Path(__file__).resolve().parents[2] / '.local' / 'preview'
PACKAGE = OUT / 'package'
SIGNATURE = 'check-%d' % int(time.time())
FPS = 30
LEAD = 90
QUICK = '--quick' in sys.argv

summary = []


def check(condition, message):
    if not condition:
        raise AssertionError(message)
    summary.append('ok  ' + message)


def order(target, total, lead=LEAD):
    """Same order as `previewFrameOrder` in the app: the playhead and `lead` frames ahead, then outward"""
    target = max(0, min(total - 1, target))
    frames = list(range(target, min(total, target + lead + 1)))
    behind, ahead = target - 1, target + lead + 1
    while behind >= 0 or ahead < total:
        if ahead < total:
            frames.append(ahead)
            ahead += 1
        if behind >= 0:
            frames.append(behind)
            behind -= 1
    return frames


def frames_on_disk(folder, suffix='.jpg'):
    names = [path.name for path in folder.glob('*' + suffix) if not path.name.startswith('.')]
    if suffix == '.jpg':
        names = [name for name in names if name.count('.') == 1]
    return sorted(int(name.split('.')[0]) for name in names)


def wait(folder, condition, timeout):
    began = time.monotonic()
    while time.monotonic() - began < timeout:
        status = read_status(folder)
        if condition(status):
            return status
        time.sleep(0.05)
    raise AssertionError('Timed out waiting for the preview job: ' + json.dumps(read_status(folder)))


def read_status(folder):
    try:
        return json.loads((folder / 'status.json').read_text())
    except (OSError, ValueError):
        return {}


def main():
    if not (PACKAGE / '.cache' / 'scene.json').is_file():
        raise SystemExit('Run `tsx scripts/export-blender-fixture.ts jingle-bells .local/preview/package brass 30` first')
    bpy.ops.wm.read_homefile(use_empty=True)
    worker = Worker(PACKAGE)
    applied = worker.handle('apply_scene', {'descriptionPath': '.cache/scene.json'})
    check(applied['frameEnd'] > applied['frameStart'], 'scene applied (%d frames)' % (applied['frameEnd'] - applied['frameStart']))
    scene = bpy.context.scene
    duration = (scene.frame_end - scene.frame_start) / (scene.render.fps / scene.render.fps_base)
    total = int(duration * FPS + 1e-6) + 1

    spawned = time.time()
    began = time.perf_counter()
    started = worker.handle('preview_render', {'signature': SIGNATURE, 'fps': FPS, 'width': 360,
                                               'order': order(300, total), 'refine': []})
    start_ms = (time.perf_counter() - began) * 1000
    folder = Path(started['folder'])
    check(not started['retargeted'] and started['frames'] == total, 'job started for %d frames (%.0f ms to save and spawn)' % (total, start_ms))
    check(started['width'] == 360 and started['height'] == 640, 'preview size %dx%d' % (started['width'], started['height']))

    status = wait(folder, lambda value: value.get('flat', 0) >= 8, 90)
    first_frame_s = time.time() - spawned
    rendered = frames_on_disk(folder)
    check(rendered[:8] == list(range(300, 308)), 'first frames start at the playhead (%s…)' % rendered[:4])

    again = worker.handle('preview_render', {'signature': SIGNATURE, 'fps': FPS, 'width': 360,
                                             'order': order(750, total), 'refine': list(range(750, 774))})
    check(again['retargeted'] and again['pid'] == started['pid'], 'same signature retargets the running job')
    before = set(frames_on_disk(folder))
    wait(folder, lambda value: len(set(frames_on_disk(folder)) - before) >= 2 * live_preview.CHUNK_FRAMES['flat'], 30)
    fresh = sorted(set(frames_on_disk(folder)) - before)
    # The chunk in flight when the target changed still comes from the old order
    check(sum(1 for index in fresh if 750 <= index <= 750 + LEAD) >= len(fresh) - live_preview.CHUNK_FRAMES['flat'], 'retargeted frames follow the new playhead (%s…)' % fresh[:4])

    if QUICK:
        worker.handle('preview_render_cancel', {})
        status = wait(folder, lambda value: value.get('state') == 'cancelled', 10)
        check(status['state'] == 'cancelled', 'cancel stops the job')
    else:
        status = wait(folder, lambda value: value.get('state') in ('done', 'failed'), 900)
        check(status['state'] == 'done', 'job finished: ' + str(status.get('error', 'done')))
        flat = frames_on_disk(folder)
        fast = frames_on_disk(folder, '.fast.jpg')
        check(flat == list(range(total)), 'every frame of the song rendered at Flat Light')
        check(fast == list(range(750, 774)), 'refine pass rendered Fast frames near the playhead')
        fill_s = status['flatDoneAt'] - spawned
        summary.append('    Flat Light %.1f ms/frame, Fast %s ms/frame, first frames %.1f s after the start, song filled at Flat Light %.1f s after the start'
                       % (status['flatMs'], status['fastMs'], first_frame_s, fill_s))
        size = sum((folder / ('%05d.jpg' % index)).stat().st_size for index in flat) / len(flat)
        summary.append('    average JPEG %.1f kB' % (size / 1024))
        image = bpy.data.images.load(str(folder / '00300.jpg'))
        check(tuple(image.size) == (360, 640), 'frame 300 is 360x640')
        (OUT / 'summary.json').write_text(json.dumps({**status, 'firstFrameS': first_frame_s, 'fillS': fill_s,
                                                      'startMs': start_ms, 'averageJpegKb': size / 1024}, indent=2))
    worker.handle('preview_render_cancel', {})
    print('\n'.join(summary))


main()
