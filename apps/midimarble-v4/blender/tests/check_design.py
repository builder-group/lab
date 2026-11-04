"""Headless check of the Design data in `apply_scene`: library skins, per-piece reactions and wall text.

Builds a test `assets/test-key/asset.blend` with bpy (a piano key with an `MM_REACT_Key` press part), applies it to
a platform and checks orientation, fitted scale, reaction drivers, swapping back to the default skin and the
user's skin offset; then per-piece reaction presets, wall text ownership and a short `render_film`. Renders a
brass still with the asset skin and a wall title to `.local/design/` (or `MM_CHECK_OUT`).

Run: Blender --background --factory-startup --python-exit-code 1 --python blender/tests/check_design.py
"""
import json
import math
import os
import shutil
import sys
import tempfile
from pathlib import Path

import bmesh
import bpy
import numpy as np
from bpy_extras.object_utils import world_to_camera_view
from mathutils import Matrix, Vector

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from mm_worker import render, themes, walltext  # noqa: E402
from mm_worker.ops import Worker  # noqa: E402
from mm_worker.util import DETACHED_COLLECTION, MANAGED_COLLECTION, STUDIO_COLLECTION, parse_color  # noqa: E402

APP_DIR = Path(__file__).resolve().parents[2]
FPS = 30.0
PHYSICS_HZ = 240.0
DURATION = 0.6
GRAVITY = 9.81
RADIUS = 0.008
RELEASE = (-0.01, 0.26, 0.05)  # x, y, time
VX = 0.12
PLATFORM = {'length': 0.06, 'thickness': 0.008, 'depth': 0.03}
PLATFORM_POSITION = {'x': 0.0, 'y': 0.12}
PLATFORM_ANGLE = 0.15
ASSET_PATH = 'assets/test-key/asset.blend'
FITTED_LENGTH = 0.05

summary = []


def check(condition, message):
    if not condition:
        raise AssertionError(message)
    summary.append('ok  ' + message)


def close(a, b, tolerance=1e-5):
    return all(abs(x - y) < tolerance for x, y in zip(a, b))


# Package


def ballistic():
    """Marble falling onto the tilted platform top and bouncing off it"""
    x0, y0, t0 = RELEASE
    normal = (-math.sin(PLATFORM_ANGLE), math.cos(PLATFORM_ANGLE))
    # Height of the platform top under the falling marble
    hit_x = x0 + VX * 0.15
    top = PLATFORM_POSITION['y'] + math.tan(PLATFORM_ANGLE) * (hit_x - PLATFORM_POSITION['x']) + PLATFORM['thickness'] / 2 / normal[1]
    contact_y = top + RADIUS / normal[1]
    hit = t0 + math.sqrt(2 * (y0 - contact_y) / GRAVITY)
    times = t0 + np.arange(0, int((DURATION - t0) * PHYSICS_HZ) + 1) / PHYSICS_HZ
    bounce = 0.5 * GRAVITY * (hit - t0)
    y = np.where(times <= hit, y0 - GRAVITY / 2 * (times - t0) ** 2,
                 contact_y + bounce * (times - hit) - GRAVITY / 2 * (times - hit) ** 2)
    x = x0 + VX * (times - t0)
    angle = -(x - x0) / RADIUS
    return np.stack([times, x, y, angle], axis=1).astype('<f4'), hit


def write_package(root, records, hit, theme='brass', asset=False, reaction=None, texts=None, duration=DURATION, overrides=None, skin=None, layers=None):
    motion = root / '.cache' / 'motion'
    motion.mkdir(parents=True, exist_ok=True)
    records.tofile(motion / 'marble-1.bin')
    piece = {
        'id': 'platform-1', 'name': 'Key 1', 'type': 'platform', 'params': PLATFORM,
        'position': PLATFORM_POSITION, 'angle': PLATFORM_ANGLE, 'wallOffset': 0.0,
        'hitTimes': [hit], 'motionPath': None, 'sampleCount': 0, 'color': '#e2a33b',
        'skin': {'assetId': 'test-key', 'link': 'linked'} if asset else ({'assetId': skin, 'link': 'linked'} if skin else None),
        'assetPath': ASSET_PATH if asset else None,
        'reaction': reaction,
    }
    description = {
        'version': 1, 'projectId': 'design-check', 'revision': 1, 'fps': FPS, 'duration': duration,
        'frame': {'width': 1080, 'height': 1920}, 'theme': theme,
        'marbles': [{
            'id': 'marble-1', 'name': 'Marble 1', 'radius': RADIUS, 'color': '#d94f4f',
            'motionPath': '.cache/motion/marble-1.bin', 'sampleCount': len(records),
        }],
        'pieces': [piece],
        'wallTexts': texts or [],
    }
    if overrides:
        description['themeOverrides'] = overrides
    if layers:
        description.update(layers)
    (root / '.cache' / 'scene.json').write_text(json.dumps(description))


