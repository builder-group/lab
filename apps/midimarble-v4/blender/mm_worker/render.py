"""Film rendering in a separate Blender process.

`render_film` saves a copy of the live scene into `renders/.jobs/<jobId>/scene.blend` and starts a background
Blender on it with `blender/render_job.py`, then answers right away with the job ID, so the live worker stays
responsive. The job renders frames to PNG, writes progress to `.bridge/outbox/<jobId>.progress.json`, muxes the
frames and the soundtrack WAV into an MP4 (H.264 + AAC) with FFmpeg, and finishes with the usual response envelope
in `.bridge/outbox/<jobId>.json`. Without an FFmpeg binary it encodes with Blender's own FFmpeg through the
sequencer instead.

`cancel` writes a cancel flag the job checks between frames and stops the process if it does not end in time.
The live worker notices jobs that exit without an answer and reports them as failed.

Frames are rendered by time, not by frame number: output frame i shows time i / preset fps, so 30 and 60 fps
presets work regardless of the frame rate the keyframes were written at. A loop scene (`mm_loop` from
`apply_scene`) renders its loop range instead: frame i shows loop start + i / fps, up to the frame before the loop
end.
"""
import json
import math
import os
import re
import shutil
import signal
import subprocess
import time
from pathlib import Path

import bpy

from .preview import temporary
from .util import WorkerError, resolve_package_path, write_json_atomic

PRESETS = {
    'fast': {'short': 720, 'fps': 30, 'eevee': 16, 'cycles': 32, 'x264': 'veryfast', 'crf': 20},
    'balanced': {'short': 1080, 'fps': 30, 'eevee': 32, 'cycles': 64, 'x264': 'medium', 'crf': 18},
    'best': {'short': 1080, 'fps': 60, 'eevee': 64, 'cycles': 128, 'x264': 'slow', 'crf': 17},
}
JOB_ID = re.compile(r'[A-Za-z0-9_-]{1,100}')
JOB_FOLDER = 'renders/.jobs'
CANCEL_GRACE_SECONDS = 5.0
FFMPEG_CANDIDATES = ('/opt/homebrew/bin/ffmpeg', '/usr/local/bin/ffmpeg', '/usr/bin/ffmpeg')
RENDER_JOB_SCRIPT = Path(__file__).resolve().parents[1] / 'render_job.py'


# Live worker side


