"""Headless check of the skin model: ids free of themes, theme parts, skin properties and marble skins.

Resolves the cases in `skin_look_cases.json` that `skin-catalog.test.ts` also runs, so TS and Python agree; builds every
skin in the catalog under every theme; applies a scene with a project theme's parts and per-piece overrides.

Run: Blender --background --factory-startup --python-exit-code 1 --python blender/tests/check_skins.py
"""
import json
import shutil
import sys
import tempfile
from pathlib import Path

import bpy
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from mm_worker import assets, skin_catalog, skin_materials, skins, themes  # noqa: E402
from mm_worker.ops import Worker  # noqa: E402
from mm_worker.util import parse_color  # noqa: E402

RADIUS = 0.008
summary = []


def check(condition, message):
    if not condition:
        raise AssertionError(message)
    summary.append('ok  ' + message)


def piece(skin=None, piece_type='platform', **extra):
    return {
        'id': piece_type, 'name': piece_type, 'type': piece_type, 'color': '#3478f6', 'position': {'x': 0.0, 'y': 0.0}, 'angle': 0.1,
        'params': {'length': 0.06, 'thickness': 0.008, 'depth': 0.03, 'radius': 0.0025, 'gap': 0.01, 'bore': 0.004, 'bladeCount': 4,
                   'bladeLength': 0.05, 'bladeThickness': 0.006, 'hubRadius': 0.008},
        'path': [{'x': -0.05, 'y': 0.0}, {'x': 0.05, 'y': -0.01}], 'paths': [[{'x': -0.05, 'y': 0.0}, {'x': 0.0, 'y': -0.02}, {'x': 0.05, 'y': 0.0}]],
        'skin': skin, **extra,
    }


def materials(spec):
    meshes = [spec['root'], *(part['mesh'] for part in spec['parts'])]
    return [material.name for mesh in meshes for material in mesh.materials]


def linked_skin(skin_id, **fields):
    return {'assetId': skin_id, **fields}


def check_parity():
    cases = json.loads((Path(__file__).with_name('skin_look_cases.json')).read_text())
    for case in cases:
        look = skin_catalog.resolve_look(case['base'], case.get('parts'), case['element'], case.get('component'))
        for field, value in case['expected'].items():
            check(look[field] == value, 'parity: %s: %s is %r, got %r' % (case['name'], field, value, look[field]))


def check_every_skin_in_every_theme():
    # The same skin builds the same materials whatever the theme: skins carry no theme
    for element, entry in skin_catalog.ELEMENTS.items():
        for skin in entry['skins']:
            names = {}
            for theme in themes.THEMES:
                context = skins.skin_context(theme, RADIUS)
                if element == 'marble':
                    if skin['id'] == 'marble:contrast':
                        continue
                    spec = skins.build_spec('marble', {'radius': RADIUS, 'color': '#3478f6', 'skin': linked_skin(skin['id'])}, context)
                else:
                    spec = skins.build_spec('piece', piece(linked_skin(skin['id']), element), context)
                names[theme] = materials(spec)
            check(len({json.dumps(value) for value in names.values()}) <= 1, '%s looks the same in every theme (%s)' % (skin['id'], names))
    # And each theme's default is its part
    for theme, element, skin in (('brass', 'rail', 'rail:chrome'), ('pegboard', 'tunnel', 'tunnel:wood'), ('neon', 'windmill', 'windmill:glow')):
        context = skins.skin_context(theme, RADIUS)
        check(materials(skins.build_spec('piece', piece(None, element), context)) == materials(skins.build_spec('piece', piece(linked_skin(skin), element), context)),
              "%s's default %s is %s" % (theme, element, skin))


def node_types(material):
    return {node.type for node in material.node_tree.nodes}


def check_long_posts():
    # Past the body's depth a skin keeps the bar's size and stands it out on a post; its body still reaches the marble's lane
    for skin in ('platform:plate-gold', 'platform:chrome-device', 'platform:dark-housing', 'platform:gold', 'platform:device'):
        def back_and_reach(depth):
            context = {**skins.skin_context('brass', RADIUS), 'pathDepth': depth / 2}
            part = piece(linked_skin(skin))
            part['params'] = {**part['params'], 'depth': depth}
            spec = skins.build_spec('piece', part, context)
            root = [vertex.co.y for vertex in spec['root'].vertices]
            bar = [vertex.co.y for vertex in spec['parts'][0]['mesh'].vertices]
            return depth / 2 - max(bar), max(root) - min(bar)
        short, _ = back_and_reach(0.05)
        long, _ = back_and_reach(0.1)
        check(short < 0.005 and long > 0.03, '%s stands out on a post only when deep (%.3f m at 5 cm, %.3f m at 10 cm)' % (skin, short, long))


