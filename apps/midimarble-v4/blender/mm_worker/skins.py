"""Default skins per theme and piece type, with hit reactions.

A default skin is a mesh object parented to its holder, tagged `mm_skin = 'default'`. Moving parts, such as a
platform's bar, are child objects tagged `mm_part`; reactions drive them from the holder's `mm_hit` so the holder
and its keyframes are never changed. The skin root keeps any local offset the user gives it.

Ownership: the app rebuilds a default skin only while it is unedited. `mm_skin_print` fingerprints the skin as
the app built it (meshes, materials, modifiers and parts). A skin whose fingerprint changed, or whose `mm_skin`
is not `default`, belongs to the user and is never touched.

Local frame of a piece holder: x along the piece, z up in the piece's frame, y into the wall. The holder sits at
y = -(wallOffset + depth / 2), so the wall plane is at local y = wallOffset + depth / 2.
"""
import hashlib
import json
import math

import bpy
from mathutils import Vector

from . import themes
from .geometry import MeshBuilder, rounded_polyline
from .util import DEFAULT_MARBLE_RADIUS, DEFAULT_PIECE_DEPTH, MARBLE_WALL_GAP, OWNER

DEFAULT_SKIN = 'default'
REACTION_PATHS = (('location', 2), ('rotation_euler', 1), ('["mm_flash"]', -1))
VISIBILITY_PATHS = ('hide_render', 'hide_viewport')


def skin_context(theme, marble_radius=DEFAULT_MARBLE_RADIUS, reactions=None):
    settings = themes.theme_settings(theme)
    merged = dict(settings['reactions'])
    for name, value in (reactions or {}).items():
        if name in merged and isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value):
            merged[name] = float(value)
    return {'theme': themes.theme_name(theme), 'marbleRadius': float(marble_radius), 'reactions': merged}


# Public entry points


def create_marble_skin(holder, marble, collection, context):
    return _create(holder, 'marble', marble, collection, context)


def create_piece_skin(holder, piece, collection, context):
    return _create(holder, 'piece', piece, collection, context)


def refresh_default_skin(skin, kind, entity, context, collection=None):
    """Rebuilds an unedited default skin whose theme or parameters changed. Returns what happened."""
    if skin.get('mm_skin') != DEFAULT_SKIN or skin.type != 'MESH':
        return 'custom'
    stored = skin.get('mm_skin_print')
    if stored is not None and stored != fingerprint(skin):
        return 'edited'
    holder = skin.parent
    if kind == 'marble' and holder is not None and not skin.get('mm_visibility'):
        add_visibility(skin, holder)
    key = skin_key(kind, entity, context)
    if skin.get('mm_skin_key') == key:
        return 'kept'
    spec = build_spec(kind, entity, context)
    previous = skin.data
    skin.data = spec['root']
    if previous.users == 0:
        bpy.data.meshes.remove(previous)
    for modifier in list(skin.modifiers):
        # Skins from earlier versions carried a bevel modifier; bevels are now part of the mesh
        if modifier.name == 'Bevel' and modifier.type == 'BEVEL':
            skin.modifiers.remove(modifier)
    for part in [child for child in skin.children if child.get('mm_part')]:
        remove_object(part)
    collection = collection or (skin.users_collection[0] if skin.users_collection else None)
    for part_spec in spec['parts']:
        _add_part(skin, holder, part_spec, collection, entity, context)
    skin['mm_skin_key'] = key
    skin['mm_skin_print'] = fingerprint(skin)
    return 'rebuilt'


def add_visibility(skin, holder):
    """Hides a marble skin while its holder's `mm_visible` is 0, such as inside a tunnel"""
    if 'mm_visible' not in holder:
        holder['mm_visible'] = 1.0
    for path in VISIBILITY_PATHS:
        driver = skin.driver_add(path).driver
        driver.type = 'SCRIPTED'
        variable = driver.variables[0] if len(driver.variables) else driver.variables.new()
        variable.name = 'v'
        variable.type = 'SINGLE_PROP'
        variable.targets[0].id_type = 'OBJECT'
        variable.targets[0].id = holder
        variable.targets[0].data_path = '["mm_visible"]'
        driver.expression = 'v < 0.5'
    skin['mm_visibility'] = True


