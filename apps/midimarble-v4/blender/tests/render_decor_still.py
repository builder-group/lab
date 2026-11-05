"""Fast stills of a package with Decor, for looking at a scatter.

Expects a package with Decor and its scene description at `.cache/scene.json`.

Run: Blender --background --factory-startup --python-exit-code 1 --python blender/tests/render_decor_still.py -- <package> <out-dir> <time> [<time> ...]
"""
import json
import shutil
import sys
from pathlib import Path

import bpy

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from mm_worker.ops import Worker  # noqa: E402

arguments = sys.argv[sys.argv.index('--') + 1:]
package, out, times = Path(arguments[0]).resolve(), Path(arguments[1]).resolve(), [float(value) for value in arguments[2:]]
out.mkdir(parents=True, exist_ok=True)
# The worker starts from an empty scene; the factory scene's own World would stay and take the theme's fill light away
bpy.ops.wm.read_homefile(use_empty=True)
worker = Worker(package)
report = worker.handle('apply_scene', {'descriptionPath': '.cache/scene.json'})
print(json.dumps({'decor': len(report['decor']['created']), 'problems': report['decor']['problems'], 'ms': report['ms']}))
for time in times:
    frame = worker.handle('preview_frame', {'time': time, 'width': 720})
    target = out / ('decor-%05.1fs.png' % time)
    shutil.copyfile(frame['path'], target)
    print('DECOR STILL', target, frame['renderMs'], 'ms', frame['width'], 'x', frame['height'])