def check_marbles():
    context = skins.skin_context('pegboard', RADIUS)
    marble = {'radius': RADIUS, 'color': '#3478f6'}

    def build(skin_id, **fields):
        return skins.build_spec('marble', {**marble, 'skin': linked_skin(skin_id, **fields)}, context)['root']

    meshes = {name: build('marble:' + name) for name in ('glass', 'metal', 'magic', 'pearl', 'deep')}
    for name, mesh in meshes.items():
        extent = max(abs(vertex.co.length - RADIUS) for vertex in mesh.vertices)
        check(extent < 1e-6, 'a %s marble is a sphere of the marble radius, so physics never changes with skin' % name)
    glass = meshes['glass'].materials[0]
    check('BSDF_TRANSPARENT' in node_types(glass) and glass.surface_render_method == 'BLENDED', 'Glass is a clear blended surface')
    swirl, cats_eye = glass.name, build('marble:glass', variant='cats-eye').materials[0].name
    check(swirl != cats_eye and 'cats-eye' in cats_eye, "Variant picks Glass's Cat's-Eye (%s)" % cats_eye)
    check('#3478f6' in swirl and skin_materials.GLASS_SKIN in build('marble:glass', colorSource='skin').materials[0].name, "Color picks Glass's swirl color")
    metal = meshes['metal'].materials[0]
    principled = themes._principled(metal)
    check(principled.inputs['Metallic'].default_value == 1.0 and 'steel' in metal.name, 'Metal is a steel ball bearing')
    check('#3478f6' in build('marble:metal', colorSource='marble').materials[0].name, 'Color: Marble tints the metal')
    magic = meshes['magic'].materials[0]
    check('TEX_NOISE' in node_types(magic) and not any(link.to_socket.name == 'Volume' for link in magic.node_tree.links), 'Magic is noise on a surface, with no volume to pay for')
    tree = magic.node_tree
    drivers = tree.animation_data.drivers if tree.animation_data else []
    check(len(drivers) == 1 and drivers[0].data_path.startswith('nodes["' + skin_materials.SMOKE_TIME_NODE), "Magic's smoke drifts with a driver")
    glow = build('marble:magic', glowColor='#00ff88').materials[0]
    check(glow.name != magic.name, 'Glow Color changes the smoke (%s)' % glow.name)
    deep = themes.deep_color('#3478f6')
    check(deep in meshes['deep'].materials[0].name, 'Deep is the marble hue made deep')
    check('pearl' in meshes['pearl'].materials[0].name, 'Pearl is the pearl marble')
    # The contrast rule still picks the theme's default
    default = skins.build_spec('marble', marble, context)['root']
    check(themes.marble_look('pegboard', '#3478f6')['body'] in default.materials[0].name, "a marble without a skin keeps its theme's contrast look")


