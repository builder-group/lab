"""Built-in skins per element, with hit reactions. A skin carries no theme: `skin_catalog.resolve_look` says which skin
and properties a piece wears, its own or its theme's, and the builders here draw it the same in every theme.

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

from . import skin_catalog, skin_materials, themes
from .geometry import MeshBuilder, rounded_polyline
from .util import DEFAULT_MARBLE_RADIUS, DEFAULT_PIECE_DEPTH, MARBLE_WALL_GAP, OWNER, parse_color

DEFAULT_SKIN = 'default'
REACTION_PATHS = (('location', 2), ('rotation_euler', 1), ('["mm_flash"]', -1))
# Asset reaction parts move through their delta transforms, so their modelled transform stays intact
ASSET_REACTION_PATHS = (
    ('delta_location', 0), ('delta_location', 1), ('delta_location', 2),
    ('delta_rotation_euler', 0), ('delta_rotation_euler', 1), ('delta_rotation_euler', 2), ('["mm_flash"]', -1),
)
VISIBILITY_PATHS = ('hide_render', 'hide_viewport')
# Design reaction presets; anything else keeps the theme's reaction
REACTION_PRESETS = ('none', 'press', 'wobble', 'glow')
DEFAULT_PRESS = 0.0015
DEFAULT_WOBBLE_DEGREES = 8.0
DEFAULT_WOBBLE_HZ = 10.0
DEFAULT_GLOW = 6.0
# A default windmill skin glows briefly when a marble strikes a blade, unless Design picks another reaction
WINDMILL_FLASH = 1.2
# `mm_hit` rises to 1 at a hit and decays as exp(-t / HIT_TAU) to 0 over HIT_DECAY seconds; a wobble recovers
# the time since the hit from the hit value
HIT_DECAY = 0.25
HIT_TAU = HIT_DECAY / 5


def skin_context(theme, marble_radius=DEFAULT_MARBLE_RADIUS, reactions=None, parts=None):
    settings = themes.theme_settings(theme)
    merged = dict(settings['reactions'])
    for name, value in (reactions or {}).items():
        if name in merged and isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value):
            merged[name] = float(value)
    parts = skin_catalog.clean_parts(parts)
    context = {'theme': themes.theme_name(theme), 'marbleRadius': float(marble_radius), 'reactions': merged, 'parts': parts}
    # A project theme's Glow: one colour for every glowing edge instead of each marble's
    if settings.get('glow') is not None:
        context['glow'] = tuple(settings['glow'])
    return context


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
    release_root_flash(skin)
    add_root_flash(skin, holder, spec.get('flash', 0.0))
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
    release_root_flash(obj)
    paths = REACTION_PATHS if obj.get('mm_part') else ASSET_REACTION_PATHS if obj.get('mm_react') else ()
    for path, index in paths:
        try:
            if index >= 0:
                obj.driver_remove(path, index)
            else:
                obj.driver_remove(path)
        except TypeError:
            pass


def add_root_flash(skin, holder, strength):
    """Emission flash of a whole skin from `mm_hit`, for skins without moving parts such as a windmill"""
    if holder is None or not strength:
        return
    skin['mm_flash'] = 0.0
    drive(skin, '["mm_flash"]', -1, holder, '%.4f*h' % strength)
    skin['mm_root_flash'] = True


def release_root_flash(obj):
    if obj.get('mm_root_flash') and obj.animation_data is not None:
        obj.driver_remove('["mm_flash"]')
        obj['mm_flash'] = 0.0
    if 'mm_root_flash' in obj:
        del obj['mm_root_flash']


def piece_reaction(piece, context):
    """Reaction amounts of a piece: the theme's, or the preset its skin's On Hit names.

    `press` (metres along the contact normal) and `dip` (degrees of tilt) for presses, `wobble` (degrees) and
    `frequency` (Hz) for a decaying wobble, `flash` for the emission strength of a glow.
    """
    theme = context['reactions']
    look = piece_look(piece, context)
    preset = look['onHit']
    reaction = {'preset': 'theme', 'press': 0.0, 'dip': 0.0, 'flash': 0.0, 'wobble': 0.0, 'frequency': DEFAULT_WOBBLE_HZ}
    if preset not in REACTION_PRESETS:
        if piece.get('type') == 'windmill':
            reaction.update(flash=WINDMILL_FLASH)
            return reaction
        # A knob's lens lights up on every hit, like the reference's glowing red tops, in any theme
        knob = look['skin'] == 'platform:knob'
        reaction.update(press=theme.get('press', 0.0), dip=theme.get('dip', 0.0),
                        flash=DEFAULT_GLOW if knob else theme.get('flash', 0.0))
        return reaction
    reaction['preset'] = preset
    if preset == 'press':
        reaction.update(press=theme.get('press') or DEFAULT_PRESS, dip=theme.get('dip', 0.0))
    elif preset == 'wobble':
        reaction.update(wobble=DEFAULT_WOBBLE_DEGREES, frequency=DEFAULT_WOBBLE_HZ)
    elif preset == 'glow':
        reaction.update(flash=DEFAULT_GLOW)
    return reaction


def wobble_expression(degrees, frequency):
    """Decaying oscillation in radians: zero at the hit, swinging at `frequency` while `mm_hit` decays"""
    if not degrees:
        return None
    phase = 2 * math.pi * frequency * HIT_TAU
    return '%.6f*h*sin(-%.6f*log(max(h, 0.0001)))' % (math.radians(degrees), phase)


def drive(obj, path, index, holder, expression):
    """Adds a simple-expression driver reading the holder's `mm_hit` as `h`"""
    fcurve = obj.driver_add(path, index) if index >= 0 else obj.driver_add(path)
    driver = fcurve.driver
    driver.type = 'SCRIPTED'
    variable = driver.variables[0] if len(driver.variables) else driver.variables.new()
    variable.name = 'h'
    variable.type = 'SINGLE_PROP'
    variable.targets[0].id_type = 'OBJECT'
    variable.targets[0].id = holder
    variable.targets[0].data_path = '["mm_hit"]'
    driver.expression = expression
    return fcurve


