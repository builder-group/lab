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
from mm_worker.scene import MARBLE_WALL_GAP  # noqa: E402
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
            'position': {'x': 0.25, 'y': 0.4}, 'angle': 0.0, 'wallOffset': 0.002, 'hitTimes': [],
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
    for frame in (6, 7, 20, 23, 31, 45, 59, 60):
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
    check(worst < 1e-4, 'marble world location matches samples (worst %.2e m)' % worst)
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

    # Hit value peaks at the hit
    fcurve = next(curve for curve in bpy_channelbag(platform).fcurves if curve.data_path == '["mm_hit"]')
    hit_frame = hit * FPS
    check(abs(fcurve.evaluate(hit_frame) - 1.0) < 1e-5, 'mm_hit is 1 at the hit time (frame %.3f)' % hit_frame)
    check(fcurve.evaluate(math.floor(hit_frame) - 1) < 1e-6, 'mm_hit is 0 before the hit')
    whole = [fcurve.evaluate(frame) for frame in range(scene.frame_end + 1)]
    check(int(np.argmax(whole)) == math.ceil(hit_frame), 'mm_hit peaks on the first whole frame after the hit')
    check(fcurve.evaluate((hit + 0.26) * FPS) < 1e-6, 'mm_hit decays to 0 within 0.25 s')
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

    # Removing a piece detaches its skin in place
    windmill_skin = holder('windmill-1').children[0]
    windmill_skin_name = windmill_skin.name
    world_before = windmill_skin.matrix_world.copy()
    write_package(root, marble_records, hit, moved, 0.3, False)
    report = worker.handle('apply_scene', {'descriptionPath': '.cache/scene.json'})
    detached = bpy.data.collections[DETACHED_COLLECTION]
    windmill_skin = bpy.data.objects[windmill_skin_name]
    check(report['removed'] == ['windmill-1'] and holder('windmill-1') is None, 'removed piece deletes its holder')
    check(windmill_skin.name in detached.objects and windmill_skin.parent is None, 'removed piece skin moves to detached')
    check(windmill_skin.name not in bpy.data.collections[MANAGED_COLLECTION].objects, 'detached skin leaves the managed collection')
    check(all(abs(a - b) < 1e-6 for a, b in zip(np.array(windmill_skin.matrix_world).ravel(), np.array(world_before).ravel())), 'detached skin keeps its world transform')

    check_themes_camera_and_render(worker, root, marble_records, hit, moved)

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
    print('\n'.join(summary))
    print('CHECK PASSED: %d assertions' % sum(1 for line in summary if line.startswith('ok')))


def check_themes_camera_and_render(worker, root, marble_records, hit, moved):
    from bpy_extras.object_utils import world_to_camera_view
    from mm_worker import render
    scene = bpy.context.scene
    rig = {'mode': 'rig', 'distance': 0.5, 'pitch': 0.45, 'lead': 0.15, 'smoothing': 0.6,
           'shots': [{'id': 's1', 'time': 0.6, 'kind': 'pushIn', 'roll': 0.1, 'distance': 0.4}]}

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
    check(any(marker.name == 'MM · pushIn' for marker in scene.timeline_markers), 'shot markers are on the timeline')

    # Editing the camera hands it over to Blender until the app regenerates it on request
    from bpy_extras import anim_utils
    channelbag = anim_utils.animdata_get_channelbag_for_assigned_slot(camera.animation_data)
    channelbag.fcurves.find('location', index=2).keyframe_points[10].co.y += 0.05
    report = worker.handle('apply_scene', {'descriptionPath': '.cache/scene.json'})
    check(report['camera'] == 'takenOver', 'an edited camera is taken over')
    report = worker.handle('apply_scene', {'descriptionPath': '.cache/scene.json', 'regenerateCamera': True})
    check(report['camera'] == 'baked', 'regenerateCamera rebuilds a taken-over camera')
    rig_manual = dict(rig, mode='manual')
    write_package(root, marble_records, hit, moved, 0.3, True, theme='brass', camera=rig_manual)
    check(worker.handle('apply_scene', {'descriptionPath': '.cache/scene.json'})['camera'] == 'manual', 'manual camera mode is left alone')
    write_package(root, marble_records, hit, moved, 0.3, True, theme='brass', camera=rig)
    worker.handle('apply_scene', {'descriptionPath': '.cache/scene.json'})

    # Switching back rebuilds only untouched default skins
    write_package(root, marble_records, hit, moved, 0.3, True, theme='pegboard', camera=rig)
    worker.handle('apply_scene', {'descriptionPath': '.cache/scene.json'})
    check(holder('platform-1').children[0].children[0].material_slots[0].material.name.startswith('MM · flat'), 'pegboard rebuilds the bar')
    check(marble_skin.data.materials[0] == user_material, 'the edited marble skin still survives')
    write_package(root, marble_records, hit, moved, 0.3, True, theme='brass', camera=rig)
    worker.handle('apply_scene', {'descriptionPath': '.cache/scene.json'})

    # A film job runs in its own process and can be cancelled
    try:
        worker.handle('render_film', {'preset': 'ultra', 'outputPath': 'renders/x.mp4'})
        check(False, 'unknown presets are rejected')
    except Exception as error:
        check(getattr(error, 'code', None) == 'INVALID_ARGS', 'unknown presets are rejected')
    started = worker.handle('render_film', {'preset': 'fast', 'outputPath': 'renders/cancel.mp4', 'jobId': 'job-cancel'})
    check(started['frames'] == 30 and (started['width'], started['height']) == (720, 1280), 'fast preset is 720x1280 at 30 fps')
    time.sleep(1.0)
    worker.handle('cancel', {'jobId': 'job-cancel'})
    envelope = render.wait_for_job(root, 'job-cancel', timeout=30)
    check(not envelope['ok'] and envelope['error']['code'] == 'CANCELLED', 'cancel stops the render job')
    check(not (root / 'renders' / 'cancel.mp4').exists(), 'a cancelled job writes no film')


def bpy_channelbag(obj):
    from bpy_extras import anim_utils
    return anim_utils.animdata_get_channelbag_for_assigned_slot(obj.animation_data)


main()