def start_render_film(worker, args):
    preset_name = args.get('preset', 'balanced')
    if preset_name not in PRESETS:
        raise WorkerError('INVALID_ARGS', 'preset must be fast, balanced or best')
    engine = args.get('engine') or 'eevee'
    if engine not in ('eevee', 'cycles'):
        raise WorkerError('INVALID_ARGS', 'engine must be eevee or cycles')
    output = resolve_package_path(worker.project_dir, args.get('outputPath') or 'renders/film-%s.mp4' % preset_name)
    if output.suffix.lower() != '.mp4':
        raise WorkerError('INVALID_ARGS', 'outputPath must end in .mp4')
    audio = None
    if args.get('audioPath'):
        audio = resolve_package_path(worker.project_dir, args['audioPath'])
        if not audio.is_file():
            raise WorkerError('NOT_FOUND', 'Soundtrack not found: ' + args['audioPath'])
    job_id = args.get('jobId') or 'film-%d' % int(time.time() * 1000)
    if not JOB_ID.fullmatch(job_id):
        raise WorkerError('INVALID_ARGS', 'jobId may use letters, digits, - and _ only')
    if job_id in worker.jobs and worker.jobs[job_id].poll() is None:
        raise WorkerError('BUSY', 'Job ' + job_id + ' is already rendering')
    scene = bpy.context.scene
    if scene.camera is None:
        raise WorkerError('NO_CAMERA', 'The scene has no active camera')

    job_dir = worker.project_dir / JOB_FOLDER / job_id
    if job_dir.exists():
        shutil.rmtree(job_dir)
    job_dir.mkdir(parents=True)
    preset = PRESETS[preset_name]
    width, height = preset_size(scene, preset['short'])
    scene_fps = scene.render.fps / scene.render.fps_base
    start_time = scene.frame_start / scene_fps
    duration = (scene.frame_end - scene.frame_start) / scene_fps
    loop = scene.get('mm_loop')
    if loop is not None and len(loop) >= 2:
        # A loop film shows [start, end): the frame at `end` repeats the first, so repeating the MP4 is seamless
        start_time, duration = float(loop[0]), float(loop[1]) - float(loop[0])
    frame_count = max(1, int(round(duration * preset['fps'])))
    samples = args.get('samples')
    job = {
        'id': job_id,
        'projectDir': str(worker.project_dir),
        'preset': preset_name,
        'engine': engine,
        'fps': preset['fps'],
        'width': width,
        'height': height,
        'frames': frame_count,
        'duration': frame_count / preset['fps'],
        'startTime': start_time,
        'loop': loop is not None,
        'samples': int(samples) if isinstance(samples, (int, float)) and samples > 0 else preset[engine],
        'x264Preset': preset['x264'],
        'crf': preset['crf'],
        'output': str(output),
        'audio': str(audio) if audio else None,
        'keepFrames': bool(args.get('keepFrames')),
        'hostPid': getattr(worker, 'host_pid', None),
        'outbox': str(worker.project_dir / '.bridge' / 'outbox'),
    }
    write_json_atomic(job_dir / 'job.json', job)
    bpy.ops.wm.save_as_mainfile(filepath=str(job_dir / 'scene.blend'), copy=True, relative_remap=True, compress=False)
    command = [
        bpy.app.binary_path, '--background', '--factory-startup', str(job_dir / 'scene.blend'),
        '--python-exit-code', '1', '--python', str(RENDER_JOB_SCRIPT), '--', str(job_dir / 'job.json'),
    ]
    log = (job_dir / 'render.log').open('w')
    environment = {**os.environ, 'PYTHONDONTWRITEBYTECODE': '1'}
    process = subprocess.Popen(command, stdout=log, stderr=subprocess.STDOUT, stdin=subprocess.DEVNULL, env=environment,
                               start_new_session=True)
    log.close()
    worker.jobs[job_id] = process
    return {'jobId': job_id, 'pid': process.pid, 'frames': frame_count, 'fps': preset['fps'], 'width': width,
            'height': height, 'engine': engine, 'jobDir': str(job_dir)}


def cancel(worker, args):
    job_id = args.get('jobId')
    if not isinstance(job_id, str) or not JOB_ID.fullmatch(job_id):
        raise WorkerError('INVALID_ARGS', 'cancel needs a jobId')
    job_dir = worker.project_dir / JOB_FOLDER / job_id
    if not job_dir.is_dir():
        raise WorkerError('NOT_FOUND', 'Unknown job ' + job_id)
    (job_dir / 'cancel').write_text('cancel')
    process = worker.jobs.get(job_id)
    if process is not None and process.poll() is None:
        try:
            process.wait(CANCEL_GRACE_SECONDS)
        except subprocess.TimeoutExpired:
            stop_process(process)
    finish_orphan(worker.project_dir, job_id)
    worker.jobs.pop(job_id, None)
    return {'jobId': job_id, 'cancelled': True}


def stop_process(process):
    try:
        os.killpg(process.pid, signal.SIGTERM)
        process.wait(5)
    except (ProcessLookupError, subprocess.TimeoutExpired, PermissionError):
        try:
            os.killpg(process.pid, signal.SIGKILL)
        except (ProcessLookupError, PermissionError):
            pass
        process.wait()


def poll_jobs(worker):
    """Reports jobs whose process ended without writing an answer"""
    for job_id, process in list(worker.jobs.items()):
        if process.poll() is None:
            continue
        finish_orphan(worker.project_dir, job_id)
        worker.jobs.pop(job_id, None)