def is_edited(skin):
    """Whether the user changed an app-built skin since the app last wrote it"""
    stored = skin.get('mm_skin_print')
    if skin.get('mm_skin') == DEFAULT_SKIN:
        return skin.type != 'MESH' or (stored is not None and stored != fingerprint(skin))
    from . import assets
    return stored is not None and stored != assets.fingerprint(skin)


def user_offset(skin):
    """Local transform the user gave a skin root; skins are built with an identity root"""
    return (tuple(skin.location), tuple(skin.rotation_euler), tuple(skin.scale))


def apply_offset(skin, offset):
    if offset is None:
        return
    skin.location, skin.rotation_euler, skin.scale = offset


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
        # The body follows the Wall colour of a project theme, so a wall edit rebuilds the marble
        look = marble_look(entity, context)
        values = ['marble', context['theme'], round(float(entity['radius']), 6), entity.get('color'),
                  themes.marble_look(context['theme'], entity.get('color') or '#d0d4dc')['body'],
                  look['skin'], look['colour'], look['glowColor'], look['variant']]
    else:
        frame = PieceFrame(entity, context)
        values = [
            'piece', context['theme'], entity.get('type', 'platform'), entity.get('color'),
            sorted((name, round(float(value), 6)) for name, value in (entity.get('params') or {}).items()),
            round(frame.wall_offset, 6), round(context['marbleRadius'], 6),
            [[round(value, 5) for value in point] for point in frame.local_path()],
            [[[round(value, 5) for value in point] for point in wire] for wire in frame.local_wires()],
            math.copysign(1.0, frame.angle), sorted(piece_reaction(entity, context).items()), frame.skin,
            None if frame.note_pitch is None else int(round(frame.note_pitch)) % 12,
            frame.look['colour'], frame.look['glowColor'], frame.look['variant'],
        ]
        # Only set properties join the key, so skins built before they existed stay current
        if frame.look['properties']:
            values.append(sorted(frame.look['properties'].items()))
        # Only a set Glow joins the key, so skins built before project themes stay current
        if context.get('glow') is not None and frame.glows_as_neon:
            values.append(['glow', [round(value, 5) for value in context['glow']]])
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
    add_root_flash(skin, holder, spec.get('flash', 0.0))
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
        add_reaction(part, holder, float(entity.get('angle', 0.0)), piece_reaction(entity, context))
    return part


def add_reaction(part, holder, angle, reaction):
    """Bar reaction from `mm_hit`: a press along -z with a tilt around the bracket, a decaying wobble in the wall
    plane, or an emission flash. Every motion springs back as `mm_hit` decays; preset `none` adds no drivers."""
    if reaction.get('preset') == 'none':
        return
    tilt = math.radians(reaction.get('dip', 0.0)) * (-1.0 if angle >= 0 else 1.0)
    rotation = ['%.6f*h' % tilt]
    wobble = wobble_expression(reaction.get('wobble', 0.0), reaction.get('frequency', DEFAULT_WOBBLE_HZ))
    if wobble:
        rotation.append(wobble)
    expressions = ('-%.6f*h' % reaction.get('press', 0.0), ' + '.join(rotation), '%.4f*h' % reaction.get('flash', 0.0))
    for (path, index), expression in zip(REACTION_PATHS, expressions):
        drive(part, path, index, holder, expression)


def build_spec(kind, entity, context):
    if kind == 'marble':
        return {'root': marble_mesh(entity, context), 'parts': []}
    piece_type = entity.get('type', 'platform')
    frame = PieceFrame(entity, context)
    builder = {'rail': rail_spec, 'tunnel': tunnel_spec, 'windmill': windmill_spec,
               'bowl': bowl_spec}.get(piece_type, platform_spec)
    spec = builder(frame, entity)
    meshes = [spec['root'], *(part['mesh'] for part in spec['parts'])]
    reaction = piece_reaction(entity, context)
    # On Hit: Glow on a piece without a moving part flashes the whole skin, like a windmill
    if reaction['preset'] == 'glow' and not spec['parts']:
        spec['flash'] = reaction['flash']
        _swap_materials(meshes, skin_materials.flash_ready)
    glow = frame.look['glowColor']
    if glow:
        _swap_materials(meshes, lambda material: skin_materials.glow_tinted(material, glow))
    return spec


