"""Decor: the film's decorations, from `TSceneDescription.decor`, and what the user added directly in Blender.

Built-in items are procedural and cheap: one mesh per item, shared by every copy, or a text object. Each is modelled in
the asset frame the library's decorations use: origin at the centre of the back face, X right, Y up, +Z out of the wall
toward the camera. A decoration is one object in `MidiMarble · managed` tagged `mm_role = 'decor'` and the layer's key as
`mm_id`, so the preview's ID pass picks it. An asset decoration is an empty with copies of its `MM_ASSET` objects below.

Decor has no physics: the simulation never reads it and nothing here has a collider. App-owned objects follow the same
rule as titles: re-applying updates one while it still holds what the app last wrote (`mm_written`), one the user edited
in Blender is left alone, and when its layer goes it moves to `MidiMarble · detached` instead of being deleted.

Timing is a title's: `walltext.write_timing` keys `mm_visible` and `hide_render`. Hidden layers stay in the file, hidden,
so an edit made in Blender survives hiding.

Made in Blender: objects in the scene the app doesn't own, by their top-level object. `report_user_objects` names them
with their bounds on the wall, lights and cameras left out. `apply_user_decor` only ever touches their visibility, with
keyframes on the object itself, and gives back the visibility they had when the project stops setting it. They are never
moved or deleted.
"""
import hashlib
import json
import math
from pathlib import Path

import bmesh
import bpy
from mathutils import Matrix, Vector

from . import anim, assets, decor_effects, themes, walltext
from .util import (
    DETACHED_COLLECTION,
    MANAGED_COLLECTION,
    OWNER,
    STUDIO_COLLECTION,
    WorkerError,
    descendants,
    finite,
    link_only_to,
    parse_color,
    tag,
)

DECOR_ROLE = 'decor'
PART_ROLE = 'decor-part'
# Gap between the back of an item and the wall plane so they never z-fight
WALL_GAP = 0.0002
SOURCE_PROPERTY = 'mm_decor_source'
VISIBILITY_PATHS = ('hide_render', 'hide_viewport')
# Set on a Blender object whose visibility the project controls, with the values it had before
USER_TIMED = 'mm_decor_timed'
USER_PRIOR = 'mm_decor_prior'
GEOMETRY_TYPES = {'MESH', 'CURVE', 'SURFACE', 'META', 'FONT', 'CURVES', 'POINTCLOUD', 'VOLUME', 'GREASEPENCIL'}
CATALOG = json.loads((Path(__file__).parent / 'decor_catalog.json').read_text())
ITEMS = {item['id'][len('decor:'):]: item for item in CATALOG['items']}


def item_material(key, color, roughness=0.35, metallic=0.0, emission=0.0, opacity=1.0):
    """A shared material per look that mixes to transparent by the object's `mm_visible`, like a title"""
    def build(material):
        linear = parse_color(color)
        material.diffuse_color = (*linear[:3], max(opacity, 0.15))
        tree = material.node_tree
        principled = themes._principled(material)
        themes._set(principled, 'Base Color', linear)
        themes._set(principled, 'Roughness', roughness)
        themes._set(principled, 'Metallic', metallic)
        if emission > 0.0:
            themes._set(principled, 'Emission Color', linear)
            themes._set(principled, 'Emission Strength', emission)
        output = next(node for node in tree.nodes if node.type == 'OUTPUT_MATERIAL')
        transparent = tree.nodes.new('ShaderNodeBsdfTransparent')
        mix = tree.nodes.new('ShaderNodeMixShader')
        visible = tree.nodes.new('ShaderNodeAttribute')
        visible.attribute_type = 'OBJECT'
        visible.attribute_name = walltext.VISIBLE_PROPERTY
        factor = visible.outputs['Fac']
        if opacity < 1.0:
            multiply = tree.nodes.new('ShaderNodeMath')
            multiply.operation = 'MULTIPLY'
            multiply.inputs[1].default_value = opacity
            tree.links.new(factor, multiply.inputs[0])
            factor = multiply.outputs[0]
        tree.links.new(factor, mix.inputs['Fac'])
        tree.links.new(transparent.outputs['BSDF'], mix.inputs[1])
        tree.links.new(principled.outputs[0], mix.inputs[2])
        tree.links.new(mix.outputs['Shader'], output.inputs['Surface'])
    return themes._shared('MM · decor ' + key, build)


