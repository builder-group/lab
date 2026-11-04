"""Renders the Library's preview of every built-in skin: one piece isolated on a neutral wall, 160 px square.

Export a package per theme first (`tsx scripts/export-blender-fixture.ts <fixture> <package> <theme>`), then run once
per package:

Run: Blender --background --factory-startup --python blender/tests/render_skin_previews.py -- <package> <out-dir>
     <prefix> --types platform,switchback [--variants brass:gold,brass:copper] [--size 160]

Writes `<prefix>-<type>.png` for the theme default of each type, and `<element>-<name>.png` for each `--variants` skin
(applied to the first piece of the first type), such as `platform-copper.png`, the name `skin_catalog.json` gives it.
`--marbles marble:glass,marble:metal` renders marble skins on their own the same way, close up. The committed previews in
`public/skins/` were rendered from Jingle Bells (platform, switchback, finish, marbles), Long Gap (rail, tunnel) and
Windmill, then quantized to 192 colours with Pillow to keep them small.
"""
import argparse
import json
import math
import sys
from pathlib import Path

import bpy
from mathutils import Vector

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from mm_worker import render  # noqa: E402
from mm_worker.ops import Worker  # noqa: E402
from mm_worker.util import descendants  # noqa: E402

PREVIEW_DESCRIPTION = '.cache/scene-preview.json'
NEUTRAL = (0.42, 0.42, 0.43, 1.0)  # linear; reads as a light warm grey in sRGB

parser = argparse.ArgumentParser()
parser.add_argument('package')
parser.add_argument('out')
parser.add_argument('prefix')
parser.add_argument('--types', default='platform')
parser.add_argument('--variants', default='')
parser.add_argument('--marbles', default='')
parser.add_argument('--size', type=int, default=160)
parser.add_argument('--samples', type=int, default=32)
arguments = parser.parse_args(sys.argv[sys.argv.index('--') + 1:])

package = Path(arguments.package).resolve()
out = Path(arguments.out).resolve()
out.mkdir(parents=True, exist_ok=True)
description = json.loads((package / '.cache' / 'scene.json').read_text())
description.pop('themeOptions', None)
bpy.ops.wm.read_homefile(use_empty=True)
worker = Worker(package)
scene = bpy.context.scene


def neutral_material():
    material = bpy.data.materials.new('MM preview neutral')
    material.use_nodes = True
    shader = material.node_tree.nodes['Principled BSDF']
    shader.inputs['Base Color'].default_value = NEUTRAL
    shader.inputs['Roughness'].default_value = 0.85
    return material


NEUTRAL_MATERIAL = neutral_material()


def apply(piece_id, skin):
    pieces = []
    for piece in description['pieces']:
        piece = dict(piece)
        if piece['id'] == piece_id and skin is not None:
            piece['skin'] = {'assetId': skin, 'link': 'linked'}
        pieces.append(piece)
    (package / PREVIEW_DESCRIPTION).write_text(json.dumps({**description, 'pieces': pieces}))
    worker.handle('apply_scene', {'descriptionPath': PREVIEW_DESCRIPTION})


def isolate(piece_id):
    """Shows only the piece and a plain wall behind it; returns the piece's objects"""
    holder = next(obj for obj in scene.objects if obj.get('mm_id') == piece_id and obj.get('mm_role') != 'skin')
    keep = {holder, *descendants(holder)}
    for obj in scene.objects:
        if obj.get('mm_role') == 'studio.wall':
            obj.hide_render = False
            obj.data.materials.clear()
            obj.data.materials.append(NEUTRAL_MATERIAL)
        elif obj.type in {'MESH', 'CURVE', 'FONT', 'EMPTY'}:
            obj.hide_render = obj not in keep
    return [obj for obj in keep if obj.type in {'MESH', 'CURVE', 'FONT'}]


def frame(objects):
    """Points an orthographic camera, slightly from above and the side, at the objects' bounds with a margin"""
    camera = scene.camera
    camera.animation_data_clear()
    camera.data.animation_data_clear()
    camera.constraints.clear()
    camera.data.type = 'ORTHO'
    camera.rotation_euler = (math.radians(80), 0.0, math.radians(-12))
    camera.location = (0.0, 0.0, 0.0)
    bpy.context.view_layer.update()
    to_camera = camera.matrix_world.inverted()
    corners = [to_camera @ (obj.matrix_world @ Vector(corner)) for obj in objects for corner in obj.bound_box]
    low = Vector((min(c.x for c in corners), min(c.y for c in corners), min(c.z for c in corners)))
    high = Vector((max(c.x for c in corners), max(c.y for c in corners), max(c.z for c in corners)))
    centre = Vector(((low.x + high.x) / 2, (low.y + high.y) / 2, high.z + 1.0))
    camera.location = camera.matrix_world @ centre
    camera.data.ortho_scale = max(high.x - low.x, high.y - low.y) * 1.3
    camera.data.clip_end = 10.0


def render_piece(piece_id, path):
    objects = isolate(piece_id)
    frame(objects)
    scene.render.resolution_x = arguments.size
    scene.render.resolution_y = arguments.size
    render.render_still(scene, path, 0.0, arguments.size, 'eevee', arguments.samples)
    print('PREVIEW', path)


types = [value for value in arguments.types.split(',') if value]
for piece_type in types:
    piece = next(piece for piece in description['pieces'] if piece['type'] == piece_type)
    apply(piece['id'], None)
    render_piece(piece['id'], out / ('%s-%s.png' % (arguments.prefix, piece_type)))

for variant in [value for value in arguments.variants.split(',') if value]:
    piece = next(piece for piece in description['pieces'] if piece['type'] == types[0])
    apply(piece['id'], variant)
    render_piece(piece['id'], out / (variant.replace(':', '-') + '.png'))


def apply_marble(skin):
    marbles = [{**marble, 'skin': {'assetId': skin, 'link': 'linked'}} for marble in description['marbles']]
    (package / PREVIEW_DESCRIPTION).write_text(json.dumps({**description, 'marbles': marbles}))
    worker.handle('apply_scene', {'descriptionPath': PREVIEW_DESCRIPTION})


for skin in [value for value in arguments.marbles.split(',') if value]:
    apply_marble(skin)
    render_piece(description['marbles'][0]['id'], out / (skin.replace(':', '-') + '.png'))
