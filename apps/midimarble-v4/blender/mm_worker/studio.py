"""Studio: wall, sun, added lights, world light, camera and render look.

The studio objects are created once. Afterwards the app changes a studio object only while it still holds what the
app last wrote (`mm_written` fingerprints); a wall, sun or world the user edited belongs to Blender. A theme
switch re-themes the untouched objects and resets the render look. The camera is framed or rig-baked unless the user
took it over.
"""
import json
import math

import bpy
from mathutils import Euler

from . import camera as camera_rig
from . import themes
from .util import STUDIO_COLLECTION, ensure_collection, finite, parse_color, tag

STUDIO_VERSION = 1
PEG_PITCH = 0.025
# Wall beyond everything the run and the camera cover
WALL_MARGIN = 1.5
FRAME_MARGIN = 1.15


def ensure_studio(scene, theme):
    """Creates missing studio objects and applies `theme` to untouched ones. Returns `{created, themed}`. The wall
    is sized afterwards by `fit_wall`, once the camera is known."""
    theme = themes.theme_name(theme)
    created = not scene.get('mm_studio_version')
    collection = ensure_collection(STUDIO_COLLECTION)
    # A project theme's colours count as a switch too, so changing one re-themes the untouched studio
    key = themes.theme_key(theme)
    switched = scene.get('mm_theme') != key
    if studio_object('studio.wall') is None and created:
        create_wall(collection)
    sun = studio_object('studio.sun')
    if sun is None and created:
        sun = create_sun(collection)
    if sun is not None and (switched or created):
        update_sun(sun, theme)
    # The back light is made once; deleted, it stays gone
    rim = studio_object('studio.rim')
    made_rim = rim is None and not scene.get('mm_rim_made')
    if made_rim:
        rim = create_rim(collection)
        scene['mm_rim_made'] = True
    if rim is not None and (switched or created or made_rim):
        update_rim(rim, theme)
    if created:
        create_world(scene)
    if switched or created:
        update_world(scene, theme)
    camera = studio_object('studio.camera')
    if camera is None and created:
        camera = create_camera(collection)
        scene.camera = camera
    if switched or created:
        themes.apply_render_look(scene, theme)
        scene['mm_theme'] = key
    scene['mm_studio_version'] = STUDIO_VERSION
    return {'created': created, 'themed': switched or created}


def studio_object(role):
    collection = bpy.data.collections.get(STUDIO_COLLECTION)
    if collection is None:
        return None
    for obj in collection.objects:
        if obj.get('mm_role') == role and obj.get('mm_owner') == 'midimarble':
            return obj
    return None


def written(obj, values):
    obj['mm_written_json'] = json.dumps(values)


def untouched(obj, values):
    stored = obj.get('mm_written_json')
    return stored is None or json.loads(stored) == values


# Wall


def create_wall(collection):
    mesh = bpy.data.meshes.new('MM wall')
    wall = bpy.data.objects.new('Wall', mesh)
    wall.rotation_euler = (math.pi / 2, 0.0, 0.0)
    collection.objects.link(wall)
    tag(wall, 'studio.wall', 'studio.wall')
    return wall


def wall_signature(wall):
    mesh = wall.data
    corners = [round(value, 5) for vertex in mesh.vertices for value in vertex.co] if wall.type == 'MESH' else []
    materials = [material.name if material else None for material in mesh.materials] if wall.type == 'MESH' else []
    return [corners, [round(value, 5) for value in (*wall.location, *wall.rotation_euler, *wall.scale)], materials]


def fit_wall(scene, bounds, theme):
    """Sizes an untouched wall to cover the run and everything the camera sees over the scene range, whatever the
    run's depth. Returns the wall bounds, or None when there is no wall or the user edited it."""
    wall = studio_object('studio.wall')
    if wall is None:
        return None
    footprint = camera_rig.view_footprint(scene, studio_object('studio.camera'))
    if footprint is not None:
        bounds = ((min(bounds[0][0], footprint[0][0]), min(bounds[0][1], footprint[0][1])),
                  (max(bounds[1][0], footprint[1][0]), max(bounds[1][1], footprint[1][1])))
    if not update_wall(wall, bounds, themes.theme_name(theme)):
        return None
    return wall_bounds(wall)


