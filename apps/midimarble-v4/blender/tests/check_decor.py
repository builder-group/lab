"""Headless check of Decor: the built-in items, In and Out, hiding, picks and Made in Blender.

Builds a package with a short synthetic run, applies a description with one layer of every built-in item and checks
each object exists at its catalog size without any collision role, that In and Out key its visibility like a title's, that
hiding and removing behave, and that objects the user adds are listed, timed and never moved or deleted, lights left out.

Run: Blender --background --factory-startup --python-exit-code 1 --python blender/tests/check_decor.py
"""
import json
import sys
import tempfile
from pathlib import Path

import bpy
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from mm_worker import decor  # noqa: E402
from mm_worker.ops import Worker  # noqa: E402
from mm_worker.util import MANAGED_COLLECTION  # noqa: E402

FPS = 30.0
DURATION = 4.0
summary = []


def check(condition, message):
    if not condition:
        raise AssertionError(message)
    summary.append('ok  ' + message)


def write_package(root):
    times = np.arange(0.0, DURATION, 1 / 60)
    records = np.stack([times, 0.05 * np.sin(times * 3), -0.2 * times, -times * 20], axis=1).astype('<f4')
    motion = root / '.cache' / 'motion' / 'marble.bin'
    motion.parent.mkdir(parents=True, exist_ok=True)
    motion.write_bytes(records.tobytes())
    (root / 'project.json').write_text('{}')
    return len(records)


def description(samples, decor_layers, made_in_blender=None):
    return {
        'version': 1, 'projectId': 'decor', 'revision': 1, 'fps': FPS, 'duration': DURATION,
        'frame': {'width': 1080, 'height': 1920}, 'theme': 'brass',
        'marbles': [{'id': 'marble', 'name': 'Melody', 'radius': 0.008, 'color': '#d04040', 'motionPath': '.cache/motion/marble.bin', 'sampleCount': samples}],
        'pieces': [],
        'decor': decor_layers,
        **({'madeInBlender': made_in_blender} if made_in_blender is not None else {}),
    }


def apply(worker, root, value):
    path = root / '.cache' / 'scene.json'
    path.write_text(json.dumps(value))
    return worker.handle('apply_scene', {'descriptionPath': '.cache/scene.json'})


def write_asset(path):
    """An asset file with one collection `MM_ASSET`, its origin at the centre of the back face, in a separate library"""
    mesh = bpy.data.meshes.new('holly')
    mesh.from_pydata([(-0.02, -0.01, 0.0), (0.02, -0.01, 0.0), (0.02, 0.01, 0.0), (-0.02, 0.01, 0.0)], [], [(0, 1, 2, 3)])
    obj = bpy.data.objects.new('holly', mesh)
    collection = bpy.data.collections.new('MM_ASSET')
    collection.objects.link(obj)
    bpy.data.libraries.write(str(path), {collection}, fake_user=True)
    bpy.data.collections.remove(collection)
    bpy.data.objects.remove(obj)
    bpy.data.meshes.remove(mesh)


def visibility_keys(obj, path):
    action = obj.animation_data.action if obj.animation_data else None
    if action is None:
        return []
    from bpy_extras import anim_utils
    bag = anim_utils.animdata_get_channelbag_for_assigned_slot(obj.animation_data)
    curve = bag.fcurves.find(path) if bag else None
    return [(round(point.co.x), round(point.co.y)) for point in curve.keyframe_points] if curve else []