def apply(worker):
    return worker.handle('apply_scene', {'descriptionPath': '.cache/scene.json'})


def box(bm, minimum, maximum):
    result = bmesh.ops.create_cube(bm, size=1.0)
    centre = [(a + b) / 2 for a, b in zip(minimum, maximum)]
    size = [b - a for a, b in zip(minimum, maximum)]
    bmesh.ops.transform(bm, matrix=Matrix.Translation(centre) @ Matrix.Diagonal((*size, 1.0)), verts=result['verts'])


def mesh_object(name, minimum, maximum, material):
    mesh = bpy.data.meshes.new(name)
    bm = bmesh.new()
    box(bm, minimum, maximum)
    bm.to_mesh(mesh)
    bm.free()
    mesh.materials.append(material)
    return bpy.data.objects.new(name, mesh)


def material(name, color, roughness):
    result = bpy.data.materials.new(name)
    if result.node_tree is None:
        result.use_nodes = True
    principled = result.node_tree.nodes['Principled BSDF']
    principled.inputs['Base Color'].default_value = color
    principled.inputs['Roughness'].default_value = roughness
    return result


def build_asset(folder):
    """A piano key: origin at the centre of the key top, +Z up out of it, X along the key, Y into the wall"""
    folder.mkdir(parents=True, exist_ok=True)
    collection = bpy.data.collections.new('MM_ASSET')
    ivory = material('Test ivory', (0.92, 0.88, 0.78, 1.0), 0.25)
    lacquer = material('Test lacquer', (0.012, 0.012, 0.014, 1.0), 0.18)
    half = FITTED_LENGTH / 2
    key = mesh_object('MM_REACT_Key', (-half, -0.012, -0.006), (half, 0.012, 0.0), ivory)
    key['mm_reaction'] = 'press'
    base = mesh_object('Base', (-half * 1.02, -0.013, -0.016), (half * 1.02, 0.015, -0.0065), lacquer)
    tip = mesh_object('Tip', (-0.001, -0.001, -0.001), (0.001, 0.001, 0.001), lacquer)
    tip.location = (half, 0.0, -0.01)
    for obj in (key, base, tip):
        collection.objects.link(obj)
    path = folder / 'asset.blend'
    bpy.data.libraries.write(str(path), {collection}, fake_user=True)
    (folder / 'manifest.json').write_text(json.dumps({
        '$schema': 'marble-asset@1', 'id': 'test-key', 'label': 'Test key', 'role': 'skin', 'pieceType': 'platform',
        'fittedParams': {'length': FITTED_LENGTH}, 'reactions': [{'part': 'MM_REACT_Key', 'kind': 'press'}],
    }))
    # The session forgets the source so the worker loads only what the file holds
    for obj in (key, base, tip):
        mesh = obj.data
        bpy.data.objects.remove(obj)
        bpy.data.meshes.remove(mesh)
    bpy.data.collections.remove(collection)
    bpy.data.materials.remove(ivory)
    bpy.data.materials.remove(lacquer)
    return path


# Helpers


def holder(mm_id):
    collection = bpy.data.collections[MANAGED_COLLECTION]
    return next((obj for obj in collection.objects if obj.get('mm_id') == mm_id and obj.type == 'EMPTY'), None)


def text_object(mm_id):
    collection = bpy.data.collections[MANAGED_COLLECTION]
    return next((obj for obj in collection.objects if obj.get('mm_id') == mm_id and obj.type == 'FONT'), None)


def asset_part(skin, name):
    return next(obj for obj in [skin, *skin.children_recursive] if obj.get('mm_asset_part') == name)


def asset_frame(skin):
    return next(obj for obj in skin.children if obj.get('mm_asset_frame'))


def contact_normal():
    return Vector((-math.sin(PLATFORM_ANGLE), 0.0, math.cos(PLATFORM_ANGLE)))


def world_point(x, y, d=0.0):
    return Vector((x, -d, y))


