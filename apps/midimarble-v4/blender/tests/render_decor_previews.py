"""Renders the Library's preview tile of every built-in Decor item, 160 px square, on a neutral wall.

Run: Blender --background --factory-startup --python-exit-code 1 --python blender/tests/render_decor_previews.py -- public/decor
"""
import math
import sys
import tempfile
from pathlib import Path

import bpy

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from mm_worker import decor  # noqa: E402

out = Path(sys.argv[sys.argv.index('--') + 1]).resolve()
out.mkdir(parents=True, exist_ok=True)
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
collection = bpy.data.collections.new('tiles')
scene.collection.children.link(collection)
scene.render.engine = 'BLENDER_EEVEE'
scene.render.resolution_x = scene.render.resolution_y = 160
scene.render.film_transparent = False
scene.view_settings.view_transform = 'Standard'

world = bpy.data.worlds.new('tile')
world.use_nodes = True
world.node_tree.nodes['Background'].inputs[0].default_value = (0.5, 0.5, 0.5, 1.0)
world.node_tree.nodes['Background'].inputs[1].default_value = 0.5
scene.world = world

wall_mesh = bpy.data.meshes.new('wall')
wall_mesh.from_pydata([(-1, 0, -1), (1, 0, -1), (1, 0, 1), (-1, 0, 1)], [], [(0, 1, 2, 3)])
wall = bpy.data.objects.new('wall', wall_mesh)
wall_material = bpy.data.materials.new('wall')
wall_material.use_nodes = True
wall_material.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (0.42, 0.4, 0.44, 1.0)
wall_material.node_tree.nodes['Principled BSDF'].inputs['Roughness'].default_value = 0.9
wall_mesh.materials.append(wall_material)
collection.objects.link(wall)

sun_data = bpy.data.lights.new('sun', 'SUN')
sun_data.energy = 2.0
sun_data.angle = math.radians(25)
sun = bpy.data.objects.new('sun', sun_data)
sun.rotation_euler = (math.radians(70), 0.0, math.radians(-25))
collection.objects.link(sun)

camera_data = bpy.data.cameras.new('camera')
camera_data.type = 'ORTHO'
camera = bpy.data.objects.new('camera', camera_data)
camera.location = (0.0, -1.0, 0.0)
camera.rotation_euler = (math.radians(90), 0.0, 0.0)
collection.objects.link(camera)
scene.camera = camera

GARLAND_ZOOM = 3.2
for item_id, item in decor.ITEMS.items():
    entry = {'id': 'decor:' + item_id, 'name': item['label'], 'item': item_id, 'position': {'x': 0.0, 'y': 0.0}, 'scale': 1.0, 'rotation': 0.0, 'depth': 0.0}
    if 'text' in item:
        entry['text'] = item['text']
    obj, problem = decor.create_decor(tempfile.gettempdir(), entry, collection, {})
    if obj is None:
        raise RuntimeError(problem)
    obj[decor.SOURCE_PROPERTY] = item_id
    decor.write_decor(obj, entry, 30.0, 1.0)
    camera_data.ortho_scale = max(item['halfWidth'], item['halfHeight']) * 2 * 1.25
    if 'effect' in item:
        # An effect fills the frame it hangs from; a tile is a small frame, so it shows the thing close up
        entry['snowfall'] = {'density': 0.08, 'size': 2.2, 'speed': 1.0, 'color': item['color']}
        entry['garland'] = {'side': 'left', 'spacing': 0.42}
        decor.attach_effects([entry], collection, camera, scene, 30.0, 1.0, 'pegboard')
        if item['effect'] == 'garland':
            # Close on one sprig: scaled about the frame's left edge, with the depth it hangs at
            half = camera_data.ortho_scale / 2
            obj.scale = (GARLAND_ZOOM, GARLAND_ZOOM, 1.0)
            obj.location.x = half * (GARLAND_ZOOM - 1)
    scene.render.filepath = str(out / item['preview'])
    bpy.ops.render.render(write_still=True)
    decor.remove_tree(obj)
    print('DECOR TILE', item['preview'])