def _swap_materials(meshes, swap):
    for mesh in meshes:
        for index, material in enumerate(mesh.materials):
            mesh.materials[index] = swap(material)


def piece_look(piece, context):
    return skin_catalog.resolve_look(context['theme'], context.get('parts'), piece.get('type', 'platform'), piece.get('skin'))


def marble_look(marble, context):
    return skin_catalog.resolve_look(context['theme'], context.get('parts'), 'marble', marble.get('skin'))


# Platform skins: plain bars in a finish, and devices. `device` is a chrome housing with a grille and a dome between end
# blocks in a bar finish (`device-copper` starts with copper, Variant picks another), `key` a dark housing with a white
# key that presses, `knob` a dark housing with a red lens that glows on every hit.
BAR_FINISHES = ('gold', 'silver', 'copper', 'dark')
DEVICES = ('device', 'key', 'knob')
KNOB_GLOW = (0.9, 0.02, 0.012)
# Colour: Skin on a glowing skin, which has no marble to take its colour from
GLOW_SKIN_COLOR = '#39c8ff'


def device_parts(skin):
    """(device, trim finish) of a platform skin's name; a plain bar has no device"""
    device, _, trim = skin.partition('-')
    if device not in DEVICES:
        return None, skin
    return device, trim or 'gold'


class PieceFrame:
    """Dimensions of a piece in its holder's local frame"""

    def __init__(self, piece, context):
        self.params = {name: float(value) for name, value in (piece.get('params') or {}).items()}
        self.depth = self.params.get('depth', DEFAULT_PIECE_DEPTH)
        self.wall_offset = float(piece.get('wallOffset', 0.0))
        self.wall_y = self.wall_offset + self.depth / 2
        self.context = context
        self.marble_radius = context['marbleRadius']
        self.marble_y = self.wall_y - (self.marble_radius + MARBLE_WALL_GAP)
        self.angle = float(piece.get('angle', 0.0))
        position = piece.get('position') or {'x': 0.0, 'y': 0.0}
        self.origin = (float(position['x']), float(position['y']))
        self.path = [(float(point['x']), float(point['y'])) for point in (piece.get('path') or [])]
        # A Rail's several paths, top first
        self.wires = [[(float(point['x']), float(point['y'])) for point in wire] for wire in (piece.get('paths') or [])]
        self.color = piece.get('color') or '#c8b89a'
        self.look = piece_look(piece, context)
        self.piece_id = str(piece.get('id') or '')
        self.skin = self.look['skin']
        self.style = self.skin.split(':', 1)[1]
        self.glows_as_neon = self.style in ('neon', 'glow')
        self.colour = self.look['colour']
        # Colour: By Note: a platform that plays a note takes its pitch class colour; without a note it takes its marble's
        pitch = piece.get('notePitch')
        self.note_pitch = float(pitch) if self.colour == 'note' and isinstance(pitch, (int, float)) else None
        self.device, self.trim = device_parts(self.style)
        if self.device == 'device' and self.look['variant'] in BAR_FINISHES:
            self.trim = self.look['variant']

    def metal(self, fallback):
        """Material of a skin's metal: its own with Colour: Skin, its note's or a metal in the marble's colour otherwise"""
        if self.note_pitch is not None:
            return themes.note_material(self.note_pitch)
        return skin_materials.tinted_metal_material(self.color) if self.colour != 'skin' else fallback

    def toy(self, roughness=0.35, coat=0.4):
        """Material of a painted toy part: its note's or its marble's colour, or bare wood with Colour: Skin"""
        if self.note_pitch is not None:
            return themes.note_material(self.note_pitch)
        return themes.wood_material() if self.colour == 'skin' else themes.flat_material(self.color, roughness, coat)

    def wrap(self, own):
        """Material of a Gift's paper: `own` with Colour: Skin, its note's or its marble's colour otherwise"""
        if self.note_pitch is not None:
            return themes.note_material(self.note_pitch)
        return skin_materials.paper_material(own if self.colour == 'skin' else self.color)

    def pick(self, choices, salt=''):
        """One of `choices` for this piece, the same on every apply"""
        digest = hashlib.sha1((self.piece_id + salt).encode()).digest()
        return choices[digest[0] % len(choices)]

    def ribbon(self, own=None):
        """Ribbon Colour: the piece's own, or the skin's, which `own` gives when it goes with the paper"""
        color = self.look['properties'].get('Ribbon Colour')
        valid = isinstance(color, str) and len(color) == 7 and color.startswith('#')
        return skin_materials.paper_material(color if valid else own or RIBBON_COLOR, 0.24, 0.7)

    def to_local(self, point):
        dx, dy = point[0] - self.origin[0], point[1] - self.origin[1]
        cos, sin = math.cos(self.angle), math.sin(self.angle)
        return dx * cos + dy * sin, -dx * sin + dy * cos

    def local_path(self):
        return [self.to_local(point) for point in self.path]

    def local_wires(self):
        return [[self.to_local(point) for point in wire] for wire in self.wires]

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