def check_properties():
    brass = skins.skin_context('brass', RADIUS)
    names = materials(skins.build_spec('piece', dict(piece(None), notePitch=69), brass))
    check('MM · bar' not in ' '.join(names) and 'MM · brass' in names, 'Brass dresses a platform in Gold (%s)' % names)
    names = materials(skins.build_spec('piece', dict(piece({'colorSource': 'note'}), notePitch=69), brass))
    check('MM · note A' in names, 'Color: By Note on a selection without a skin of its own (%s)' % names)
    names = materials(skins.build_spec('piece', dict(piece(linked_skin('platform:copper', colorSource='note')), notePitch=69), brass))
    check('MM · note A' in names, 'Color: By Note on a chosen skin (%s)' % names)
    names = materials(skins.build_spec('piece', piece({'colorSource': 'marble'}), brass))
    check('MM · metal #3478f6' in names, 'Color: Marble tints a metal skin (%s)' % names)
    pegboard = skins.skin_context('pegboard', RADIUS)
    names = materials(skins.build_spec('piece', piece({'colorSource': 'skin'}), pegboard))
    check('MM · wood' in names and not any(name.startswith('MM · flat') for name in names), 'Color: Skin shows Pegboard bare (%s)' % names)
    names = materials(skins.build_spec('piece', piece(linked_skin('platform:device', variant='copper')), brass))
    check('MM · bar copper' in names, 'Variant picks a Device trim (%s)' % names)
    # On Hit
    check(skins.piece_reaction(piece({'onHit': 'wobble'}), brass)['wobble'] > 0, 'On Hit: Wobble wobbles')
    check(skins.piece_reaction(piece({'onHit': 'none'}), brass)['preset'] == 'none', 'On Hit: None stops the reaction')
    spec = skins.build_spec('piece', piece({'onHit': 'glow'}, 'rail'), brass)
    check(spec.get('flash', 0) > 0 and all(themes._principled(material).inputs['Emission Strength'].is_linked for material in spec['root'].materials),
          'On Hit: Glow flashes a piece with no moving part')
    # Glow Color
    spec = skins.build_spec('piece', piece({'onHit': 'glow', 'glowColor': '#00ff88'}), brass)
    bar = spec['parts'][0]['mesh'].materials[0]
    emission = themes._principled(bar).inputs['Emission Color'].default_value
    check(all(abs(a - b) < 1e-4 for a, b in zip(emission[:3], parse_color('#00ff88')[:3])) and '#00ff88' in bar.name, 'Glow Color sets the emission on a copy (%s)' % bar.name)
    # Theme parts and the old Color by Note option
    parts = {'platform': {'skin': 'platform:copper', 'onHit': 'wobble'}}
    context = skins.skin_context('neon', RADIUS, parts=parts)
    names = materials(skins.build_spec('piece', piece(None), context))
    check('MM · bar copper' in names, 'a project theme says platforms: Copper (%s)' % names)
    check(skins.piece_reaction(piece(None), context)['preset'] == 'wobble', 'a project theme says platforms: On Hit Wobble')
    # The key rebuilds a skin when a property changes
    keys = {skins.skin_key('piece', piece(fields or None), brass) for fields in ({}, {'colorSource': 'marble'}, {'glowColor': '#00ff88'}, {'onHit': 'glow'})}
    check(len(keys) == 4, 'each property change rebuilds the skin')


def check_extra_properties():
    material = bpy.data.materials.new('Ribbon')
    material.use_nodes = True
    tree = material.node_tree
    rgb = tree.nodes.new('ShaderNodeRGB')
    rgb.label = 'Ribbon Color'
    value = tree.nodes.new('ShaderNodeValue')
    value.label = 'Shine'
    mesh = bpy.data.meshes.new('Ribbon')
    mesh.materials.append(material)
    obj = bpy.data.objects.new('Ribbon', mesh)
    manifest = {'properties': [{'name': 'Ribbon Color', 'type': 'color'}, {'name': 'Shine', 'type': 'number', 'default': 0.5}, {'name': 'Missing', 'type': 'number', 'default': 1.0}]}
    values = assets.property_values(piece({'properties': {'Ribbon Color': '#ff0000'}}), manifest)
    check(values == {'Ribbon Color': '#ff0000', 'Shine': 0.5, 'Missing': 1.0}, 'manifest defaults sit under a piece value (%s)' % values)
    assets.apply_properties([obj], values)
    own = obj.material_slots[0].material
    check(own is not material, 'a skin with its own values wears a copy of the material')
    check(abs(own.node_tree.nodes[rgb.name].outputs[0].default_value[0] - 1.0) < 1e-4 and abs(own.node_tree.nodes[value.name].outputs[0].default_value - 0.5) < 1e-6,
          'extra properties reach named nodes; a missing name is ignored')
    check(abs(tree.nodes[value.name].outputs[0].default_value) < 1e-6, 'other pieces keep the shared material')


