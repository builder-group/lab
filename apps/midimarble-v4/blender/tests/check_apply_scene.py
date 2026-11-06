"""Headless check of the worker's scene operations.

Run: Blender --background --factory-startup --python-exit-code 1 --python blender/tests/check_apply_scene.py
"""
import json
import os
import math
import shutil
import sys
import tempfile
import time
from pathlib import Path

import bpy
import numpy as np
from bpy_extras.object_utils import world_to_camera_view
from mathutils import Vector

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from mm_worker.bridge import Bridge  # noqa: E402
from mm_worker.ops import Worker  # noqa: E402
from mm_worker.util import MARBLE_WALL_GAP  # noqa: E402
from mm_worker import scene as worker_scene  # noqa: E402
from mm_worker.util import DETACHED_COLLECTION, MANAGED_COLLECTION  # noqa: E402

FPS = 60.0
PHYSICS_HZ = 240.0
DURATION = 1.0
GRAVITY = 9.81
RADIUS = 0.01
RELEASE = (0.0, 0.6, 0.1)  # x, y, time
VX = 0.1
PLATFORM = {'length': 0.06, 'thickness': 0.008, 'depth': 0.03}
PLATFORM_Y = 0.2
PLATFORM_ANGLE = 0.2
RESTITUTION = 0.6
WINDMILL_SPEED = 2.0

summary = []


def check(condition, message):
    if not condition:
        raise AssertionError(message)
    summary.append('ok  ' + message)


def ballistic():
    """Marble falling from the release point, bouncing once off the platform top"""
    x0, y0, t0 = RELEASE
    contact_y = PLATFORM_Y + PLATFORM['thickness'] / 2 + RADIUS
    hit = t0 + math.sqrt(2 * (y0 - contact_y) / GRAVITY)
    bounce_speed = RESTITUTION * GRAVITY * (hit - t0)
    times = t0 + np.arange(0, int((DURATION - t0) * PHYSICS_HZ) + 1) / PHYSICS_HZ
    y = np.where(
        times <= hit,
        y0 - GRAVITY / 2 * (times - t0) ** 2,
        contact_y + bounce_speed * (times - hit) - GRAVITY / 2 * (times - hit) ** 2,
    )
    x = x0 + VX * (times - t0)
    angle = -(x - x0) / RADIUS
    return np.stack([times, x, y, angle], axis=1).astype('<f4'), hit


WINDMILL_CONTACT = 0.6
WINDMILL_STALE_HIT = 0.3


def write_package(root, marble_records, hit, platform_position, platform_angle, with_windmill, theme='pegboard', camera=None):
    motion = root / '.cache' / 'motion'
    motion.mkdir(parents=True, exist_ok=True)
    marble_records.tofile(motion / 'marble-1.bin')
    windmill_times = np.arange(0, int(DURATION * PHYSICS_HZ) + 1) / PHYSICS_HZ
    windmill = np.stack([windmill_times, WINDMILL_SPEED * windmill_times], axis=1).astype('<f4')
    windmill.tofile(motion / 'windmill-1.bin')
    pieces = [{
        'id': 'platform-1', 'name': 'Platform 1', 'type': 'platform', 'params': PLATFORM,
        'position': platform_position, 'angle': platform_angle, 'wallOffset': 0.0,
        'hitTimes': [hit], 'motionPath': None, 'sampleCount': 0, 'skin': None, 'color': '#e2a33b',
    }]
    if with_windmill:
        pieces.append({
            'id': 'windmill-1', 'name': 'Windmill 1', 'type': 'windmill',
            'params': {'length': 0.05, 'thickness': 0.005, 'depth': 0.02},
            'position': {'x': 0.25, 'y': 0.4}, 'angle': 0.0, 'wallOffset': 0.002,
            # Scenery reacts to contacts; a stray hit time on it is ignored
            'hitTimes': [WINDMILL_STALE_HIT], 'contactTimes': [WINDMILL_CONTACT], 'musical': False,
            'motionPath': '.cache/motion/windmill-1.bin', 'sampleCount': len(windmill), 'skin': None, 'color': '#5aa5d6',
        })
    description = {
        'version': 1, 'projectId': 'check', 'revision': 1, 'fps': FPS, 'duration': DURATION,
        'frame': {'width': 1080, 'height': 1920}, 'theme': theme,
        'marbles': [{
            'id': 'marble-1', 'name': 'Marble 1', 'radius': RADIUS, 'color': '#d94f4f',
            'motionPath': '.cache/motion/marble-1.bin', 'sampleCount': len(marble_records),
        }],
        'pieces': pieces,
    }
    if camera is not None:
        description['camera'] = camera
    (root / '.cache' / 'scene.json').write_text(json.dumps(description))
    return windmill


def holder(mm_id):
    collection = bpy.data.collections[MANAGED_COLLECTION]
    return next((obj for obj in collection.objects if obj.get('mm_id') == mm_id and obj.type == 'EMPTY'), None)


