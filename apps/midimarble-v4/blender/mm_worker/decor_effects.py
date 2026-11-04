"""Decor that belongs to the frame, not the wall: Snowfall and Garland. Both hang from the film camera.

The camera turns as it follows the run, so a thing fixed on the wall would cross the frame instead of staying at its
edges or filling it. These items are one flat mesh each, a little in front of the camera's near side, and draw as unlit
blended surfaces. Blended surfaces write no depth, so depth of field leaves them sharp and they sort over everything.
Each mesh paints by material slot and then by face order, and has no collider and casts no shadow.

Snowfall moves in Geometry Nodes from the scene's frame alone: same frame, same picture, whatever rendered before it, so
a resumed render matches. Garland is a static strip whose one key curve is baked from the camera, so it scrolls past at
the speed the wall moves through the frame and reads as hanging on the wall. Both are seeded by the layer's ID.

`mm_rgba` carries colour and alpha per vertex. Workbench can't read it, so each slot's `diffuse_color` stands in for
Flat Light. Workbench also outlines every silhouette, which turns soft things into rings, so Flat Light leaves out the snow
and a Garland's glow part, its halos and shadow (`flat_settings`). The preview's ID pass hides all of these
(`id_pass_settings`), so they never catch a click.
"""
import hashlib
import json
import math

import bpy
import numpy as np
from mathutils import Euler, Vector

from . import anim, themes, walltext
from .util import OWNER, descendants, finite, parse_color, tag

EFFECT_PROPERTY = 'mm_effect'
PARAMS_PROPERTY = 'mm_effect_params'
RGBA = 'mm_rgba'
# Camera-space distance of each mesh. Screen size doesn't depend on it; it only has to clear the camera's near clip
SNOW_DEPTH = 0.018
GARLAND_DEPTH = 0.02
NEAR_CLIP_MARGIN = 1.6

SNOWFALL_DEFAULTS = {'density': 0.5, 'size': 1.0, 'speed': 1.0, 'color': '#fff1d6'}
GARLAND_DEFAULTS = {'side': 'both', 'spacing': 0.14}
GARLAND_SIDES = {'left': (-1.0,), 'right': (1.0,), 'both': (-1.0, 1.0)}

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
# Garland's pattern repeats every this many sprigs
GARLAND_PERIOD = 8
GLOW_PART = 'garland-glow'


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


