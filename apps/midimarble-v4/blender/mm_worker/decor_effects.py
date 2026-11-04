"""Decor that belongs to the frame, not the wall: Snowfall, named Particles in the app. It hangs from the film camera.

The camera turns as it follows the run, so a thing fixed on the wall would cross the frame instead of filling it. An
item is one flat mesh, a little in front of the camera's near side, and draw as unlit
blended surfaces. Blended surfaces write no depth, so depth of field leaves them sharp and they sort over everything.
Each mesh paints by material slot and then by face order, and has no collider and casts no shadow.

Snowfall moves in Geometry Nodes from the scene's frame alone: same frame, same picture, whatever rendered before it, so
a resumed render matches. It is seeded by the layer's ID.

`mm_rgba` carries colour and alpha per vertex. Workbench can't read it, so each slot's `diffuse_color` stands in for
Flat Light. Workbench also outlines every silhouette, which turns soft things into rings, so Flat Light leaves out the snow
(`flat_settings`). The preview's ID pass hides it too
(`id_pass_settings`), so they never catch a click.
"""
import hashlib
import json
import math

import bpy
import numpy as np

from . import themes
from .util import OWNER, finite, parse_color

EFFECT_PROPERTY = 'mm_effect'
PARAMS_PROPERTY = 'mm_effect_params'
RGBA = 'mm_rgba'
# Camera-space distance of each mesh. Screen size doesn't depend on it; it only has to clear the camera's near clip
SNOW_DEPTH = 0.018
NEAR_CLIP_MARGIN = 1.6

SNOWFALL_DEFAULTS = {'density': 0.5, 'size': 1.0, 'speed': 1.0, 'color': '#fff1d6'}

# Flakes at Density 0 and 1
SNOW_COUNT = (30, 360)
# Wide frames of snow fall the same screens per second
SNOW_OVERSCAN = 1.08
GROUP_NAME = 'MM · snowfall motion'
# Share of the flakes, diameter in frame widths, fall in frame heights per second and centre alpha of each depth: far,
# middle and near, the near ones large, quick and soft like snow close to a lens
SNOW_DEPTHS = (
    (0.62, 0.0120, 0.075, 0.95, 0.42),
    (0.30, 0.0200, 0.115, 0.80, 0.45),
    (0.08, 0.0440, 0.190, 0.38, 0.20),
)
SNOW_RINGS = 8
# A flake is a light of its own: over the wall's brightness, so it reads as white on cream
SNOW_GAIN = 2.4
SNOW_RIM = (0.30, 0.18, 0.08, 0.07)


def seed_of(mm_id):
    return int.from_bytes(hashlib.sha1(str(mm_id).encode()).digest()[:8], 'little')


def effect_of(item):
    return item.get('effect') if item else None


def is_effect(obj):
    return obj.get('mm_owner') == OWNER and obj.get(EFFECT_PROPERTY) is not None


def effect_objects(collection):
    return [obj for obj in (collection.objects if collection else []) if is_effect(obj)]


def create(name, effect, collection):
    mesh = bpy.data.meshes.new('MM ' + effect)
    obj = bpy.data.objects.new(name, mesh)
    collection.objects.link(obj)
    obj[EFFECT_PROPERTY] = effect
    obj.visible_shadow = False
    return obj


def params_of(entry):
    """The layer's settings with defaults filled in"""
    own = entry.get('snowfall') or {}
    return {
        'density': min(1.0, max(0.0, finite(own.get('density', SNOWFALL_DEFAULTS['density']), 'density'))),
        'size': max(0.05, finite(own.get('size', SNOWFALL_DEFAULTS['size']), 'size')),
        'speed': max(0.0, finite(own.get('speed', SNOWFALL_DEFAULTS['speed']), 'speed')),
        'color': str(own.get('color', SNOWFALL_DEFAULTS['color'])).lower(),
    }


def signature(obj):
    """What the worker wrote; the scroll keys move the object, so its placement says nothing here"""
    return hashlib.sha1(json.dumps([obj.get(PARAMS_PROPERTY), obj.data.name if obj.data else None]).encode()).hexdigest()[:16]


