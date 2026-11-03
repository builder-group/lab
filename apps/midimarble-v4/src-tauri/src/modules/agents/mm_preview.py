"""Checks a MidiMarble candidate and renders its preview.

Run from the candidate folder:

    Blender --background --factory-startup --python mm_preview.py -- asset.blend preview.png

The script appends the `MM_ASSET` collection into an empty scene with neutral lighting, prints one
`MM_CHECK` line per finding and renders a 512x512 still. It exits with code 1 when the asset breaks the
contract, so the preview is only written for a usable candidate. `--check-only` skips the render.
"""

import json
import math
import os
import sys

import bpy
from mathutils import Vector

REACTIONS = {'press', 'wobble', 'glow'}
ROLES = {'skin', 'decoration', 'text'}


def main():
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    check_only = '--check-only' in argv
    paths = [value for value in argv if not value.startswith('--')]
    asset_path = os.path.abspath(paths[0] if paths else 'asset.blend')
    preview_path = os.path.abspath(paths[1] if len(paths) > 1 else 'preview.png')
    problems = []

    check_manifest(os.path.join(os.path.dirname(asset_path), 'manifest.json'), problems)
    collection = append_collection(asset_path, problems)
    if collection is not None:
        check_collection(collection, problems)

    for problem in problems:
        print('MM_CHECK error:', problem)
    if problems:
        print('MM_CHECK failed with', len(problems), 'problem(s)')
        sys.exit(1)
    print('MM_CHECK ok')
    if check_only:
        return
    stage(collection)
    render(preview_path)
    print('MM_PREVIEW', preview_path)


def check_manifest(path, problems):
    if not os.path.isfile(path):
        problems.append('manifest.json is missing')
        return
    try:
        with open(path, encoding='utf-8') as file:
            manifest = json.load(file)
    except ValueError as error:
        problems.append('manifest.json is not valid JSON: %s' % error)
        return
    if manifest.get('$schema') != 'marble-asset@1':
        problems.append("manifest.json needs \"$schema\": \"marble-asset@1\"")
    for key in ('id', 'label', 'role'):
        if not isinstance(manifest.get(key), str) or not manifest.get(key):
            problems.append('manifest.json needs a non-empty string "%s"' % key)
    if manifest.get('role') not in ROLES:
        problems.append('manifest.json "role" must be one of %s' % sorted(ROLES))


def append_collection(path, problems):
    if not os.path.isfile(path):
        problems.append('%s is missing' % os.path.basename(path))
        return None
    with bpy.data.libraries.load(path, link=False) as (source, target):
        if 'MM_ASSET' not in source.collections:
            problems.append('asset.blend has no collection named MM_ASSET')
            return None
        target.collections = ['MM_ASSET']
    collection = target.collections[0]
    bpy.context.scene.collection.children.link(collection)
    # Appended objects carry stale world matrices until the view layer evaluates them
    bpy.context.view_layer.update()
    return collection


def check_collection(collection, problems):
    objects = list(collection.all_objects)
    meshes = [obj for obj in objects if obj.type in {'MESH', 'CURVE', 'FONT', 'SURFACE', 'META'}]
    if not meshes:
        problems.append('MM_ASSET has no visible geometry')
        return
    for obj in objects:
        if obj.name.startswith('MM_REACT_'):
            reaction = obj.get('mm_reaction')
            if reaction not in REACTIONS:
                problems.append('%s needs mm_reaction set to one of %s' % (obj.name, sorted(REACTIONS)))
            if obj.parent is None or obj.parent.name not in collection.all_objects:
                problems.append('%s must be a child of an object in MM_ASSET' % obj.name)
    low, high = bounds(meshes)
    size = high - low
    print('MM_CHECK size_m', round(size.x, 4), round(size.y, 4), round(size.z, 4))
    if max(size) > 2.0:
        problems.append('the model is %.2f m across; model in metres at real scale' % max(size))
    if high.z > 0.05 * max(max(size), 0.01) + 1e-4:
        print('MM_CHECK warning: geometry reaches %.4f m above the contact face at z = 0' % high.z)


def bounds(objects):
    corners = [obj.matrix_world @ Vector(corner) for obj in objects for corner in obj.bound_box]
    low = Vector((min(c.x for c in corners), min(c.y for c in corners), min(c.z for c in corners)))
    high = Vector((max(c.x for c in corners), max(c.y for c in corners), max(c.z for c in corners)))
    return low, high


def stage(collection):
    scene = bpy.context.scene
    world = bpy.data.worlds.new('MM_PreviewWorld')
    world.use_nodes = True
    background = world.node_tree.nodes.get('Background')
    background.inputs['Color'].default_value = (0.32, 0.33, 0.35, 1.0)
    background.inputs['Strength'].default_value = 0.5
    scene.world = world

    meshes = [obj for obj in collection.all_objects if obj.type in {'MESH', 'CURVE', 'FONT', 'SURFACE', 'META'}]
    low, high = bounds(meshes)
    centre = (low + high) / 2
    radius = max((high - low).length / 2, 0.005)

    camera_data = bpy.data.cameras.new('MM_PreviewCamera')
    camera_data.lens = 50
    camera_data.clip_start = radius * 0.01
    camera_data.clip_end = radius * 100
    camera = bpy.data.objects.new('MM_PreviewCamera', camera_data)
    scene.collection.objects.link(camera)
    direction = Vector((0.55, -1.0, 0.75)).normalized()
    distance = radius / math.sin(camera_data.angle / 2) * 1.15
    camera.location = centre + direction * distance
    camera.rotation_euler = (-direction).to_track_quat('-Z', 'Y').to_euler()
    scene.camera = camera

    # Light power scales with the squared distance so small and large models are lit alike
    reach = radius * 4
    add_light(scene, 'MM_Key', 'AREA', centre + Vector((1.0, -1.2, 1.6)).normalized() * reach, centre, 150 * reach * reach)
    add_light(scene, 'MM_Fill', 'AREA', centre + Vector((-1.4, -0.6, 0.6)).normalized() * reach, centre, 40 * reach * reach)
    add_light(scene, 'MM_Rim', 'AREA', centre + Vector((0.0, 1.5, 1.0)).normalized() * reach, centre, 80 * reach * reach)


def add_light(scene, name, kind, location, target, energy):
    data = bpy.data.lights.new(name, kind)
    data.energy = energy
    if kind == 'AREA':
        data.size = (location - target).length * 0.6
    light = bpy.data.objects.new(name, data)
    light.location = location
    light.rotation_euler = (target - location).to_track_quat('-Z', 'Y').to_euler()
    scene.collection.objects.link(light)


def render(path):
    scene = bpy.context.scene
    scene.render.engine = 'CYCLES'
    scene.cycles.device = 'CPU'
    scene.cycles.samples = 64
    scene.cycles.use_denoising = True
    scene.render.resolution_x = 512
    scene.render.resolution_y = 512
    scene.render.resolution_percentage = 100
    scene.render.film_transparent = False
    scene.render.image_settings.file_format = 'PNG'
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)


main()