RIBBON_COLOR = '#d9a520'
# Gift: a colour of its own per piece, so a run of them reads as a pile of presents
# (paper, ribbon)
GIFT_PAPERS = (('#a01522', RIBBON_COLOR), ('#14603a', RIBBON_COLOR), ('#ece4d2', '#a81a26'), ('#a01522', RIBBON_COLOR), ('#14603a', '#ece4d2'))
# The furthest a built-in platform skin stands out of the wall, in marble radii
SKIN_OUT_RADII = 3.5
# Height of a Gift at the 16 mm marble of the Marble Race Kit: its top face is the contact surface
PRESENT_HEIGHT = 0.017


def present_box(frame, length, thickness):
    """(depth, y of the middle, top, bottom) of a box that stands on the wall and whose top face is the collider's"""
    k = frame.marble_radius / 0.008
    depth = min(max(frame.depth, 2.2 * frame.marble_radius + 0.004 * k), 3.0 * frame.marble_radius)
    top = thickness / 2
    return depth, frame.wall_y - 0.0004 - depth / 2, top, top - max(thickness * 1.15, PRESENT_HEIGHT * k)


def add_bow(builder, center, k, material):
    """A ribbon bow on a box's front face, below the top so the marble's surface stays clear: two loops, a knot, two tails"""
    x, y, z = center
    for side in (-1, 1):
        loop = []
        for step in range(11):
            angle = 2 * math.pi * step / 10
            reach = 0.5 - 0.5 * math.cos(angle)
            loop.append((x + side * 0.0088 * k * reach, y - 0.0024 * k * reach, z + 0.0034 * k * math.sin(angle) + 0.0008 * k * reach))
        builder.tube(loop, 0.0011 * k, material=material, sides=6)
        builder.tube([(x, y, z), (x + side * 0.0028 * k, y - 0.0006 * k, z - 0.0034 * k), (x + side * 0.0052 * k, y - 0.0004 * k, z - 0.0058 * k)],
                     0.0009 * k, material=material, sides=6)
    builder.sphere(0.002 * k, (x, y - 0.0004 * k, z), material=material, segments=10, rings=6)


def wall_cleat(frame, length, bottom, k):
    """What holds a box to the wall: hidden behind it, so the box's parts alone press on a hit"""
    cleat = MeshBuilder()
    cleat.box((length * 0.3, 0.002 * k, 0.003 * k), (0.0, frame.wall_y - 0.001 * k, bottom + 0.004 * k))
    return cleat.to_mesh('MM cleat', [themes.plastic_material('cleat', (0.2, 0.2, 0.2), 0.6)])


def gift_spec(frame, length, thickness):
    """A wrapped box with a ribbon round it both ways and a bow on its front face. The ribbon's top is the contact
    surface and nothing reaches above it."""
    k = frame.marble_radius / 0.008
    depth, y, top, bottom = present_box(frame, length, thickness)
    height = top - bottom
    middle = (top + bottom) / 2
    proud = 0.00025 * k
    band = min(max(length * 0.075, 0.003 * k), 0.0055 * k)
    box = MeshBuilder()
    # The paper's top lies a hair under the ribbon's, which is the contact surface
    box.box((length, depth, height - proud), (0.0, y, middle - proud / 2), bevel=0.0009 * k, segments=2)
    box.box((band, depth + proud * 2, height), (0.0, y, middle), bevel=0.0003 * k, segments=1, material=1)
    box.box((length + proud * 2, band, height), (0.0, y, middle), bevel=0.0003 * k, segments=1, material=1)
    front = y - depth / 2 - proud
    add_bow(box, (0.0, front - 0.0002 * k, top - 0.0056 * k), k, 1)
    paper, ribbon = frame.pick(GIFT_PAPERS)
    paper = frame.wrap(paper)
    return {
        'root': wall_cleat(frame, length, bottom, k),
        'parts': [{'role': 'bar', 'mesh': box.to_mesh('MM gift', [paper, frame.ribbon(ribbon)]), 'reactive': True}],
    }


def plain_bar_depth(frame):
    """How far a Pegboard or Neon bar stands out of the wall. Like the device and bar skins it stops at SKIN_OUT_RADII
    marble radii, so the default 9 cm depth gives a bar rather than a square tile; `SKIN_OUT_RADII` in track-look.ts"""
    return min(frame.depth, SKIN_OUT_RADII * frame.marble_radius)