def main():
    root = Path(tempfile.mkdtemp(prefix='mm-check-')) / 'Check.marble'
    root.mkdir(parents=True)
    scene = bpy.context.scene
    cube = bpy.data.objects.get('Cube')
    if cube is not None:
        # The factory cube would hide the run; it stays in the scene as a user object the worker must not touch
        cube.location = (5.0, 0.0, 0.0)
    cube_location = tuple(cube.location) if cube else None

    # Mailbox round trip, including a request the worker must survive
    bridge = Bridge(root)
    bridge.ready = True
    inbox, outbox = root / '.bridge' / 'host-inbox', root / '.bridge' / 'outbox'
    (inbox / 'req-ping.json').write_text(json.dumps({'id': 'req-ping', 'op': 'ping', 'args': {}}))
    (inbox / 'req-bad.json').write_text(json.dumps({'id': 'req-bad', 'op': 'explode', 'args': {}}))
    (inbox / 'req-broken.json').write_text('{not json')
    bridge.tick()
    ping = json.loads((outbox / 'req-ping.json').read_text())
    bad = json.loads((outbox / 'req-bad.json').read_text())
    broken = json.loads((outbox / 'req-broken.json').read_text())
    check(ping['ok'] and ping['result']['protocol'] == 1, 'mailbox answers ping')
    check(not bad['ok'] and bad['error']['code'] == 'UNKNOWN_OP', 'mailbox reports unknown op as an error')
    check(not broken['ok'] and broken['error']['code'] == 'INVALID_REQUEST', 'mailbox survives malformed JSON')
    check(json.loads((root / '.bridge' / 'status.json').read_text())['ready'], 'status.json reports ready')

    worker = Worker(root)
    marble_records, hit = ballistic()
    hit_x = float(RELEASE[0] + VX * (hit - RELEASE[2]))
    platform_position = {'x': hit_x, 'y': PLATFORM_Y}
    windmill = write_package(root, marble_records, hit, platform_position, PLATFORM_ANGLE, True)
    began = time.perf_counter()
    report = worker.handle('apply_scene', {'descriptionPath': '.cache/scene.json'})
    summary.append('apply_scene took %.1f ms, %d keys' % ((time.perf_counter() - began) * 1000, report['keyframes']))
    check(sorted(report['created']) == ['marble-1', 'platform-1', 'windmill-1'], 'first apply creates three holders')
    check(scene.render.fps == 60 and abs(scene.render.fps_base - 1) < 1e-9, 'scene fps is exact')
    check(scene.frame_start == 0 and scene.frame_end == 60, 'frame range covers the duration')
    check((scene.render.resolution_x, scene.render.resolution_y) == (1080, 1920), 'portrait frame renders at 1080x1920')
    check(scene.render.engine == 'BLENDER_EEVEE', 'render engine is Eevee')

    # Marble playback matches the physics samples after the wall mapping
    marble = holder('marble-1')
    check(all(marble.lock_location) and all(marble.lock_rotation) and all(marble.lock_scale), 'holder transforms are locked')
    check(marble['mm_owner'] == 'midimarble' and marble['mm_role'] == 'marble', 'holder carries mm_ tags')
    samples = marble_records.astype(np.float64)
    worst = 0.0
    # Frames away from the hit play the samples exactly; frames near it are time-warped onto the contact frame
    contact_frame = round(hit * 30) * 2
    for frame in (6, 7, 14, 31, 45, 59, 60):
        scene.frame_set(frame)
        t = frame / FPS
        expected = (
            np.interp(t, samples[:, 0], samples[:, 1]),
            -(RADIUS + MARBLE_WALL_GAP),
            np.interp(t, samples[:, 0], samples[:, 2]),
        )
        actual = marble.matrix_world.translation
        worst = max(worst, max(abs(actual[index] - expected[index]) for index in range(3)))
        expected_rotation = -np.interp(t, samples[:, 0], samples[:, 3])
        check(abs(marble.rotation_euler.y - expected_rotation) < 1e-3, 'marble rotation at frame %d' % frame)
    check(worst < 1e-4, 'marble world location matches samples away from hits (worst %.2e m)' % worst)
    scene.frame_set(contact_frame)
    contact_z = PLATFORM_Y + PLATFORM['thickness'] / 2 + RADIUS
    check(abs(marble.matrix_world.translation.z - contact_z) < 1e-4,
          'the contact frame %d shows the marble touching the platform' % contact_frame)
    check(abs(contact_frame / FPS - hit) <= 1 / 60 + 1e-9, 'the contact frame is within one 60 fps frame of the hit')
    heights = []
    for frame in range(contact_frame - 8, contact_frame + 9):
        scene.frame_set(frame)
        heights.append(marble.matrix_world.translation.z)
    check(int(np.argmin(heights)) == 8, 'the marble is lowest on the contact frame')
    skin = marble.children[0]
    check((skin.matrix_world.translation - marble.matrix_world.translation).length < 1e-9, 'marble skin follows its holder')

    # Static piece pose and tilt direction as seen from the front camera
    platform = holder('platform-1')
    check(abs(platform.rotation_euler.y + PLATFORM_ANGLE) < 1e-6, 'platform rotation is -angle around Y')
    check(abs(platform.location.y + PLATFORM['depth'] / 2) < 1e-6, 'platform sits at wallOffset + depth/2')
    platform_skin = platform.children[0]
    right = platform_skin.matrix_world @ Vector((PLATFORM['length'] / 2, 0, 0))
    left = platform_skin.matrix_world @ Vector((-PLATFORM['length'] / 2, 0, 0))
    check(right.z > left.z and right.x > left.x, 'positive wall angle tilts the platform up to the right')
    camera = scene.camera
    right_view = world_to_camera_view(scene, camera, right)
    left_view = world_to_camera_view(scene, camera, left)
    check(right_view.x > left_view.x and right_view.y > left_view.y, 'front camera sees the right end higher and to the right')

    # Moving piece follows its recorded angle
    windmill_holder = holder('windmill-1')
    for frame in (0, 15, 37, 60):
        scene.frame_set(frame)
        expected = -np.interp(frame / FPS, windmill[:, 0].astype(np.float64), windmill[:, 1].astype(np.float64))
        check(abs(windmill_holder.rotation_euler.y - expected) < 1e-4, 'windmill rotation at frame %d' % frame)

    # Scenery reacts on contact: the windmill's `mm_hit` follows its contact times, never hit times, and flashes it
    windmill_hit = next(curve for curve in bpy_channelbag(windmill_holder).fcurves if curve.data_path == '["mm_hit"]')
    contact = round(WINDMILL_CONTACT * FPS)
    check(abs(windmill_hit.evaluate(contact) - 1.0) < 1e-5, 'windmill mm_hit is 1 on its contact frame %d' % contact)
    check(windmill_hit.evaluate(round(WINDMILL_STALE_HIT * FPS)) < 1e-6, 'windmill mm_hit ignores hit times')
    windmill_skin = next(child for child in windmill_holder.children if child.get('mm_skin') == 'default')
    scene.frame_set(contact)
    check(windmill_skin.get('mm_root_flash') and windmill_skin['mm_flash'] > 1.0,
          'windmill skin flashes on contact (%.2f)' % windmill_skin['mm_flash'])
    scene.frame_set(contact + round(0.3 * FPS))
    check(windmill_skin['mm_flash'] < 1e-6, 'windmill flash fades after the contact')

    # Hit value peaks at the hit
    fcurve = next(curve for curve in bpy_channelbag(platform).fcurves if curve.data_path == '["mm_hit"]')
    check(abs(fcurve.evaluate(contact_frame) - 1.0) < 1e-5, 'mm_hit is 1 on the contact frame %d' % contact_frame)
    check(fcurve.evaluate(contact_frame - 1) < 1e-6, 'mm_hit is 0 before the contact frame')
    whole = [fcurve.evaluate(frame) for frame in range(scene.frame_end + 1)]
    check(int(np.argmax(whole)) == contact_frame, 'mm_hit peaks on the contact frame')
    check(fcurve.evaluate(contact_frame + 0.26 * FPS) < 1e-6, 'mm_hit decays to 0 within 0.25 s')
    check(all(point.interpolation == 'LINEAR' for point in fcurve.keyframe_points), 'keys interpolate linearly')

    # Preview render and object ID pass
    preview_time = 0.3
    result = worker.handle('preview_frame', {'time': preview_time, 'width': 540})
    check(Path(result['path']).is_file() and Path(result['idPath']).is_file(), 'preview_frame writes the PNG and ID PNG')
    if os.environ.get('MM_CHECK_OUT'):
        shutil.copy(result['path'], Path(os.environ['MM_CHECK_OUT']) / 'preview.png')
        shutil.copy(result['idPath'], Path(os.environ['MM_CHECK_OUT']) / 'preview.ids.png')
    summary.append('preview_frame 540x%d: render %.0f ms, ID pass %.0f ms' % (result['height'], result['renderMs'], result['idMs']))
    scene.frame_set(round(preview_time * FPS))
    view = world_to_camera_view(scene, camera, marble.matrix_world.translation)
    image = bpy.data.images.load(result['idPath'])
    image.colorspace_settings.name = 'Non-Color'
    width, height = image.size
    pixels = np.array(image.pixels[:]).reshape(height, width, 4)
    px, py = int(view.x * width), int(view.y * height)
    rgb = tuple(int(round(value * 255)) for value in pixels[py, px, :3])
    picked = None
    for key, mm_id in result['ids'].items():
        target = tuple(int(key[index:index + 2], 16) for index in (1, 3, 5))
        if max(abs(a - b) for a, b in zip(rgb, target)) <= 2:
            picked = mm_id
    check(picked == 'marble-1', 'ID pass picks the marble under its pixel (got %s at %s)' % (picked, rgb))
    check(scene.render.engine == 'BLENDER_EEVEE' and scene.render.resolution_x == 1080, 'preview restores render settings')

    # User edits unlink a holder; apply leaves it alone until relinked
    platform.location.z += 0.01
    states = {item['mmId']: item['link'] for item in worker.handle('inspect', {})['holders']}
    check(states == {'marble-1': 'linked', 'platform-1': 'unlinked', 'windmill-1': 'linked'}, 'inspect reports the moved platform as unlinked')
    report = worker.handle('apply_scene', {'descriptionPath': '.cache/scene.json'})
    check(report['skipped'] == ['platform-1'], 'apply skips the unlinked platform')
    report = worker.handle('apply_scene', {'descriptionPath': '.cache/scene.json', 'relink': ['platform-1']})
    check('platform-1' in report['updated'] and abs(platform.location.z - PLATFORM_Y) < 1e-6, 'relink restores the app transform')

    # Moving the piece in Compose keeps the manual skin offset
    offset = (0.0, -0.003, 0.004)
    platform_skin.location = offset
    skin_name = platform_skin.name
    moved = {'x': hit_x + 0.05, 'y': PLATFORM_Y + 0.02}
    write_package(root, marble_records, hit, moved, 0.3, True)
    worker.handle('apply_scene', {'descriptionPath': '.cache/scene.json'})
    platform = holder('platform-1')
    check(abs(platform.location.x - moved['x']) < 1e-6 and abs(platform.rotation_euler.y + 0.3) < 1e-6, 'moved piece moves its holder')
    check(len(platform.children) == 1 and platform.children[0].name == skin_name, 'existing skin is kept')
    check(all(abs(a - b) < 1e-9 for a, b in zip(platform.children[0].location, offset)), 'manual skin offset survives re-apply')

    # Removing a piece deletes an untouched skin; one changed in Blender is kept, detached in place and out of the film
    windmill_skin = holder('windmill-1').children[0]
    windmill_skin_name = windmill_skin.name
    world_before = windmill_skin.matrix_world.copy()
    windmill_skin['mm_skin'] = 'mine'
    write_package(root, marble_records, hit, moved, 0.3, False)
    report = worker.handle('apply_scene', {'descriptionPath': '.cache/scene.json'})
    detached = bpy.data.collections[DETACHED_COLLECTION]
    windmill_skin = bpy.data.objects[windmill_skin_name]
    check(report['removed'] == ['windmill-1'] and holder('windmill-1') is None, 'removed piece deletes its holder')
    check(windmill_skin.name in detached.objects and windmill_skin.parent is None, 'removed piece skin moves to detached')
    check(detached.hide_render and detached.hide_viewport, 'detached work is never drawn in a film')
    check(windmill_skin.name not in bpy.data.collections[MANAGED_COLLECTION].objects, 'detached skin leaves the managed collection')
    check(all(abs(a - b) < 1e-6 for a, b in zip(np.array(windmill_skin.matrix_world).ravel(), np.array(world_before).ravel())), 'detached skin keeps its world transform')

    check_themes_camera_and_render(worker, root, marble_records, hit, moved)

    untouched_holder = holder('platform-1')
    untouched_name = untouched_holder.children[0].name
    worker_scene.detach(untouched_holder, bpy.data.collections[MANAGED_COLLECTION])
    check(bpy.data.objects.get(untouched_name) is None, 'an untouched skin goes with its piece')

    # Bad requests fail cleanly
    try:
        worker.handle('apply_scene', {'descriptionPath': '../outside.json'})
        check(False, 'paths outside the package are rejected')
    except Exception as error:
        check(getattr(error, 'code', None) == 'INVALID_ARGS', 'paths outside the package are rejected')

    if cube is not None:
        check(bpy.data.objects.get('Cube') is not None and tuple(cube.location) == cube_location, 'objects outside MidiMarble collections stay untouched')

    saved = worker.handle('save', {})
    check(Path(saved['path']).is_file(), 'save writes scene.blend')
    shutil.rmtree(root.parent, ignore_errors=True)
    check_device_skins()
    check_color_by_note()
    check_marble_contrast()
    check_switchback_skins()
    check_readable_camera_and_wall()
    print('\n'.join(summary))
    print('CHECK PASSED: %d assertions' % sum(1 for line in summary if line.startswith('ok')))


