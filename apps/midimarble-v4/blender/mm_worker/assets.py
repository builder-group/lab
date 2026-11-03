"""Library skins: `assets/<id>/asset.blend` models placed on piece holders.

An asset holds one collection `MM_ASSET`. Its origin is the centre of the contact surface and +Z points away from
the contact face. Optional reaction parts are objects named `MM_REACT_<Name>` with `mm_reaction` = `press`,
`wobble` or `glow`.

Appended, not linked: the worker appends `MM_ASSET` once per asset file into a template collection that is not
in the scene (`MM asset · <path>`, kept with a fake user) and packs its images. Skins are object copies of the
template that share its meshes and materials. The scene file then carries everything it renders, so packages can
move and film jobs, which render a saved copy of the scene, need no library paths. The template is reloaded when
the file's size or modification time changes, which rebuilds the skins that use it.

Skin layout under a piece holder:

    <holder>
      <name> skin            EMPTY, `mm_skin = 'asset'`; its local transform is the user's offset
        <name> asset frame   EMPTY, places the asset frame on the piece's contact surface and scales it
          copies of the MM_ASSET objects, hierarchy kept

Ownership follows default skins: `mm_skin_print` fingerprints the skin as the app built it (everything below the
root, so the root offset stays the user's). An edited asset skin belongs to the user and is never touched.
"""
import hashlib
import json
import math

import bpy
from mathutils import Matrix, Vector

from . import skins
from .util import OWNER, WorkerError, descendants, resolve_package_path

ASSET_COLLECTION = 'MM_ASSET'
ASSET_SKIN = 'asset'
TEMPLATE_PREFIX = 'MM asset · '
REACT_PREFIX = 'MM_REACT_'
REACTION_KINDS = ('press', 'wobble', 'glow')
# Fitted scale stays within this factor of the asset's own size, so a wrong manifest cannot blow it up
MAX_FIT_SCALE = 4.0


def layout(piece_type):
    """Contact layout of a piece type, matching the agent brief: `box`, `path`, `tube` or `rotor`"""
    return {'rail': 'path', 'tunnel': 'tube', 'windmill': 'rotor'}.get(piece_type, 'box')


# Templates


def load_asset(project_dir, relative, cache):
    """Template collection and manifest of a package-relative asset, loaded once per apply.

    Returns `(template, manifest, None)` or `(None, None, reason)` with reason `missingAsset` or `invalidAsset`.
    """
    if relative in cache:
        return cache[relative]
    try:
        path = resolve_package_path(project_dir, relative)
    except WorkerError:
        cache[relative] = (None, None, 'invalidAsset')
        return cache[relative]
    if not path.is_file():
        cache[relative] = (None, None, 'missingAsset')
        return cache[relative]
    stat = path.stat()
    stamp = '%d:%d' % (stat.st_mtime_ns, stat.st_size)
    name = TEMPLATE_PREFIX + relative
    template = bpy.data.collections.get(name)
    if template is None or template.get('mm_asset_stamp') != stamp:
        loaded = append_collection(path)
        if loaded is None:
            cache[relative] = (None, None, 'invalidAsset')
            return cache[relative]
        if template is not None:
            remove_template(template)
        loaded.name = name
        loaded.use_fake_user = True
        loaded['mm_asset_stamp'] = stamp
        loaded['mm_asset_path'] = relative
        loaded[OWNER] = True
        pack_images(loaded)
        template = loaded
    cache[relative] = (template, read_manifest(path.parent / 'manifest.json'), None)
    return cache[relative]


def append_collection(path):
    with bpy.data.libraries.load(str(path), link=False) as (source, target):
        if ASSET_COLLECTION not in source.collections:
            return None
        target.collections = [ASSET_COLLECTION]
    collection = target.collections[0] if target.collections else None
    if collection is None or not collection.all_objects:
        if collection is not None:
            bpy.data.collections.remove(collection)
        return None
    return collection


def remove_template(template):
    for obj in list(template.all_objects):
        bpy.data.objects.remove(obj)
    for child in list(template.children_recursive):
        bpy.data.collections.remove(child)
    bpy.data.collections.remove(template)


def pack_images(template):
    """Packs images the asset did not pack, so the scene keeps them when the package moves"""
    for obj in template.all_objects:
        for slot in obj.material_slots:
            material = slot.material
            if material is None or material.node_tree is None:
                continue
            for node in material.node_tree.nodes:
                image = getattr(node, 'image', None)
                if image is not None and image.packed_file is None and image.source == 'FILE':
                    try:
                        image.pack()
                    except RuntimeError:
                        pass