def release_reactions(obj):
    """Removes the app's reaction and visibility drivers, used when a skin leaves its holder"""
    if obj.animation_data is None:
        return
    if obj.get('mm_visibility'):
        for path in VISIBILITY_PATHS:
            obj.driver_remove(path)
    if not obj.get('mm_part'):
        return
    for path, index in REACTION_PATHS:
        try:
            obj.driver_remove(path, index)
        except TypeError:
            pass


def fingerprint(skin):
    entries = []
    for obj in [skin, *sorted((child for child in skin.children), key=lambda child: child.get('mm_part', child.name))]:
        data = obj.data
        entries.append([
            obj.get('mm_part', 'root'),
            obj.type,
            data.name if data is not None else None,
            len(data.vertices) if obj.type == 'MESH' else 0,
            len(data.polygons) if obj.type == 'MESH' else 0,
            [material.name if material else None for material in (data.materials if obj.type == 'MESH' else [])],
            [modifier.type for modifier in obj.modifiers],
            len(obj.children),
        ])
    return hashlib.sha1(json.dumps(entries).encode()).hexdigest()[:16]


def skin_key(kind, entity, context):
    if kind == 'marble':
        values = ['marble', context['theme'], round(float(entity['radius']), 6), entity.get('color')]
    else:
        frame = PieceFrame(entity, context)
        values = [
            'piece', context['theme'], entity.get('type', 'platform'), entity.get('color'),
            sorted((name, round(float(value), 6)) for name, value in (entity.get('params') or {}).items()),
            round(frame.wall_offset, 6), round(context['marbleRadius'], 6),
            [[round(value, 5) for value in point] for point in frame.local_path()],
            math.copysign(1.0, frame.angle), sorted(context['reactions'].items()), frame.finish,
        ]
    return hashlib.sha1(json.dumps(values).encode()).hexdigest()[:16]


def remove_object(obj):
    for child in list(obj.children):
        remove_object(child)
    data = obj.data
    bpy.data.objects.remove(obj)
    if data is not None and getattr(data, 'users', 1) == 0 and isinstance(data, bpy.types.Mesh):
        bpy.data.meshes.remove(data)


# Building


def _create(holder, kind, entity, collection, context):
    spec = build_spec(kind, entity, context)
    skin = bpy.data.objects.new(holder.name + ' skin', spec['root'])
    collection.objects.link(skin)
    skin.parent = holder
    skin.matrix_parent_inverse.identity()
    skin['mm_skin'] = DEFAULT_SKIN
    skin['mm_owner'] = OWNER
    if kind == 'marble':
        add_visibility(skin, holder)
    for part_spec in spec['parts']:
        _add_part(skin, holder, part_spec, collection, entity, context)
    skin['mm_skin_key'] = skin_key(kind, entity, context)
    skin['mm_skin_print'] = fingerprint(skin)
    return skin


def _add_part(skin, holder, spec, collection, entity, context):
    part = bpy.data.objects.new(skin.name + ' ' + spec['role'], spec['mesh'])
    if collection is not None:
        collection.objects.link(part)
    part.parent = skin
    part.matrix_parent_inverse.identity()
    part['mm_part'] = spec['role']
    part['mm_owner'] = OWNER
    part['mm_flash'] = 0.0
    if spec.get('reactive') and holder is not None:
        add_reaction(part, holder, float(entity.get('angle', 0.0)), context['reactions'])
    return part


def add_reaction(part, holder, angle, reactions):
    """Bar dip: a small press along -z and a tilt around the bracket that follow `mm_hit` and spring back with it"""
    press = reactions.get('press', 0.0)
    tilt = math.radians(reactions.get('dip', 0.0)) * (-1.0 if angle >= 0 else 1.0)
    flash = reactions.get('flash', 0.0)
    for (path, index), expression in zip(REACTION_PATHS, ('-%.6f*h' % press, '%.6f*h' % tilt, '%.4f*h' % flash)):
        fcurve = part.driver_add(path, index) if index >= 0 else part.driver_add(path)
        driver = fcurve.driver
        driver.type = 'SCRIPTED'
        variable = driver.variables[0] if len(driver.variables) else driver.variables.new()
        variable.name = 'h'
        variable.type = 'SINGLE_PROP'
        variable.targets[0].id_type = 'OBJECT'
        variable.targets[0].id = holder
        variable.targets[0].data_path = '["mm_hit"]'
        driver.expression = expression