def check_themes_camera_and_render(worker, root, marble_records, hit, moved):
    from bpy_extras.object_utils import world_to_camera_view
    from mm_worker import render
    scene = bpy.context.scene
    rig = {'mode': 'rig', 'distance': 0.5, 'pitch': 0.45, 'lead': 0.15, 'smoothing': 0.6,
           'shots': [{'id': 's1', 'time': 0.6, 'distance': 0.4}]}

    # A user-edited default skin and a custom skin survive a theme switch; untouched default skins are rebuilt
    platform = holder('platform-1')
    marble = holder('marble-1')
    platform_skin = platform.children[0]
    marble_skin = marble.children[0]
    custom = bpy.data.objects.new('Custom skin', bpy.data.meshes.new('Custom mesh'))
    bpy.data.collections[MANAGED_COLLECTION].objects.link(custom)
    custom.parent = marble
    custom['mm_skin'] = 'user'
    user_material = bpy.data.materials.new('User paint')
    marble_skin.data.materials[0] = user_material
    write_package(root, marble_records, hit, moved, 0.3, True, theme='brass', camera=rig)
    report = worker.handle('apply_scene', {'descriptionPath': '.cache/scene.json'})
    check(report['theme'] == 'brass' and report['themed'], 'theme switch to brass re-themes the studio')
    check(report['skins'].get('marble-1') in ('edited', 'custom'), 'apply reports user-owned marble skins')
    check(marble_skin.data.materials[0] == user_material, 'a user-edited default skin is not rebuilt')
    check(custom.name in bpy.data.objects and custom.parent == marble, 'a custom skin stays untouched')
    platform_skin = platform.children[0]
    parts = {child['mm_part']: child for child in platform_skin.children if child.get('mm_part')}
    check('bar' in parts, 'brass platform skin has a reactive bar part')
    check(any(slot.material and slot.material.name == 'MM · chrome' for slot in platform_skin.material_slots), 'bracket is chrome')
    check(parts['bar'].material_slots[0].material.name == 'MM · brass', 'bar is brass')
    windmill = holder('windmill-1')
    check(windmill.children[0].data.materials[0].name == 'MM · brass', 'windmill skin is rebuilt in brass')
    wall = next(obj for obj in bpy.data.collections['MidiMarble · studio'].objects if obj.get('mm_role') == 'studio.wall')
    check(wall.data.materials[0].name == 'MM · wall plaster', 'untouched wall gets the brass plaster')

    # Reactions: the bar dips at the hit and rests otherwise; holder keys and marble motion are unchanged
    keys_before = list(platform['mm_keys'])
    bar = parts['bar']
    scene.frame_set(math.ceil(hit * FPS))
    dip = bar.location.z
    tilt = bar.rotation_euler.y
    scene.frame_set(0)
    check(dip < -0.0005 and abs(tilt) > math.radians(1), 'bar dips and tilts at the hit (%.4f m, %.2f deg)' % (dip, math.degrees(tilt)))
    check(abs(bar.location.z) < 1e-9 and abs(bar.rotation_euler.y) < 1e-9, 'bar rests away from hits')
    check(list(platform['mm_keys']) == keys_before, 'reactions leave holder keyframes unchanged')
    states = {item['mmId']: item['link'] for item in worker.handle('inspect', {})['holders']}
    check(all(state == 'linked' for state in states.values()), 'reactions do not unlink holders')

    # Camera rig follows the marble with keyframes and keeps it in frame
    check(report['camera'] == 'baked', 'apply bakes the follow camera')
    camera = scene.camera
    check(camera.data.type == 'PERSP' and camera.animation_data is not None, 'camera is a keyframed perspective camera')
    worst = 0.0
    for frame in range(6, scene.frame_end + 1, 3):
        scene.frame_set(frame)
        view = world_to_camera_view(scene, camera, marble.matrix_world.translation)
        worst = max(worst, abs(view.x - 0.5), abs(view.y - 0.5))
    check(worst < 0.45, 'marble stays inside the frame (worst offset %.2f)' % worst)
    check(any(marker.name == 'MM · Shot' for marker in scene.timeline_markers), 'shot markers are on the timeline')

    # Editing the camera leaves it to Blender, and a rig after that is Follow Marbles turned back on
    from bpy_extras import anim_utils
    channelbag = anim_utils.animdata_get_channelbag_for_assigned_slot(camera.animation_data)
    channelbag.fcurves.find('location', index=2).keyframe_points[10].co.y += 0.05
    report = worker.handle('apply_scene', {'descriptionPath': '.cache/scene.json'})
    check(report['camera'] == 'takenOver', 'an edited camera is taken over')
    report = worker.handle('apply_scene', {'descriptionPath': '.cache/scene.json'})
    check(report['camera'] == 'baked', 'a rig after that bakes over the edit')
    rig_manual = dict(rig, mode='manual')
    write_package(root, marble_records, hit, moved, 0.3, True, theme='brass', camera=rig_manual)
    check(worker.handle('apply_scene', {'descriptionPath': '.cache/scene.json'})['camera'] == 'manual', 'manual camera mode is left alone')
    channelbag.fcurves.find('location', index=2).keyframe_points[10].co.y += 0.05
    write_package(root, marble_records, hit, moved, 0.3, True, theme='brass', camera=rig)
    check(worker.handle('apply_scene', {'descriptionPath': '.cache/scene.json'})['camera'] == 'baked', 'Follow Marbles turned back on bakes over an edit made while it was off')

    # Switching back rebuilds only untouched default skins
    write_package(root, marble_records, hit, moved, 0.3, True, theme='pegboard', camera=rig)
    worker.handle('apply_scene', {'descriptionPath': '.cache/scene.json'})
    check(holder('platform-1').children[0].children[0].material_slots[0].material.name.startswith('MM · flat'), 'pegboard rebuilds the bar')
    check(marble_skin.data.materials[0] == user_material, 'the edited marble skin still survives')
    check_neon_theme(worker, root, marble_records, hit, moved, rig)
    write_package(root, marble_records, hit, moved, 0.3, True, theme='brass', camera=rig)
    worker.handle('apply_scene', {'descriptionPath': '.cache/scene.json'})
    rim = studio_role('studio.rim')
    check(rim is not None and rim.hide_render, 'a theme without a back light hides it')

    # A marble inside a tunnel is hidden through its holder's mm_visible
    from mm_worker import contacts
    tunnel = {'type': 'tunnel', 'params': {'radius': 0.002, 'bore': 0.004}, 'path': [{'x': 0.0, 'y': 0.0}, {'x': 0.2, 'y': 0.0}]}
    center_y = RADIUS + 0.002
    visible = contacts.tunnel_visibility(np.array([-0.05, 0.005, 0.1, 0.195, 0.1]), np.array([center_y] * 4 + [0.05]), RADIUS, [tunnel])
    check(list(visible) == [1, 1, 0, 1, 1], 'a marble is hidden only while fully inside a tunnel')
    marble_skin = next(child for child in marble.children if child.get('mm_visibility'))
    marble['mm_visible'] = 0.0
    marble.update_tag()
    scene.frame_set(scene.frame_current + 1)
    hidden = marble_skin.hide_render
    marble['mm_visible'] = 1.0
    marble.update_tag()
    scene.frame_set(scene.frame_current - 1)
    check(hidden and not marble_skin.hide_render, 'mm_visible drives the marble skin visibility')

    # A film job runs in its own process and can be canceled
    try:
        worker.handle('render_film', {'preset': 'ultra', 'outputPath': 'renders/x.mp4'})
        check(False, 'unknown presets are rejected')
    except Exception as error:
        check(getattr(error, 'code', None) == 'INVALID_ARGS', 'unknown presets are rejected')
    started = worker.handle('render_film', {'preset': 'final', 'outputPath': 'renders/cancel.mp4', 'jobId': 'job-cancel'})
    check(started['frames'] == 30 and (started['width'], started['height']) == (1080, 1920), 'final preset is 1080x1920 at 30 fps')
    time.sleep(1.0)
    worker.handle('cancel', {'jobId': 'job-cancel'})
    envelope = render.wait_for_job(root, 'job-cancel', timeout=30)
    check(not envelope['ok'] and envelope['error']['code'] == 'CANCELED', 'cancel stops the render job')
    check(not (root / 'renders' / 'cancel.mp4').exists(), 'a canceled job writes no film')