def read_manifest(path):
    try:
        value = json.loads(path.read_text())
    except (OSError, ValueError):
        return {}
    return value if isinstance(value, dict) else {}


def stamp(template):
    return template.get('mm_asset_stamp')


# Skins


def create_asset_skin(holder, piece, template, manifest, collection, context, offset=None):
    root = bpy.data.objects.new(holder.name + ' skin', None)
    root.empty_display_type = 'PLAIN_AXES'
    root.empty_display_size = 0.01
    collection.objects.link(root)
    root.parent = holder
    root.matrix_parent_inverse.identity()
    root['mm_skin'] = ASSET_SKIN
    root['mm_owner'] = OWNER
    skins.apply_offset(root, offset)
    _populate(root, holder, piece, template, manifest, collection, context)
    return root


def refresh_asset_skin(skin, piece, template, manifest, context, collection):
    """Rebuilds an unedited asset skin whose asset, parameters or reaction changed. Returns what happened."""
    if skins.is_edited(skin):
        return 'edited'
    if skin.get('mm_skin_key') == skin_key(piece, template, manifest, context):
        return 'kept'
    for child in list(skin.children):
        skins.remove_object(child)
    _populate(skin, skin.parent, piece, template, manifest, collection, context)
    return 'rebuilt'


def skin_key(piece, template, manifest, context):
    values = [
        'asset', template.get('mm_asset_path'), stamp(template), piece.get('type', 'platform'),
        sorted((name, round(float(value), 6)) for name, value in (piece.get('params') or {}).items()),
        sorted((manifest.get('fittedParams') or {}).items()) if isinstance(manifest.get('fittedParams'), dict) else [],
        round(float(piece.get('wallOffset', 0.0)), 6), round(context['marbleRadius'], 6),
        [[round(float(point['x']), 5), round(float(point['y']), 5)] for point in (piece.get('path') or [])],
        [round(float(piece['position']['x']), 6), round(float(piece['position']['y']), 6), round(float(piece.get('angle', 0.0)), 6)]
        if layout(piece.get('type')) in ('path', 'tube') else None,
        sorted(skins.piece_reaction(piece, context).items()),
    ]
    return hashlib.sha1(json.dumps(values).encode()).hexdigest()[:16]


def fingerprint(skin):
    """What the app built below the skin root; the root's own transform is the user's offset"""
    entries = []
    for obj in sorted(descendants(skin), key=lambda item: (item.get('mm_asset_part') or '', item.name)):
        data = obj.data
        entries.append([
            obj.get('mm_asset_part', 'frame' if obj.get('mm_asset_frame') else obj.name),
            obj.type,
            data.name if data is not None else None,
            len(data.vertices) if obj.type == 'MESH' else 0,
            len(data.polygons) if obj.type == 'MESH' else 0,
            [slot.material.name if slot.material else None for slot in obj.material_slots],
            [modifier.type for modifier in obj.modifiers],
            len(obj.children),
            [round(value, 5) for row in obj.matrix_basis for value in row],
        ])
    return hashlib.sha1(json.dumps(entries).encode()).hexdigest()[:16]