def build_spec(kind, entity, context):
    theme = context['theme']
    if kind == 'marble':
        return {'root': marble_mesh(entity, theme), 'parts': []}
    piece_type = entity.get('type', 'platform')
    frame = PieceFrame(entity, context)
    builder = {'rail': rail_spec, 'tunnel': tunnel_spec, 'windmill': windmill_spec}.get(piece_type, platform_spec)
    return builder(frame, entity, theme)


class PieceFrame:
    """Dimensions of a piece in its holder's local frame"""

    def __init__(self, piece, context):
        self.params = {name: float(value) for name, value in (piece.get('params') or {}).items()}
        self.depth = self.params.get('depth', DEFAULT_PIECE_DEPTH)
        self.wall_offset = float(piece.get('wallOffset', 0.0))
        self.wall_y = self.wall_offset + self.depth / 2
        self.marble_radius = context['marbleRadius']
        self.marble_y = self.wall_y - (self.marble_radius + MARBLE_WALL_GAP)
        self.angle = float(piece.get('angle', 0.0))
        position = piece.get('position') or {'x': 0.0, 'y': 0.0}
        self.origin = (float(position['x']), float(position['y']))
        self.path = [(float(point['x']), float(point['y'])) for point in (piece.get('path') or [])]
        self.color = piece.get('color') or '#c8b89a'
        # Built-in bar finishes are chosen with skin asset IDs `brass:<finish>`; other skins keep the theme default
        asset = ((piece.get('skin') or {}).get('assetId') or '')
        self.finish = asset.split(':', 1)[1] if asset.startswith('brass:') else 'gold'

    def to_local(self, point):
        dx, dy = point[0] - self.origin[0], point[1] - self.origin[1]
        cos, sin = math.cos(self.angle), math.sin(self.angle)
        return dx * cos + dy * sin, -dx * sin + dy * cos

    def local_path(self):
        return [self.to_local(point) for point in self.path]

    def offset_path(self, distance):
        """World path pushed `distance` along its upward normal, in local wall coordinates"""
        result = []
        for index, point in enumerate(self.path):
            previous = self.path[max(0, index - 1)]
            following = self.path[min(len(self.path) - 1, index + 1)]
            tx, ty = following[0] - previous[0], following[1] - previous[1]
            length = math.hypot(tx, ty) or 1.0
            nx, ny = -ty / length, tx / length
            if ny < 0:
                nx, ny = -nx, -ny
            result.append(self.to_local((point[0] + nx * distance, point[1] + ny * distance)))
        return result