def studio_role(role):
    return next((obj for obj in bpy.data.collections['MidiMarble · studio'].objects if obj.get('mm_role') == role), None)


def check_neon_theme(worker, root, marble_records, hit, moved, rig):
    """Neon dresses everything: a navy wall, a back light, glossy bars whose bevelled edges glow and flash on a
    hit, and a neon windmill"""
    scene = bpy.context.scene
    write_package(root, marble_records, hit, moved, 0.3, True, theme='neon', camera=rig)
    report = worker.handle('apply_scene', {'descriptionPath': '.cache/scene.json'})
    check(report['theme'] == 'neon' and report['themed'], 'theme switch to neon re-themes the studio')
    check(studio_role('studio.wall').data.materials[0].name == 'MM · wall neon', 'untouched wall gets the neon wall')
    rim = studio_role('studio.rim')
    check(rim is not None and not rim.hide_render and rim.data.energy > 0, 'neon lights the pieces from behind')
    check(scene.world.node_tree.nodes['Background'].inputs['Color'].default_value[2] < 0.2, 'neon world is a dark navy')
    skin = holder('platform-1').children[0]
    check(skin.data.materials[0].name == 'MM · neon mount', 'neon platform sits on a dark mount')
    bar = next(child for child in skin.children if child.get('mm_part') == 'bar')
    names = [material.name for material in bar.data.materials]
    check(names[0].startswith('MM · neon body') and names[1].startswith('MM · neon trim'), 'neon bar has a body and a glowing trim (%s)' % names)
    trim_faces = sum(1 for polygon in bar.data.polygons if polygon.material_index == 1)
    check(0 < trim_faces < len(bar.data.polygons), 'the bar edges glow, its faces do not (%d of %d)' % (trim_faces, len(bar.data.polygons)))
    top = max(vertex.co.z for vertex in bar.data.vertices)
    check(abs(top - PLATFORM['thickness'] / 2) < 1e-4, 'neon bar top face is the contact surface (%.5f m)' % top)
    scene.frame_set(math.ceil(hit * FPS))
    flash = bar['mm_flash']
    scene.frame_set(0)
    check(flash > 1.0 and abs(bar['mm_flash']) < 1e-6, 'neon bar flashes at the hit (%.2f) and rests otherwise' % flash)
    windmill = holder('windmill-1').children[0]
    check(windmill.data.materials[0].name.startswith('MM · neon body'), 'windmill skin is rebuilt in neon')