def _populate(root, holder, piece, template, manifest, collection, context):
    frame = skins.PieceFrame(piece, context)
    kind = layout(piece.get('type'))
    frame_object = bpy.data.objects.new(root.name.replace(' skin', '') + ' asset frame', None)
    frame_object.empty_display_type = 'ARROWS'
    frame_object.empty_display_size = 0.01
    collection.objects.link(frame_object)
    frame_object.parent = root
    frame_object.matrix_parent_inverse.identity()
    frame_object['mm_asset_frame'] = True
    frame_object['mm_owner'] = OWNER

    originals = sorted(template.all_objects, key=lambda obj: obj.name)
    asset_matrix = contact_matrix(frame, kind, manifest)
    curve = None
    if kind in ('path', 'tube') and len(frame.path) >= 2:
        curve = path_curve(root, frame, kind, collection)
        start = min((corner[0] for obj in originals if obj.type == 'MESH' for corner in world_corners(obj)), default=0.0)
        asset_matrix = curve.matrix_basis @ Matrix.Rotation(-math.pi / 2, 4, 'X') @ Matrix.Translation((-start, 0.0, 0.0)) @ fit_scale(frame, kind, manifest)
    frame_object.matrix_basis = asset_matrix

    copies = {}
    for original in originals:
        copy = original.copy()
        collection.objects.link(copy)
        copy['mm_owner'] = OWNER
        copy['mm_asset_part'] = original.name
        copies[original] = copy
    for original, copy in copies.items():
        if original.parent in copies:
            copy.parent = copies[original.parent]
            copy.matrix_parent_inverse = original.matrix_parent_inverse.copy()
            copy.matrix_basis = original.matrix_basis.copy()
        else:
            copy.parent = frame_object
            copy.matrix_parent_inverse.identity()
            copy.matrix_basis = asset_space(original)
        if curve is not None and copy.type == 'MESH' and original.parent not in copies:
            bend_along(copy, curve)
    reaction = skins.piece_reaction(piece, context)
    for original, copy in copies.items():
        reaction_kind = original.get('mm_reaction')
        if original.name.startswith(REACT_PREFIX) and reaction_kind in REACTION_KINDS:
            add_part_reaction(copy, original, holder, reaction_kind, reaction, kind)
    root['mm_asset'] = template.get('mm_asset_path')
    root['mm_skin_key'] = skin_key(piece, template, manifest, context)
    root['mm_skin_print'] = fingerprint(root)


def contact_matrix(frame, kind, manifest):
    """Asset frame in the holder's local frame: x along the piece, y into the wall, z up from the contact face"""
    scale = fit_scale(frame, kind, manifest)
    if kind == 'rotor':
        # Origin at the hub with +Z toward the camera; blade angle 0 along +x like the physics rotor
        return Matrix.Rotation(math.pi / 2, 4, 'X') @ scale
    if kind in ('path', 'tube'):
        return scale
    thickness = frame.params.get('thickness', 0.008)
    return Matrix.Translation((0.0, 0.0, thickness / 2)) @ scale


def fit_scale(frame, kind, manifest):
    """Scales the asset from the parameters it was built for (`fittedParams`) to the piece's own"""
    fitted = manifest.get('fittedParams') if isinstance(manifest.get('fittedParams'), dict) else {}

    def ratio(name):
        built, wanted = fitted.get(name), frame.params.get(name)
        if not isinstance(built, (int, float)) or isinstance(built, bool) or built <= 0 or wanted is None or wanted <= 0:
            return 1.0
        return min(max(wanted / built, 1 / MAX_FIT_SCALE), MAX_FIT_SCALE)

    if kind == 'rotor':
        uniform = ratio('bladeLength')
        return Matrix.Diagonal((uniform, uniform, uniform, 1.0))
    if kind in ('path', 'tube'):
        across = ratio('radius')
        return Matrix.Diagonal((1.0, across, across, 1.0))
    return Matrix.Diagonal((ratio('length'), ratio('depth'), ratio('thickness'), 1.0))


def world_corners(obj):
    matrix = asset_space(obj)
    return [matrix @ Vector(corner) for corner in obj.bound_box]


def asset_space(obj):
    """Transform of a template object in the asset frame. Template objects are not in a scene, so their
    `matrix_world` may never have been evaluated; this follows the parent chain instead."""
    if obj.parent is None:
        return obj.matrix_basis.copy()
    return asset_space(obj.parent) @ obj.matrix_parent_inverse @ obj.matrix_basis


# Rails and tunnels


def path_curve(root, frame, kind, collection):
    """Poly curve along the line the asset's z = 0 follows: the top of the rail wire or the tunnel floor.

    The curve's local XY plane is the wall plane (x right, y up) and its +Z points toward the camera, so a mesh
    with x along the section, y toward the camera and z up bends in the wall plane.
    """
    support = frame.params.get('radius', 0.0025 if kind == 'path' else 0.002)
    line = frame.offset_path(support)
    first = line[0]
    data = bpy.data.curves.new(root.name + ' path', 'CURVE')
    data.dimensions = '2D'
    data.twist_mode = 'MINIMUM'
    spline = data.splines.new('POLY')
    spline.points.add(len(line) - 1)
    for point, (x, z) in zip(spline.points, line):
        point.co = (x - first[0], z - first[1], 0.0, 1.0)
    curve = bpy.data.objects.new(root.name + ' path', data)
    collection.objects.link(curve)
    curve.parent = root
    curve.matrix_parent_inverse.identity()
    curve.matrix_basis = Matrix.Translation((first[0], frame.marble_y, first[1])) @ Matrix.Rotation(math.pi / 2, 4, 'X')
    curve.hide_render = True
    curve['mm_owner'] = OWNER
    curve['mm_asset_part'] = 'MM path'
    return curve