def wall_bounds(wall):
    """Wall rectangle in wall coordinates as ((min_x, min_y), (max_x, max_y))"""
    # The local XY plane turned upright: local x is wall x and local y is wall height
    xs = [wall.location.x + vertex.co.x for vertex in wall.data.vertices]
    ys = [wall.location.z + vertex.co.y for vertex in wall.data.vertices]
    return (min(xs), min(ys)), (max(xs), max(ys))


def update_wall(wall, bounds, theme):
    """Fits an untouched wall to `bounds` with a margin and gives it the theme's material. The plaster and pegboard
    materials use object coordinates in metres, so their scale does not change with the wall size."""
    if wall.type != 'MESH' or not untouched(wall, wall_signature(wall)):
        return False
    (min_x, min_y), (max_x, max_y) = bounds
    half_width = (max_x - min_x) / 2 + WALL_MARGIN
    half_height = (max_y - min_y) / 2 + WALL_MARGIN
    mesh = wall.data
    if len(mesh.vertices) != 4:
        mesh.clear_geometry()
        mesh.from_pydata([(0, 0, 0)] * 4, [], [(0, 1, 2, 3)])
    # Local XY plane; the object rotation turns it into Blender XZ with its normal facing the camera (-Y)
    for vertex, corner in zip(mesh.vertices, ((-1, -1), (1, -1), (1, 1), (-1, 1))):
        vertex.co = (corner[0] * half_width, corner[1] * half_height, 0.0)
    mesh.update()
    wall.location = ((min_x + max_x) / 2, 0.0, (min_y + max_y) / 2)
    wall.rotation_euler = (math.pi / 2, 0.0, 0.0)
    material = themes.wall_material(theme, PEG_PITCH)
    if len(mesh.materials):
        mesh.materials[0] = material
    else:
        mesh.materials.append(material)
    written(wall, wall_signature(wall))
    return True


# Sun and world


def create_sun(collection):
    light = bpy.data.lights.new('MM sun', 'SUN')
    sun = bpy.data.objects.new('Sun', light)
    sun.location = (-1.0, -1.5, 2.0)
    collection.objects.link(sun)
    tag(sun, 'studio.sun', 'studio.sun')
    return sun


def sun_signature(sun):
    light = sun.data
    return [round(light.energy, 4), round(light.angle, 5), [round(value, 4) for value in light.color],
            [round(value, 5) for value in sun.rotation_euler]]


def update_sun(sun, theme):
    if sun.type != 'LIGHT' or sun.data.type != 'SUN' or not untouched(sun, sun_signature(sun)):
        return False
    settings = themes.sun_settings(theme)
    sun.data.energy = settings['energy']
    sun.data.angle = settings['angle']
    sun.data.color = settings['color']
    sun.data.use_shadow = True
    # Fine shadow maps and jittered soft shadows keep long grazing shadows free of stair steps
    sun.data.shadow_maximum_resolution = 0.0002
    sun.data.use_shadow_jitter = True
    sun.data.shadow_jitter_overblur = 10.0
    sun.data.shadow_filter_radius = 1.5
    sun.rotation_euler = Euler(settings['rotation'])
    written(sun, sun_signature(sun))
    return True


def create_rim(collection):
    light = bpy.data.lights.new('MM rim', 'SUN')
    rim = bpy.data.objects.new('Rim Light', light)
    rim.location = (1.0, 1.0, 2.0)
    collection.objects.link(rim)
    tag(rim, 'studio.rim', 'studio.rim')
    return rim


def rim_signature(rim):
    return [*sun_signature(rim), bool(rim.hide_render)]