def attach(entries, managed, camera, scene, fps, duration, theme):
    """Hangs every effect from the film camera and builds what changed. Runs once the camera is baked, as its lens and
    path decide how the items fit. Returns the layers it built."""
    built = []
    if camera is None or camera.type != 'CAMERA':
        return built
    by_id = {entry.get('id'): entry for entry in entries or []}
    exposure = themes.theme_settings(theme).get('exposure', 0.0)
    for obj in effect_objects(managed):
        entry = by_id.get(obj.get('mm_id'))
        if entry is None:
            continue
        if obj.parent is not camera:
            obj.parent = camera
        obj.matrix_parent_inverse.identity()
        params = params_of(entry)
        depth = max(SNOW_DEPTH, camera.data.clip_start * NEAR_CLIP_MARGIN)
        half = frame_half(camera, scene, depth)
        fingerprint = json.dumps([params, depth, round(half[0], 6), round(half[1], 6), fps, exposure])
        if obj.get(PARAMS_PROPERTY) != fingerprint:
            build_snowfall(obj, params, half, depth, fps, seed_of(obj['mm_id']), exposure)
            obj[PARAMS_PROPERTY] = fingerprint
            built.append(obj['mm_id'])
    return built


def frame_half(camera, scene, depth):
    """Half width and half height of the frame, in metres, at `depth` in front of the camera"""
    corners = camera.data.view_frame(scene=scene)
    xs = [abs(corner.x) for corner in corners]
    ys = [abs(corner.y) for corner in corners]
    if camera.data.type == 'ORTHO':
        return max(xs), max(ys)
    plane = abs(corners[0].z) or 1.0
    return max(xs) * depth / plane, max(ys) * depth / plane


# Materials


def overlay_material(key, flat_color, exposure, render_alpha=True):
    """Unlit, blended, coloured by `mm_rgba` and faded by the layer's `mm_visible`. The strength undoes the theme's
    exposure, so a colour reads the same in every theme."""
    name = 'overlay %s %.3f' % (key, exposure)
    gain = 2.0 ** -exposure

    def build(material):
        material.diffuse_color = flat_color
        material.surface_render_method = 'BLENDED'
        material.use_backface_culling = False
        tree = material.node_tree
        for node in list(tree.nodes):
            if node.type != 'OUTPUT_MATERIAL':
                tree.nodes.remove(node)
        output = next(node for node in tree.nodes if node.type == 'OUTPUT_MATERIAL')
        color = tree.nodes.new('ShaderNodeAttribute')
        color.attribute_type = 'GEOMETRY'
        color.attribute_name = RGBA
        visible = tree.nodes.new('ShaderNodeAttribute')
        visible.attribute_type = 'OBJECT'
        visible.attribute_name = 'mm_visible'
        fade = tree.nodes.new('ShaderNodeMath')
        fade.operation = 'MULTIPLY'
        tree.links.new(color.outputs['Alpha'], fade.inputs[0])
        tree.links.new(visible.outputs['Fac'], fade.inputs[1])
        emission = tree.nodes.new('ShaderNodeEmission')
        emission.inputs['Strength'].default_value = gain
        tree.links.new(color.outputs['Color'], emission.inputs['Color'])
        transparent = tree.nodes.new('ShaderNodeBsdfTransparent')
        mix = tree.nodes.new('ShaderNodeMixShader')
        tree.links.new(fade.outputs[0], mix.inputs['Fac'])
        tree.links.new(transparent.outputs['BSDF'], mix.inputs[1])
        tree.links.new(emission.outputs[0], mix.inputs[2])
        tree.links.new(mix.outputs['Shader'], output.inputs['Surface'])
    return themes._shared('MM · decor ' + name, build)