# Geometry: in the asset frame, each part a material slot index


def _box(mesh, slot, center, size, angle=0.0):
    matrix = Matrix.Translation(center) @ Matrix.Rotation(angle, 4, 'Z') @ Matrix.Diagonal((size[0], size[1], size[2], 1.0))
    result = bmesh.ops.create_cube(mesh, size=1.0, matrix=matrix)
    _assign(result['verts'], slot)


def _sphere(mesh, slot, center, radius, squash=1.0, segments=(16, 10)):
    matrix = Matrix.Translation(center) @ Matrix.Diagonal((1.0, 1.0, squash, 1.0))
    result = bmesh.ops.create_uvsphere(mesh, u_segments=segments[0], v_segments=segments[1], radius=radius, matrix=matrix)
    _assign(result['verts'], slot)


def _ball(mesh, slot, center, radius):
    result = bmesh.ops.create_icosphere(mesh, subdivisions=1, radius=radius, matrix=Matrix.Translation(center))
    _assign(result['verts'], slot)


def _cylinder(mesh, slot, center, radius, depth, segments=10):
    # The axis runs along Y, up the wall
    matrix = Matrix.Translation(center) @ Matrix.Rotation(math.pi / 2, 4, 'X')
    result = bmesh.ops.create_cone(mesh, cap_ends=True, cap_tris=False, segments=segments, radius1=radius, radius2=radius, depth=depth, matrix=matrix)
    _assign(result['verts'], slot)


def _prism(mesh, slot, outline, depth):
    """A flat shape in the wall plane, extruded `depth` out of the wall"""
    back = [mesh.verts.new((x, y, 0.0)) for x, y in outline]
    front = [mesh.verts.new((x, y, depth)) for x, y in outline]
    faces = [mesh.faces.new(list(reversed(back))), mesh.faces.new(front)]
    for index in range(len(outline)):
        following = (index + 1) % len(outline)
        faces.append(mesh.faces.new((back[index], back[following], front[following], front[index])))
    for face in faces:
        face.material_index = slot


def _assign(verts, slot):
    for vert in verts:
        for face in vert.link_faces:
            face.material_index = slot


BAUBLE_MIDDLE = 0.006
BAUBLE_SQUASH = 0.8


def _bauble(mesh):
    # Sunk into the wall and flattened a little, so it reads as hanging on the wall with a short shadow
    _sphere(mesh, 0, (0.0, -0.003, BAUBLE_MIDDLE), 0.013, BAUBLE_SQUASH, (20, 12))
    _cylinder(mesh, 1, (0.0, 0.012, BAUBLE_MIDDLE), 0.003, 0.004)
    _ball(mesh, 1, (0.0, 0.015, BAUBLE_MIDDLE), 0.001)


def _snowflake(mesh):
    width, depth = 0.0026, 0.002
    for index in range(3):
        angle = index * math.pi / 3
        _box(mesh, 0, (0.0, 0.0, depth / 2), (width, 0.034, depth), angle)
    for index in range(6):
        angle = index * math.pi / 3
        direction = Vector((-math.sin(angle), math.cos(angle), 0.0))
        at = direction * 0.0115
        for side in (-1, 1):
            tick = angle + side * math.pi / 4
            shift = Vector((-math.sin(tick), math.cos(tick), 0.0)) * 0.0032
            _box(mesh, 0, (at.x + shift.x, at.y + shift.y, depth / 2), (width * 0.8, 0.0065, depth), tick)