def platform_spec(frame, piece):
    params = frame.params
    length = params.get('length', 0.06)
    thickness = params.get('thickness', 0.008)
    if frame.device is not None:
        return device_spec(frame, length, thickness)
    if frame.style == 'gift':
        return gift_spec(frame, length, thickness)
    if frame.style in BAR_FINISHES:
        chrome = themes.chrome_material()
        metal = frame.metal(themes.bar_material(frame.style))
        # Bracket parts scale with the kit, measured against the 16 mm marble of the Marble Race Kit
        k = frame.marble_radius / 0.008
        standoff = 0.0025 * k
        bar_depth = min(max(frame.depth * 0.72, 1.7 * frame.marble_radius), 3.2 * frame.marble_radius)
        bar_y = frame.wall_y - standoff - bar_depth / 2
        # The top face is the collider's contact surface; the bar reaches a little below the collider so it reads
        # as a solid ingot like the reference
        bar_thickness = thickness * 1.15
        bar_z = thickness / 2 - bar_thickness / 2
        bar = MeshBuilder()
        bar.box((length, bar_depth, bar_thickness), (0.0, bar_y, bar_z), bevel=bar_thickness * 0.22, segments=3)
        for side in (-1, 1):
            # End caps are flush with the contact surface and reach a little further down and out
            bar.box((0.0045 * k, bar_depth * 1.04, bar_thickness * 1.15),
                    (side * (length / 2 - 0.00225 * k), bar_y, bar_z - bar_thickness * 0.075), bevel=0.0007 * k, material=1)
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
    if frame.style == 'neon':
        return neon_platform_spec(frame, length, thickness)
    wood = themes.wood_material()
    bar = MeshBuilder()
    depth = plain_bar_depth(frame)
    bar.box((length, depth, thickness), (0.0, frame.wall_y - depth / 2, 0.0), bevel=min(thickness, depth) * 0.25)
    peg = MeshBuilder()
    peg.cylinder(0.0028, depth * 0.9, (0.0, frame.wall_y - depth * 0.45, -thickness / 2 - 0.0035), axis='Y', bevel=0.0006)
    return {
        'root': peg.to_mesh('MM peg', [wood]),
        'parts': [{'role': 'bar', 'mesh': bar.to_mesh('MM bar', [frame.toy(0.42, 0.3)]), 'reactive': True}],
    }


def neon_platform_spec(frame, length, thickness):
    """Neon platform: a glossy deep-coloured bar whose rounded edges are a glowing outline, on a dark peg. The
    outline is the bar's own bevel, so the top face stays the collider's contact surface."""
    body, trim = neon_colors(frame)
    bar = MeshBuilder()
    depth = plain_bar_depth(frame)
    bar.box((length, depth, thickness), (0.0, frame.wall_y - depth / 2, 0.0), bevel=min(thickness, depth) * NEON_EDGE_SHARE, material=0)
    for face in bar.bm.faces:
        face.normal_update()
        # Flat faces point along an axis; the bevel's faces between them light up
        if max(abs(value) for value in face.normal) < 0.98:
            face.material_index = 1
    peg = MeshBuilder()
    peg.cylinder(0.0028, depth * 0.9, (0.0, frame.wall_y - depth * 0.45, -thickness / 2 - 0.0035), axis='Y', bevel=0.0006)
    return {
        'root': peg.to_mesh('MM peg', [themes.neon_mount_material()]),
        'parts': [{'role': 'bar', 'mesh': bar.to_mesh('MM bar', [themes.neon_body_material(body), themes.neon_trim_material(trim)]),
                   'reactive': True}],
    }


# Width of a Neon platform's glowing edge as a share of the bar's thickness
NEON_EDGE_SHARE = 0.3


def neon_colors(frame):
    """(body, trim) linear colours of a glowing piece: its note's colour with Colour: By Note, its marble's with Colour:
    Marble, the skin's own with Colour: Skin, all pushed to full saturation; the trim is the brighter one"""
    source = themes.note_color(frame.note_pitch) if frame.note_pitch is not None else GLOW_SKIN_COLOR if frame.colour == 'skin' else frame.color
    glow = frame.context.get('glow')
    return themes.neon_color(source, 0.16), tuple(glow) if glow is not None else themes.neon_color(source, 1.0)


