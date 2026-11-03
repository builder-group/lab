"""Wall text: native Blender text objects on the wall from `TSceneDescription.wallTexts`.

Each text is a FONT object in `MidiMarble · managed` tagged `mm_role = 'text'` and its entity's `mm_id`. It is
centred on its wall position, raised toward the camera by its extrusion and turned by its wall angle. The text is
app-owned: re-applying updates it while it still holds what the app last wrote (`mm_written`). A text the user
edited in Blender, or marked `mm_link = 'unlinked'`, is left alone; when its entity is removed it moves to
`MidiMarble · detached` instead of being deleted.

Fonts: `font` names a loaded Blender font (the built-in one is `Bfont Regular`) or a font file, package-relative
or absolute. Font files are packed so the scene keeps them.

Timing: optional `in` and `out` seconds show a title only inside its range. The object property `mm_visible` fades
from 0 to 1 over `FADE` seconds after `in` and back to 0 over the `FADE` seconds before `out`; the title material
mixes to transparent by it, and `hide_render` keeps the title out of renders and the ID pass while it is hidden.

Styles: `style` `wall` (the default) and `songName` sit on the wall as above. `caption` (near the top of the frame)
and `endCard` (centred) are screen titles: `attach_screen_texts` parents them to the film camera, after the camera
exists, and drivers on its lens and distance keep them the same size and place in the frame while it moves. Their
`size` is the letter height as a fraction of the frame height; they cast no shadow and have no extrusion.
"""
import hashlib
import json
import math
from pathlib import Path

import bpy
from mathutils import Matrix

from . import anim, themes
from .util import OWNER, WorkerError, finite, link_only_to, parse_color, resolve_package_path, tag

TEXT_ROLE = 'text'
BUILTIN_FONT = 'Bfont Regular'
# Gap between the back of the letters and the wall plane so they never z-fight with it
WALL_GAP = 0.0002
# Seconds a timed title takes to fade in after its `in` time and out before its `out` time
FADE = 0.25
VISIBLE_PROPERTY = 'mm_visible'
TIMING_PATHS = ('["%s"]' % VISIBLE_PROPERTY, 'hide_render')
# `KeyframePoint.interpolation` enum value for CONSTANT
INTERPOLATION_CONSTANT = 0
SCREEN_STYLES = ('caption', 'endCard')
SCREEN_PROPERTY = 'mm_screen'
# Screen titles sit this far along the way from the camera to the closer of its focus and the wall, in front of the
# pieces and close to the focus so depth of field keeps them nearly sharp
SCREEN_DEPTH = 0.85
# Height of a caption's centre above the frame centre, as a fraction of the half frame height
CAPTION_HEIGHT = 0.7
SCREEN_PATHS = (('location', 1), ('location', 2), ('scale', 0), ('scale', 1), ('scale', 2))


def is_text(obj):
    return obj.get('mm_owner') == OWNER and obj.get('mm_role') == TEXT_ROLE and obj.type == 'FONT'


def apply_texts(project_dir, texts, managed, detached_collection, fps=30.0, duration=None):
    report = {'created': [], 'updated': [], 'skipped': [], 'removed': []}
    existing = {obj['mm_id']: obj for obj in managed.objects if is_text(obj)}
    for entry in texts or []:
        mm_id = entry.get('id')
        if not isinstance(mm_id, str) or not mm_id:
            raise WorkerError('INVALID_DESCRIPTION', 'Wall text needs an id')
        obj = existing.pop(mm_id, None)
        if obj is not None and link_state(obj) == 'unlinked':
            report['skipped'].append(mm_id)
            continue
        created = obj is None
        if created:
            data = bpy.data.curves.new(entry.get('text') or mm_id, 'FONT')
            obj = bpy.data.objects.new(entry.get('text') or mm_id, data)
            managed.objects.link(obj)
            tag(obj, mm_id, TEXT_ROLE)
        write_text(project_dir, obj, entry)
        write_timing(obj, entry, fps, duration)
        report['created' if created else 'updated'].append(mm_id)
    for mm_id, obj in existing.items():
        if link_state(obj) == 'unlinked':
            detached = detached_collection()
            link_only_to(obj, detached, remove_from=managed)
        else:
            data = obj.data
            bpy.data.objects.remove(obj)
            if data is not None and data.users == 0:
                bpy.data.curves.remove(data)
        report['removed'].append(mm_id)
    return report