def _fairy_light(mesh):
    span = 0.031
    # Hangs between its two ends
    sag = lambda x: (x * x) * 8.5 - 0.004
    steps = 8
    points = [(-span + step * 2 * span / steps) for step in range(steps + 1)]
    for a, b in zip(points, points[1:]):
        middle = (a + b) / 2
        run = math.hypot(b - a, sag(b) - sag(a))
        tilt = math.atan2(sag(b) - sag(a), b - a) - math.pi / 2
        _box(mesh, 0, (middle, sag(middle), 0.0012), (0.0007, run, 0.0007), tilt)
    for index in range(7):
        x = -span + index * 2 * span / 6
        _ball(mesh, 1, (x, sag(x) - 0.0022, 0.0022), 0.0024)


def _gift_box(mesh):
    _box(mesh, 0, (0.0, -0.003, 0.0045), (0.026, 0.024, 0.009))
    _box(mesh, 0, (0.0, 0.0105, 0.005), (0.028, 0.005, 0.01))
    _box(mesh, 1, (0.0, -0.001, 0.0047), (0.005, 0.0286, 0.0102))
    _sphere(mesh, 1, (-0.0045, 0.0145, 0.0058), 0.0042, 0.5, (8, 6))
    _sphere(mesh, 1, (0.0045, 0.0145, 0.0058), 0.0042, 0.5, (8, 6))


def _star(mesh):
    outline = []
    for index in range(10):
        radius = 0.016 if index % 2 == 0 else 0.0068
        angle = math.pi / 2 - index * math.pi / 5
        outline.append((radius * math.cos(angle), radius * math.sin(angle)))
    _prism(mesh, 0, outline, 0.003)


def _plain_sphere(mesh):
    _sphere(mesh, 0, (0.0, 0.0, 0.013), 0.013, 1.0, (20, 12))


def _plain_cube(mesh):
    _box(mesh, 0, (0.0, 0.0, 0.012), (0.024, 0.024, 0.024))


def _ring(mesh):
    segments = 24
    outer, inner, depth = 0.015, 0.009, 0.006
    circle = lambda radius, z: [mesh.verts.new((radius * math.cos(index * math.tau / segments), radius * math.sin(index * math.tau / segments), z)) for index in range(segments)]
    loops = [circle(outer, 0.0), circle(outer, depth), circle(inner, depth), circle(inner, 0.0)]
    for side, loop in enumerate(loops):
        following = loops[(side + 1) % len(loops)]
        for index in range(segments):
            mesh.faces.new((loop[index], loop[(index + 1) % segments], following[(index + 1) % segments], following[index]))
    _assign([vert for loop in loops for vert in loop], 0)


def _looks(item_id):
    """Materials of an item's slots"""
    item = ITEMS[item_id]
    color = item['color']
    if item_id.startswith('bauble'):
        # A faint glow of its own, for Bloom and for warmth; Bloom also catches the sun in its gloss
        return [item_material(item_id, color, roughness=0.14, metallic=0.75, emission=0.35), item_material('bauble cap', '#c9b37a', roughness=0.3, metallic=1.0)]
    if item_id == 'snowflake-gold':
        return [item_material(item_id, color, roughness=0.3, metallic=1.0)]
    if item_id == 'fairy-light':
        return [item_material('fairy wire', '#3a3a3a', roughness=0.6), item_material(item_id, color, roughness=0.4, emission=10.0)]
    if item_id == 'gift-box':
        return [item_material(item_id, color, roughness=0.55), item_material('gift ribbon', item['second'], roughness=0.3, metallic=0.4)]
    if item_id == 'star':
        return [item_material(item_id, color, roughness=0.32, metallic=0.9, emission=0.2)]
    return [item_material(item_id, color, roughness=0.6)]


BUILDERS = {
    'bauble-red': _bauble,
    'bauble-gold': _bauble,
    'snowflake-gold': _snowflake,
    'fairy-light': _fairy_light,
    'gift-box': _gift_box,
    'star': _star,
    'sphere': _plain_sphere,
    'ring': _ring,
    'cube': _plain_cube,
}


