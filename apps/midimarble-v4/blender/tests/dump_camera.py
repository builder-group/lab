"""Applies a scene package headless and dumps the baked follow camera per frame to JSON.

Used by `scripts/check-follow-camera.ts`, which compares the TypeScript port in `src/modules/camera/follow-camera.ts`
against these keyframes. Writes `<package>/../blender-camera.json` with, per frame, the evaluated location, the
rotation matrix rows from the Euler keys and the focus distance, plus the lens and sensor.

Run: Blender --background --factory-startup --python-exit-code 1 --python blender/tests/dump_camera.py -- <package>
"""
import json
import sys
from pathlib import Path

import bpy
from mathutils import Euler

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from mm_worker.ops import Worker  # noqa: E402


def curves(holder, paths):
    """F-curves of the holder's assigned action slot by (data path, index)"""
    from bpy_extras import anim_utils
    found = {}
    if holder.animation_data is None or holder.animation_data.action is None:
        return found
    channelbag = anim_utils.animdata_get_channelbag_for_assigned_slot(holder.animation_data)
    for fcurve in (channelbag.fcurves if channelbag else []):
        if fcurve.data_path in paths:
            found[(fcurve.data_path, fcurve.array_index)] = fcurve
    return found


def main():
    package = Path(sys.argv[sys.argv.index('--') + 1]).resolve()
    worker = Worker(package)
    report = worker.handle('apply_scene', {'descriptionPath': '.cache/scene.json'})
    scene = bpy.context.scene
    camera = scene.camera
    pose = curves(camera, ('location', 'rotation_euler'))
    lens = curves(camera.data, ('dof.focus_distance',))
    frames = []
    for frame in range(0, scene.frame_end + 1):
        location = [pose[('location', axis)].evaluate(frame) for axis in range(3)]
        euler = Euler([pose[('rotation_euler', axis)].evaluate(frame) for axis in range(3)], 'XYZ')
        matrix = euler.to_matrix()
        frames.append({
            'frame': frame,
            'location': location,
            'euler': list(euler),
            'matrix': [list(row) for row in matrix],
            'focus': lens[('dof.focus_distance', 0)].evaluate(frame),
        })
    out = package.parent / 'blender-camera.json'
    out.write_text(json.dumps({
        'camera': report['camera'],
        'fps': scene.render.fps / scene.render.fps_base,
        'resolution': [scene.render.resolution_x, scene.render.resolution_y],
        'lens': camera.data.lens,
        'sensorWidth': camera.data.sensor_width,
        'sensorFit': camera.data.sensor_fit,
        'frames': frames,
    }))
    print('dumped', len(frames), 'frames to', out)


main()