def device_spec(frame, length, thickness):
    """Brass device skins on a short wall stub. The top face is the collider's contact surface; the housing reaches
    below the collider like a solid block. Seen from the follow camera the top and the face away from the wall show,
    so the detail sits there."""
    k = frame.marble_radius / 0.008
    standoff = 0.002 * k
    depth = min(max(frame.depth * 0.8, 2.0 * frame.marble_radius), 3.2 * frame.marble_radius)
    back = frame.wall_y - standoff
    front = back - depth
    middle = (front + back) / 2
    top = thickness / 2
    stub = MeshBuilder()
    stub.cylinder(0.005 * k, 0.0025 * k, (0.0, frame.wall_y - 0.00125 * k, top - thickness), axis='Y', bevel=0.0006 * k, segments=24)
    stub.cylinder(0.0022 * k, standoff + 0.002 * k, (0.0, back - 0.001 * k + standoff / 2, top - thickness), axis='Y', segments=16)
    root = stub.to_mesh('MM stub', [themes.chrome_material()])
    body = MeshBuilder()
    if frame.device == 'device':
        # Harmonica-like: chrome housing, a row of grille slots on the front, a dome and end blocks in the trim finish
        height = thickness * 1.9
        end = min(0.012 * k, length * 0.16)
        body.box((length - 2 * end + 0.001 * k, depth * 0.94, height * 0.9), (0.0, middle, top - height * 0.45 - 0.0004 * k),
                 bevel=0.0012 * k, material=0)
        for side in (-1, 1):
            body.box((end, depth, height), (side * (length / 2 - end / 2), middle, top - height / 2), bevel=0.0022 * k,
                     material=1, segments=4)
        slots = 7
        span = (length - 2 * end) * 0.74
        for index in range(slots):
            x = -span / 2 + span * index / (slots - 1) - (length - 2 * end) * 0.06
            body.box((span / slots * 0.55, 0.0012 * k, height * 0.42), (x, front + 0.0004 * k, top - height * 0.52),
                     bevel=0.0003 * k, material=2)
        body.sphere(height * 0.3, (span / 2 + (length - 2 * end) * 0.02, front + 0.0006 * k, top - height * 0.5), material=0,
                    segments=24, rings=12)
        trim = frame.metal(themes.bar_material(frame.trim))
        materials = [themes.bar_material('silver'), trim, themes.slot_material()]
    elif frame.device == 'key':
        # Dark housing with a white key that runs over the top and down the front
        height = thickness * 2.0
        body.box((length, depth, height), (0.0, middle, top - 0.0012 * k - height / 2), bevel=0.0018 * k, material=0, segments=4)
        key_front = front - 0.0008 * k
        key_back = min(back - 0.002 * k, frame.marble_y + frame.marble_radius * 1.1)
        key_height = height * 0.42
        body.box((length * 0.66, key_back - key_front, key_height), (length * 0.06, (key_front + key_back) / 2, top - key_height / 2),
                 bevel=0.0009 * k, material=1, segments=3)
        key = frame.metal(themes.key_material())
        materials = [themes.housing_material(), key]
    else:
        # Dark knob housing with a red lens at its outer end
        height = thickness * 1.7
        body.box((length, depth, height), (0.0, middle, top - height / 2), bevel=0.0026 * k, material=0, segments=4)
        lens = min(length * 0.34, 0.016 * k)
        side = -1.0 if frame.angle >= 0 else 1.0
        body.box((lens, 0.0024 * k, height * 0.56), (side * (length / 2 - lens / 2 - 0.003 * k), front - 0.0004 * k, top - height / 2),
                 bevel=min(0.0011 * k, height * 0.25), material=1, segments=4)
        glow = themes.note_color(frame.note_pitch) if frame.note_pitch is not None else KNOB_GLOW if frame.colour == 'skin' else parse_color(frame.color)[:3]
        materials = [themes.housing_material(), themes.glow_material(glow)]
    return {'root': root, 'parts': [{'role': 'bar', 'mesh': body.to_mesh('MM ' + frame.device, materials), 'reactive': True}]}


# Colour: Skin of a Candy Rail
CANDY_COLOR = '#c8202c'


def rail_spec(frame, piece):
    if frame.wires:
        return rail_paths_spec(frame)
    params = frame.params
    physics_radius = params.get('radius', 0.0025)
    gap = params.get('gap', 0.01)
    radius = min(physics_radius, 0.0016) if frame.style == 'chrome' else physics_radius * 0.8
    if frame.style == 'chrome':
        wire_material, post_material = frame.metal(themes.chrome_material()), themes.chrome_material()
    elif frame.style == 'candy':
        wire_material = skin_materials.candy_material(CANDY_COLOR if frame.colour == 'skin' else frame.color)
        post_material = themes.chrome_material()
    elif frame.style == 'glow':
        # Glow rails are tube lights; dimmer than a platform's trim since they run long
        wire_material, post_material = themes.neon_trim_material(neon_colors(frame)[1], 1.6), themes.neon_mount_material()
    else:
        wire_material, post_material = frame.toy(), themes.wood_material()
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
            wall_ball(builder, frame, below[0], below[1], radius)
    else:
        builder.box((0.02, gap, radius * 2), (0.0, frame.marble_y, 0.0))
    return {'root': builder.to_mesh('MM rail', [wire_material, post_material]), 'parts': []}


def wall_ball(builder, frame, x, z, radius, material=1):
    """The ball a rail's post ends in where it meets the wall, as on the reference shorts' wire tracks"""
    ball = max(radius * 1.9, 0.0028)
    builder.sphere(ball, (x, frame.wall_y - ball * 0.55, z), material=material, segments=14, rings=8)