def check_device_skins():
    """Device skins keep the collider's top face as their contact surface; the knob glows on hits"""
    from mm_worker import skins
    context = skins.skin_context('brass', RADIUS)
    for skin in ('device', 'device-copper', 'key', 'knob', 'silver', 'unknown'):
        piece = {'type': 'platform', 'params': PLATFORM, 'angle': 0.2, 'position': {'x': 0, 'y': 0},
                 'skin': {'assetId': 'platform:' + skin}}
        spec = skins.build_spec('piece', piece, context)
        bar = spec['parts'][0]['mesh']
        top = max(vertex.co.z for vertex in bar.vertices)
        check(abs(top - PLATFORM['thickness'] / 2) < 1e-4, 'platform:%s top face is the contact surface (%.5f m)' % (skin, top))
        materials = [material.name for material in bar.materials]
        reaction = skins.piece_reaction(piece, context)
        if skin == 'knob':
            check(any(name.startswith('MM · glow') for name in materials) and reaction['flash'] > 0, 'platform:knob has a lens that glows on hits')
        if skin == 'key':
            check('MM · key' in materials, 'platform:key has a white key')
        if skin == 'device-copper':
            check('MM · bar copper' in materials and 'MM · slot' in materials, 'platform:device-copper has copper ends and a grille')
        if skin == 'unknown':
            check(materials[0] == 'MM · brass', 'an unknown brass skin falls back to the gold bar')