def update_rim(rim, theme):
    """Gives an untouched back light the theme's settings; a theme without one hides it"""
    if rim.type != 'LIGHT' or rim.data.type != 'SUN' or not untouched(rim, rim_signature(rim)):
        return False
    settings = themes.rim_settings(theme)
    rim.hide_render = rim.hide_viewport = settings is None
    if settings is not None:
        rim.data.energy = settings['energy']
        rim.data.angle = settings['angle']
        rim.data.color = settings['color']
        # Light from behind the pieces would only cast shadows onto the wall's back; edges are all it is for
        rim.data.use_shadow = False
        rim.rotation_euler = Euler(settings['rotation'])
    else:
        rim.data.energy = 0.0
    written(rim, rim_signature(rim))
    return True


# Added lights: suns the project owns, one layer each in Film


LIGHT_ROLE = 'studio.light'
LIGHT_ANGLE = 12.0


def apply_lights(lights):
    """Makes the studio's added lights match the description's `lights`. A light the user edited in Blender belongs to
    Blender: it keeps its values and, when the project deletes it, is hidden rather than removed, so undo can show it
    again. Returns the IDs of `{created, updated, skipped, removed, hidden}`."""
    collection = ensure_collection(STUDIO_COLLECTION)
    report = {'created': [], 'updated': [], 'skipped': [], 'removed': [], 'hidden': []}
    existing = {obj['mm_light_id']: obj for obj in collection.objects if obj.get('mm_role') == LIGHT_ROLE and obj.get('mm_owner') == 'midimarble'}
    for light in lights:
        light_id = str(light['id'])
        obj = existing.pop(light_id, None)
        created = obj is None
        if created:
            obj = create_light(collection, light_id, str(light.get('name', 'Light')))
        was_hidden = bool(obj.get('mm_deleted'))
        if was_hidden:
            del obj['mm_deleted']
            obj.hide_render = obj.hide_viewport = False
        if update_light(obj, light, created):
            report['created' if created else 'updated'].append(light_id)
        else:
            report['skipped'].append(light_id)
    for light_id, obj in existing.items():
        if obj.get('mm_deleted'):
            continue
        if obj.type == 'LIGHT' and untouched(obj, sun_signature(obj)):
            data = obj.data
            bpy.data.objects.remove(obj)
            bpy.data.lights.remove(data)
            report['removed'].append(light_id)
        else:
            obj['mm_deleted'] = True
            obj.hide_render = obj.hide_viewport = True
            report['hidden'].append(light_id)
    return report


def create_light(collection, light_id, name):
    light = bpy.data.lights.new('MM light', 'SUN')
    obj = bpy.data.objects.new(name, light)
    obj.location = (0.0, -1.5, 2.0)
    collection.objects.link(obj)
    tag(obj, LIGHT_ROLE + '.' + light_id, LIGHT_ROLE)
    obj['mm_light_id'] = light_id
    return obj


def update_light(obj, light, created):
    if obj.type != 'LIGHT' or obj.data.type != 'SUN' or (not created and not untouched(obj, sun_signature(obj))):
        return False
    obj.name = str(light.get('name', obj.name))
    obj.data.energy = max(0.0, finite(light['strength'], 'light strength'))
    obj.data.angle = math.radians(LIGHT_ANGLE)
    obj.data.color = parse_color(light['color'])[:3]
    obj.data.use_shadow = True
    obj.data.shadow_maximum_resolution = 0.0002
    obj.data.use_shadow_jitter = True
    obj.data.shadow_jitter_overblur = 10.0
    obj.data.shadow_filter_radius = 1.5
    direction = themes.sun_direction(finite(light['side'], 'light side'), finite(light['height'], 'light height'))
    obj.rotation_euler = Euler(themes.sun_rotation(direction))
    written(obj, sun_signature(obj))
    return True