def stop_all(worker):
    for job_id, process in list(worker.jobs.items()):
        if process.poll() is None:
            stop_process(process)
        finish_orphan(worker.project_dir, job_id)
    worker.jobs.clear()


def finish_orphan(project_dir, job_id):
    job_dir = Path(project_dir) / JOB_FOLDER / job_id
    if (job_dir / 'result.json').is_file():
        return
    cancelled = (job_dir / 'cancel').is_file()
    error = {'code': 'CANCELLED', 'message': 'The render was cancelled'} if cancelled else {
        'code': 'FAILED', 'message': 'The render process ended unexpectedly. See ' + str(job_dir / 'render.log')}
    finish(Path(project_dir) / '.bridge' / 'outbox', job_dir, job_id, error=error)


def finish(outbox, job_dir, job_id, result=None, error=None):
    envelope = {'id': job_id, 'ok': error is None}
    if error is None:
        envelope['result'] = result
    else:
        envelope['error'] = error
    write_json_atomic(Path(job_dir) / 'result.json', envelope)
    write_json_atomic(Path(outbox) / (job_id + '.json'), envelope)
    (Path(outbox) / (job_id + '.progress.json')).unlink(missing_ok=True)


def wait_for_job(project_dir, job_id, timeout=3600.0, on_progress=None):
    """Blocks until the job's envelope arrives; used by headless checks. Takes the envelope like the host does."""
    outbox = Path(project_dir) / '.bridge' / 'outbox'
    response = outbox / (job_id + '.json')
    progress = outbox / (job_id + '.progress.json')
    began = time.monotonic()
    while time.monotonic() - began < timeout:
        if response.is_file():
            envelope = json.loads(response.read_text())
            response.unlink(missing_ok=True)
            return envelope
        if on_progress is not None and progress.is_file():
            try:
                on_progress(json.loads(progress.read_text()))
            except (json.JSONDecodeError, OSError):
                pass
        time.sleep(0.2)
    raise TimeoutError('Render job ' + job_id + ' did not finish in time')


def preset_size(scene, short_side):
    aspect = scene.render.resolution_x / scene.render.resolution_y
    if aspect < 1:
        width, height = short_side, short_side / aspect
    else:
        width, height = short_side * aspect, short_side
    # H.264 with yuv420p needs even dimensions
    return int(round(width / 2) * 2), int(round(height / 2) * 2)


# Shared render settings


def engine_settings(scene, engine, samples, width, height):
    """Settings for one render, applied through `preview.temporary` so the scene keeps its own values"""
    settings = [
        (scene.render, 'resolution_x', width),
        (scene.render, 'resolution_y', height),
        (scene.render, 'resolution_percentage', 100),
        (scene.render.image_settings, 'file_format', 'PNG'),
        (scene.render.image_settings, 'color_mode', 'RGB'),
        (scene.render.image_settings, 'color_depth', '8'),
        (scene.render, 'film_transparent', False),
    ]
    if engine == 'cycles':
        settings += [(scene.render, 'engine', 'CYCLES')]
        if samples:
            settings += [(scene.cycles, 'samples', samples), (scene.cycles, 'use_denoising', True)]
    else:
        settings += [(scene.render, 'engine', 'BLENDER_EEVEE')]
        if samples:
            settings += [(scene.eevee, 'taa_render_samples', samples)]
    return settings


def use_gpu_for_cycles(scene):
    try:
        preferences = bpy.context.preferences.addons['cycles'].preferences
        preferences.compute_device_type = 'METAL'
        preferences.get_devices()
        for device in preferences.devices:
            device.use = True
        scene.cycles.device = 'GPU'
        return True
    except (KeyError, TypeError, AttributeError):
        return False