def write_text(project_dir, obj, entry):
    data = obj.data
    size = finite(entry.get('size', 0.03), 'size')
    depth = max(0.0, finite(entry.get('depth', 0.0), 'depth'))
    screen = entry.get('style') if entry.get('style') in SCREEN_STYLES else None
    data.body = str(entry.get('text') or '')
    if screen is not None:
        # Unit letters scaled by the camera drivers; `size` is a fraction of the frame height
        data.size = 1.0
        data.extrude = 0.0
        data.bevel_depth = 0.0
        obj[SCREEN_PROPERTY] = screen
        obj['mm_screen_size'] = max(size, 1e-3)
    else:
        data.size = max(size, 1e-4)
        # Extrusion grows both ways from the text plane, so half the depth each way
        data.extrude = depth / 2
        data.bevel_depth = min(depth * 0.12, size * 0.01)
        detach_from_camera(obj)
    data.bevel_resolution = 2
    data.align_x = 'CENTER'
    data.align_y = 'CENTER'
    font = resolve_font(project_dir, entry.get('font'))
    if font is not None:
        data.font = font
    material = title_material(entry.get('color') or '#1d1d1f', screen is not None)
    if len(data.materials):
        data.materials[0] = material
    else:
        data.materials.append(material)
    position = entry.get('position') or {'x': 0.0, 'y': 0.0}
    angle = finite(entry.get('angle', 0.0), 'angle')
    if screen is None:
        # Text local +Z points at the camera (-Y), local +Y up the wall; the wall angle turns it in the wall plane
        obj.matrix_basis = (
            Matrix.Translation((finite(position['x'], 'x'), -(depth / 2 + WALL_GAP), finite(position['y'], 'y')))
            @ Matrix.Rotation(-angle, 4, 'Y')
            @ Matrix.Rotation(math.pi / 2, 4, 'X')
        )
    label = str(entry.get('text') or '').strip()[:48]
    if label and obj.name != label and not obj.name.startswith(label + '.'):
        obj.name = label
    obj['mm_written'] = signature(obj)


def attach_screen_texts(managed, camera, scene):
    """
    Parents caption and end card titles to the film camera. Drivers place them at `SCREEN_DEPTH` of the way to the
    closer of the focus distance and the wall, and scale them by the frame height there, so a caption stays at the
    top of the frame at its size whatever the camera does. Returns how many were attached.
    """
    if camera is None or camera.type != 'CAMERA' or managed is None:
        return 0
    # The sensor spans the longer image side, so the half frame height per metre is shorter in landscape
    width, height = scene.render.resolution_x, max(scene.render.resolution_y, 1)
    fit = min(1.0, height / max(width, 1))
    # An orthographic camera (the framed still camera) sees the same frame height at every distance
    ortho = camera.data.type == 'ORTHO'
    count = 0
    for obj in managed.objects:
        style = obj.get(SCREEN_PROPERTY) if is_text(obj) else None
        if style not in SCREEN_STYLES or link_state(obj) == 'unlinked':
            continue
        obj.parent = camera
        obj.matrix_parent_inverse.identity()
        obj.matrix_basis = Matrix.Identity(4)
        obj.visible_shadow = False
        size = float(obj.get('mm_screen_size', 0.06))
        distance = '%g*abs(wall)' % SCREEN_DEPTH if ortho else '%g*min(focus, abs(wall))' % SCREEN_DEPTH
        frame_half = 'ortho*%g' % (fit / 2) if ortho else '(%s)*%g/lens' % (distance, camera.data.sensor_width / 2 * fit)
        expressions = {
            ('location', 1): '%s*%g' % (frame_half, CAPTION_HEIGHT if style == 'caption' else 0.0),
            ('location', 2): '-(%s)' % distance,
        }
        for index in range(3):
            # Letter height is `size` of the full frame height
            expressions[('scale', index)] = '%s*%g' % (frame_half, 2 * size)
        for path, index in SCREEN_PATHS:
            obj.driver_remove(path, index)
            driver = obj.driver_add(path, index).driver
            driver.type = 'SCRIPTED'
            add_variable(driver, 'focus', camera.data, 'dof.focus_distance')
            add_variable(driver, 'lens', camera.data, 'lens')
            add_variable(driver, 'ortho', camera.data, 'ortho_scale')
            wall = driver.variables.new()
            wall.name = 'wall'
            wall.type = 'TRANSFORMS'
            wall.targets[0].id = camera
            wall.targets[0].transform_type = 'LOC_Y'
            wall.targets[0].transform_space = 'WORLD_SPACE'
            driver.expression = expressions[(path, index)]
        obj['mm_written'] = signature(obj)
        count += 1
    return count


def add_variable(driver, name, target_id, data_path):
    variable = driver.variables.new()
    variable.name = name
    variable.type = 'SINGLE_PROP'
    variable.targets[0].id_type = 'CAMERA'
    variable.targets[0].id = target_id
    variable.targets[0].data_path = data_path


def detach_from_camera(obj):
    """Turns a screen title back into a wall title: no camera parent, drivers or screen tags"""
    if SCREEN_PROPERTY not in obj and obj.parent is None:
        return
    for path, index in SCREEN_PATHS:
        obj.driver_remove(path, index)
    obj.parent = None
    obj.visible_shadow = True
    obj.scale = (1.0, 1.0, 1.0)
    for name in (SCREEN_PROPERTY, 'mm_screen_size'):
        if name in obj:
            del obj[name]


