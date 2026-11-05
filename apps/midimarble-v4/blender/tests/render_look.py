"""Applies an exported package and renders stills for look review.

Run: Blender --background --factory-startup --python blender/tests/render_look.py -- <package> <out-dir> [--times 1.0,2.5]
     [--engine eevee|cycles] [--width 540] [--samples N] [--film final] [--marble-skin marble:glass] [--marble-variant cats-eye]
"""
import argparse
import json
import shutil
import sys
import time
from pathlib import Path

import bpy

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from mm_worker import render  # noqa: E402
from mm_worker.ops import Worker  # noqa: E402

parser = argparse.ArgumentParser()
parser.add_argument('package')
parser.add_argument('out')
parser.add_argument('--times', default='')
parser.add_argument('--engine', default='eevee')
parser.add_argument('--width', type=int, default=540)
parser.add_argument('--samples', type=int, default=0)
parser.add_argument('--film', default='')
parser.add_argument('--hits', type=int, default=0, help='Also render stills at the first N hit times')
parser.add_argument('--marble-skin', default='', help='Dress every marble in this skin, such as marble:glass')
parser.add_argument('--marble-variant', default='')
parser.add_argument('--suffix', default='')
arguments = parser.parse_args(sys.argv[sys.argv.index('--') + 1:])

package = Path(arguments.package).resolve()
out = Path(arguments.out).resolve()
out.mkdir(parents=True, exist_ok=True)
bpy.ops.wm.read_homefile(use_empty=True)
worker = Worker(package)
description_path = '.cache/scene.json'
if arguments.marble_skin:
    look = json.loads((package / description_path).read_text())
    for marble in look['marbles']:
        marble['skin'] = {'assetId': arguments.marble_skin, **({'variant': arguments.marble_variant} if arguments.marble_variant else {})}
    description_path = '.cache/scene-look.json'
    (package / description_path).write_text(json.dumps(look))
report = worker.handle('apply_scene', {'descriptionPath': description_path})
print('APPLY', json.dumps({key: report[key] for key in ('camera', 'theme', 'keyframes', 'ms')}))
scene = bpy.context.scene


def marble_view_stats():
    """Where the marbles appear in the camera image over the whole run, as fractions of the frame"""
    from bpy_extras.object_utils import world_to_camera_view
    from mm_worker.util import MANAGED_COLLECTION
    marbles = [obj for obj in bpy.data.collections[MANAGED_COLLECTION].objects if obj.get('mm_role') == 'marble']
    xs, ys = [], []
    for frame in range(scene.frame_start, scene.frame_end + 1):
        scene.frame_set(frame)
        for marble in marbles:
            view = world_to_camera_view(scene, scene.camera, marble.matrix_world.translation)
            xs.append(view.x)
            ys.append(view.y)
    xs.sort()
    ys.sort()
    pick = lambda values, q: round(values[int(q * (len(values) - 1))], 3)
    return {'x': [pick(xs, q) for q in (0, 0.05, 0.5, 0.95, 1)], 'y': [pick(ys, q) for q in (0, 0.05, 0.5, 0.95, 1)]}


print('MARBLE VIEW', json.dumps(marble_view_stats()))

times = [float(value) for value in arguments.times.split(',') if value]
if arguments.hits:
    description = json.loads((package / '.cache' / 'scene.json').read_text())
    hit_times = sorted(time_value for piece in description['pieces'] for time_value in piece['hitTimes'])
    times += hit_times[:arguments.hits]
for seconds in times:
    began = time.perf_counter()
    path = render.render_still(scene, out / ('%s%s-%s-%05.2f.png' % (package.stem, arguments.suffix, arguments.engine, seconds)), seconds,
                               arguments.width, arguments.engine, arguments.samples or None)
    print('STILL %s %.2fs %.0f ms' % (path, seconds, (time.perf_counter() - began) * 1000))

if arguments.film:
    began = time.perf_counter()
    started = worker.handle('render_film', {
        'preset': arguments.film, 'engine': arguments.engine, 'outputPath': 'renders/film-%s.mp4' % arguments.film,
        'audioPath': 'renders/soundtrack.wav' if (package / 'renders' / 'soundtrack.wav').is_file() else None,
    })
    print('FILM started', json.dumps(started))
    result = render.wait_for_job(package, started['jobId'], timeout=3600)
    print('FILM', json.dumps(result), '%.1f s' % (time.perf_counter() - began))
    if result.get('ok'):
        shutil.copy(result['result']['path'], out / ('%s-%s.mp4' % (package.stem, arguments.film)))
