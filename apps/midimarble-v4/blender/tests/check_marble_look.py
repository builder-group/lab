"""End to end: a skin applied by a project command reaches Blender on the marble, and shows in the frame.

`scripts/export-marble-skin-scenes.ts` turns MCP's `applySkin` and an inspector tile's edit into scene descriptions; this
applies them in one running scene, as the app does, and reads the materials and the rendered pixels. Also the default
marble on warm walls, a library skin on a marble, the Plain wall and a steady camera.

Run: tsx scripts/export-marble-skin-scenes.ts <package> && Blender --background --factory-startup --python-exit-code 1 \
     --python blender/tests/check_marble_look.py -- <package>
"""
import json
import sys
from pathlib import Path

import bpy
from bpy_extras.object_utils import world_to_camera_view
from mathutils import Vector

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from mm_worker import studio, themes  # noqa: E402
from mm_worker.ops import Worker  # noqa: E402

package = Path(sys.argv[sys.argv.index('--') + 1]).resolve()
TIME = 1.2
WIDTH = 360
summary = []


def check(condition, message):
    if not condition:
        raise AssertionError(message)
    summary.append('ok  ' + message)


def build_asset():
    """A marble's library skin: a red sphere at the origin, radius 0.02, so applying it must scale it to the marble"""
    folder = package / 'assets' / 'marble-test-glass'
    folder.mkdir(parents=True, exist_ok=True)
    mesh = bpy.data.meshes.new('MM test sphere')
    import bmesh
    shape = bmesh.new()
    bmesh.ops.create_uvsphere(shape, u_segments=24, v_segments=12, radius=0.02)
    shape.to_mesh(mesh)
    shape.free()
    material = bpy.data.materials.new('MM test red')
    material.use_nodes = True
    material.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (1.0, 0.0, 0.0, 1.0)
    material.node_tree.nodes['Principled BSDF'].inputs['Emission Color'].default_value = (1.0, 0.0, 0.0, 1.0)
    material.node_tree.nodes['Principled BSDF'].inputs['Emission Strength'].default_value = 1.0
    mesh.materials.append(material)
    obj = bpy.data.objects.new('Sphere', mesh)
    collection = bpy.data.collections.new('MM_ASSET')
    collection.objects.link(obj)
    bpy.data.libraries.write(str(folder / 'asset.blend'), {collection}, fake_user=True)
    (folder / 'manifest.json').write_text(json.dumps({'$schema': 'marble-asset@1', 'id': 'marble-test-glass', 'label': 'Test Glass', 'role': 'skin', 'pieceType': 'marble', 'fittedParams': {'radius': 0.02}}))
    bpy.data.collections.remove(collection)
    bpy.data.objects.remove(obj)
    bpy.data.meshes.remove(mesh)
    bpy.data.materials.remove(material)


bpy.ops.wm.read_homefile(use_empty=True)
build_asset()
worker = Worker(package)
scene = bpy.context.scene


def apply(name):
    return worker.handle('apply_scene', {'descriptionPath': '.cache/scene-%s.json' % name})


def description(name):
    return json.loads((package / '.cache' / ('scene-%s.json' % name)).read_text())


def holders():
    marbles = [obj for obj in scene.objects if obj.get('mm_role') == 'marble' and obj.type == 'EMPTY']
    return sorted(marbles, key=lambda obj: [marble['id'] for marble in description('default')['marbles']].index(obj['mm_id']))


def marble_material(holder):
    return holder.children[0].data.materials[0].name


def marble_pixels():
    """Mean linear color of the middle of each marble in a rendered frame, and of the wall beside the first"""
    frame = worker.handle('preview_frame', {'time': TIME, 'width': WIDTH})
    image = bpy.data.images.load(frame['path'])
    width, height = image.size
    pixels = image.pixels[:]
    scene.frame_set(round(TIME * scene.render.fps))
    bpy.context.view_layer.update()
    depsgraph = bpy.context.evaluated_depsgraph_get()
    camera = scene.camera.evaluated_get(depsgraph)

    def sample(point):
        view = world_to_camera_view(scene, camera, point)
        x, y = int(view.x * width), int(view.y * height)
        if not (2 <= x < width - 2 and 2 <= y < height - 2):
            return None
        values = [pixels[4 * ((y + dy) * width + x + dx) + channel] for dx in (-1, 0, 1) for dy in (-1, 0, 1) for channel in range(3)]
        return tuple(sum(values[channel::3]) / 9 for channel in range(3))

    found = [sample(holder.evaluated_get(depsgraph).matrix_world.translation) for holder in holders()]
    bpy.data.images.remove(image)
    return found


def distance(a, b):
    return sum((x - y) ** 2 for x, y in zip(a, b)) ** 0.5


def luminance(color):
    return 0.2126 * color[0] + 0.7152 * color[1] + 0.0722 * color[2]


def check_command_reaches_the_scene():
    for name in ('agent-glass-metal', 'tiles-glass-metal'):
        marbles = description(name)['marbles']
        check(marbles[0]['skin']['assetId'] == 'marble:glass' and marbles[1]['skin']['assetId'] == 'marble:metal', '%s: the scene description names the skins' % name)
    magic, library = description('agent-magic-library')['marbles']
    check(magic['skin']['assetId'] == 'marble:magic' and magic.get('assetPath') is None, 'a built-in skin has no asset path')
    check(library['assetPath'] == 'assets/marble-test-glass/asset.blend', 'a library skin on a marble names its asset')