def set_time(scene, seconds):
    fps = scene.render.fps / scene.render.fps_base
    frame_float = seconds * fps
    frame = math.floor(frame_float + 1e-6)
    scene.frame_set(frame, subframe=max(0.0, frame_float - frame))


def render_still(scene, path, seconds, width, engine='eevee', samples=None):
    """Renders one frame at `seconds` to `path` with the scene aspect and returns the path"""
    height = max(2, round(width * scene.render.resolution_y / scene.render.resolution_x))
    if engine == 'cycles':
        use_gpu_for_cycles(scene)
    previous = scene.frame_current
    set_time(scene, seconds)
    try:
        with temporary([*engine_settings(scene, engine, samples, width, height), (scene.render, 'filepath', str(path))]):
            bpy.ops.render.render(write_still=True)
    finally:
        scene.frame_set(previous)
    return str(path)


# Job process side


class Cancelled(Exception):
    pass


def run_job(job_path):
    job_path = Path(job_path)
    job = json.loads(job_path.read_text())
    job_dir = job_path.parent
    outbox = Path(job['outbox'])
    job_id = job['id']
    try:
        result = render_job(job, job_dir, outbox)
        finish(outbox, job_dir, job_id, result=result)
    except Cancelled:
        finish(outbox, job_dir, job_id, error={'code': 'CANCELLED', 'message': 'The render was cancelled'})
    except Exception as error:  # noqa: BLE001 - every failure must reach the host as an answer
        import traceback
        traceback.print_exc()
        finish(outbox, job_dir, job_id, error={'code': 'FAILED', 'message': type(error).__name__ + ': ' + str(error)})


def render_job(job, job_dir, outbox):
    scene = bpy.context.scene
    frames_dir = job_dir / 'frames'
    frames_dir.mkdir(exist_ok=True)
    engine = job['engine']
    if engine == 'cycles':
        use_gpu_for_cycles(scene)
    count = int(job['frames'])
    fps = float(job['fps'])
    progress_path = outbox / (job['id'] + '.progress.json')
    began = time.perf_counter()
    last_progress = 0.0

    def report(fraction, phase, frame=None, ms_per_frame=None):
        write_json_atomic(progress_path, {
            'id': job['id'], 'progress': max(0.0, min(1.0, fraction)), 'phase': phase, 'frame': frame,
            'frames': count, 'msPerFrame': ms_per_frame, 'updatedAt': time.time()})

    report(0.0, 'Preparing')
    settings = engine_settings(scene, engine, job['samples'], job['width'], job['height'])
    with temporary(settings):
        for index in range(count):
            check_cancel(job, job_dir)
            set_time(scene, job['startTime'] + index / fps)
            scene.render.filepath = str(frames_dir / ('%05d.png' % index))
            bpy.ops.render.render(write_still=True)
            elapsed = time.perf_counter() - began
            now = time.monotonic()
            if now - last_progress > 0.25 or index == count - 1:
                last_progress = now
                report(0.95 * (index + 1) / count, 'Rendering frame %d of %d' % (index + 1, count), index + 1,
                       round(elapsed * 1000 / (index + 1), 1))
    render_seconds = time.perf_counter() - began
    check_cancel(job, job_dir)
    report(0.96, 'Encoding')
    output = Path(job['output'])
    output.parent.mkdir(parents=True, exist_ok=True)
    temporary_output = output.with_name(output.stem + '.partial.mp4')
    encoder = encode(job, job_dir, frames_dir, temporary_output)
    temporary_output.replace(output)
    if not job.get('keepFrames'):
        shutil.rmtree(frames_dir, ignore_errors=True)
        (job_dir / 'scene.blend').unlink(missing_ok=True)
    return {
        'path': str(output),
        'frames': count,
        'fps': fps,
        'width': job['width'],
        'height': job['height'],
        'duration': count / fps,
        'engine': engine,
        'samples': job['samples'],
        'encoder': encoder,
        'renderSeconds': round(render_seconds, 2),
        'msPerFrame': round(render_seconds * 1000 / count, 1),
        'hasAudio': job.get('audio') is not None,
    }