def _write_mesh(obj, verts, faces, rgba, slots, materials):
    """Replaces the mesh of `obj`: arrays of positions, triangles or fans as index tuples, colours and each face's slot"""
    old = obj.data
    mesh = bpy.data.meshes.new(old.name)
    mesh.from_pydata(verts.tolist(), [], faces)
    mesh.update()
    for material in materials:
        mesh.materials.append(material)
    attribute = mesh.color_attributes.new(RGBA, 'FLOAT_COLOR', 'POINT')
    attribute.data.foreach_set('color', rgba.astype(np.float32).ravel())
    mesh.polygons.foreach_set('material_index', np.asarray(slots, dtype=np.int32))
    mesh[OWNER] = True
    obj.data = mesh
    if old.users == 0:
        bpy.data.meshes.remove(old)
    return mesh


# Snowfall


def build_snowfall(obj, params, half, depth, fps, seed, exposure):
    random = np.random.default_rng(seed)
    count = int(round(SNOW_COUNT[0] + (SNOW_COUNT[1] - SNOW_COUNT[0]) * params['density']))
    base = min(half[0], half[1]) * 2
    color = parse_color(params['color'])[:3]
    bright = tuple(channel * SNOW_GAIN for channel in color)
    span = (half[0] * 2 * SNOW_OVERSCAN, half[1] * 2 * SNOW_OVERSCAN)
    rings = SNOW_RINGS
    per_flake = 1 + rings * 2
    positions = np.zeros((count * per_flake, 3), dtype=np.float64)
    rgba = np.zeros((count * per_flake, 4), dtype=np.float64)
    home = np.zeros((count * per_flake, 3), dtype=np.float64)
    rate = np.zeros((count * per_flake, 3), dtype=np.float64)
    faces = []
    angles = np.arange(rings) * 2 * math.pi / rings
    unit = np.stack([np.cos(angles), np.sin(angles), np.zeros(rings)], axis=1)
    shares = np.cumsum([share for share, *_ in SNOW_DEPTHS])
    speed = params['speed']
    for flake in range(count):
        layer = int(np.searchsorted(shares, (flake + 0.5) / count))
        layer = min(layer, len(SNOW_DEPTHS) - 1)
        _share, diameter, fall, alpha, plateau = SNOW_DEPTHS[layer]
        radius = base * diameter * params['size'] * random.uniform(0.75, 1.25) / 2
        first = flake * per_flake
        positions[first + 1:first + 1 + rings] = unit * radius * plateau
        positions[first + 1 + rings:first + per_flake] = unit * radius
        peak = alpha * random.uniform(0.8, 1.0)
        rgba[first:first + 1 + rings, :3] = bright
        rgba[first:first + 1 + rings, 3] = peak
        # A faint warm shade at the rim keeps a pale flake readable on a pale wall
        rgba[first + 1 + rings:first + per_flake] = SNOW_RIM
        for ring in range(rings):
            a, b = ring + 1, (ring + 1) % rings + 1
            faces.append((first, first + a, first + b))
            faces.append((first + a, first + a + rings, first + b + rings, first + b))
        wobble = (random.uniform(0.15, 0.4) / fps) * 2 * math.pi
        cycle = (fall * speed * random.uniform(0.85, 1.15)) / fps / SNOW_OVERSCAN
        drift = random.uniform(0.002, 0.009) * speed / fps
        home[first:first + per_flake] = (random.random(), random.random(), random.uniform(0, 2 * math.pi))
        amplitude = random.uniform(0.006, 0.02) * (0.5 + layer * 0.4)
        rate[first:first + per_flake] = (cycle, drift, amplitude)
        positions[first:first + per_flake, 2] = wobble
    # z of each vertex carries the wobble rate up to Geometry Nodes, which puts the flake on its plane
    material = overlay_material('snow ' + params['color'], (*color, 0.65), exposure)
    mesh = _write_mesh(obj, positions, faces, rgba, [0] * len(faces), [material])
    _vector(mesh, 'mm_home', home)
    _vector(mesh, 'mm_rate', rate)
    _vector(mesh, 'mm_span', np.tile((span[0], span[1], -depth), (len(home), 1)))
    modifier = obj.modifiers.get('Snowfall') or obj.modifiers.new('Snowfall', 'NODES')
    modifier.node_group = snowfall_group()


def _vector(mesh, name, values):
    attribute = mesh.attributes.new(name, 'FLOAT_VECTOR', 'POINT')
    attribute.data.foreach_set('vector', values.astype(np.float32).ravel())