def create_world(scene):
    # A world the scene already has belongs to the user
    if scene.world is not None:
        return
    world = bpy.data.worlds.new('MM studio')
    world['mm_owner'] = 'midimarble'
    scene.world = world


def world_signature(world):
    background = world.node_tree.nodes.get('Background') if world.node_tree else None
    if background is None:
        return None
    return [[round(value, 4) for value in background.inputs['Color'].default_value],
            round(background.inputs['Strength'].default_value, 4)]


def update_world(scene, theme):
    world = scene.world
    if world is None or world.get('mm_owner') != 'midimarble':
        return False
    if not world.use_nodes:
        world.use_nodes = True
    if world_signature(world) is None or not untouched(world, world_signature(world)):
        return False
    settings = themes.theme_settings(theme)['world']
    background = world.node_tree.nodes['Background']
    themes.studio_environment(world, settings)
    background.inputs['Color'].default_value = (*settings['color'], 1.0)
    background.inputs['Strength'].default_value = settings['strength']
    world.color = settings['color']
    written(world, world_signature(world))
    return True


# Camera


def create_camera(collection):
    data = bpy.data.cameras.new('MM camera')
    data.type = 'ORTHO'
    camera = bpy.data.objects.new('Camera', data)
    # Camera looks along its local -Z; +90 degrees around X points it at the wall (+Y)
    camera.rotation_euler = (math.pi / 2, 0.0, 0.0)
    collection.objects.link(camera)
    tag(camera, 'studio.camera', 'studio.camera')
    return camera


def set_resolution(scene, frame):
    """Short side 1080 px with the project frame aspect"""
    width, height = float(frame['width']), float(frame['height'])
    aspect = width / height
    if aspect < 1:
        scene.render.resolution_x = 1080
        scene.render.resolution_y = round(1080 / aspect)
    else:
        scene.render.resolution_y = 1080
        scene.render.resolution_x = round(1080 * aspect)
    scene.render.resolution_percentage = 100


def camera_owned(camera):
    """True while the camera holds what the app last wrote"""
    if camera.get('mm_written_json') is not None:
        return json.loads(camera['mm_written_json']) == camera_rig.signature(camera)
    return True


def remember_camera(camera):
    camera['mm_written_json'] = json.dumps(camera_rig.signature(camera))


def update_camera(scene, bounds, settings, marbles, motions, fps, regenerate=False):
    """Bakes the follow rig, or frames the run with a static front camera without rig settings.

    Returns `framed`, `baked`, `takenOver`, `manual` or `missing`.
    """
    camera = studio_object('studio.camera')
    if camera is None or camera.type != 'CAMERA':
        return 'missing'
    if settings is not None and settings['mode'] == 'manual':
        return 'manual'
    if not regenerate and not camera_owned(camera):
        return 'takenOver'
    if settings is None:
        camera_rig.clear(camera)
        frame_front(scene, camera, bounds)
        remember_camera(camera)
        return 'framed'
    if not camera_rig.bake(scene, camera, settings, marbles, motions, fps):
        camera_rig.clear(camera)
        frame_front(scene, camera, bounds)
        remember_camera(camera)
        return 'framed'
    remember_camera(camera)
    return 'baked'


def frame_front(scene, camera, bounds):
    (min_x, min_y), (max_x, max_y) = bounds
    width = (max_x - min_x) * FRAME_MARGIN
    height = (max_y - min_y) * FRAME_MARGIN
    aspect = scene.render.resolution_x / scene.render.resolution_y
    # Orthographic scale spans the larger image side
    scale = max(width, height * aspect) if aspect >= 1 else max(height, width / aspect)
    camera.data.type = 'ORTHO'
    camera.data.ortho_scale = max(scale, 0.1)
    camera.data.dof.use_dof = False
    camera.location = ((min_x + max_x) / 2, -10.0, (min_y + max_y) / 2)
    camera.rotation_euler = Euler((math.pi / 2, 0.0, 0.0))
    camera.data.clip_end = 100.0