def shared_mesh(item_id, look_id=None):
    """The one mesh of an item, built once"""
    name = 'MM decor · ' + item_id
    existing = bpy.data.meshes.get(name)
    if existing is not None:
        return existing
    mesh = bpy.data.meshes.new(name)
    work = bmesh.new()
    BUILDERS[item_id](work)
    bmesh.ops.recalc_face_normals(work, faces=work.faces)
    work.to_mesh(mesh)
    work.free()
    for polygon in mesh.polygons:
        polygon.use_smooth = item_id.startswith('bauble') or item_id in ('sphere', 'ring')
    for material in _looks(look_id or item_id):
        mesh.materials.append(material)
    mesh[OWNER] = True
    return mesh


# App-owned decor


def is_decor(obj):
    return obj.get('mm_owner') == OWNER and obj.get('mm_role') == DECOR_ROLE


def parts_of(obj):
    return descendants(obj)


def apply_decor(project_dir, entries, managed, detached_collection, asset_cache, fps=30.0, duration=None):
    report = {'created': [], 'updated': [], 'skipped': [], 'removed': [], 'problems': {}}
    existing = {obj['mm_id']: obj for obj in managed.objects if is_decor(obj)}
    for entry in entries or []:
        mm_id = entry.get('id')
        if not isinstance(mm_id, str) or not mm_id:
            raise WorkerError('INVALID_DESCRIPTION', 'A decoration needs an id')
        obj = existing.pop(mm_id, None)
        if obj is not None and link_state(obj) == 'unlinked':
            report['skipped'].append(mm_id)
            continue
        source = entry.get('item') or entry.get('assetPath')
        if obj is not None and obj.get(SOURCE_PROPERTY) != source:
            remove_tree(obj)
            obj = None
        created = obj is None
        if created:
            obj, problem = create_decor(project_dir, entry, managed, asset_cache)
            if obj is None:
                report['problems'][mm_id] = problem
                continue
            obj[SOURCE_PROPERTY] = source
        write_decor(obj, entry, fps, duration)
        report['created' if created else 'updated'].append(mm_id)
    for mm_id, obj in existing.items():
        if link_state(obj) == 'unlinked':
            detached = detached_collection()
            for member in [obj, *parts_of(obj)]:
                link_only_to(member, detached, remove_from=managed)
        else:
            remove_tree(obj)
        report['removed'].append(mm_id)
    return report


def create_decor(project_dir, entry, managed, asset_cache):
    item_id = entry.get('item')
    name = str(entry.get('name') or entry['id'])
    if item_id is not None:
        item = ITEMS.get(item_id)
        if item is None:
            return None, 'Unknown decor item: ' + str(item_id)
        if decor_effects.effect_of(item) is not None:
            obj = decor_effects.create(name, item['effect'], managed)
            tag(obj, entry['id'], DECOR_ROLE)
            return obj, None
        obj = bpy.data.objects.new(name, shared_mesh(item_id, item_id))
        managed.objects.link(obj)
        tag(obj, entry['id'], DECOR_ROLE)
        return obj, None
    relative = entry.get('assetPath')
    template, _manifest, problem = assets.load_asset(project_dir, relative, asset_cache)
    if template is None:
        return None, problem or 'The asset could not be loaded'
    root = bpy.data.objects.new(name, None)
    root.empty_display_size = 0.01
    managed.objects.link(root)
    tag(root, entry['id'], DECOR_ROLE)
    copies = {}
    for index, original in enumerate(template.all_objects):
        copy = original.copy()
        managed.objects.link(copy)
        tag(copy, '%s/%d' % (entry['id'], index), PART_ROLE)
        copies[original] = copy
    for original, copy in copies.items():
        if original.parent in copies:
            copy.parent = copies[original.parent]
        else:
            copy.parent = root
    return root, None


