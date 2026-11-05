"""Background preview frames for Film playback, like Final Cut's background render.

`preview_render` saves a copy of the live scene into `.cache/preview-frames/<signature>/scene.blend` and starts a
background Blender on it with `blender/preview_job.py`, so the live worker stays responsive. The job renders small
JPEG frames with Eevee and the film's own lights into the same folder: `00042.jpg` is frame 42, time
`startTime + 42 / fps`.

The app decides the order. It writes `target.json` (`{"order": [...], "paused": false}`) into the folder, through
this op or directly through the host, whenever the person stops working. The job re-reads it between chunks: it takes
the first frame of `order` without a file and renders it with its missing neighbours as one short animation render
(`CHUNK_FRAMES`), which keeps Blender's render scene between frames. While `paused` it sleeps, keeping its scene and
shaders. It exits once `order` is done. `cancel` in the folder stops it between chunks. `status.json` reports progress,
with `pid` naming the run.

The signature names the scene: the app hashes the scene description and motion files it applied, so any scene
change starts a new folder and leaves the old frames unused (invalidate all). Undo returns to an earlier signature
whose frames are still there; the newest `KEEP_SIGNATURES` folders stay.
"""
import json
import os
import shutil
import subprocess
import sys
import time
from pathlib import Path

import bpy

from .preview import temporary
from .render import JOB_ID, engine_settings, stop_process
from .util import WorkerError, write_json_atomic

PREVIEW_FOLDER = '.cache/preview-frames'
KEEP_SIGNATURES = 3
DEFAULT_WIDTH = 360
DEFAULT_FPS = 30.0
SAMPLES = 8
# Frames per animation render: short enough to pause, follow a new playhead or cancel within about a second
CHUNK_FRAMES = 4
# Seconds between looks at `target.json` while paused, and between status updates that say the job is alive
PAUSE_SLEEP_SECONDS = 0.25
PAUSE_REPORT_SECONDS = 5.0
# The job shares the machine with the person's work: lower priority, and never every core
NICENESS = 10
MAX_THREADS = 4
JPEG_QUALITY = 82
STOP_GRACE_SECONDS = 2.0
JOB_SCRIPT = Path(__file__).resolve().parents[1] / 'preview_job.py'


# Live worker side


def start_preview_render(worker, args):
    signature = args.get('signature')
    if not isinstance(signature, str) or not JOB_ID.fullmatch(signature):
        raise WorkerError('INVALID_ARGS', 'preview_render needs a signature of letters, digits, - and _')
    width = int(args.get('width') or DEFAULT_WIDTH)
    if not 64 <= width <= 1080:
        raise WorkerError('INVALID_ARGS', 'Preview width must be between 64 and 1080')
    fps = float(args.get('fps') or DEFAULT_FPS)
    if not 1 <= fps <= 60:
        raise WorkerError('INVALID_ARGS', 'Preview fps must be between 1 and 60')
    target = {'order': int_list(args.get('order')), 'paused': args.get('paused') is True}
    folder = preview_folder(worker.project_dir, signature)
    current = getattr(worker, 'preview', None)
    if current is not None and current['signature'] == signature and current['process'].poll() is None:
        (folder / 'cancel').unlink(missing_ok=True)
        write_json_atomic(folder / 'target.json', target)
        return {**current['info'], 'retargeted': True}
    stop_preview(worker)
    scene = bpy.context.scene
    if scene.camera is None:
        raise WorkerError('NO_CAMERA', 'The scene has no active camera')

    folder.mkdir(parents=True, exist_ok=True)
    (folder / 'cancel').unlink(missing_ok=True)
    height = max(2, int(round(width * scene.render.resolution_y / scene.render.resolution_x / 2)) * 2)
    scene_fps = scene.render.fps / scene.render.fps_base
    # Preview frames are every `step`-th scene frame, so the job can render them as animation chunks
    step = max(1, int(round(scene_fps / fps)))
    fps = scene_fps / step
    start_time = scene.frame_start / scene_fps
    frames = max(0, scene.frame_end - scene.frame_start) // step + 1
    job = {
        'signature': signature,
        'fps': fps,
        'step': step,
        'frameStart': scene.frame_start,
        'width': width,
        'height': height,
        'frames': frames,
        'startTime': start_time,
        'hostPid': getattr(worker, 'host_pid', None),
    }
    write_json_atomic(folder / 'job.json', job)
    write_json_atomic(folder / 'target.json', target)
    bpy.ops.wm.save_as_mainfile(filepath=str(folder / 'scene.blend'), copy=True, relative_remap=True, compress=False)
    command = [
        bpy.app.binary_path, '--background', '--factory-startup', '--threads', str(MAX_THREADS), str(folder / 'scene.blend'),
        '--python-exit-code', '1', '--python', str(JOB_SCRIPT), '--', str(folder / 'job.json'),
    ]
    log = (folder / 'render.log').open('w')
    environment = {**os.environ, 'PYTHONDONTWRITEBYTECODE': '1'}
    process = subprocess.Popen(command, stdout=log, stderr=subprocess.STDOUT, stdin=subprocess.DEVNULL, env=environment,
                               start_new_session=True)
    log.close()
    info = {'signature': signature, 'pid': process.pid, 'frames': frames, 'fps': fps, 'width': width, 'height': height,
            'startTime': start_time, 'folder': str(folder)}
    worker.preview = {'signature': signature, 'process': process, 'info': info}
    prune(worker.project_dir, keep=signature)
    return {**info, 'retargeted': False}