def check_color_by_note():
    """Color by Note gives every platform that plays a note its pitch class color in both themes; without the
    option or without a note the theme's own material stays, and the skin key changes with the pitch class"""
    from mm_worker import skins, themes
    neon_piece = {'type': 'platform', 'params': PLATFORM, 'angle': 0.2, 'position': {'x': 0, 'y': 0}, 'notePitch': 69, 'color': '#3478f6'}
    neon_on = [material.name for material in skins.build_spec('piece', neon_piece, skins.skin_context('neon', RADIUS, parts={'platform': {'colorSource': 'note'}}))['parts'][0]['mesh'].materials]
    neon_off = [material.name for material in skins.build_spec('piece', neon_piece, skins.skin_context('neon', RADIUS))['parts'][0]['mesh'].materials]
    expected = themes.neon_body_material(skins.neon_colors(skins.PieceFrame(neon_piece, skins.skin_context('neon', RADIUS, parts={'platform': {'colorSource': 'note'}})))[0]).name
    check(neon_on[0] == expected and neon_off[0] != expected and themes.note_color(69) is not None,
          'neon: Color by Note gives an A platform its note color (%s, %s)' % (neon_on[0], neon_off[0]))
    for theme, plain in (('pegboard', 'MM · flat'), ('brass', 'MM · brass')):
        on = skins.skin_context(theme, RADIUS, parts={'platform': {'colorSource': 'note'}})
        off = skins.skin_context(theme, RADIUS)
        piece = {'type': 'platform', 'params': PLATFORM, 'angle': 0.2, 'position': {'x': 0, 'y': 0}, 'notePitch': 69}
        colored = [material.name for material in skins.build_spec('piece', piece, on)['parts'][0]['mesh'].materials]
        check('MM · note A' in colored, '%s: Color by Note colors an A platform (%s)' % (theme, colored))
        default = [material.name for material in skins.build_spec('piece', piece, off)['parts'][0]['mesh'].materials]
        check(not any(name.startswith('MM · note') for name in default) and default[0].startswith(plain),
              '%s: without the option the theme material stays (%s)' % (theme, default))
        octave = dict(piece, notePitch=81)
        other = dict(piece, notePitch=70)
        check(skins.skin_key('piece', piece, on) == skins.skin_key('piece', octave, on)
              and skins.skin_key('piece', piece, on) != skins.skin_key('piece', other, on),
              '%s: the skin key follows the pitch class' % theme)
    # A chosen skin keeps its own color under Color by Note; Brass's Gold spelled out is still its default
    def platform_materials(theme, skin):
        piece = {'type': 'platform', 'params': PLATFORM, 'angle': 0.2, 'position': {'x': 0, 'y': 0}, 'notePitch': 60,
                 'skin': {'assetId': skin}}
        context = skins.skin_context(theme, RADIUS, parts={'platform': {'colorSource': 'note'}})
        return [material.name for material in skins.build_spec('piece', piece, context)['parts'][0]['mesh'].materials]

    names = platform_materials('brass', 'platform:key')
    check('MM · key' in names and not any(name.startswith('MM · note') for name in names), 'platform:key keeps its white key under Color by Note (%s)' % names)
    names = platform_materials('pegboard', 'platform:copper')
    check(names[0] == 'MM · bar copper', 'a Copper skin from More Skins keeps its copper under Color by Note (%s)' % names)
    names = platform_materials('pegboard', 'platform:gold')
    check(names[0] == 'MM · brass', 'a Gold skin chosen in Pegboard keeps its gold under Color by Note (%s)' % names)
    names = platform_materials('brass', 'platform:gold')
    check(names[0] == 'MM · note C', "Brass's Gold, its default spelled out, takes the note color (%s)" % names)