def check_apply():
    root = Path(tempfile.mkdtemp(prefix='mm-skins-')) / 'Skins.marble'
    (root / '.cache' / 'motion').mkdir(parents=True)
    np.array([[0.0, 0.0, 0.3, 0.0], [1.0, 0.1, 0.1, 3.0]], dtype='<f4').tofile(root / '.cache' / 'motion' / 'marble-1.bin')
    worker = Worker(root)

    def write(parts=None, marble_skin=None, piece_skin=None):
        description = {
            'version': 1, 'projectId': 'skins', 'revision': 1, 'fps': 30, 'duration': 1.0, 'frame': {'width': 9, 'height': 16}, 'theme': 'neon',
            'marbles': [{'id': 'marble-1', 'name': 'Marble', 'radius': RADIUS, 'color': '#3478f6', 'motionPath': '.cache/motion/marble-1.bin', 'sampleCount': 2, **({'skin': marble_skin} if marble_skin else {})}],
            'pieces': [{**piece(piece_skin), 'hitTimes': [0.5], 'motionPath': None, 'sampleCount': 0, 'wallOffset': 0.0}],
            **({'themeParts': parts} if parts else {}),
        }
        (root / '.cache' / 'scene.json').write_text(json.dumps(description))
        return worker.handle('apply_scene', {'descriptionPath': '.cache/scene.json'})

    def skin_of(mm_id):
        holder = next(obj for obj in bpy.context.scene.objects if obj.get('mm_id') == mm_id and obj.type == 'EMPTY')
        return holder.children[0]

    write()
    check(skin_of('marble-1').data.materials[0].name.startswith('MM · neon pearl'), "Neon's marble stays its pearl")
    write(parts={'platform': {'skin': 'platform:copper'}, 'marble': {'skin': 'marble:glass'}})
    check(skin_of('marble-1').data.materials[0].name.startswith('MM · glass swirl'), 'theme parts dress the marble as Glass')
    bar = next(child for child in skin_of('platform').children if child.get('mm_part') == 'bar')
    check('MM · bar copper' in [material.name for material in bar.data.materials], 'theme parts dress the platform as Copper')
    write(parts={'marble': {'skin': 'marble:glass'}}, marble_skin=linked_skin('marble:magic'), piece_skin={'colorSource': 'skin'})
    check(skin_of('marble-1').data.materials[0].name.startswith('MM · magic'), "a marble's own skin beats the theme's")
    # Magic drifts: its noise time moves with the frame
    material = skin_of('marble-1').data.materials[0]
    scene = bpy.context.scene
    scene.frame_set(0)
    first = material.node_tree.nodes[skin_materials.SMOKE_TIME_NODE].outputs[0].default_value
    scene.frame_set(20)
    second = material.node_tree.nodes[skin_materials.SMOKE_TIME_NODE].outputs[0].default_value
    check(second > first, "Magic's smoke drifts from frame to frame (%.4f, %.4f)" % (first, second))
    # Skins hide inside a tunnel like any marble: the visibility driver is on the one skin object
    check(bool(skin_of('marble-1').get('mm_visibility')), 'a skinned marble still hides inside a tunnel')
    write()
    check(skin_of('marble-1').data.materials[0].name.startswith('MM · neon pearl'), 'Reset to Theme brings the theme marble back')
    shutil.rmtree(root.parent, ignore_errors=True)


