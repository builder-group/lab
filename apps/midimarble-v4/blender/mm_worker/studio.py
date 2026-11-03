"""Default pegboard studio: wall, sun, world light, front camera and render settings.

Created on the first apply only. Later applies change only the camera framing while the camera keeps the
transform the app last wrote; any user edit hands the camera over to Blender.
"""
import math

import bpy
from mathutils import Euler, Vector

from .util import STUDIO_COLLECTION, ensure_collection, tag

STUDIO_VERSION = 1
PEG_PITCH = 0.025
WALL_MARGIN = 1.0
FRAME_MARGIN = 1.15


def ensure_studio(scene, bounds):
    """Creates the default studio once per scene. Returns True when it was created by this call."""
    if scene.get('mm_studio_version'):
        return False
    collection = ensure_collection(STUDIO_COLLECTION)
    create_wall(collection, bounds)
    create_sun(collection)
    create_world(scene)
    camera = create_camera(collection)
    scene.camera = camera
    scene.render.engine = 'BLENDER_EEVEE'
    scene.view_settings.view_transform = 'AgX'
    scene['mm_studio_version'] = STUDIO_VERSION
    return True


def studio_object(role):
    collection = bpy.data.collections.get(STUDIO_COLLECTION)
    if collection is None:
        return None
    for obj in collection.objects:
        if obj.get('mm_role') == role and obj.get('mm_owner') == 'midimarble':
            return obj
    return None


def create_wall(collection, bounds):
    (min_x, min_y), (max_x, max_y) = bounds
    half_width = (max_x - min_x) / 2 + WALL_MARGIN
    half_height = (max_y - min_y) / 2 + WALL_MARGIN
    center_x, center_y = (min_x + max_x) / 2, (min_y + max_y) / 2
    mesh = bpy.data.meshes.new('MM wall')
    # Local XY plane; the object rotation turns it into Blender XZ with its normal facing the camera (-Y)
    mesh.from_pydata(
        [(-half_width, -half_height, 0), (half_width, -half_height, 0), (half_width, half_height, 0), (-half_width, half_height, 0)],
        [],
        [(0, 1, 2, 3)],
    )
    wall = bpy.data.objects.new('Pegboard wall', mesh)
    wall.location = (center_x, 0.0, center_y)
    wall.rotation_euler = (math.pi / 2, 0.0, 0.0)
    mesh.materials.append(pegboard_material())
    collection.objects.link(wall)
    tag(wall, 'studio.wall', 'studio.wall')
    return wall


def pegboard_material():
    material = bpy.data.materials.new('MM · pegboard')
    material['mm_owner'] = 'midimarble'
    material.diffuse_color = (0.55, 0.42, 0.28, 1.0)
    tree = material.node_tree
    nodes, links = tree.nodes, tree.links
    principled = nodes.get('Principled BSDF')
    coordinates = nodes.new('ShaderNodeTexCoord')
    mapping = nodes.new('ShaderNodeMapping')
    mapping.inputs['Scale'].default_value = (1 / PEG_PITCH, 1 / PEG_PITCH, 1.0)
    fraction = nodes.new('ShaderNodeVectorMath')
    fraction.operation = 'FRACTION'
    center = nodes.new('ShaderNodeVectorMath')
    center.operation = 'SUBTRACT'
    center.inputs[1].default_value = (0.5, 0.5, 0.0)
    length = nodes.new('ShaderNodeVectorMath')
    length.operation = 'LENGTH'
    ramp = nodes.new('ShaderNodeValToRGB')
    ramp.color_ramp.interpolation = 'CONSTANT'
    ramp.color_ramp.elements[0].position = 0.0
    ramp.color_ramp.elements[0].color = (0.035, 0.025, 0.018, 1.0)
    ramp.color_ramp.elements[1].position = 0.15
    ramp.color_ramp.elements[1].color = (0.55, 0.40, 0.25, 1.0)
    links.new(coordinates.outputs['Object'], mapping.inputs['Vector'])
    links.new(mapping.outputs['Vector'], fraction.inputs[0])
    links.new(fraction.outputs['Vector'], center.inputs[0])
    links.new(center.outputs['Vector'], length.inputs[0])
    links.new(length.outputs['Value'], ramp.inputs['Fac'])
    links.new(ramp.outputs['Color'], principled.inputs['Base Color'])
    principled.inputs['Roughness'].default_value = 0.8
    return material


def create_sun(collection):
    light = bpy.data.lights.new('MM sun', 'SUN')
    light.energy = 3.0
    light.angle = math.radians(25)
    sun = bpy.data.objects.new('Sun', light)
    # Shines from the upper left, slightly in front of the wall
    direction = Vector((1.0, 1.2, -1.1)).normalized()
    sun.rotation_euler = direction.to_track_quat('-Z', 'Y').to_euler()
    sun.location = (-1.0, -1.5, 2.0)
    collection.objects.link(sun)
    tag(sun, 'studio.sun', 'studio.sun')
    return sun


def create_world(scene):
    # A world the scene already has belongs to the user
    if scene.world is not None:
        return
    world = bpy.data.worlds.new('MM studio')
    world['mm_owner'] = 'midimarble'
    background = world.node_tree.nodes.get('Background') if world.node_tree else None
    if background is not None:
        background.inputs['Color'].default_value = (0.75, 0.78, 0.82, 1.0)
        background.inputs['Strength'].default_value = 0.6
    world.color = (0.75, 0.78, 0.82)
    scene.world = world


def create_camera(collection):
    data = bpy.data.cameras.new('MM camera')
    data.type = 'ORTHO'
    camera = bpy.data.objects.new('Front camera', data)
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


def camera_signature(camera):
    return [round(value, 6) for value in (*camera.location, *camera.rotation_euler, camera.data.ortho_scale)]


def frame_camera(scene, bounds):
    """Frames the run with the app camera unless the user changed it since the app last wrote it"""
    camera = studio_object('studio.camera')
    if camera is None or camera.type != 'CAMERA':
        return False
    written = camera.get('mm_written')
    if written is not None and list(written) != camera_signature(camera):
        return False
    (min_x, min_y), (max_x, max_y) = bounds
    width = (max_x - min_x) * FRAME_MARGIN
    height = (max_y - min_y) * FRAME_MARGIN
    aspect = scene.render.resolution_x / scene.render.resolution_y
    # Orthographic scale spans the larger image side
    scale = max(width, height * aspect) if aspect >= 1 else max(height, width / aspect)
    camera.data.type = 'ORTHO'
    camera.data.ortho_scale = max(scale, 0.1)
    camera.location = ((min_x + max_x) / 2, -10.0, (min_y + max_y) / 2)
    camera.rotation_euler = Euler((math.pi / 2, 0.0, 0.0))
    camera.data.clip_end = 100.0
    camera['mm_written'] = camera_signature(camera)
    return True