def snowfall_group():
    """The frame gives each flake its place: it falls, wrapping at the frame's edges, and sways. All per-flake numbers
    come from the mesh, so every layer shares this group."""
    group = bpy.data.node_groups.get(GROUP_NAME)
    if group is not None:
        return group
    group = bpy.data.node_groups.new(GROUP_NAME, 'GeometryNodeTree')
    group[OWNER] = True
    group.interface.new_socket('Geometry', in_out='INPUT', socket_type='NodeSocketGeometry')
    group.interface.new_socket('Geometry', in_out='OUTPUT', socket_type='NodeSocketGeometry')
    nodes, links = group.nodes, group.links
    source = nodes.new('NodeGroupInput')
    sink = nodes.new('NodeGroupOutput')
    time = nodes.new('GeometryNodeInputSceneTime')
    frame = time.outputs['Frame']

    def attribute(name):
        node = nodes.new('GeometryNodeInputNamedAttribute')
        node.data_type = 'FLOAT_VECTOR'
        node.inputs['Name'].default_value = name
        split = nodes.new('ShaderNodeSeparateXYZ')
        links.new(node.outputs['Attribute'], split.inputs[0])
        return split.outputs

    def math_node(operation, a, b=None):
        node = nodes.new('ShaderNodeMath')
        node.operation = operation
        for index, value in enumerate((a, b)):
            if value is None:
                continue
            if isinstance(value, (int, float)):
                node.inputs[index].default_value = value
            else:
                links.new(value, node.inputs[index])
        return node.outputs[0]

    home, rate, span = attribute('mm_home'), attribute('mm_rate'), attribute('mm_span')
    position = nodes.new('GeometryNodeInputPosition')
    local = nodes.new('ShaderNodeSeparateXYZ')
    links.new(position.outputs[0], local.inputs[0])
    # Falling: home - rate × frame, wrapped into 0..1, is the height in the frame's span
    fallen = math_node('FRACT', math_node('SUBTRACT', home['Y'], math_node('MULTIPLY', rate['X'], frame)))
    swayed = math_node('MULTIPLY', rate['Z'], math_node('SINE', math_node('ADD', math_node('MULTIPLY', local.outputs['Z'], frame), home['Z'])))
    across = math_node('FRACT', math_node('ADD', home['X'], math_node('ADD', swayed, math_node('MULTIPLY', rate['Y'], frame))))
    x = math_node('ADD', local.outputs['X'], math_node('MULTIPLY', math_node('SUBTRACT', across, 0.5), span['X']))
    y = math_node('ADD', local.outputs['Y'], math_node('MULTIPLY', math_node('SUBTRACT', fallen, 0.5), span['Y']))
    combine = nodes.new('ShaderNodeCombineXYZ')
    links.new(x, combine.inputs['X'])
    links.new(y, combine.inputs['Y'])
    links.new(span['Z'], combine.inputs['Z'])
    placed = nodes.new('GeometryNodeSetPosition')
    links.new(source.outputs[0], placed.inputs['Geometry'])
    links.new(combine.outputs[0], placed.inputs['Position'])
    links.new(placed.outputs['Geometry'], sink.inputs[0])
    return group


# What some renders leave out


def _hiding(objects):
    """Temporary settings that hide objects, keyed timing included"""
    settings = []
    for obj in objects:
        settings.append((obj, 'hide_render', True))
        if obj.animation_data is None or obj.animation_data.action is None:
            continue
        from bpy_extras import anim_utils
        bag = anim_utils.animdata_get_channelbag_for_assigned_slot(obj.animation_data)
        for fcurve in (bag.fcurves if bag else []):
            if fcurve.data_path == 'hide_render':
                settings.append((fcurve, 'mute', True))
    return settings


def id_pass_settings(managed):
    """Keeps every effect out of the preview's ID image"""
    return _hiding(effect_objects(managed))


def flat_settings(managed):
    """Flat Light leaves out what has no outline to speak of: the snow"""
    return _hiding(effect_objects(managed))