def platform_spec(frame, piece, theme):
    params = frame.params
    length = params.get('length', 0.06)
    thickness = params.get('thickness', 0.008)
    if theme == 'brass':
        chrome, metal = themes.chrome_material(), themes.bar_material(frame.finish)
        # Bracket parts scale with the kit, measured against the 16 mm marble of the Marble Race Kit
        k = frame.marble_radius / 0.008
        standoff = 0.0025 * k
        bar_depth = min(max(frame.depth * 0.72, 1.7 * frame.marble_radius), 3.2 * frame.marble_radius)
        bar_y = frame.wall_y - standoff - bar_depth / 2
        # The top face is the collider's contact surface; the underside is slimmer than the collider so the
        # bar reads thin like the reference
        bar_thickness = thickness * 0.62
        bar_z = thickness / 2 - bar_thickness / 2
        bar = MeshBuilder()
        bar.box((length, bar_depth, bar_thickness), (0.0, bar_y, bar_z), bevel=bar_thickness * 0.22, segments=3)
        for side in (-1, 1):
            bar.box((0.0045 * k, bar_depth * 1.04, bar_thickness * 1.15), (side * (length / 2 - 0.00225 * k), bar_y, bar_z),
                    bevel=0.0007 * k, material=1)
        bracket = MeshBuilder()
        underside = bar_z - bar_thickness / 2
        drop = max(0.022 * k, thickness * 2.6)
        base_z = underside - drop
        bracket.cylinder(0.0055 * k, 0.003 * k, (0.0, frame.wall_y - 0.0015 * k, base_z), axis='Y', bevel=0.0008 * k, segments=28)
        bracket.cylinder(0.0028 * k, 0.003 * k, (0.0, frame.wall_y - 0.0042 * k, base_z), axis='Y', bevel=0.0006 * k, segments=20)
        rod = rounded_polyline([
            (0.0, frame.wall_y - 0.004 * k, base_z),
            (0.0, bar_y, base_z),
            (0.0, bar_y, underside + 0.0004 * k),
        ], 0.004 * k)
        bracket.tube(rod, 0.0012 * k, sides=10)
        for side in (-1, 1):
            arm = rounded_polyline([
                (side * 0.001 * k, bar_y, base_z + 0.002 * k),
                (side * length * 0.16, bar_y, underside - 0.002 * k),
                (side * length * 0.22, bar_y, underside + 0.0004 * k),
            ], 0.003 * k)
            bracket.tube(arm, 0.0009 * k, sides=8)
        bracket.box((length * 0.46, bar_depth * 0.7, 0.0012 * k), (0.0, bar_y, underside - 0.0006 * k), bevel=0.0004 * k)
        return {
            'root': bracket.to_mesh('MM bracket', [chrome]),
            'parts': [{'role': 'bar', 'mesh': bar.to_mesh('MM bar', [metal, chrome]), 'reactive': True}],
        }
    wood = themes.wood_material()
    bar = MeshBuilder()
    bar.box((length, frame.depth, thickness), (0.0, 0.0, 0.0), bevel=min(thickness, frame.depth) * 0.25)
    peg = MeshBuilder()
    peg.cylinder(0.0028, frame.depth * 0.9, (0.0, frame.wall_y - frame.depth * 0.45, -thickness / 2 - 0.0035), axis='Y', bevel=0.0006)
    return {
        'root': peg.to_mesh('MM peg', [wood]),
        'parts': [{'role': 'bar', 'mesh': bar.to_mesh('MM bar', [themes.flat_material(frame.color, 0.42, 0.3)]), 'reactive': True}],
    }


def rail_spec(frame, piece, theme):
    params = frame.params
    physics_radius = params.get('radius', 0.0025)
    gap = params.get('gap', 0.01)
    radius = min(physics_radius, 0.0016) if theme == 'brass' else physics_radius * 0.8
    if theme == 'brass':
        wire_material, post_material = themes.chrome_material(), themes.chrome_material()
    else:
        wire_material, post_material = themes.flat_material(frame.color, 0.35, 0.4), themes.wood_material()
    builder = MeshBuilder()
    if len(frame.path) >= 2:
        reach = frame.marble_radius + radius
        half = min(gap / 2, reach * 0.95)
        rise = math.sqrt(reach * reach - half * half)
        # Wire centres sit lower than the physics support line so the marble rests between the two wires
        line = frame.offset_path(frame.marble_radius + physics_radius - rise)
        for side in (-1, 1):
            y = frame.marble_y + side * gap / 2
            builder.tube([(x, y, z) for x, z in line], radius, material=0, sides=10)
        for index in post_indices(line):
            x, z = line[index]
            builder.tube([(x, frame.marble_y - gap / 2, z), (x, frame.marble_y + gap / 2, z)], radius * 0.8, material=1, sides=8)
            below = frame.offset_path(frame.marble_radius + physics_radius - rise - 0.006)[index]
            post = rounded_polyline([
                (below[0], frame.wall_y, below[1]),
                (below[0], frame.marble_y, below[1]),
                (x, frame.marble_y, z),
            ], 0.003)
            builder.tube(post, radius * 0.75, material=1, sides=8)
            builder.cylinder(0.004, 0.002, (below[0], frame.wall_y - 0.001, below[1]), axis='Y', material=1, bevel=0.0005)
    else:
        builder.box((0.02, gap, radius * 2), (0.0, frame.marble_y, 0.0))
    return {'root': builder.to_mesh('MM rail', [wire_material, post_material]), 'parts': []}