def check_skins_reach_blender():
    apply('default')
    first, second = holders()
    default = marble_material(first)
    check(default.startswith('MM · glass'), "a marble without a skin wears the Brass theme's marble (%s)" % default)
    before = marble_pixels()
    # Applied in the running scene, one after another, as the window does
    for name in ('agent-glass-metal', 'tiles-glass-metal'):
        apply(name)
        first, second = holders()
        check(marble_material(first).startswith('MM · glass swirl'), '%s: the first marble is Glass in Blender (%s)' % (name, marble_material(first)))
        check('metal' in marble_material(second), '%s: the second marble is Metal in Blender (%s)' % (name, marble_material(second)))
        after = marble_pixels()
        for index, (old, new) in enumerate(zip(before, after)):
            if old is not None and new is not None:
                check(distance(old, new) > 0.03, '%s: marble %d looks different in the frame (%s to %s)' % (name, index + 1, old, new))
        apply('default')
        check(marble_material(holders()[0]) == default, 'Reset brings the theme marble back')
    apply('agent-magic-library')
    first, second = holders()
    check(marble_material(first).startswith('MM · magic'), 'the first marble is Magic in Blender')
    skin = second.children[0]
    check(skin.get('mm_skin') == 'asset' and skin.get('mm_asset') == 'assets/marble-test-glass/asset.blend', 'the second marble wears its library skin')
    meshes = [obj for obj in skin.children_recursive if obj.type == 'MESH']
    check(len(meshes) == 1, 'the library skin holds its model')
    radius = next(marble['radius'] for marble in description('default')['marbles'] if marble['id'] == second['mm_id'])
    bpy.context.view_layer.update()
    corners = [meshes[0].matrix_world @ Vector(corner) for corner in meshes[0].bound_box]
    size = max(corner.x for corner in corners) - min(corner.x for corner in corners)
    check(abs(size - 2 * radius) < 2 * radius * 0.15, 'the model scales from its fitted radius to the marble (%.4f wide)' % size)
    center = sum(corners, Vector()) / 8
    check((center - second.matrix_world.translation).length < radius * 0.2, "the model's origin sits at the marble's center")
    check(meshes[0].get('mm_visibility') is not None, 'a marble in a library skin still hides inside a tunnel')
    pixels = marble_pixels()
    if pixels[1] is not None:
        check(pixels[1][0] > 2 * pixels[1][1] and pixels[1][0] > 0.15, 'the library skin shows red in the frame (%s)' % (pixels[1],))
    apply('default')
    check(marble_material(holders()[1]) == default or holders()[1].children[0].get('mm_skin') != 'asset', 'taking the library skin off brings the theme marble back')


def check_default_marble_look():
    # The same numbers `draft-look.test.ts` holds, so the Draft Preview and the film agree
    expected = {('brass', '#3478f6', None): '#123f94', ('brass', '#ff1a2e', '#ffefc8'): '#8a0e19', ('pegboard', '#34c759', None): '#0c6222'}
    for (theme, color, wall), body in expected.items():
        look = themes.marble_look(theme, color, {'wallColor': wall} if wall else {})
        check(look['tone'] == 'deep', '%s on %s is deep' % (color, theme))
        check(look['body'].lower() == body, '%s on %s has the body the draft has: %s, got %s' % (color, theme, body, look['body']))
        check(themes.display_luminance(look['body']) >= themes.DEEP_LUMINANCE - 1e-3, 'a deep marble is no near-black ball (%s)' % look['body'])
        check(look['contrast'] >= 2.9, '%s on %s still stands apart (%.2f)' % (color, theme, look['contrast']))


def check_steady_camera_and_plain_wall():
    apply('default')
    report = apply('steady')
    check(report['camera'] in ('framed', 'baked'), 'the rig still drives the camera')
    tilted = []
    for frame in range(scene.frame_start, min(scene.frame_end, scene.frame_start + 180), 10):
        scene.frame_set(frame)
        # Image right stays level: nothing in it points up or down the wall
        tilted.append(abs((scene.camera.matrix_world.to_3x3() @ Vector((1, 0, 0))).z))
    check(max(tilted) < 1e-3, 'Sway 0 keeps the wall upright in the frame on every frame (%.5f)' % max(tilted))
    wall = studio.studio_object('studio.wall')
    material = wall.data.materials[0]
    check(material.name.startswith('MM · wall plain'), 'wall skin Plain turns the pattern off (%s)' % material.name)
    nodes = {node.type for node in material.node_tree.nodes}
    check(not nodes & {'TEX_NOISE', 'TEX_IMAGE', 'BUMP', 'TEX_WAVE', 'TEX_CHECKER'}, 'a Plain wall has no texture at all')


check_command_reaches_the_scene()
check_skins_reach_blender()
check_default_marble_look()
check_steady_camera_and_plain_wall()
print('\n'.join(summary))
print('MARBLE LOOK OK (%d checks)' % len(summary))