def check_gift_candy():
    brass = skins.skin_context('brass', RADIUS)
    thickness = 0.008
    for skin_id in ('platform:gift',):
        built = piece(linked_skin(skin_id))
        spec = skins.build_spec('piece', built, brass)
        bars = [part for part in spec['parts'] if part['role'] == 'bar']
        check(len(bars) == 1 and bars[0]['reactive'], '%s moves as one part on a hit' % skin_id)
        vertices = [vertex.co for vertex in bars[0]['mesh'].vertices]
        top = max(vertex.z for vertex in vertices)
        check(abs(top - thickness / 2) < 1e-4, '%s tops out at the contact surface, bow included (%.5f)' % (skin_id, top))
        flat = [vertex for vertex in vertices if abs(vertex.z - top) < 1e-3]
        check(max(vertex.x for vertex in flat) - min(vertex.x for vertex in flat) > 0.055, '%s has a flat top the whole length of the piece' % skin_id)
        frame = skins.PieceFrame(built, brass)
        check(max(vertex.y for vertex in vertices) <= frame.wall_y + 1e-4, '%s stops at the wall' % skin_id)
        check(min(vertex.y for vertex in vertices) < frame.marble_y - RADIUS * 0.8, '%s is deep enough for the marble to roll on' % skin_id)
        check(len(vertices) < 3000, '%s stays cheap (%d vertices)' % (skin_id, len(vertices)))
        ribbon = materials(skins.build_spec('piece', piece(linked_skin(skin_id, properties={'Ribbon Color': '#00ff88'})), brass))
        check(any('#00ff88' in name for name in ribbon), '%s takes its Ribbon Color (%s)' % (skin_id, ribbon))
        check(any('#3478f6' in name for name in materials(skins.build_spec('piece', piece(linked_skin(skin_id, colorSource='marble')), brass))), '%s takes Color: Marble' % skin_id)
        check(any('note' in name for name in materials(skins.build_spec('piece', dict(piece(linked_skin(skin_id, colorSource='note')), notePitch=69), brass))), '%s takes Color: By Note' % skin_id)
        check(skins.skin_key('piece', piece(linked_skin(skin_id)), brass) != skins.skin_key('piece', piece(linked_skin(skin_id, properties={'Ribbon Color': '#00ff88'})), brass),
              'a changed Ribbon Color rebuilds %s' % skin_id)
        glow = skins.build_spec('piece', piece(linked_skin(skin_id, onHit='glow')), brass)
        check(skins.piece_reaction(piece(linked_skin(skin_id, onHit='glow')), brass)['flash'] > 0 and glow['parts'], '%s can glow on a hit' % skin_id)
    # Each piece keeps its own wrapping on every apply, and the papers vary along a run
    papers = {tuple(materials(skins.build_spec('piece', dict(piece(linked_skin('platform:gift')), id='gift-%d' % index), brass))) for index in range(12)}
    check(len(papers) >= 3, 'a run of Gifts wears different papers (%d)' % len(papers))
    first = materials(skins.build_spec('piece', dict(piece(linked_skin('platform:gift')), id='gift-1'), brass))
    check(first == materials(skins.build_spec('piece', dict(piece(linked_skin('platform:gift')), id='gift-1'), brass)), 'a piece keeps its paper on every apply')

    for element in ('rail',):
        names = materials(skins.build_spec('piece', piece(linked_skin(element + ':candy'), element), brass))
        check(any(name.startswith('MM · candy #c8202c') for name in names), 'Candy %s is striped red and white (%s)' % (element, names))
        names = materials(skins.build_spec('piece', piece(linked_skin(element + ':candy', colorSource='marble'), element), brass))
        check(any(name.startswith('MM · candy #3478f6') for name in names), 'Candy %s takes Color: Marble' % element)
    marble = skins.build_spec('marble', {'radius': RADIUS, 'color': '#3478f6', 'skin': linked_skin('marble:glass-green')}, brass)
    check(materials(marble)[0].startswith('MM · glass swirl ' + skin_materials.GLASS_GREEN_SKIN), 'Green Glass has a green swirl (%s)' % materials(marble))
    check(abs(max(abs(vertex.co.length) for vertex in marble['root'].vertices) - RADIUS) < 1e-5, 'Green Glass keeps the marble radius')

    # A wall kind that left the app (an old project's Tinsel, moved to Plaster on load) keeps the theme's here too
    themes.set_scene_look('tinsel', None)
    check(themes.theme_settings('brass')['wall']['kind'] == 'plaster', 'an unknown wall kind keeps the theme')
    themes.set_scene_look(None, None)


def check_none():
    """The skin None wears the label color the scene builder passes, whatever the theme"""
    label = parse_color('#c8102e')[:3]
    for theme in ('pegboard', 'brass', 'neon'):
        context = skins.skin_context(theme, RADIUS)
        for element in ('platform', 'rail', 'tunnel', 'windmill', 'bowl'):
            entity = piece(linked_skin(element + ':none'), element, color='#c8102e')
            spec = skins.build_spec('piece', entity, context)
            meshes = [spec['root'], *(part['mesh'] for part in spec['parts'])]
            colors = [node.inputs['Base Color'].default_value[:3] for mesh in meshes for material in mesh.materials for node in (material.node_tree.nodes if material.use_nodes else []) if node.type == 'BSDF_PRINCIPLED']
            check(any(np.allclose(color, label, atol=0.02) for color in colors), 'None %s in %s wears its label color (%s)' % (element, theme, materials(spec)))
        marble = skins.build_spec('marble', {'radius': RADIUS, 'color': '#c8102e', 'skin': linked_skin('marble:none')}, context)
        names = materials(marble)
        tree_colors = [node.inputs['Base Color'].default_value[:3] for mesh in [marble['root']] for material in mesh.materials for node in material.node_tree.nodes if node.type == 'BSDF_PRINCIPLED']
        check(any(np.allclose(color, label, atol=0.02) for color in tree_colors), 'None marble in %s wears its label color (%s)' % (theme, names))


bpy.ops.wm.read_homefile(use_empty=True)
check_parity()
check_none()
check_gift_candy()
check_every_skin_in_every_theme()
check_marbles()
check_properties()
check_extra_properties()
check_apply()
check_long_posts()
print('\n'.join(summary))
print('CHECK PASSED: %d assertions' % len(summary))