def rail_paths_spec(frame):
    """A Rail with several paths, in the same skins as one path. A path with a Switchback layout is one bent wire per
    leg (its wall, a rounded bend, the leg), then a short exit stop; each is a capsule of `radius` around its polyline
    that the marble rolls along and through the bends.

    Chrome draws every wire as a pair of thin chrome wires like the rails, one on each side of the marble's plane and
    set back toward the wire's far side so the marble touches both where it touches the capsule, with ties at the
    ends and posts to the wall at the ends and the bend. Wood draws each wire as one toy-coloured rod on the
    capsule line with wooden pegs to the wall at the same places, Glow as a tube light on dark posts."""
    wires = [wire for wire in frame.local_wires() if len(wire) >= 2]
    physics_radius = frame.params.get('radius', 0.0025)
    k = frame.marble_radius / 0.008
    builder = MeshBuilder()
    if not wires:
        builder.box((0.02, 0.01, 0.004), (0.0, frame.marble_y, 0.0))
        return {'root': builder.to_mesh('MM rail', [themes.chrome_material()]), 'parts': []}
    points = [point for wire in wires for point in wire]
    centre = (sum(x for x, _ in points) / len(points), sum(z for _, z in points) / len(points))
    if frame.style != 'chrome':
        for wire in wires:
            builder.tube([(x, frame.marble_y, z) for x, z in wire], physics_radius * 0.9, material=0, sides=12)
            for x, z in (wire[index] for index in wire_post_indices(wire)):
                builder.cylinder(0.0028, frame.wall_y - frame.marble_y, (x, (frame.wall_y + frame.marble_y) / 2, z), axis='Y',
                                 material=1)
        if frame.style == 'glow':
            materials = [themes.neon_trim_material(neon_colors(frame)[1], 1.6), themes.neon_mount_material()]
        elif frame.style == 'candy':
            materials = [skin_materials.candy_material(CANDY_COLOR if frame.colour == 'skin' else frame.color), themes.chrome_material()]
        else:
            materials = [frame.toy(), themes.wood_material()]
        return {'root': builder.to_mesh('MM rail', materials), 'parts': []}
    # Thicker than a single path's wires: several paths are seen from further away and their short legs must still read
    radius = min(physics_radius, 0.0022 * k)
    gap = frame.params.get('gap', 1.25 * frame.marble_radius)
    reach = frame.marble_radius + radius
    half = min(gap / 2, reach * 0.95)
    # Wire centres sit back from the capsule line so the marble rests on both wires where it would touch the capsule
    setback = frame.marble_radius + physics_radius - math.sqrt(reach * reach - half * half)
    for wire in wires:
        line = offset_wire(wire, -setback * marble_side(wire, centre))
        for side in (-1, 1):
            builder.tube([(x, frame.marble_y + side * half, z) for x, z in line], radius, material=0, sides=10)
        for index in wire_post_indices(line):
            x, z = line[index]
            if index in (0, len(line) - 1):
                builder.tube([(x, frame.marble_y - half, z), (x, frame.marble_y + half, z)], radius * 0.8, material=0, sides=8)
            builder.tube([(x, frame.marble_y + half, z), (x, frame.wall_y, z)], radius * 0.75, material=0, sides=8)
            wall_ball(builder, frame, x, z, radius, material=0)
    return {'root': builder.to_mesh('MM rail', [frame.metal(themes.chrome_material())]), 'parts': []}


def bowl_spec(frame, piece):
    """Bowl: the curved wire the marble lands in and settles in (`paths[0]`), a wire cradle like the reference short's
    catcher: two wires under the marble's path, one on each side of the marble's plane and set back so the marble rests
    on both where it touches the capsule, tied across every 2.5 cm and held by posts that end in a ball at the wall.
    Chrome and Wood draw clear chrome wires; Wood's posts are wooden pegs. Glow draws the wires as glowing tube edges on
    dark posts. Colour: By Note never applies: a Bowl plays no note."""
    wires = [wire for wire in frame.local_wires() if len(wire) >= 2]
    physics_radius = frame.params.get('radius', 0.0025)
    k = frame.marble_radius / 0.008
    builder = MeshBuilder()
    if not wires:
        builder.box((0.02, 0.01, 0.004), (0.0, frame.marble_y, 0.0))
        return {'root': builder.to_mesh('MM bowl', [themes.chrome_material()]), 'parts': []}
    if frame.style == 'glow':
        # Brighter than a rail's trim: the Bowl is the film's last image
        materials = [themes.neon_trim_material(neon_colors(frame)[1], 2.4), themes.neon_mount_material()]
    else:
        materials = [frame.metal(themes.chrome_material()), themes.chrome_material() if frame.style == 'chrome' else themes.wood_material()]
    radius = min(physics_radius, 0.0018 * k)
    gap = 1.25 * frame.marble_radius
    reach = frame.marble_radius + radius
    half = min(gap / 2, reach * 0.95)
    setback = frame.marble_radius + physics_radius - math.sqrt(reach * reach - half * half)
    for wire in wires:
        # The wire turns toward the marble
        under = offset_wire(wire, -setback * marble_side(wire, wire[0]))
        for offset in (-half, half):
            builder.tube([(x, frame.marble_y + offset, z) for x, z in under], radius, material=0, sides=10)
        for tie in post_indices(under, 0.025 * k):
            x, z = under[tie]
            builder.tube([(x, frame.marble_y - half, z), (x, frame.marble_y + half, z)], radius * 0.7, material=0, sides=8)
        for post in post_indices(under, 0.08 * k):
            x, z = under[post]
            builder.tube([(x, frame.marble_y + half, z), (x, frame.wall_y, z)], radius * 0.75, material=1, sides=8)
            wall_ball(builder, frame, x, z, radius)
    return {'root': builder.to_mesh('MM bowl', materials), 'parts': []}


def marble_side(wire, centre):
    """+1 when the marble rides on the left of the wire's direction, -1 on the right.

    A bent wire turns toward the marble: it rolls inside the bend, above the leg and inside the wall. A straight
    wire, such as the exit stop, faces the middle of the rail."""
    turn = 0.0
    for (ax, az), (bx, bz), (cx, cz) in zip(wire, wire[1:], wire[2:]):
        turn += (bx - ax) * (cz - bz) - (bz - az) * (cx - bx)
    if abs(turn) > 1e-9:
        return 1.0 if turn > 0 else -1.0
    (ax, az), (bx, bz) = wire[0], wire[-1]
    left = (-(bz - az), bx - ax)
    return 1.0 if (centre[0] - (ax + bx) / 2) * left[0] + (centre[1] - (az + bz) / 2) * left[1] >= 0 else -1.0