def check_marble_contrast():
    """Every marble stays 3:1 apart from its wall and from every surface of its own platform in Pegboard and Neon,
    by the luminance of the materials Blender renders; Brass's clear glass reads by color on dark gold, so it only keeps
    its body apart from the wall; a dark project wall turns Pegboard's marbles pearl"""
    from mm_worker import themes, skins
    label_colors = ('#3478f6', '#ff9f0a', '#30d158', '#bf5af2', '#ff375f', '#64d2ff', '#808080')

    def luminance(color):
        return 0.2126 * color[0] + 0.7152 * color[1] + 0.0722 * color[2]

    def ratio(a, b):
        high, low = sorted((luminance(a), luminance(b)), reverse=True)
        return (high + 0.05) / (low + 0.05)

    for color in label_colors:
        check(themes.marble_look('brass', color)['contrast'] >= 2.8, 'brass: a %s marble stands apart from the wall' % color)
    for theme in ('pegboard', 'neon'):
        context = skins.skin_context(theme, RADIUS)
        wall = themes.wall_material(theme, 0.025).diffuse_color
        lowest = []
        for color in label_colors:
            marble = skins.build_spec('marble', {'radius': RADIUS, 'color': color}, context)['root'].materials[0]
            piece = {'type': 'platform', 'params': PLATFORM, 'angle': 0.2, 'position': {'x': 0, 'y': 0}, 'color': color}
            surfaces = [material.diffuse_color for material in skins.build_spec('piece', piece, context)['parts'][0]['mesh'].materials]
            lowest.append(min(ratio(marble.diffuse_color, other) for other in [wall, *surfaces]))
        check(min(lowest) >= themes.MARBLE_CONTRAST,
              '%s: every marble is at least 3:1 apart from its wall and its platform (lowest %.1f:1)' % (theme, min(lowest)))
    check(themes.marble_look('pegboard', '#3478f6')['tone'] == 'deep' and themes.marble_look('neon', '#3478f6')['tone'] == 'pearl',
          'light walls get deep marbles, the dark Neon wall pearl ones')
    check(themes.marble_look('pegboard', '#3478f6', {'wallColor': '#1a1a1a'})['tone'] == 'pearl', 'a dark project wall turns a Pegboard marble pearl')
    context = skins.skin_context('pegboard', RADIUS)
    plain = skins.skin_key('marble', {'radius': RADIUS, 'color': '#3478f6'}, context)
    themes.set_overrides({'wallColor': '#1a1a1a'})
    try:
        dark = skins.skin_key('marble', {'radius': RADIUS, 'color': '#3478f6'}, context)
    finally:
        themes.set_overrides(None)
    check(plain != dark, 'a Wall color that changes the marble tone rebuilds the marble skin')


def bent_wire(wall_u, top, high_y, along, slope, low_u, low_y, bend, points=12):
    """Python copy of the engine's `bentWire`: a wall, a bend tangent to wall and leg, then the leg"""
    corner = math.pi / 2 + slope
    share = 1 / math.tan(corner / 2)
    radius = min(bend, min(top - high_y, math.hypot(low_u - wall_u, low_y - high_y)) * 0.9 / share)
    reach = radius * share
    start = (wall_u, high_y + reach)
    end = (wall_u + along * math.cos(slope) * reach, high_y - math.sin(slope) * reach)
    center = (wall_u + along * radius, high_y + reach)
    begin = math.atan2(start[1] - center[1], start[0] - center[0])
    sweep = math.atan2(end[1] - center[1], end[0] - center[0]) - begin
    if along > 0 and sweep < 0:
        sweep += 2 * math.pi
    if along < 0 and sweep > 0:
        sweep -= 2 * math.pi
    arc = [(center[0] + radius * math.cos(begin + sweep * i / points), center[1] + radius * math.sin(begin + sweep * i / points))
           for i in range(1, points)]
    return [(wall_u, top), start, *arc, end, (low_u, low_y)], center, radius


def check_switchback_skins():
    """Switchback wires are drawn in both themes along the bent capsules the simulation collides with: brass wire
    pairs stay one setback behind the physics wire through the bend, on the side away from the marble"""
    from mm_worker import skins
    slope, bend = math.radians(8), 0.04
    first, center_a, radius_a = bent_wire(0.0, 0.0, -0.03, 1, slope, 0.068, -0.03 - math.tan(slope) * 0.068, bend)
    second, center_b, radius_b = bent_wire(0.1, -0.04, -0.075, -1, slope, 0.032, -0.075 - math.tan(slope) * 0.068, bend)
    stop = [(0.0, -0.06), (0.0, -0.12)]
    wires = [[{'x': x, 'y': y} for x, y in wire] for wire in (first, second, stop)]
    piece = {'type': 'rail', 'layout': 'switchback', 'params': {'width': 0.1, 'turns': 2, 'radius': 0.0025, 'bend': bend}, 'angle': 0.0,
             'position': {'x': 0.0, 'y': 0.0}, 'paths': wires}
    for theme in ('brass', 'pegboard', 'neon'):
        mesh = skins.build_spec('piece', piece, skins.skin_context(theme, RADIUS))['root']
        xs = [vertex.co.x for vertex in mesh.vertices]
        zs = [vertex.co.z for vertex in mesh.vertices]
        span = max(max(xs) - min(xs), max(zs) - min(zs))
        check(len(mesh.vertices) > 100 and 0.1 <= span <= 0.16, '%s switchback draws its wires (%.3f m across)' % (theme, span))
        bpy.data.meshes.remove(mesh)

    check(skins.marble_side(first, (0.05, -0.05)) > 0 and skins.marble_side(second, (0.05, -0.05)) < 0,
          'the marble rides inside each bend')
    check(skins.marble_side(stop, (0.05, -0.05)) > 0, 'a straight stop faces the middle of the rail')
    setback = 0.004
    for wire, center, radius, label in ((first, center_a, radius_a, 'left'), (second, center_b, radius_b, 'right')):
        line = skins.offset_wire(wire, -setback * skins.marble_side(wire, (0.05, -0.05)))
        bend_points = line[1:-1]
        error = max(abs(math.dist(point, center) - (radius + setback)) for point in bend_points)
        check(error < 2e-4, '%s brass wire follows the bend one setback outside it (%.5f m)' % (label, error))
        low = line[-1]
        check(low[1] < wire[-1][1] - setback * 0.9, '%s brass wire runs below the leg (%.4f m)' % (label, wire[-1][1] - low[1]))
        check(len(skins.wire_post_indices(wire)) == 3, '%s bent wire gets a post at its bend' % label)