def params_of(entry, effect):
    """The layer's settings with defaults filled in"""
    if effect == 'snowfall':
        own = entry.get('snowfall') or {}
        return {
            'density': min(1.0, max(0.0, finite(own.get('density', SNOWFALL_DEFAULTS['density']), 'density'))),
            'size': max(0.05, finite(own.get('size', SNOWFALL_DEFAULTS['size']), 'size')),
            'speed': max(0.0, finite(own.get('speed', SNOWFALL_DEFAULTS['speed']), 'speed')),
            'color': str(own.get('color', SNOWFALL_DEFAULTS['color'])).lower(),
        }
    own = entry.get('garland') or {}
    side = own.get('side', GARLAND_DEFAULTS['side'])
    return {
        'side': side if side in GARLAND_SIDES else GARLAND_DEFAULTS['side'],
        'spacing': max(0.04, finite(own.get('spacing', GARLAND_DEFAULTS['spacing']), 'spacing')),
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
        effect = obj[EFFECT_PROPERTY]
        if obj.parent is not camera:
            obj.parent = camera
        obj.matrix_parent_inverse.identity()
        params = params_of(entry, effect)
        depth = max(GARLAND_DEPTH if effect == 'garland' else SNOW_DEPTH, camera.data.clip_start * NEAR_CLIP_MARGIN)
        half = frame_half(camera, scene, depth)
        if effect == 'garland':
            # A blended object sorts by its origin, so the origin holds the depth
            obj.location = (0.0, 0.0, -depth)
        fingerprint = json.dumps([params, depth, round(half[0], 6), round(half[1], 6), fps, exposure])
        path = camera_path(camera, scene) if effect == 'garland' else None
        scroll = garland_scroll(path, camera, scene, depth) if path else None
        if scroll is not None:
            fingerprint = json.dumps([fingerprint, round(float(np.ptp(scroll[1])), 5), round(float(scroll[1][-1]), 5)])
        if obj.get(PARAMS_PROPERTY) != fingerprint:
            if effect == 'snowfall':
                build_snowfall(obj, params, half, depth, fps, seed_of(obj['mm_id']), exposure)
            else:
                build_garland(obj, params, half, scroll[1] if scroll else None, seed_of(obj['mm_id']), exposure, managed)
            obj[PARAMS_PROPERTY] = fingerprint
            built.append(obj['mm_id'])
        if effect == 'garland':
            if scroll is not None:
                anim.write_fcurve(anim.ensure_channelbag(obj), 'location', 1, scroll[0], scroll[1])
            for part in descendants(obj):
                is_hidden = entry.get('hidden') is True
                if is_hidden:
                    anim.clear_channels(part, walltext.TIMING_PATHS)
                    part.hide_render = True
                else:
                    walltext.write_timing(part, entry, fps, duration)
                part.hide_viewport = is_hidden
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


# Garland


def camera_path(camera, scene):
    """(frames, locations, rotations) of the camera from its curves, without changing the scene's frame"""
    curves = {}
    if camera.animation_data is not None and camera.animation_data.action is not None:
        from bpy_extras import anim_utils
        bag = anim_utils.animdata_get_channelbag_for_assigned_slot(camera.animation_data)
        for fcurve in (bag.fcurves if bag else []):
            if fcurve.data_path in ('location', 'rotation_euler'):
                curves[(fcurve.data_path, fcurve.array_index)] = fcurve
    frames = list(range(scene.frame_start, scene.frame_end + 1))
    locations, rotations = [], []
    for frame in frames:
        locations.append(Vector([curves[('location', axis)].evaluate(frame) if ('location', axis) in curves else camera.location[axis] for axis in range(3)]))
        rotations.append(Euler([curves[('rotation_euler', axis)].evaluate(frame) if ('rotation_euler', axis) in curves else camera.rotation_euler[axis] for axis in range(3)], 'XYZ').to_matrix())
    return frames, locations, rotations


def garland_scroll(path, camera, scene, depth):
    """(frames, heights): how far up the camera's near plane the strip stands on each frame, so it passes the frame at the
    speed the wall does. The wall moves through the frame as the camera moves along its own up axis, and the share of
    a frame height that is depends on how far the wall is."""
    frames, locations, rotations = path
    is_ortho = camera.data.type == 'ORTHO'
    heights = [0.0]
    for index in range(1, len(frames)):
        rotation = rotations[index]
        up = rotation @ Vector((0.0, 1.0, 0.0))
        forward = rotation @ Vector((0.0, 0.0, -1.0))
        step = (locations[index] - locations[index - 1]).dot(up)
        if is_ortho:
            heights.append(heights[-1] - step)
            continue
        distance = abs(locations[index].y) / max(abs(forward.y), 0.2)
        heights.append(heights[-1] - step * depth / max(distance, 1e-3))
    values = np.asarray(heights, dtype=np.float64)
    return frames, values


class _Paint:
    """Two meshes built together: the garland itself, and what is soft (halos and shadow) for its glow part"""

    def __init__(self):
        self.parts = [{'verts': [], 'rgba': [], 'faces': [], 'slots': []}, {'verts': [], 'rgba': [], 'faces': [], 'slots': []}]

    def part(self, slot):
        return self.parts[1] if slot in GLOW_SLOTS else self.parts[0]


def _triangle(paint, slot, points, colors):
    part = paint.part(slot)
    start = len(part['verts'])
    part['verts'] += [(x, y, 0.0) for x, y in points]
    part['rgba'] += colors
    part['faces'].append(tuple(start + index for index in range(len(points))))
    part['slots'].append(slot)


def _stroke(paint, slot, a, b, width, color_a, color_b=None, end_width=None):
    """A tapered segment from a to b"""
    color_b = color_b or color_a
    dx, dy = b[0] - a[0], b[1] - a[1]
    length = math.hypot(dx, dy) or 1.0
    nx, ny = -dy / length, dx / length
    start, end = width / 2, (width if end_width is None else end_width) / 2
    _triangle(paint, slot, [(a[0] + nx * start, a[1] + ny * start), (a[0] - nx * start, a[1] - ny * start), (b[0] - nx * end, b[1] - ny * end), (b[0] + nx * end, b[1] + ny * end)], [color_a, color_a, color_b, color_b])


def _disc(paint, slot, center, radius, color_at, rings=4, segments=18):
    """A disc whose vertices take `color_at(x, y)`, with x and y in -1..1 of the disc"""
    part = paint.part(slot)
    start = len(part['verts'])
    part['verts'].append((center[0], center[1], 0.0))
    part['rgba'].append(color_at(0.0, 0.0))
    for ring in range(1, rings + 1):
        share = ring / rings
        for segment in range(segments):
            angle = segment * 2 * math.pi / segments
            x, y = math.cos(angle) * share, math.sin(angle) * share
            part['verts'].append((center[0] + x * radius, center[1] + y * radius, 0.0))
            part['rgba'].append(color_at(x, y))
    for segment in range(segments):
        following = (segment + 1) % segments
        part['faces'].append((start, start + 1 + segment, start + 1 + following))
        part['slots'].append(slot)
    for ring in range(rings - 1):
        inner, outer = start + 1 + ring * segments, start + 1 + (ring + 1) * segments
        for segment in range(segments):
            following = (segment + 1) % segments
            part['faces'].append((inner + segment, outer + segment, outer + following, inner + following))
            part['slots'].append(slot)


def _rgb(hex_color, alpha=1.0, gain=1.0):
    linear = parse_color(hex_color)
    return (linear[0] * gain, linear[1] * gain, linear[2] * gain, alpha)


SLOT_SHADOW, SLOT_HALO, SLOT_NEEDLE, SLOT_WIRE, SLOT_FLAKE, SLOT_BAUBLE, SLOT_LIGHT = range(7)
GLOW_SLOTS = (SLOT_SHADOW, SLOT_HALO)
# The glow part sits this much behind the garland: enough to sort behind it, too little to shift it on screen. It can't
# make up for the depth by scaling, as it scrolls with its parent and a scale would move it further the further it went
GLOW_DEPTH = 0.00002
NEEDLE_DARK = _rgb('#1f3328')
NEEDLE_LIGHT = _rgb('#8aa08c')
SPINE = _rgb('#2a2620')
WIRE = _rgb('#201c18')
FLAKE = _rgb('#b9b6ac', 0.8)
SHADOW = (0.16, 0.10, 0.05, 0.14)
# The wall takes a soft drop shadow down and to the side, as far as the Key Light's on the wall
SHADOW_SHIFT = (0.0035, -0.004)
BAUBLES = {'red': '#c31f28', 'gold': '#d9b45a'}
BULB_CORE = (3.6, 2.5, 1.2)
BULB_HALO = (1.0, 0.55, 0.16)


def _sphere_color(hex_color):
    """A lit ball painted by hand: top-left light, deep bottom edge and a small highlight"""
    base = parse_color(hex_color)

    def color_at(x, y):
        z = math.sqrt(max(0.0, 1.0 - x * x - y * y))
        light = max(0.0, -0.45 * x + 0.5 * y + 0.74 * z)
        highlight = max(0.0, 1.0 - math.hypot(x + 0.35, y - 0.38) / 0.28) ** 2
        value = 0.25 + 0.85 * light
        return (base[0] * value + highlight, base[1] * value + highlight, base[2] * value + highlight, 1.0)
    return color_at


def _bulb(paint, center, radius):
    """A fairy light: a small warm-white core over a soft amber halo"""
    core, halo = BULB_CORE, BULB_HALO

    def halo_at(x, y):
        share = 1.0 - min(1.0, math.hypot(x, y))
        return (core[0] * share + halo[0] * (1 - share), core[1] * share + halo[1] * (1 - share), core[2] * share + halo[2] * (1 - share), 0.8 * share * share)
    _disc(paint, SLOT_HALO, center, radius, halo_at, rings=4, segments=12)
    _disc(paint, SLOT_LIGHT, center, radius * 0.24, lambda _x, _y: (*core, 1.0), rings=1, segments=8)


def _sprig(paint, slot, root, side, length, angle, random, needles=20):
    """A short fir branch from `root` into the frame: a thin spine, paired needles swept toward its tip, and each needle a
    long thin triangle going paler toward the tip"""
    cos, sin = math.cos(angle), math.sin(angle)
    tip = (root[0] - side * cos * length, root[1] + sin * length)
    _stroke(paint, SLOT_WIRE if slot == SLOT_NEEDLE else slot, root, tip, length * 0.018, SHADOW if slot == SLOT_SHADOW else SPINE)
    for index in range(needles):
        share = (index + 0.5) / needles
        at = (root[0] + (tip[0] - root[0]) * share, root[1] + (tip[1] - root[1]) * share)
        reach = length * (0.25 - 0.12 * share) * random.uniform(0.85, 1.1)
        for flank in (-1.0, 1.0):
            sweep = math.radians(random.uniform(40, 56))
            direction = (-side * (cos * math.cos(sweep) - flank * sin * math.sin(sweep)), sin * math.cos(sweep) + flank * cos * math.sin(sweep))
            end = (at[0] + direction[0] * reach, at[1] + direction[1] * reach)
            if slot == SLOT_SHADOW:
                _stroke(paint, slot, at, end, length * 0.026, SHADOW, end_width=0.0)
            else:
                _stroke(paint, slot, at, end, length * 0.03, NEEDLE_DARK, NEEDLE_LIGHT, end_width=length * 0.006)


def _flake(paint, center, radius):
    for index in range(3):
        angle = index * math.pi / 3 + 0.25
        dx, dy = math.cos(angle) * radius, math.sin(angle) * radius
        _stroke(paint, SLOT_FLAKE, (center[0] - dx, center[1] - dy), (center[0] + dx, center[1] + dy), radius * 0.05, FLAKE)
    for index in range(6):
        angle = index * math.pi / 3 + 0.25
        at = (center[0] + math.cos(angle) * radius * 0.6, center[1] + math.sin(angle) * radius * 0.6)
        for flank in (-0.8, 0.8):
            end = (at[0] + math.cos(angle + flank) * radius * 0.28, at[1] + math.sin(angle + flank) * radius * 0.28)
            _stroke(paint, SLOT_FLAKE, at, end, radius * 0.04, FLAKE)


def _bauble(paint, center, radius, kind):
    glossy = _sphere_color(BAUBLES[kind])
    shadow_at = (center[0] + radius * 0.45, center[1] - radius * 0.55)
    _disc(paint, SLOT_SHADOW, shadow_at, radius * 1.25, lambda x, y: (SHADOW[0], SHADOW[1], SHADOW[2], 0.32 * (1 - min(1.0, math.hypot(x, y))) ** 0.7), rings=3, segments=14)
    _disc(paint, SLOT_BAUBLE, center, radius, glossy)
    cap = _rgb('#c9b37a')
    _stroke(paint, SLOT_BAUBLE, (center[0], center[1] + radius * 0.9), (center[0], center[1] + radius * 1.25), radius * 0.5, cap)


def garland_side(paint, side, half, low, high, spacing, seed):
    """One garland along the edge at `side`, from `low` to `high` on the strip. Laid out from fixed pattern cells, so the
    same strip comes back after `GARLAND_PERIOD` sprigs."""
    width = half[0] * 2
    height = half[1] * 2
    unit = min(width, height)
    step = spacing * height
    period = step * GARLAND_PERIOD
    edge = side * half[0]
    wave = unit * 0.016
    inset = unit * 0.05
    first = math.floor(low / step) - 1
    last = math.ceil(high / step) + 1
    side_seed = seed + (0 if side < 0 else 977)
    # Sag between two points of the wire along a sine that closes on the pattern's period
    wire_x = lambda y: edge - side * inset + side * wave * math.sin(y / period * 2 * math.pi * 3 + side_seed % 7)

    # The wire and a shadow under it, in short steps
    y = first * step
    step_y = step / 6
    while y < last * step:
        a, b = (wire_x(y), y), (wire_x(y + step_y), y + step_y)
        _stroke(paint, SLOT_SHADOW, (a[0] + SHADOW_SHIFT[0] * unit, a[1] + SHADOW_SHIFT[1] * unit), (b[0] + SHADOW_SHIFT[0] * unit, b[1] + SHADOW_SHIFT[1] * unit), unit * 0.0032, SHADOW)
        _stroke(paint, SLOT_WIRE, a, b, unit * 0.0024, WIRE)
        y += step_y

    for cell in range(first, last + 1):
        index = cell % GARLAND_PERIOD
        random = np.random.default_rng(side_seed + index)
        at = cell * step + float(random.uniform(-0.12, 0.12)) * step
        root = (edge + side * unit * 0.008, at)
        length = unit * float(random.uniform(0.15, 0.19))
        angle = math.radians(float(random.uniform(-7, 7)))
        shifted = (root[0] + SHADOW_SHIFT[0] * unit, root[1] + SHADOW_SHIFT[1] * unit)
        needle_seed = side_seed * 31 + index
        _sprig(paint, SLOT_SHADOW, shifted, side, length, angle, np.random.default_rng(needle_seed))
        _sprig(paint, SLOT_NEEDLE, root, side, length, angle, np.random.default_rng(needle_seed))
        # Fairy lights along the wire, two per sprig
        for share in (0.2, 0.7):
            y = cell * step + share * step
            at_wire = (wire_x(y), y)
            _bulb(paint, at_wire, unit * 0.018)
        # A bauble on every third sprig, red and gold in turn; a snowflake by a sprig's tip on the others now and then
        if index % 3 == 0:
            bauble_y = at - step * 0.32
            kind = 'red' if index % 2 == 0 else 'gold'
            center = (wire_x(bauble_y) - side * unit * 0.018, bauble_y)
            radius = unit * 0.024
            _stroke(paint, SLOT_WIRE, (center[0], center[1] + radius * 1.2), (wire_x(bauble_y + step * 0.1), bauble_y + step * 0.1), unit * 0.0012, WIRE)
            _bauble(paint, center, radius, kind)
        elif index % 4 == 1:
            tip = (root[0] - side * length * 1.05, at + step * 0.14)
            _flake(paint, tip, unit * 0.03)


def build_garland(obj, params, half, scroll, seed, exposure, managed):
    paint = _Paint()
    spacing = params['spacing']
    height = half[1] * 2
    # The strip covers what scrolls past: at scroll h a point at y of the strip shows at y + h
    if scroll is not None and len(scroll):
        low, high = -half[1] - float(np.max(scroll)), half[1] - float(np.min(scroll))
    else:
        low, high = -half[1], half[1]
    low, high = low - height * 0.05, high + height * 0.05
    for side in GARLAND_SIDES[params['side']]:
        garland_side(paint, side, half, low, high, spacing, seed)
    materials = [
        overlay_material('garland shadow', (0.3, 0.2, 0.1, 0.12), exposure),
        overlay_material('garland halo', (1.0, 0.8, 0.5, 0.4), exposure),
        overlay_material('garland needle', (*NEEDLE_DARK[:3], 1.0), exposure),
        overlay_material('garland wire', (*WIRE[:3], 1.0), exposure),
        overlay_material('garland flake', (*FLAKE[:3], 0.7), exposure),
        overlay_material('garland bauble', (*_rgb(BAUBLES['red'])[:3], 1.0), exposure),
        overlay_material('garland light', (1.0, 0.82, 0.55, 1.0), exposure),
    ]
    main, glow = paint.parts
    _write_mesh(obj, np.asarray(main['verts'], dtype=np.float64), main['faces'], np.asarray(main['rgba'], dtype=np.float64), main['slots'], materials)
    part = next((child for child in descendants(obj) if child.get(EFFECT_PROPERTY) == GLOW_PART), None)
    if part is None:
        part = bpy.data.objects.new(obj.name + ' Glow', bpy.data.meshes.new('MM garland glow'))
        managed.objects.link(part)
        tag(part, obj['mm_id'] + '/glow', 'decor-part')
        part[EFFECT_PROPERTY] = GLOW_PART
        part.visible_shadow = False
        part.parent = obj
    part.matrix_parent_inverse.identity()
    part.location = (0.0, 0.0, -GLOW_DEPTH)
    _write_mesh(part, np.asarray(glow['verts'], dtype=np.float64), glow['faces'], np.asarray(glow['rgba'], dtype=np.float64), glow['slots'], materials)


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
    """Flat Light leaves out what has no outline to speak of: the snow and a Garland's glow"""
    return _hiding([obj for obj in effect_objects(managed) if obj[EFFECT_PROPERTY] in ('snowfall', GLOW_PART)])