def post_indices(line, spacing=0.08):
    if not line:
        return []
    indices, travelled, last = [0], 0.0, 0.0
    for index in range(1, len(line)):
        travelled += math.dist(line[index - 1], line[index])
        if travelled - last >= spacing and index < len(line) - 1:
            indices.append(index)
            last = travelled
    if len(line) - 1 not in indices:
        indices.append(len(line) - 1)
    return indices


def tunnel_spec(frame, piece, theme):
    params = frame.params
    support = params.get('radius', 0.002)
    bore = params.get('bore', 0.004)
    radius = frame.marble_radius + bore + support
    if theme == 'brass':
        materials = [themes.frosted_material(), themes.chrome_material()]
    else:
        materials = [themes.flat_material(frame.color, 0.4, 0.2), themes.wood_material()]
    builder = MeshBuilder()
    if len(frame.path) >= 2:
        line = frame.offset_path(frame.marble_radius + support)
        points = [(x, frame.marble_y, z) for x, z in line]
        builder.tube(points, radius, material=0, sides=24, cap=False)
        for end, inner in ((0, 1), (-1, -2)):
            start, toward = Vector(points[end]), Vector(points[inner])
            direction = (toward - start).normalized()
            builder.tube([start - direction * 0.001, start + direction * 0.006], radius * 1.12, material=1, sides=24, cap=False)
    else:
        builder.cylinder(radius, 0.05, (0.0, frame.marble_y, 0.0), axis='X')
    return {'root': builder.to_mesh('MM tunnel', materials), 'parts': []}


def windmill_spec(frame, piece, theme):
    params = frame.params
    count = max(2, round(params.get('bladeCount', 4)))
    blade_length = params.get('bladeLength', 0.06)
    blade_thickness = params.get('bladeThickness', 0.006)
    hub = params.get('hubRadius', 0.008)
    if theme == 'brass':
        materials = [themes.brass_material(), themes.chrome_material()]
    else:
        materials = [themes.flat_material(frame.color, 0.42, 0.3), themes.wood_material()]
    builder = MeshBuilder()
    depth = frame.depth * 0.85
    center_y = frame.wall_y - frame.depth + depth / 2
    builder.cylinder(hub, depth * 1.05, (0.0, center_y, 0.0), axis='Y', material=0, bevel=0.0012, segments=32)
    builder.cylinder(hub * 0.45, frame.depth * 0.3, (0.0, center_y - depth * 0.6, 0.0), axis='Y', material=1, bevel=0.0005)
    builder.cylinder(hub * 0.35, frame.wall_y - center_y, (0.0, (frame.wall_y + center_y) / 2, 0.0), axis='Y', material=1)
    # Blade k points along wall angle 2πk/n from +x, matching the physics rotor
    reach = hub + blade_length / 2
    for index in range(count):
        rotated_blade(builder, reach, blade_length, blade_thickness, depth, center_y, 2 * math.pi * index / count)
    return {'root': builder.to_mesh('MM windmill', materials), 'parts': []}


def rotated_blade(builder, reach, length, thickness, depth, center_y, angle):
    """Adds one bevelled blade turned by `angle` (counter-clockwise on the wall) around the hub"""
    before = set(builder.bm.verts)
    builder.box((length, depth, thickness), (reach, center_y, 0.0), bevel=thickness * 0.3)
    cos, sin = math.cos(angle), math.sin(angle)
    for vertex in builder.bm.verts:
        if vertex in before:
            continue
        x, z = vertex.co.x, vertex.co.z
        vertex.co.x = x * cos - z * sin
        vertex.co.z = x * sin + z * cos


def marble_mesh(marble, theme):
    radius = float(marble['radius'])
    color = marble.get('color') or '#d0d4dc'
    material = themes.glass_marble_material(color) if theme == 'brass' else themes.glossy_marble_material(color)
    builder = MeshBuilder()
    builder.sphere(radius, segments=48, rings=24)
    return builder.to_mesh('MM marble', [material])