def main():
    scene = bpy.context.scene
    for obj in list(bpy.data.objects):
        bpy.data.objects.remove(obj)
    root = Path(tempfile.mkdtemp(prefix='mm-design-')) / 'Design.marble'
    root.mkdir(parents=True)
    build_asset(root / 'assets' / 'test-key')
    worker = Worker(root)
    records, hit = ballistic()
    hit_frame = math.ceil(hit * FPS - 1e-6)

    # Theme default first, with a user offset on its skin
    write_package(root, records, hit)
    apply(worker)
    platform = holder('platform-1')
    default_skin = platform.children[0]
    check(default_skin.get('mm_skin') == 'default', 'the platform starts with the default skin')
    offset = (0.0, -0.002, 0.003)
    default_skin.location = offset

    # Library skin replaces the unedited default skin and keeps the user offset
    write_package(root, records, hit, asset=True)
    report = apply(worker)
    platform = holder('platform-1')
    check(len(platform.children) == 1 and platform.children[0].get('mm_skin') == 'asset', 'assetPath swaps in the asset skin')
    skin = platform.children[0]
    check(close(skin.location, offset), 'the asset skin keeps the user offset of the default skin')
    check('platform-1' not in report['skins'], 'a loadable asset reports no skin problem')
    check(bpy.data.collections.get('MM asset · ' + ASSET_PATH) is not None, 'the asset is appended once as a template')
    check(not any(obj.users_collection[0].name.startswith('MM asset') for obj in scene.objects), 'the template is not rendered')

    # Orientation: asset origin on the contact surface centre, +Z along the contact normal, X along the piece
    skin.location = (0.0, 0.0, 0.0)
    scene.frame_set(0)
    frame = asset_frame(skin).matrix_world
    centre = world_point(PLATFORM_POSITION['x'], PLATFORM_POSITION['y'], PLATFORM['depth'] / 2) + contact_normal() * PLATFORM['thickness'] / 2
    check((frame.translation - centre).length < 1e-6, 'asset origin sits on the contact surface centre')
    z_axis = (frame.to_3x3() @ Vector((0, 0, 1))).normalized()
    check((z_axis - contact_normal()).length < 1e-6, 'asset +Z equals the contact normal (%s)' % str(tuple(round(v, 4) for v in z_axis)))
    tip = asset_part(skin, 'Tip').matrix_world.translation
    along = Vector((math.cos(PLATFORM_ANGLE), 0.0, math.sin(PLATFORM_ANGLE)))
    expected_tip = centre + along * (FITTED_LENGTH / 2 * PLATFORM['length'] / FITTED_LENGTH) - contact_normal() * 0.01
    check((tip - expected_tip).length < 1e-6, 'fittedParams stretch the asset to the platform length')
    skin.location = offset

    # The press part follows mm_hit; the holder and marble keys are untouched
    key = asset_part(skin, 'MM_REACT_Key')
    keys_before = list(platform['mm_keys'])
    scene.frame_set(0)
    rest = key.matrix_world.translation.copy()
    scene.frame_set(hit_frame)
    pressed = key.matrix_world.translation.copy()
    scene.frame_set(0)
    travel = (pressed - rest).dot(contact_normal())
    check(-0.0025 < travel < -0.0005, 'the MM_REACT_Key part presses along -normal at the hit (%.2f mm)' % (travel * 1000))
    check((key.matrix_world.translation - rest).length < 1e-9, 'the key rests away from hits')
    check(list(platform['mm_keys']) == keys_before, 'reactions leave holder keyframes unchanged')
    states = {item['mmId']: item for item in worker.handle('inspect', {})['holders']}
    check(states['platform-1']['link'] == 'linked' and states['platform-1']['skinKind'] == 'asset', 'inspect reports a linked asset skin')

    # Re-apply keeps the asset skin untouched
    skin_name = skin.name
    apply(worker)
    check(holder('platform-1').children[0].name == skin_name, 're-apply keeps the asset skin')

    # Per-piece reaction overrides: none stops the key, press sets its travel
    write_package(root, records, hit, asset=True, reaction={'preset': 'none', 'params': {}})
    apply(worker)
    key = asset_part(holder('platform-1').children[0], 'MM_REACT_Key')
    scene.frame_set(hit_frame)
    moved = (key.matrix_world.translation - rest).length
    scene.frame_set(0)
    check(moved < 1e-9, 'reaction preset none keeps the key still')
    write_package(root, records, hit, asset=True, reaction={'preset': 'press', 'params': {'press': 0.004}})
    apply(worker)
    key = asset_part(holder('platform-1').children[0], 'MM_REACT_Key')
    scene.frame_set(hit_frame)
    hit_value = holder('platform-1')['mm_hit']
    travel = (key.matrix_world.translation - rest).dot(contact_normal())
    scene.frame_set(0)
    check(abs(travel + 0.004 * hit_value) < 1e-5, 'press params set the key travel (%.2f mm)' % (travel * 1000))

    # Switching back to the theme default restores the default skin with the user's offset
    holder('platform-1').children[0].location = (0.001, 0.0, 0.002)
    write_package(root, records, hit)
    apply(worker)
    platform = holder('platform-1')
    check(len(platform.children) == 1 and platform.children[0].get('mm_skin') == 'default', 'no assetPath restores the default skin')
    check(close(platform.children[0].location, (0.001, 0.0, 0.002)), 'the default skin takes over the asset skin offset')
    check(not any(obj.get('mm_asset_part') for obj in bpy.data.collections[MANAGED_COLLECTION].objects), 'the asset copies are removed')

    # Default bar reactions per preset
    write_package(root, records, hit, reaction={'preset': 'wobble', 'params': {'angle': 10.0}})
    apply(worker)
    bar = next(child for child in holder('platform-1').children[0].children if child.get('mm_part') == 'bar')
    angles = []
    for frame_index in range(hit_frame, hit_frame + 8):
        scene.frame_set(frame_index)
        angles.append(bar.rotation_euler.y)
    scene.frame_set(0)
    check(min(angles) < -math.radians(1) and max(angles) > math.radians(1), 'wobble swings the bar both ways after the hit')
    check(abs(bar.location.z) < 1e-9, 'wobble does not press the bar')
    write_package(root, records, hit, reaction={'preset': 'glow', 'params': {'strength': 5.0}})
    apply(worker)
    bar = next(child for child in holder('platform-1').children[0].children if child.get('mm_part') == 'bar')
    scene.frame_set(hit_frame)
    flash = bar['mm_flash']
    scene.frame_set(0)
    check(flash > 2.0 and abs(bar.location.z) < 1e-9, 'glow flashes the bar without moving it (%.2f)' % flash)

    # An edited asset skin belongs to the user: switching back keeps it
    write_package(root, records, hit, asset=True)
    apply(worker)
    edited = holder('platform-1').children[0]
    asset_part(edited, 'Base').scale = (1.0, 1.0, 1.5)
    write_package(root, records, hit)
    report = apply(worker)
    check(holder('platform-1').children[0] == edited and report['skins'].get('platform-1') == 'edited', 'an edited asset skin is kept and reported')
    edited_state = next(item for item in worker.handle('inspect', {})['holders'] if item['mmId'] == 'platform-1')
    check(edited_state['skinKind'] == 'asset', 'the edited asset skin stays on its holder')
    asset_part(edited, 'Base').scale = (1.0, 1.0, 1.0)
    write_package(root, records, hit, asset=True)
    apply(worker)

    # A missing asset file keeps the current asset skin and reports it
    asset_file = root / ASSET_PATH
    hidden = asset_file.with_suffix('.hidden')
    asset_file.rename(hidden)
    report = apply(worker)
    check(report['skins'].get('platform-1') == 'missingAsset' and holder('platform-1').children[0].get('mm_skin') == 'asset',
          'a missing asset file keeps the current skin and is reported')
    hidden.rename(asset_file)

    # Wall text: created, updated, left alone after a user edit, removed
    title = {'id': 'text-1', 'text': 'MIDI', 'font': 'Bfont Regular', 'size': 0.04, 'depth': 0.004, 'color': '#2a2522',
             'position': {'x': 0.0, 'y': 0.23}, 'angle': 0.1}
    second = dict(title, id='text-2', text='Second', position={'x': 0.05, 'y': 0.05}, angle=0.0)
    write_package(root, records, hit, asset=True, texts=[title, second])
    report = apply(worker)
    text = text_object('text-1')
    check(sorted(report['texts']['created']) == ['text-1', 'text-2'] and text is not None, 'wall texts are created')
    check(text.data.body == 'MIDI' and abs(text.data.size - 0.04) < 1e-9 and abs(text.data.extrude - 0.002) < 1e-9, 'text body, size and depth')
    check(text.name in bpy.data.collections[MANAGED_COLLECTION].objects, 'wall text lives in the managed collection')
    towards_camera = (text.matrix_world.to_3x3() @ Vector((0, 0, 1))).normalized()
    reading = (text.matrix_world.to_3x3() @ Vector((1, 0, 0))).normalized()
    check((towards_camera - Vector((0, -1, 0))).length < 1e-6, 'wall text faces the camera side')
    check((reading - Vector((math.cos(0.1), 0, math.sin(0.1)))).length < 1e-6, 'wall angle turns the text counter-clockwise')
    check(abs(text.location.x) < 1e-6 and abs(text.location.z - 0.23) < 1e-6 and -0.003 < text.location.y < -0.002,
          'wall text sits on the wall at its position, raised by its depth')
    check(text.data.materials[0].diffuse_color[0] < 0.1, 'wall text gets its colour material')
    write_package(root, records, hit, asset=True, texts=[dict(title, text='MARBLE', color='#c9a227'), second])
    report = apply(worker)
    check(report['texts']['updated'] == ['text-1', 'text-2'] and text_object('text-1').data.body == 'MARBLE', 'an unedited text updates')
    text_object('text-2').location.z += 0.01
    states = {item['mmId']: item['link'] for item in worker.handle('inspect', {})['texts']}
    check(states == {'text-1': 'linked', 'text-2': 'unlinked'}, 'inspect reports the moved text as unlinked')
    write_package(root, records, hit, asset=True, texts=[dict(title, text='MARBLE', color='#c9a227'), dict(second, text='Changed')])
    report = apply(worker)
    check(report['texts']['skipped'] == ['text-2'] and text_object('text-2').data.body == 'Second', 'an edited text is left alone')
    write_package(root, records, hit, asset=True, texts=[])
    report = apply(worker)
    detached = bpy.data.collections[DETACHED_COLLECTION]
    check(sorted(report['texts']['removed']) == ['text-1', 'text-2'], 'removed texts are reported')
    check(text_object('text-1') is None, 'a removed unedited text is deleted')
    check(any(obj.type == 'FONT' and obj.get('mm_id') == 'text-2' for obj in detached.objects), 'a removed edited text moves to detached')

    # Brass still with the asset skin and a wall title, on the contact frame
    for obj in list(detached.objects):
        bpy.data.objects.remove(obj)
    # Title timing: a title with In and Out shows only inside its range and fades at both ends
    timed = dict(title, id='text-timed', text='Timed', **{'in': 0.1, 'out': 0.45})
    whole = dict(title, id='text-whole', text='Whole', position={'x': 0.05, 'y': 0.05}, angle=0.0)
    write_package(root, records, hit, asset=True, texts=[timed, whole])
    apply(worker)
    timed_obj, whole_obj = text_object('text-timed'), text_object('text-whole')

    def visible_at(obj, seconds):
        scene.frame_set(round(seconds * FPS))
        return obj.get('mm_visible'), obj.hide_render

    check(visible_at(timed_obj, 0.0) == (0.0, True), 'a timed title is hidden before its In time')
    value, hidden = visible_at(timed_obj, 0.3)
    check(value > 0.8 and not hidden, 'a timed title shows inside its range (%.2f)' % value)
    value, hidden = visible_at(timed_obj, 0.4)
    check(0.0 < value < 0.5 and not hidden, 'a timed title fades out before its Out time (%.2f)' % value)
    check(visible_at(timed_obj, 0.5)[1], 'a timed title is hidden after its Out time')
    check(visible_at(whole_obj, 0.0) == (1.0, False) and visible_at(whole_obj, 0.5) == (1.0, False),
          'a title without timing shows for the whole film')
    title_tree = timed_obj.data.materials[0].node_tree
    check(any(node.type == 'ATTRIBUTE' and node.attribute_name == 'mm_visible' for node in title_tree.nodes)
          and any(node.type == 'BSDF_TRANSPARENT' for node in title_tree.nodes), 'the title material fades by mm_visible')
    states = {item['mmId']: item['link'] for item in worker.handle('inspect', {})['texts']}
    check(states == {'text-timed': 'linked', 'text-whole': 'linked'}, 'timing keys do not detach a title')
    def id_pixels_of(preview, mm_id):
        key = next(key for key, value in preview['ids'].items() if value == mm_id)
        target = np.array([int(key[i:i + 2], 16) for i in (1, 3, 5)])
        image = bpy.data.images.load(preview['idPath'])
        pixels = (np.array(image.pixels[:]).reshape(-1, 4) * 255).round()
        bpy.data.images.remove(image)
        return int(np.sum(np.all(np.abs(pixels[:, :3] - target) <= 1, axis=1) & (pixels[:, 3] > 200)))

    hidden_pixels = id_pixels_of(worker.handle('preview_frame', {'time': 0.0, 'width': 240}), 'text-timed')
    shown_pixels = id_pixels_of(worker.handle('preview_frame', {'time': 0.3, 'width': 240}), 'text-timed')
    check(hidden_pixels == 0 and shown_pixels > 0, 'the ID pass picks a timed title only inside its range (%d, %d px)' % (hidden_pixels, shown_pixels))
    write_package(root, records, hit, asset=True, texts=[dict(timed, **{'in': 0.0, 'out': DURATION})])
    apply(worker)
    check(visible_at(text_object('text-timed'), 0.0) == (1.0, False), 'a range covering the film clears the timing')
    scene.frame_set(0)

    # Screen titles: a caption near the top and an end card in the centre hang from the camera at a fixed frame size
    caption = dict(title, id='text-caption', text='CAPTION', style='caption', size=0.06, color='#ffffff')
    end_card = dict(title, id='text-end', text='END', style='endCard', size=0.08, color='#ffffff')
    song_name = dict(title, id='text-song', text='SONG', style='songName', size=0.07, color='#ffffff')
    write_package(root, records, hit, asset=True, texts=[caption, end_card, song_name])
    report = apply(worker)
    camera_obj = scene.camera
    check(report['texts']['screen'] == 3, 'apply attaches the caption, song name and end card to the camera')
    caption_obj, end_obj, song_obj = text_object('text-caption'), text_object('text-end'), text_object('text-song')
    check(caption_obj.parent == camera_obj and end_obj.parent == camera_obj and not caption_obj.visible_shadow,
          'screen titles are parented to the film camera and cast no shadow')
    for frame in (0, round(DURATION * FPS)):
        scene.frame_set(frame)
        bpy.context.view_layer.update()
        centre = world_to_camera_view(scene, camera_obj, caption_obj.matrix_world.translation)
        top = world_to_camera_view(scene, camera_obj, caption_obj.matrix_world @ Vector((0.0, 0.5, 0.0)))
        end_centre = world_to_camera_view(scene, camera_obj, end_obj.matrix_world.translation)
        check(abs(centre.y - 0.85) < 0.01 and abs(centre.x - 0.5) < 0.01 and 0 < centre.z,
              'the caption sits at the top centre of the frame at frame %d (%.3f, %.3f; focus %.3f, camera %s, caption %s, lens %.1f)' % (
                  frame, centre.x, centre.y, camera_obj.data.dof.focus_distance, tuple(round(v, 3) for v in camera_obj.matrix_world.translation),
                  tuple(round(v, 3) for v in caption_obj.matrix_world.translation), camera_obj.data.lens))
        check(abs((top.y - centre.y) * 2 - 0.06 * walltext.SCREEN_FONT_SCALE) < 0.004, 'the caption keeps its size in the frame at frame %d, its font 1.4 times its letter height like the encoder' % frame)
        check(abs(end_centre.y - 0.5) < 0.01, 'the end card sits in the centre at frame %d' % frame)
        song_centre = world_to_camera_view(scene, camera_obj, song_obj.matrix_world.translation)
        check(abs(song_centre.y - 0.65) < 0.01 and abs(song_centre.x - 0.5) < 0.01 and song_obj.parent == camera_obj,
              'the song name sits upright in the upper third of the frame at frame %d (%.3f)' % (frame, song_centre.y))
    # The film's rig camera is perspective and moves; the drivers follow its distance to the wall and its focus
    camera_obj.data.type = 'PERSP'
    camera_obj.data.dof.focus_distance = 0.5
    walltext.attach_screen_texts(bpy.data.collections[MANAGED_COLLECTION], camera_obj, scene)
    for location in ((0.0, -0.6, 0.1), (0.05, -0.35, 0.2)):
        camera_obj.location = location
        bpy.context.view_layer.update()
        centre = world_to_camera_view(scene, camera_obj, caption_obj.matrix_world.translation)
        top = world_to_camera_view(scene, camera_obj, caption_obj.matrix_world @ Vector((0.0, 0.5, 0.0)))
        check(abs(centre.y - 0.85) < 0.01 and abs((top.y - centre.y) * 2 - 0.06 * walltext.SCREEN_FONT_SCALE) < 0.004 and 0 < centre.z < abs(location[1]),
              'a perspective camera %.2f m from the wall keeps the caption at the top in front of the wall' % abs(location[1]))
    states = {item['mmId']: item['link'] for item in worker.handle('inspect', {})['texts']}
    check(states == {'text-caption': 'linked', 'text-end': 'linked', 'text-song': 'linked'}, 'camera drivers do not detach a screen title')
    # The film encoder burns a song name in like a caption, in the upper third on the same backing
    filters = render.screen_title_filters({'height': 1920, 'duration': 10.0, 'screenTitles': [
        {'text': 'SONG', 'style': 'songName', 'size': 0.07, 'color': '#ffffff', 'in': None, 'out': 3.0}]}, Path(root))
    check(not filters or (':y=672.0-text_h/2' in filters[0] and 'boxcolor=black@0.28' in filters[0]),
          'the encoder draws a song name in the upper third on its backing')
    write_package(root, records, hit, asset=True, texts=[dict(caption, style='wall')])
    apply(worker)
    unparented = text_object('text-caption')
    check(unparented.parent is None and (unparented.animation_data is None or unparented.animation_data.drivers.find('location', index=2) is None),
          'a caption switched back to a wall title leaves the camera')
    scene.frame_set(0)

    # Project themes: a base theme with a few colours on top. The wall, the key light and Neon's glowing edges follow
    def studio(role):
        return next(obj for obj in bpy.data.collections[STUDIO_COLLECTION].objects if obj.get('mm_role') == role)

    def near(color, hex_color):
        return all(abs(a - b) < 1e-3 for a, b in zip(color[:3], parse_color(hex_color)[:3]))

    write_package(root, records, hit, asset=True, overrides={'wallColor': '#336699', 'lightColor': '#ff8800'})
    report = apply(worker)
    wall_material = studio('studio.wall').data.materials[0]
    check(report['themed'] and wall_material.name.startswith('MM · wall plaster ') and near(wall_material.diffuse_color, '#336699'),
          "a project theme's Wall colour paints the wall (%s)" % wall_material.name)
    check(near(studio('studio.sun').data.color, '#ff8800'), "a project theme's Light colour tints the key light")
    write_package(root, records, hit, theme='neon', overrides={'glowColor': '#00ff00'})
    apply(worker)
    trims = [slot.material.name for obj in holder('platform-1').children_recursive if obj.type == 'MESH' for slot in obj.material_slots
             if slot.material is not None and slot.material.name.startswith('MM · neon trim')]
    check(trims and all(name.startswith('MM · neon trim 0.000 1.000 0.000') for name in trims), "a Neon project theme's Glow colours every edge (%s)" % trims)
    # The Wall and Lights layers: an override on a built-in theme applies, and the theme's default returns on reset.
    # The worker starts from an empty scene, so its world is its own; this check started from the factory scene's
    own_world = bpy.data.worlds.new('MM studio')
    own_world['mm_owner'] = 'midimarble'
    bpy.context.scene.world = own_world
    write_package(root, records, hit, asset=True, overrides={'backgroundColor': '#000001'})
    apply(worker)
    write_package(root, records, hit, asset=True)
    apply(worker)
    default_world = tuple(own_world.color)
    sun = studio('studio.sun')
    default_sun = (sun.data.energy, tuple(sun.data.color), tuple(sun.rotation_euler))
    default_wall = studio('studio.wall').data.materials[0].name
    fill = {'id': 'light-1', 'name': 'Fill', 'color': '#00ff88', 'strength': 4.0, 'side': 0.5, 'height': 0.0}
    write_package(root, records, hit, asset=True, overrides={'wallColor': '#336699', 'backgroundColor': '#102030', 'lightColor': '#ff8800'},
                  layers={'wallKind': 'grid', 'keyLight': {'strength': 9.0, 'side': 0.5, 'height': 0.0, 'softness': 0.5, 'exposure': 0.5, 'bloom': 0.4}, 'lights': [fill]})
    report = apply(worker)
    check(abs(math.degrees(sun.data.angle) - 30.0) < 1e-3, "the Key Light's Softness sets the sun's angle (%.1f degrees)" % math.degrees(sun.data.angle))
    scene = bpy.context.scene
    check(abs(scene.view_settings.exposure - themes.THEMES[themes.theme_name(scene.get('mm_theme', '').split(' ')[0])]['exposure'] - 0.5) < 1e-4, 'Exposure adds to the theme')
    bloom = scene.compositing_node_group
    check(bloom is not None and scene.render.use_compositing and bloom.nodes['Bloom'].inputs['Type'].default_value == 'Bloom' and abs(bloom.nodes['Bloom'].inputs['Strength'].default_value - 0.4 * themes.BLOOM_STRENGTH) < 1e-4, 'Bloom composites a Glare over the render')
    wall_material = studio('studio.wall').data.materials[0]
    check(wall_material.name.startswith('MM · wall neon ') and near(wall_material.diffuse_color, '#336699'),
          "the Wall layer's Skin and colour apply on a built-in theme (%s)" % wall_material.name)
    check(near(sun.data.color, '#ff8800') and abs(sun.data.energy - 9.0) < 1e-4, "the Key Light's colour and strength apply")
    # Side 50 %, Height 0: the light stands to the right in front of the wall, so it travels left and into the wall
    travel = sun.rotation_euler.to_matrix() @ Vector((0.0, 0.0, -1.0))
    check(close(travel, (-math.sqrt(0.5), math.sqrt(0.5), 0.0), 1e-3), "the Key Light's Side and Height set its direction (%s)" % str(tuple(travel)))
    check(near(bpy.context.scene.world.color, '#102030'), 'the Background colour reaches the world')

    def added_light(light_id):
        return next((obj for obj in bpy.data.collections[STUDIO_COLLECTION].objects if obj.get('mm_light_id') == light_id), None)

    light = added_light('light-1')
    check(light is not None and light.type == 'LIGHT' and light.data.type == 'SUN' and light.get('mm_owner') == 'midimarble' and report['lights']['created'] == ['light-1'],
          'an added light becomes an app-owned sun')
    check(near(light.data.color, '#00ff88') and abs(light.data.energy - 4.0) < 1e-4 and light.name == 'Fill', 'an added light takes its colour, strength and name')
    fill['strength'] = 6.0
    write_package(root, records, hit, asset=True, layers={'lights': [fill]})
    # (the next apply takes Bloom away again)
    report = apply(worker)
    check(abs(added_light('light-1').data.energy - 6.0) < 1e-4 and report['lights']['updated'] == ['light-1'], 'an edit reaches an untouched added light')
    check(studio('studio.wall').data.materials[0].name == default_wall and abs(sun.data.energy - default_sun[0]) < 1e-4 and close(sun.data.color, default_sun[1], 1e-3) and close(sun.rotation_euler, default_sun[2], 1e-3),
          "the theme's wall and Key Light return on reset")
    check(close(own_world.color, default_world, 1e-3), "the theme's background returns on reset")
    # A light edited in Blender belongs to Blender: it keeps its values, and deleting it only hides it
    added_light('light-1').data.energy = 11.0
    fill['strength'] = 1.0
    write_package(root, records, hit, asset=True, layers={'lights': [fill]})
    report = apply(worker)
    check(abs(added_light('light-1').data.energy - 11.0) < 1e-4 and report['lights']['skipped'] == ['light-1'], 'a light edited in Blender keeps its values')
    write_package(root, records, hit, asset=True)
    report = apply(worker)
    check(added_light('light-1').hide_render and report['lights']['hidden'] == ['light-1'], 'deleting a light edited in Blender hides it')
    write_package(root, records, hit, asset=True, layers={'lights': [fill]})
    apply(worker)
    check(not added_light('light-1').hide_render and abs(added_light('light-1').data.energy - 11.0) < 1e-4, 'undoing the delete shows it again with its edits')
    # An untouched added light is removed with its layer
    bpy.data.objects.remove(added_light('light-1'))
    write_package(root, records, hit, asset=True, layers={'lights': [fill]})
    apply(worker)
    write_package(root, records, hit, asset=True)
    report = apply(worker)
    check(added_light('light-1') is None and report['lights']['removed'] == ['light-1'], 'deleting an untouched light removes it')

    # Neon marbles contrast with their own lane: a pearl-white body with the lane's hue only on the rim, never the
    # saturated hue its platforms glow in
    write_package(root, records, hit, theme='neon')
    apply(worker)
    marble_materials = [slot.material for obj in [holder('marble-1'), *holder('marble-1').children_recursive] if obj.type == 'MESH'
                        for slot in obj.material_slots if slot.material is not None]
    platform_materials = [slot.material for obj in holder('platform-1').children_recursive if obj.type == 'MESH'
                          for slot in obj.material_slots if slot.material is not None]

    def luminance(color):
        return 0.2126 * color[0] + 0.7152 * color[1] + 0.0722 * color[2]

    def saturation(color):
        top = max(color[:3])
        return 0.0 if top <= 0 else (top - min(color[:3])) / top

    marble_body = marble_materials[0].diffuse_color if marble_materials else (0.0, 0.0, 0.0, 1.0)
    check(marble_materials and marble_materials[0].name.startswith('MM · neon pearl marble') and saturation(marble_body) < 0.2,
          'a Neon marble is pearl white, not its lane colour (%s, saturation %.2f)' % (marble_materials[0].name if marble_materials else None, saturation(marble_body)))
    lane_glows = [tuple(material.node_tree.nodes['Principled BSDF'].inputs['Emission Color'].default_value) for material in platform_materials
                  if material.name.startswith('MM · neon trim')]
    lane_bodies = [tuple(material.diffuse_color) for material in platform_materials]
    check(lane_glows and all(saturation(glow) > 0.8 for glow in lane_glows), 'Neon platforms glow in their lane hue (%d trims)' % len(lane_glows))
    contrast = min((luminance(marble_body) + 0.05) / (luminance(body) + 0.05) for body in lane_bodies) if lane_bodies else 0.0
    check(contrast >= 3.0, 'a Neon marble is at least 3:1 lighter than every surface of its lane platform (%.1f:1)' % contrast)
    # More Skins: a Brass skin dresses a platform as Brass in Neon too
    write_package(root, records, hit, theme='neon', skin='brass:copper')
    apply(worker)
    names = [slot.material.name for obj in holder('platform-1').children_recursive if obj.type == 'MESH' for slot in obj.material_slots if slot.material is not None]
    check(any('copper' in name.lower() for name in names) and not any(name.startswith('MM · neon trim') for name in names),
          'a Brass skin from More Skins dresses a Neon platform as copper Brass (%s)' % sorted(set(names)))
    write_package(root, records, hit, asset=True)
    report = apply(worker)
    check(report['themed'] and studio('studio.wall').data.materials[0].name == 'MM · wall plaster', 'the built-in theme brings its own wall back')

    title_text = dict(title, text='MIDI MARBLE', size=0.026, depth=0.003, color='#b8892b', position={'x': 0.0, 'y': 0.215}, angle=0.0)
    write_package(root, records, hit, asset=True, texts=[title_text, caption])
    apply(worker)
    out = Path(os.environ.get('MM_CHECK_OUT') or APP_DIR / '.local' / 'design')
    out.mkdir(parents=True, exist_ok=True)
    still = render.render_still(scene, out / 'design-brass.png', round(hit * FPS) / FPS, 720)
    check(Path(still).is_file(), 'brass still renders with the asset skin and wall title')
    summary.append('still: ' + str(still))
    preview = worker.handle('preview_frame', {'time': 0.0, 'width': 360})
    check('text-1' in preview['ids'].values(), 'the ID pass picks wall text')

    # A short film still renders from the saved scene copy with appended assets and text
    write_package(root, records, hit, asset=True, texts=[title_text], duration=0.2)
    apply(worker)
    started = worker.handle('render_film', {'preset': 'fast', 'outputPath': 'renders/design.mp4', 'jobId': 'job-design'})
    envelope = render.wait_for_job(root, 'job-design', timeout=600)
    check(envelope['ok'] and Path(envelope['result']['path']).is_file(), 'render_film writes the film (%d frames)' % started['frames'])

    shutil.rmtree(root.parent, ignore_errors=True)
    print('\n'.join(summary))
    print('CHECK PASSED: %d assertions' % sum(1 for line in summary if line.startswith('ok')))


main()