def write_decor(obj, entry, fps, duration):
    position = entry.get('position') or {'x': 0.0, 'y': 0.0}
    scale = finite(entry.get('scale', 1.0), 'scale')
    rotation = finite(entry.get('rotation', 0.0), 'rotation')
    is_effect = decor_effects.is_effect(obj)
    # Local +Z points at the camera (-Y), local +Y up the wall, as a title's; the wall angle turns it in the wall plane
    # An effect hangs from the camera (`decor_effects.attach`); it has no place on the wall
    if not is_effect:
        obj.matrix_basis = (
            Matrix.Translation((finite(position['x'], 'x'), -WALL_GAP, finite(position['y'], 'y')))
            @ Matrix.Rotation(-rotation, 4, 'Y')
            @ Matrix.Rotation(math.pi / 2, 4, 'X')
            @ Matrix.Diagonal((scale, scale, scale, 1.0))
        )
    label = str(entry.get('name') or '').strip()[:48]
    if label and obj.name != label and not obj.name.startswith(label + '.'):
        obj.name = label
    is_hidden = entry.get('hidden') is True
    for member in [obj, *parts_of(obj)]:
        if is_hidden:
            anim.clear_channels(member, walltext.TIMING_PATHS)
            member.hide_render = True
        else:
            walltext.write_timing(member, entry, fps, duration)
        member.hide_viewport = is_hidden
    obj['mm_written'] = signature(obj)


def attach_effects(entries, managed, camera, scene, fps, duration, theme):
    """Snowfall: see `decor_effects`"""
    return decor_effects.attach(entries, managed, camera, scene, fps, duration, theme)


def remove_tree(obj):
    for member in [*parts_of(obj), obj]:
        data = member.data
        bpy.data.objects.remove(member)
        # Shared meshes stay for the next copy; a text decoration's curve and an effect's mesh are its own
        if isinstance(data, bpy.types.Curve) and data.users == 0:
            bpy.data.curves.remove(data)
        elif isinstance(data, bpy.types.Mesh) and data.users == 0 and data.name.startswith('MM snowfall'):
            bpy.data.meshes.remove(data)


def signature(obj):
    if decor_effects.is_effect(obj):
        return decor_effects.signature(obj)
    placement = [round(value, 6) for value in (*obj.location, *obj.rotation_euler, *obj.scale)]
    body = obj.data.body if obj.type == 'FONT' else None
    return hashlib.sha1(json.dumps([placement, body, obj.get(SOURCE_PROPERTY)]).encode()).hexdigest()[:16]


def link_state(obj):
    if obj.get('mm_link') == 'unlinked':
        return 'unlinked'
    # Nothing an effect holds is the user's to place: the camera carries it
    if decor_effects.is_effect(obj):
        return 'linked'
    written = obj.get('mm_written')
    if written is not None and written != signature(obj):
        return 'unlinked'
    return 'linked'


def inspect(managed):
    return [
        {'mmId': obj['mm_id'], 'name': obj.name, 'source': obj.get(SOURCE_PROPERTY), 'link': link_state(obj)}
        for obj in (managed.objects if managed else []) if is_decor(obj)
    ]


# Made in Blender


def _app_collections():
    return {MANAGED_COLLECTION, DETACHED_COLLECTION, STUDIO_COLLECTION}


def _is_app_object(obj):
    if obj.get('mm_owner') == OWNER:
        return True
    return any(collection.name in _app_collections() or collection.get(OWNER) for collection in obj.users_collection)


def _has_geometry(obj):
    return obj.type in GEOMETRY_TYPES or (obj.type == 'EMPTY' and obj.instance_collection is not None)


def user_roots(scene):
    """Top-level objects the app doesn't own, with geometry somewhere below them. A light or camera alone isn't one."""
    roots = []
    for obj in scene.objects:
        if obj.parent is not None or _is_app_object(obj):
            continue
        if any(_has_geometry(member) for member in [obj, *descendants(obj)]):
            roots.append(obj)
    return sorted(roots, key=lambda item: item.name)