def check_readable_camera_and_wall():
    """Two marbles that drift far apart: the camera frames both, however far back that takes it, and the wall covers
    every view ray of the film"""
    from bpy_extras.object_utils import world_to_camera_view
    from mathutils import Vector
    from mm_worker.ops import Worker
    root = Path(tempfile.mkdtemp(prefix='mm-spread-')) / 'Spread.marble'
    (root / '.cache' / 'motion').mkdir(parents=True)
    duration, split = 3.0, 1.5
    times = np.arange(0, int(duration * PHYSICS_HZ) + 1) / PHYSICS_HZ
    slow = -0.3 * times
    fast = slow - np.where(times > split, GRAVITY / 2 * (times - split) ** 2, 0.0)
    tracks = {
        'marble-1': np.stack([times, 0.03 * np.sin(2 * math.pi * times), slow, times * 0], axis=1),
        'marble-2': np.stack([times, 0.15 + 0.03 * np.sin(2 * math.pi * times), fast, times * 0], axis=1),
    }
    marbles = []
    for mm_id, records in tracks.items():
        records.astype('<f4').tofile(root / '.cache' / 'motion' / (mm_id + '.bin'))
        marbles.append({'id': mm_id, 'name': mm_id, 'radius': RADIUS, 'color': '#3478f6',
                        'motionPath': '.cache/motion/%s.bin' % mm_id, 'sampleCount': len(records)})
    pieces = [{
        'id': 'p%d' % index, 'name': 'p%d' % index, 'type': 'platform', 'params': PLATFORM,
        'position': {'x': 0.04 * (-1) ** index, 'y': -0.15 * index}, 'angle': 0.2, 'wallOffset': 0.0,
        'hitTimes': [], 'motionPath': None, 'sampleCount': 0, 'skin': None, 'color': '#e2a33b',
    } for index in range(6)]
    rig = {'mode': 'rig', 'distance': 0.5, 'pitch': 1.0, 'lead': 0.15, 'smoothing': 0.6, 'shots': []}

    def apply():
        description = {
            'version': 1, 'projectId': 'spread', 'revision': 1, 'fps': 30.0, 'duration': duration,
            'frame': {'width': 1080, 'height': 1920}, 'theme': 'brass', 'marbles': marbles, 'pieces': pieces,
            'camera': rig,
        }
        (root / '.cache' / 'scene.json').write_text(json.dumps(description))
        bpy.ops.wm.read_homefile(use_empty=True)
        return Worker(root).handle('apply_scene', {'descriptionPath': '.cache/scene.json'})

    report = apply()
    scene = bpy.context.scene
    camera = scene.camera
    managed = bpy.data.collections[MANAGED_COLLECTION]
    marble = {obj['mm_id']: obj for obj in managed.objects if obj.get('mm_role') == 'marble'}
    (min_x, min_y), (max_x, max_y) = report['wall']
    corners = [Vector(corner) for corner in camera.data.view_frame(scene=scene)]

    def in_view(obj):
        view = world_to_camera_view(scene, camera, obj.matrix_world.translation)
        return 0 <= view.x <= 1 and 0 <= view.y <= 1

    uncovered, focus_lost = 0, 0
    for frame in range(scene.frame_start, scene.frame_end + 1):
        scene.frame_set(frame)
        rotation, position = camera.matrix_world.to_3x3(), camera.matrix_world.translation
        for corner in corners:
            ray = rotation @ corner
            point = position + ray * (-position.y / ray.y) if ray.y > 1e-6 else None
            if point is None or not (min_x <= point.x <= max_x and min_y <= point.z <= max_y):
                uncovered += 1
        focus_lost += not in_view(marble['marble-1'])
    check(focus_lost == 0, 'the focus marble stays in frame while the other falls away')
    check(uncovered == 0, 'the wall covers every view ray of the film (wall %.1f m tall for %.1f m of descent)'
          % (max_y - min_y, -fast[-1]))
    scene.frame_set(round(0.3 * 30))
    check(in_view(marble['marble-1']) and in_view(marble['marble-2']), 'two marbles close together share the frame')
    # The zoom is slow on purpose, so the free fall at the end outruns it; what the group needs at walking pace it gets
    scene.frame_set(round(1.8 * 30))
    check(in_view(marble['marble-2']), 'a marble drifting away from the first stays in frame')


def bpy_channelbag(obj):
    from bpy_extras import anim_utils
    return anim_utils.animdata_get_channelbag_for_assigned_slot(obj.animation_data)


main()
