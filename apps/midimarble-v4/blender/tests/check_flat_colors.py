"""Flat Light frames show the theme's colours: the median colour of a Flat Light frame, which is the wall's, stays
close to the Fast frame's in every built-in theme and in project themes with a changed Wall colour, and is the same at
two points of the film whatever the camera does. Live Preview's Flat Light and the Draft export share these settings.

Expects the package `blender:preview` writes (`tsx scripts/export-blender-fixture.ts jingle-bells .local/preview/package brass 30`).

Run: Blender --background --factory-startup --python-exit-code 1 --python blender/tests/check_flat_colors.py
"""
import json
import sys
from pathlib import Path

import bpy
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from mm_worker.live_preview import FAST_SAMPLES, FLAT_SAMPLES  # noqa: E402
from mm_worker.ops import Worker  # noqa: E402
from mm_worker.preview import temporary  # noqa: E402
from mm_worker.render import engine_settings  # noqa: E402

OUT = Path(__file__).resolve().parents[2] / '.local' / 'preview'
PACKAGE = OUT / 'package'
VARIANT = '.cache/flat-check.json'
# Channels of 8-bit display colour; the Fast wall is mottled and its grid or peg holes move the median a little
TOLERANCE = 12
FRAMES = (300, 760)
WIDTH, HEIGHT = 360, 640
CASES = (
    ('Pegboard', 'pegboard', None),
    ('Brass', 'brass', None),
    ('Neon', 'neon', None),
    ('Brass with an orange wall', 'brass', {'wallColor': '#c4623a'}),
    ('Pegboard with a blue wall', 'pegboard', {'wallColor': '#2f6f8f'}),
    ('Neon with a slate wall', 'neon', {'wallColor': '#405070'}),
)


def median_color(scene, settings, path):
    scene.render.filepath = str(path)
    with temporary(settings + [(scene.render.image_settings, 'file_format', 'PNG')]):
        bpy.ops.render.render(write_still=True)
    image = bpy.data.images.load(str(path))
    pixels = np.array(image.pixels[:]).reshape(-1, 4)[:, :3] * 255
    bpy.data.images.remove(image)
    return np.median(pixels, axis=0)


def main():
    description = PACKAGE / '.cache' / 'scene.json'
    if not description.is_file():
        raise SystemExit('Run `tsx scripts/export-blender-fixture.ts jingle-bells .local/preview/package brass 30` first')
    base = json.loads(description.read_text())
    bpy.ops.wm.read_homefile(use_empty=True)
    worker = Worker(PACKAGE)
    failures, lines = [], []
    for label, theme, overrides in CASES:
        (PACKAGE / VARIANT).write_text(json.dumps({**base, 'theme': theme, **({'themeOverrides': overrides} if overrides else {})}))
        worker.handle('apply_scene', {'descriptionPath': VARIANT})
        scene = bpy.context.scene
        flat_settings = engine_settings(scene, 'workbench', FLAT_SAMPLES, WIDTH, HEIGHT)
        fast_settings = engine_settings(scene, 'eevee', FAST_SAMPLES, WIDTH, HEIGHT)
        scene.frame_set(FRAMES[0])
        fast = median_color(scene, fast_settings, OUT / 'flat-check-fast.png')
        flats = []
        for frame in FRAMES:
            scene.frame_set(frame)
            flats.append(median_color(scene, flat_settings, OUT / 'flat-check-flat.png'))
        worst = max(float(np.abs(flat - fast).max()) for flat in flats)
        lines.append('%s  %-26s Fast %s Flat Light %s (largest channel difference %.0f)'
                     % ('ok ' if worst <= TOLERANCE else 'BAD', label, fast.round().astype(int).tolist(),
                        flats[0].round().astype(int).tolist(), worst))
        if worst > TOLERANCE:
            failures.append(label)
    (PACKAGE / VARIANT).unlink()
    print('\n'.join(lines))
    if failures:
        raise AssertionError('Flat Light wall differs from Fast by more than %d in: %s' % (TOLERANCE, ', '.join(failures)))


main()