def cancel_preview_render(worker, args):
    stopped = stop_preview(worker)
    return {'cancelled': stopped}


def stop_preview(worker):
    current = getattr(worker, 'preview', None)
    worker.preview = None
    if current is None:
        return False
    process = current['process']
    if process.poll() is not None:
        return False
    (Path(current['info']['folder']) / 'cancel').write_text('cancel')
    try:
        process.wait(STOP_GRACE_SECONDS)
    except subprocess.TimeoutExpired:
        stop_process(process)
    return True


def poll_preview(worker):
    """Forgets a preview job whose process ended, so the next `preview_render` starts a new one"""
    current = getattr(worker, 'preview', None)
    if current is not None and current['process'].poll() is not None:
        worker.preview = None


def preview_folder(project_dir, signature):
    return Path(project_dir) / PREVIEW_FOLDER / signature


def prune(project_dir, keep):
    root = Path(project_dir) / PREVIEW_FOLDER
    folders = sorted((path for path in root.iterdir() if path.is_dir() and path.name != keep),
                     key=lambda path: path.stat().st_mtime, reverse=True)
    for path in folders[KEEP_SIGNATURES - 1:]:
        shutil.rmtree(path, ignore_errors=True)


def int_list(value):
    if not isinstance(value, list):
        return []
    return [int(item) for item in value if isinstance(item, (int, float)) and item >= 0]


def frame_path(folder, index):
    return Path(folder) / ('%05d.jpg' % index)


def next_frame(target, frames, has_frame):
    """The first frame of `order` without a file, or None when it is done"""
    for index in target.get('order') or []:
        if 0 <= index < frames and not has_frame(index):
            return index
    return None


def chunk_around(index, frames, missing, size):
    """(first, last) of up to `size` missing frames in a row with `index`: forward from it, or backward to it when
    the frame after it is done, which is how the outward order reaches frames behind the playhead"""
    if not missing(index + 1) and index > 0 and missing(index - 1):
        first = index
        while first > 0 and index - first + 1 < size and missing(first - 1):
            first -= 1
        return first, index
    last = index
    while last + 1 < frames and last - index + 1 < size and missing(last + 1):
        last += 1
    return index, last


# Job process side


class Stopped(Exception):
    pass