def offset_wire(wire, distance):
    """Polyline moved `distance` to the left of its direction, keeping that distance through corners and bends"""
    result = []
    for index, (x, z) in enumerate(wire):
        normals = []
        for a, b in ((index - 1, index), (index, index + 1)):
            if a < 0 or b >= len(wire):
                continue
            (ax, az), (bx, bz) = wire[a], wire[b]
            length = math.hypot(bx - ax, bz - az)
            if length > 1e-9:
                normals.append((-(bz - az) / length, (bx - ax) / length))
        if not normals:
            result.append((x, z))
            continue
        nx, nz = sum(n[0] for n in normals), sum(n[1] for n in normals)
        size = math.hypot(nx, nz) or 1.0
        nx, nz = nx / size, nz / size
        # Scale by 1 / cos(half the turn) so the offset line stays parallel to both segments at a corner
        cos_half = max(0.2, nx * normals[0][0] + nz * normals[0][1])
        result.append((x + nx * distance / cos_half, z + nz * distance / cos_half))
    return result


def wire_post_indices(wire):
    """Ends of a wire, plus the middle of its bend where the wire turns, so posts carry the wall, bend and leg"""
    indices = [0, len(wire) - 1]
    turning = []
    for index in range(1, len(wire) - 1):
        (ax, az), (bx, bz), (cx, cz) = wire[index - 1], wire[index], wire[index + 1]
        first, second = math.atan2(bz - az, bx - ax), math.atan2(cz - bz, cx - bx)
        if abs(math.remainder(second - first, 2 * math.pi)) > 1e-3:
            turning.append(index)
    if turning:
        indices.insert(1, turning[len(turning) // 2])
    return indices


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


def tunnel_spec(frame, piece):
    params = frame.params
    support = params.get('radius', 0.002)
    bore = params.get('bore', 0.004)
    radius = frame.marble_radius + bore + support
    if frame.style == 'frosted':
        materials = [frame.metal(themes.frosted_material()), themes.chrome_material()]
    elif frame.style == 'glow':
        # A glossy tinted tube with glowing rings at its mouths
        body, trim = neon_colors(frame)
        materials = [themes.neon_body_material(body), themes.neon_trim_material(trim)]
    else:
        materials = [frame.toy(0.4, 0.2), themes.wood_material()]
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


def windmill_spec(frame, piece):
    params = frame.params
    count = max(2, round(params.get('bladeCount', 4)))
    blade_length = params.get('bladeLength', 0.06)
    blade_thickness = params.get('bladeThickness', 0.006)
    hub = params.get('hubRadius', 0.008)
    if frame.style == 'gold':
        materials = [frame.metal(themes.brass_material()), themes.chrome_material()]
    elif frame.style == 'glow':
        # Material 0 is the hub and blades, 1 the axle: saturated blades on a glowing axle cap
        body, trim = neon_colors(frame)
        materials = [themes.neon_body_material(body), themes.neon_trim_material(trim)]
    else:
        materials = [frame.toy(0.42, 0.3), themes.wood_material()]
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
    # A windmill has no moving parts of its own: its holder turns, and a strike flashes the whole skin
    reaction = piece_reaction(piece, frame.context)
    flash = reaction['flash'] if reaction['preset'] in ('theme', 'glow') else 0.0
    return {'root': builder.to_mesh('MM windmill', materials), 'parts': [], 'flash': flash}


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


def marble_mesh(marble, context):
    """A marble in its skin. The theme's default keeps a body colour that stays apart from its wall and pieces
    (`themes.marble_look`): Neon's pearl marble with a glowing rim, Brass's glass core, Pegboard's gloss. Physics never
    reads any of this: the sphere has the marble's radius in every skin."""
    theme = context['theme']
    look = marble_look(marble, context)
    radius = float(marble['radius'])
    color = marble.get('color') or '#d0d4dc'
    skin = look['skin']
    if skin == 'marble:glass':
        material = skin_materials.glass_marble_material(skin_materials.GLASS_SKIN if look['colour'] == 'skin' else color, look['variant'])
    elif skin == 'marble:glass-green':
        material = skin_materials.glass_marble_material(skin_materials.GLASS_GREEN_SKIN if look['colour'] == 'skin' else color, look['variant'], skin_materials.GLASS_GREEN_VANES)
    elif skin == 'marble:metal':
        material = skin_materials.metal_marble_material(color if look['colour'] == 'marble' else None)
    elif skin == 'marble:magic':
        material = skin_materials.magic_marble_material(skin_materials.MAGIC_SKIN if look['colour'] == 'skin' else color, look['glowColor'])
    elif skin == 'marble:pearl':
        material = themes.neon_marble_material('#d0d4dc' if look['colour'] == 'skin' else color)
    elif skin == 'marble:deep':
        material = themes.glossy_marble_material(themes.deep_color(color))
    else:
        tone = themes.marble_look(theme, color)
        if theme == 'neon' and tone['tone'] == 'pearl':
            material = themes.neon_marble_material(color)
        elif theme == 'brass':
            material = themes.glass_marble_material(tone['body'])
        else:
            material = themes.glossy_marble_material(tone['body'])
    builder = MeshBuilder()
    builder.sphere(radius, segments=48, rings=24)
    return builder.to_mesh('MM marble', [material])