def main():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    root = Path(tempfile.mkdtemp(prefix='mm-decor-'))
    samples = write_package(root)
    worker = Worker(root)

    layers = [
        {'id': 'decor:' + item, 'name': decor.ITEMS[item]['label'], 'item': item, 'position': {'x': 0.2 + index * 0.1, 'y': 0.1}, 'scale': 1.0, 'rotation': 0.0, 'depth': 0.0,
         **({'text': decor.ITEMS[item]['text']} if 'text' in decor.ITEMS[item] else {})}
        for index, item in enumerate(decor.ITEMS)
    ]
    report = apply(worker, root, description(samples, layers))
    check(len(report['decor']['created']) == len(layers), 'every built-in decor item is created')
    managed = bpy.data.collections[MANAGED_COLLECTION]
    objects = {obj['mm_id']: obj for obj in managed.objects if decor.is_decor(obj)}
    check(len(objects) == len(layers), 'one layer, one decor object')
    bpy.context.view_layer.update()

    total_vertices = 0
    for item, entry in decor.ITEMS.items():
        obj = objects['decor:' + item]
        check(obj.get('mm_role') == 'decor' and obj.get('mm_collider') is None and obj.rigid_body is None, item + ' has no collision role')
        bounds = decor.wall_bounds(obj)
        width, height = bounds['maxX'] - bounds['minX'], bounds['maxY'] - bounds['minY']
        check(width <= entry['halfWidth'] * 2 * 1.3 and width >= entry['halfWidth'] * 2 * 0.5, '%s width %.3f m matches the catalog' % (item, width))
        check(height <= entry['halfHeight'] * 2 * 1.5 and height >= entry['halfHeight'] * 2 * 0.4, '%s height %.3f m matches the catalog' % (item, height))
        if obj.type == 'MESH':
            total_vertices += len(obj.data.vertices)
    check(total_vertices < 3000, 'built-in geometry stays cheap (%d vertices in all)' % total_vertices)
    # Decor sits on the wall: nothing stands far enough out to throw a long shadow
    for item in ('bauble-red', 'bauble-gold', 'snowflake-gold', 'fairy-light', 'gift-box', 'star'):
        reach = max(vertex.co.z for vertex in objects['decor:' + item].data.vertices)
        check(reach < 0.02, '%s stays close to the wall (%.0f mm out)' % (item, reach * 1000))
    check(objects['decor:bauble-red'].data is not objects['decor:bauble-gold'].data, 'baubles have their own colours')
    check(objects['decor:handle'].type == 'FONT' and objects['decor:handle'].data.body == '@yourchannel', 'a Handle is text reading what it was given')
    check(any(child.type == 'MESH' for child in objects['decor:subscribe'].children), 'Subscribe carries an arrow')
    holders = [obj for obj in managed.objects if obj.get('mm_role') == 'piece']
    check(not holders, 'decor adds no pieces')

    # Same layers, one timed, one hidden, one moved
    layers[0] = {**layers[0], 'in': 1.0, 'out': 2.0}
    layers[1] = {**layers[1], 'hidden': True}
    layers[2] = {**layers[2], 'position': {'x': 0.5, 'y': -0.3}, 'rotation': 0.5, 'scale': 2.0, 'depth': 0.02}
    report = apply(worker, root, description(samples, layers))
    check(len(report['decor']['updated']) == len(layers), 're-applying updates the layers in place')
    timed = objects['decor:bauble-red']
    keys = visibility_keys(timed, 'hide_render')
    check(keys == [(0, 1), (30, 0), (60, 1)], 'In and Out key hide_render at 1 s and 2 s: %s' % keys)
    check(len(visibility_keys(timed, '["mm_visible"]')) >= 2, 'In and Out fade by mm_visible, like a title')
    check(objects['decor:bauble-gold'].hide_render and objects['decor:bauble-gold'].hide_viewport, 'a hidden layer is hidden and stays in the file')
    moved = objects['decor:snowflake-gold']
    check(abs(moved.location.x - 0.5) < 1e-5 and abs(moved.location.z + 0.3) < 1e-5 and moved.location.y < -0.019, 'position and depth land on the wall, in front of it')
    check(abs(moved.scale.x - 2.0) < 1e-4, 'scale lands')

    # A layer edited in Blender is the user's
    moved.location.x += 0.1
    report = apply(worker, root, description(samples, layers))
    check('decor:snowflake-gold' in report['decor']['skipped'], 'a decoration edited in Blender is left alone')

    # Removing a layer removes an untouched object and detaches an edited one
    gone = [layer for layer in layers if layer['id'] not in ('decor:star', 'decor:snowflake-gold')]
    report = apply(worker, root, description(samples, gone))
    check('decor:star' in report['decor']['removed'] and bpy.data.objects.get('Star') is None, 'a deleted layer leaves the file')
    check(bpy.data.objects.get('Gold Snowflake') is not None and 'MidiMarble · detached' in [c.name for c in bpy.data.objects['Gold Snowflake'].users_collection], 'an edited one moves to detached')
    layers = gone

    # A decoration from the Library: an asset's objects, placed by the same rules
    asset_dir = root / 'assets' / 'holly'
    asset_dir.mkdir(parents=True)
    (asset_dir / 'manifest.json').write_text(json.dumps({'$schema': 'marble-asset@1', 'id': 'holly', 'label': 'Holly', 'role': 'decoration', 'fittedParams': {'width': 0.04, 'height': 0.02}}))
    write_asset(asset_dir / 'asset.blend')
    with_asset = [*layers, {'id': 'decor:holly', 'name': 'Holly', 'assetPath': 'assets/holly/asset.blend', 'position': {'x': -0.3, 'y': 0.0}, 'scale': 1.0, 'rotation': 0.0, 'depth': 0.0, 'in': 1.0}]
    report = apply(worker, root, description(samples, with_asset))
    check('decor:holly' in report['decor']['created'] and not report['decor']['problems'], 'a library decoration is placed from its asset')
    holly = next(obj for obj in managed.objects if obj.get('mm_id') == 'decor:holly')
    check(len(holly.children) == 1 and holly.children[0].type == 'MESH', 'its objects sit under one layer')
    bpy.context.view_layer.update()
    corner = decor.wall_bounds(holly)
    check(abs(corner['minX'] + 0.32) < 1e-3 and abs(corner['maxX'] + 0.28) < 1e-3 and abs(corner['minY'] + 0.01) < 1e-3, 'its asset frame lands on the wall: %s' % corner)
    check(visibility_keys(holly.children[0], 'hide_render')[:2] == [(0, 1), (30, 0)], 'its objects take In and Out')
    report = apply(worker, root, description(samples, layers))
    check('decor:holly' in report['decor']['removed'] and bpy.data.objects.get('Holly') is None, 'deleting the layer removes its objects')

    # Made in Blender
    check(not worker.handle('inspect', {})['madeInBlender'], 'the app\'s own objects are not listed as Made in Blender')
    mesh = bpy.data.meshes.new('User Tree')
    mesh.from_pydata([(0.1, -0.02, 0.1), (0.3, -0.02, 0.1), (0.3, -0.02, 0.5)], [], [(0, 1, 2)])
    tree = bpy.data.objects.new('User Tree', mesh)
    bpy.context.scene.collection.objects.link(tree)
    light_data = bpy.data.lights.new('User Lamp', 'POINT')
    lamp = bpy.data.objects.new('User Lamp', light_data)
    bpy.context.scene.collection.objects.link(lamp)
    camera_data = bpy.data.cameras.new('User Camera')
    bpy.context.scene.collection.objects.link(bpy.data.objects.new('User Camera', camera_data))
    original = tree.matrix_world.copy()

    listed = worker.handle('inspect', {})['madeInBlender']
    check([item['name'] for item in listed] == ['User Tree'], 'a mesh the user added is listed; lights and cameras stay out')
    bounds = listed[0]['bounds']
    check(abs(bounds['minX'] - 0.1) < 1e-3 and abs(bounds['maxX'] - 0.3) < 1e-3 and abs(bounds['minY'] - 0.1) < 1e-3 and abs(bounds['maxY'] - 0.5) < 1e-3, 'its bounds are on the wall: %s' % bounds)

    apply(worker, root, description(samples, layers, [{'name': 'User Tree', 'in': 1.0, 'out': 3.0}]))
    keys = visibility_keys(tree, 'hide_render')
    check(keys == [(0, 1), (30, 0), (90, 1)], 'In and Out key the object\'s own visibility: %s' % keys)
    check(len(visibility_keys(tree, 'hide_viewport')) == 3, 'the viewport follows too')
    check(bpy.data.objects.get('User Tree') is tree, 'it is never deleted')
    check((tree.matrix_world.translation - original.translation).length < 1e-9, 'it is never moved')
    bpy.context.scene.frame_set(45)
    check(not tree.hide_render, 'it shows between In and Out')
    bpy.context.scene.frame_set(10)
    check(tree.hide_render, 'it is hidden before In')

    apply(worker, root, description(samples, layers, [{'name': 'User Tree', 'hidden': True}]))
    check(tree.hide_render and tree.hide_viewport and not visibility_keys(tree, 'hide_render'), 'Hidden hides it without keys')

    apply(worker, root, description(samples, layers, []))
    check(not tree.hide_render and not tree.hide_viewport and tree.get(decor.USER_TIMED) is None, 'once the project stops setting it, it has its visibility back')

    selected = worker.handle('select_objects', {'names': ['User Tree']})
    check(selected['selected'] == ['User Tree'] and tree.select_get(), 'Open in Blender selects it')

    print('\n'.join(summary))
    print('DECOR OK', len(summary), 'checks,', 'vertices', total_vertices)


main()