def title_material(color, emissive=False):
    """
    Title colour that mixes to transparent by the object's `mm_visible`, shared per colour. Screen titles glow in
    their colour instead of taking the scene's light, so a white caption reads white over any wall.
    """
    def build(material):
        linear = parse_color(color)
        material.diffuse_color = linear
        tree = material.node_tree
        principled = themes._principled(material)
        themes._set(principled, 'Base Color', linear)
        themes._set(principled, 'Roughness', 0.38)
        output = next(node for node in tree.nodes if node.type == 'OUTPUT_MATERIAL')
        if emissive:
            emission = tree.nodes.new('ShaderNodeEmission')
            emission.inputs['Color'].default_value = linear
            emission.inputs['Strength'].default_value = 1.0
            principled = emission
        transparent = tree.nodes.new('ShaderNodeBsdfTransparent')
        mix = tree.nodes.new('ShaderNodeMixShader')
        visible = tree.nodes.new('ShaderNodeAttribute')
        visible.attribute_type = 'OBJECT'
        visible.attribute_name = VISIBLE_PROPERTY
        tree.links.new(visible.outputs['Fac'], mix.inputs['Fac'])
        tree.links.new(transparent.outputs['BSDF'], mix.inputs[1])
        tree.links.new(principled.outputs[0], mix.inputs[2])
        tree.links.new(mix.outputs['Shader'], output.inputs['Surface'])
    return themes._shared(('MM · screen title ' if emissive else 'MM · title ') + color, build)


def title_range(entry, duration):
    """`(start, end)` seconds of a timed title, or None when it shows for the whole film"""
    start = entry.get('in')
    end = entry.get('out')
    start = max(0.0, finite(start, 'in')) if start is not None else 0.0
    end = finite(end, 'out') if end is not None else None
    if start <= 0.0 and (end is None or (duration is not None and end >= duration)):
        return None
    if end is None:
        end = float('inf')
    return start, max(start, end)


def write_timing(obj, entry, fps, duration):
    """Keys `mm_visible` and `hide_render` for a timed title, or clears them for a title shown throughout"""
    anim.clear_channels(obj, TIMING_PATHS)
    obj[VISIBLE_PROPERTY] = 1.0
    obj.hide_render = False
    span = title_range(entry, duration)
    if span is None:
        return
    start, end = span
    fade = min(FADE, (end - start) / 2) if math.isfinite(end) else FADE
    times, values = [], []
    if start > 0.0:
        times += [start, start + fade]
        values += [0.0, 1.0]
    if math.isfinite(end):
        times += [end - fade, end]
        values += [1.0, 0.0]
    channelbag = anim.ensure_channelbag(obj)
    anim.write_fcurve(channelbag, TIMING_PATHS[0], 0, [time * fps for time in times], values)
    # Hidden before `in` and from `out` on, so the ID pass cannot pick a title the film does not show
    hidden_times, hidden_values = [0.0], [1.0 if start > 0.0 else 0.0]
    if start > 0.0:
        hidden_times.append(start)
        hidden_values.append(0.0)
    if math.isfinite(end):
        hidden_times.append(end)
        hidden_values.append(1.0)
    curve = anim.write_fcurve(channelbag, TIMING_PATHS[1], 0, [time * fps for time in hidden_times], hidden_values)
    for point in curve.keyframe_points:
        point.interpolation = 'CONSTANT'
    obj[VISIBLE_PROPERTY] = values[0] if start > 0.0 else 1.0
    obj.hide_render = start > 0.0


def resolve_font(project_dir, name):
    if not isinstance(name, str) or not name:
        name = BUILTIN_FONT
    font = bpy.data.fonts.get(name)
    if font is not None:
        return font
    path = None
    candidate = Path(name)
    if candidate.suffix.lower() in ('.ttf', '.otf', '.ttc', '.woff', '.woff2', '.pfb'):
        try:
            path = candidate if candidate.is_absolute() else resolve_package_path(project_dir, name)
        except WorkerError:
            path = None
    if path is not None and path.is_file():
        font = bpy.data.fonts.load(str(path), check_existing=True)
        if font.packed_file is None:
            font.pack()
        return font
    # Unknown family names fall back to Blender's built-in font
    return bpy.data.fonts.get(BUILTIN_FONT) or bpy.data.fonts.load('<builtin>')


def signature(obj):
    data = obj.data
    # Camera drivers move screen titles every frame, so their place is the style and size instead of the transform
    screen = obj.get(SCREEN_PROPERTY)
    placement = ([screen, round(float(obj.get('mm_screen_size', 0.0)), 6), obj.parent.name if obj.parent else None] if screen
                 else [round(value, 6) for value in (*obj.location, *obj.rotation_euler, *obj.scale)])
    values = [
        placement,
        data.body, round(data.size, 6), round(data.extrude, 6), round(data.bevel_depth, 6),
        data.font.name if data.font else None,
        [material.name if material else None for material in data.materials],
        data.align_x, data.align_y,
    ]
    return hashlib.sha1(json.dumps(values).encode()).hexdigest()[:16]


def link_state(obj):
    if obj.get('mm_link') == 'unlinked':
        return 'unlinked'
    written = obj.get('mm_written')
    if written is not None and written != signature(obj):
        return 'unlinked'
    return 'linked'


def inspect(managed):
    return [
        {'mmId': obj['mm_id'], 'name': obj.name, 'text': obj.data.body, 'link': link_state(obj)}
        for obj in (managed.objects if managed else []) if is_text(obj)
    ]