def bend_along(obj, curve):
    """Repeats a straight section along the curve and bends it into the curve's shape"""
    array = obj.modifiers.new('MM repeat', 'ARRAY')
    array.fit_type = 'FIT_CURVE'
    array.curve = curve
    array.use_merge_vertices = True
    bend = obj.modifiers.new('MM bend', 'CURVE')
    bend.object = curve
    bend.deform_axis = 'POS_X'


# Reactions


def add_part_reaction(part, original, holder, kind, reaction, piece_layout):
    """Drives an `MM_REACT_*` part from the holder's `mm_hit` through its delta transforms.

    Design preset `none` turns every part off. A preset's params apply to parts of its kind; other parts use the
    default amounts.
    """
    if reaction['preset'] == 'none':
        return
    part['mm_react'] = kind
    if kind == 'press':
        amount = reaction['press'] if reaction['preset'] == 'press' else skins.DEFAULT_PRESS
        # Press along the asset's -Z, expressed in the part's parent space
        direction = asset_axis_in_parent(original, Vector((0.0, 0.0, -1.0)))
        for index in range(3):
            if abs(direction[index]) > 1e-6:
                skins.drive(part, 'delta_location', index, holder, '%.7f*h' % (amount * direction[index]))
    elif kind == 'wobble':
        degrees = reaction['wobble'] if reaction['preset'] == 'wobble' else skins.DEFAULT_WOBBLE_DEGREES
        frequency = reaction['frequency'] if reaction['preset'] == 'wobble' else skins.DEFAULT_WOBBLE_HZ
        # Wobble around the axis toward the camera, so it reads in the wall plane
        axis = asset_axis_in_parent(original, Vector((0.0, 0.0, 1.0) if piece_layout == 'rotor' else (0.0, -1.0, 0.0)))
        index = max(range(3), key=lambda item: abs(axis[item]))
        expression = skins.wobble_expression(degrees * math.copysign(1.0, axis[index]), frequency)
        skins.drive(part, 'delta_rotation_euler', index, holder, expression)
    elif kind == 'glow':
        strength = reaction['flash'] if reaction['preset'] == 'glow' else skins.DEFAULT_GLOW
        part['mm_flash'] = 0.0
        skins.drive(part, '["mm_flash"]', -1, holder, '%.4f*h' % strength)
        for slot in part.material_slots:
            if slot.material is not None:
                hook_flash(slot.material)


def asset_axis_in_parent(original, axis):
    """`axis` of the asset frame expressed in the space of the object's parent within the asset"""
    if original.parent is None:
        return axis
    rotation = (asset_space(original.parent) @ original.matrix_parent_inverse).to_3x3()
    local = rotation.inverted_safe() @ axis
    return local.normalized() if local.length > 1e-9 else axis


def hook_flash(material):
    """Adds the object property `mm_flash` to the material's emission strength, once.

    Objects without the property read 0, so other objects sharing the material do not glow.
    """
    if material.get('mm_flash_hook') or material.node_tree is None:
        return
    tree = material.node_tree
    principled = next((node for node in tree.nodes if node.type == 'BSDF_PRINCIPLED'), None)
    if principled is None:
        return
    strength = principled.inputs.get('Emission Strength')
    color = principled.inputs.get('Emission Color')
    if strength is None or strength.is_linked:
        return
    attribute = tree.nodes.new('ShaderNodeAttribute')
    attribute.attribute_type = 'OBJECT'
    attribute.attribute_name = 'mm_flash'
    add = tree.nodes.new('ShaderNodeMath')
    add.operation = 'ADD'
    add.inputs[1].default_value = strength.default_value
    tree.links.new(attribute.outputs['Fac'], add.inputs[0])
    tree.links.new(add.outputs['Value'], strength)
    base = principled.inputs.get('Base Color')
    if color is not None and not color.is_linked and max(color.default_value[:3]) < 1e-4 and base is not None and not base.is_linked:
        color.default_value = base.default_value
    material['mm_flash_hook'] = True