def wall_bounds(obj):
    """Bounds on the wall of everything with geometry at and below `obj`, at the scene's current frame"""
    xs, zs = [], []
    for member in [obj, *descendants(obj)]:
        if not _has_geometry(member):
            continue
        if member.type == 'EMPTY':
            location = member.matrix_world.translation
            xs += [location.x - 0.01, location.x + 0.01]
            zs += [location.z - 0.01, location.z + 0.01]
            continue
        for corner in member.bound_box:
            world = member.matrix_world @ Vector(corner)
            xs.append(world.x)
            zs.append(world.z)
    if not xs:
        return None
    return {'minX': round(min(xs), 5), 'minY': round(min(zs), 5), 'maxX': round(max(xs), 5), 'maxY': round(max(zs), 5)}


def report_user_objects(scene):
    bpy.context.view_layer.update()
    objects = []
    for obj in user_roots(scene):
        bounds = wall_bounds(obj)
        if bounds is not None:
            objects.append({'name': obj.name, 'bounds': bounds})
    return objects


def apply_user_decor(overrides, scene, fps, duration):
    """In, Out and Hidden of Made in Blender objects, as keyframed visibility on each object below the top-level one.
    An object the project stops setting gets the visibility back it had. Returns the names it set."""
    by_name = {entry['name']: entry for entry in overrides or [] if isinstance(entry.get('name'), str)}
    report = {'set': []}
    for root in user_roots(scene):
        override = by_name.get(root.name)
        members = [root, *descendants(root)]
        for member in members:
            was_timed = bool(member.get(USER_TIMED))
            if override is None and not was_timed:
                continue
            if not was_timed:
                member[USER_PRIOR] = [bool(member.hide_render), bool(member.hide_viewport)]
            else:
                anim.clear_channels(member, VISIBILITY_PATHS)
            prior = [bool(value) for value in member.get(USER_PRIOR, [False, False])]
            if override is None:
                member.hide_render, member.hide_viewport = prior
                del member[USER_TIMED]
                del member[USER_PRIOR]
                continue
            member[USER_TIMED] = True
            write_user_visibility(member, override, prior, fps, duration)
        if override is not None:
            report['set'].append(root.name)
    return report


def write_user_visibility(obj, override, prior, fps, duration):
    if override.get('hidden') is True:
        obj.hide_render = obj.hide_viewport = True
        return
    obj.hide_render, obj.hide_viewport = prior
    span = walltext.title_range(override, duration)
    if span is None or prior[0]:
        return
    start, end = span
    keys = [(0.0, start > 0.0)]
    if start > 0.0:
        keys.append((start, False))
    if math.isfinite(end):
        keys.append((end, True))
    for seconds, is_hidden in keys:
        obj.hide_render = is_hidden
        obj.hide_viewport = is_hidden
        for path in VISIBILITY_PATHS:
            obj.keyframe_insert(data_path=path, frame=seconds * fps)


def select_objects(names):
    """Selects objects by name for the user, in the open Blender window; the scene itself doesn't change"""
    view_layer = bpy.context.view_layer
    selected = []
    for obj in view_layer.objects:
        should_select = obj.name in names
        obj.select_set(should_select)
        if should_select:
            selected.append(obj.name)
            view_layer.objects.active = obj
    if selected and not bpy.app.background:
        frame_selection()
    return {'selected': selected}


def frame_selection():
    """Frames the selection in the first 3D view; a window without one keeps its view"""
    window = bpy.context.window_manager.windows[0] if bpy.context.window_manager.windows else None
    if window is None:
        return
    for area in window.screen.areas:
        if area.type != 'VIEW_3D':
            continue
        region = next((item for item in area.regions if item.type == 'WINDOW'), None)
        if region is None:
            continue
        with bpy.context.temp_override(window=window, area=area, region=region):
            bpy.ops.view3d.view_selected(use_all_regions=False)
        return