def run_preview_job(job_path):
    job_path = Path(job_path)
    job = json.loads(job_path.read_text())
    folder = job_path.parent
    os.nice(NICENESS)
    began = time.time()
    status = {'signature': job['signature'], 'state': 'rendering', 'frames': job['frames'], 'fps': job['fps'],
              'startTime': job['startTime'], 'width': job['width'], 'height': job['height'], 'pid': os.getpid(),
              'rendered': 0, 'frameMs': None, 'startedAt': began, 'updatedAt': began}
    write_json_atomic(folder / 'status.json', status)
    try:
        render_preview_frames(job, folder, status)
        status['state'] = 'done'
    except Stopped:
        status['state'] = 'cancelled'
    except Exception as error:  # noqa: BLE001 - the app reads the failure from the status
        import traceback
        traceback.print_exc()
        status['state'] = 'failed'
        status['error'] = type(error).__name__ + ': ' + str(error)
    status['updatedAt'] = time.time()
    write_json_atomic(folder / 'status.json', status)


def render_preview_frames(job, folder, status):
    """Renders the target's frames in chunks of consecutive frames as short animation renders: Blender keeps the
    render scene between the frames of one animation render, and Eevee its compiled shaders"""
    scene = bpy.context.scene
    frames = int(job['frames'])
    step = int(job.get('step', 1))
    frame_start = int(job.get('frameStart', scene.frame_start))
    settings = engine_settings(scene, 'eevee', SAMPLES, int(job['width']), int(job['height'])) + [
        (scene.render.image_settings, 'file_format', 'JPEG'), (scene.render.image_settings, 'quality', JPEG_QUALITY),
        (scene.render.image_settings, 'color_mode', 'RGB'), (scene.render, 'use_file_extension', True),
        (scene.render, 'use_overwrite', True), (scene.render, 'use_placeholder', False), (scene, 'frame_step', step)]
    existing = {name for name in os.listdir(folder) if name.endswith('.jpg') and not name.startswith('.')}

    def has_frame(index):
        return ('%05d.jpg' % index) in existing

    status['rendered'] = len(existing)
    target_path = folder / 'target.json'
    target, target_stamp = {}, None
    timings = []
    with temporary(settings):
        while True:
            check_stop(job, folder)
            stamp = target_path.stat().st_mtime_ns if target_path.is_file() else None
            if stamp != target_stamp:
                target_stamp = stamp
                try:
                    target = json.loads(target_path.read_text())
                except (OSError, ValueError):
                    target = {}
            if target.get('paused') is True:
                if time.time() - status['updatedAt'] > PAUSE_REPORT_SECONDS:
                    report(folder, status, timings)
                time.sleep(PAUSE_SLEEP_SECONDS)
                continue
            index = next_frame(target, frames, has_frame)
            if index is None:
                break
            wanted = set(target.get('order') or [])
            first, last = chunk_around(index, frames, lambda other: other in wanted and 0 <= other < frames and not has_frame(other),
                                       CHUNK_FRAMES)
            began = time.perf_counter()
            with temporary([(scene, 'frame_start', frame_start + first * step), (scene, 'frame_end', frame_start + last * step),
                            (scene.render, 'filepath', str(folder / '.partial-#####'))]):
                bpy.ops.render.render(animation=True)
            # Each frame appears under its final name in one rename, so the app never reads a half-written JPEG
            for other in range(first, last + 1):
                partial = folder / ('.partial-%05d.jpg' % (frame_start + other * step))
                if partial.is_file():
                    final = frame_path(folder, other)
                    os.replace(partial, final)
                    existing.add(final.name)
                    status['rendered'] += 1
            timings.append(((time.perf_counter() - began) * 1000, last - first + 1))
            report(folder, status, timings)


def report(folder, status, timings):
    recent = timings[-20:]
    if recent:
        status['frameMs'] = round(sum(ms for ms, _ in recent) / sum(count for _, count in recent), 1)
    status['updatedAt'] = time.time()
    write_json_atomic(Path(folder) / 'status.json', status)


def check_stop(job, folder):
    if (folder / 'cancel').is_file():
        raise Stopped()
    host = job.get('hostPid')
    if host:
        try:
            os.kill(int(host), 0)
        except ProcessLookupError:
            raise Stopped()
        except PermissionError:
            pass


def main():
    run_preview_job(sys.argv[sys.argv.index('--') + 1])