def check_cancel(job, job_dir):
    if (job_dir / 'cancel').is_file():
        raise Cancelled()
    host = job.get('hostPid')
    if host:
        try:
            os.kill(int(host), 0)
        except ProcessLookupError:
            raise Cancelled()
        except PermissionError:
            pass


def find_ffmpeg():
    configured = os.environ.get('MIDIMARBLE_FFMPEG')
    if configured == 'blender':
        return None
    for candidate in [configured, shutil.which('ffmpeg'), *FFMPEG_CANDIDATES]:
        if candidate and Path(candidate).is_file() and os.access(candidate, os.X_OK):
            return candidate
    return None


def encode(job, job_dir, frames_dir, output):
    ffmpeg = find_ffmpeg()
    if ffmpeg is None:
        encode_with_blender(job, frames_dir, output)
        return 'blender'
    command = [ffmpeg, '-y', '-loglevel', 'error', '-framerate', str(job['fps']), '-i', str(frames_dir / '%05d.png')]
    if job.get('audio'):
        command += ['-i', job['audio'], '-map', '0:v:0', '-map', '1:a:0', '-c:a', 'aac', '-b:a', '192k']
    command += ['-c:v', 'libx264', '-preset', job['x264Preset'], '-crf', str(job['crf']), '-pix_fmt', 'yuv420p',
                '-movflags', '+faststart', '-t', '%.4f' % job['duration'], str(output)]
    with (job_dir / 'ffmpeg.log').open('w') as log:
        process = subprocess.Popen(command, stdout=log, stderr=subprocess.STDOUT, stdin=subprocess.DEVNULL)
        while process.poll() is None:
            if (job_dir / 'cancel').is_file():
                process.terminate()
                process.wait()
                raise Cancelled()
            time.sleep(0.1)
    if process.returncode != 0:
        raise RuntimeError('FFmpeg failed: ' + (job_dir / 'ffmpeg.log').read_text()[-2000:])
    return 'ffmpeg'


def encode_with_blender(job, frames_dir, output):
    """Encodes the frames and soundtrack with Blender's FFmpeg through a sequencer scene"""
    frames = sorted(frames_dir.glob('*.png'))
    scene = bpy.data.scenes.new('MM encode')
    scene.render.fps = int(job['fps'])
    scene.render.fps_base = 1.0
    scene.render.resolution_x = job['width']
    scene.render.resolution_y = job['height']
    scene.render.resolution_percentage = 100
    scene.frame_start = 1
    scene.frame_end = len(frames)
    editor = scene.sequence_editor_create()
    strip = editor.strips.new_image('frames', str(frames[0]), 1, 1)
    for frame in frames[1:]:
        strip.elements.append(frame.name)
    strip.frame_final_duration = len(frames)
    if job.get('audio'):
        editor.strips.new_sound('soundtrack', job['audio'], 2, 1)
    settings = scene.render.image_settings
    try:
        settings.media_type = 'VIDEO'
    except (AttributeError, TypeError):
        pass
    settings.file_format = 'FFMPEG'
    scene.render.ffmpeg.format = 'MPEG4'
    scene.render.ffmpeg.codec = 'H264'
    scene.render.ffmpeg.constant_rate_factor = 'HIGH'
    scene.render.ffmpeg.audio_codec = 'AAC' if job.get('audio') else 'NONE'
    scene.render.ffmpeg.audio_bitrate = 192
    scene.render.ffmpeg.audio_mixrate = 48000
    scene.render.use_sequencer = True
    scene.view_settings.view_transform = 'Standard'
    scene.render.filepath = str(output)
    scene.render.use_file_extension = False
    bpy.ops.render.render(animation=True, scene=scene.name)
    if not output.is_file():
        raise RuntimeError('Blender did not write ' + str(output))
