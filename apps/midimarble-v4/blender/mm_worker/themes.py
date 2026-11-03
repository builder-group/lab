"""Themes as data: studio lighting, wall, render look and the materials default skins use.

Materials are shared, app-created and keyed by name. An existing material is never changed, so a user's edit of
an app material in Blender survives every apply. Studio objects (wall, sun, world) are re-themed only while they
still hold what the app last wrote.
"""
import math

import bpy

from .util import parse_color

DEFAULT_THEME = 'pegboard'

THEMES = {
    'pegboard': {
        'wall': {'kind': 'pegboard'},
        # Travel direction of the sunlight in wall terms: right, into the wall, down
        'sun': {'energy': 3.2, 'angle': 12.0, 'color': (1.0, 0.96, 0.9), 'direction': (0.62, 0.62, -0.48)},
        'world': {'color': (0.72, 0.74, 0.78), 'strength': 0.55},
        'look': 'AgX - Base Contrast',
        'exposure': 0.0,
        'fstop': 8.0,
        'reactions': {'dip': 3.0, 'press': 0.0012, 'flash': 0.0},
    },
    'brass': {
        'wall': {'kind': 'plaster', 'color': (0.42, 0.355, 0.53)},
        # A wide sun and a stronger fill keep the long diagonal shadows soft and light like the reference
        'sun': {'energy': 5.2, 'angle': 16.0, 'color': (1.0, 0.95, 0.88), 'direction': (0.82, 0.40, -0.36)},
        'world': {'color': (0.53, 0.50, 0.62), 'strength': 1.0, 'studio': True},
        'look': 'AgX - Medium High Contrast',
        'exposure': -1.25,
        'fstop': 8.0,
        'reactions': {'dip': 3.0, 'press': 0.0012, 'flash': 0.0},
    },
}


def theme_settings(name):
    return THEMES.get(name) or THEMES[DEFAULT_THEME]


def theme_name(name):
    return name if name in THEMES else DEFAULT_THEME


# Materials


def _new_material(name):
    material = bpy.data.materials.new(name)
    material['mm_owner'] = 'midimarble'
    material.use_nodes = True
    return material


def _principled(material):
    return material.node_tree.nodes.get('Principled BSDF')


def _set(principled, name, value):
    socket = principled.inputs.get(name)
    if socket is not None:
        socket.default_value = value


def _shared(name, build):
    existing = bpy.data.materials.get(name)
    if existing is not None:
        return existing
    material = _new_material(name)
    build(material)
    return material


def _flash_emission(material, color):
    """Emission driven by the object property `mm_flash` that reaction drivers set"""
    tree = material.node_tree
    principled = _principled(material)
    attribute = tree.nodes.new('ShaderNodeAttribute')
    attribute.attribute_type = 'OBJECT'
    attribute.attribute_name = 'mm_flash'
    tree.links.new(attribute.outputs['Fac'], principled.inputs['Emission Strength'])
    _set(principled, 'Emission Color', color)


def flat_material(color, roughness=0.5, coat=0.0, flash=True):
    """Pegboard toy material: a flat color with an optional clear coat"""
    def build(material):
        linear = parse_color(color)
        material.diffuse_color = linear
        principled = _principled(material)
        _set(principled, 'Base Color', linear)
        _set(principled, 'Roughness', roughness)
        _set(principled, 'Coat Weight', coat)
        _set(principled, 'Coat Roughness', 0.08)
        if flash:
            _flash_emission(material, linear)
    return _shared('MM · flat ' + color + ' r%.2f c%.1f' % (roughness, coat), build)


def wood_material():
    def build(material):
        tree = material.node_tree
        principled = _principled(material)
        coordinates = tree.nodes.new('ShaderNodeTexCoord')
        wave = tree.nodes.new('ShaderNodeTexWave')
        wave.inputs['Scale'].default_value = 180.0
        wave.inputs['Distortion'].default_value = 6.0
        ramp = tree.nodes.new('ShaderNodeValToRGB')
        ramp.color_ramp.elements[0].color = (0.42, 0.24, 0.10, 1.0)
        ramp.color_ramp.elements[1].color = (0.62, 0.40, 0.20, 1.0)
        tree.links.new(coordinates.outputs['Object'], wave.inputs['Vector'])
        tree.links.new(wave.outputs['Fac'], ramp.inputs['Fac'])
        tree.links.new(ramp.outputs['Color'], principled.inputs['Base Color'])
        _set(principled, 'Roughness', 0.55)
        material.diffuse_color = (0.55, 0.35, 0.18, 1.0)
    return _shared('MM · wood', build)


# Bar finishes: base color, metallic, roughness range and coat. Gold is the reference's brushed brass.
FINISHES = {
    'gold': {'base': (1.0, 0.68, 0.2), 'metallic': 1.0, 'roughness': (0.12, 0.24), 'coat': 0.0},
    'copper': {'base': (0.93, 0.42, 0.24), 'metallic': 1.0, 'roughness': (0.22, 0.36), 'coat': 0.0},
    'silver': {'base': (0.46, 0.48, 0.52), 'metallic': 1.0, 'roughness': (0.14, 0.26), 'coat': 0.0},
    'dark': {'base': (0.035, 0.038, 0.045), 'metallic': 0.0, 'roughness': (0.30, 0.42), 'coat': 0.6},
}


def brass_material():
    return bar_material('gold')


def bar_material(finish):
    """Brushed bar metal: streaked roughness along the bar (object X) with anisotropic highlights"""
    finish = finish if finish in FINISHES else 'gold'
    spec = FINISHES[finish]

    def build(material):
        tree = material.node_tree
        principled = _principled(material)
        base = (*spec['base'], 1.0)
        material.diffuse_color = base
        _set(principled, 'Base Color', base)
        _set(principled, 'Metallic', spec['metallic'])
        _set(principled, 'Anisotropic', 0.6 if spec['metallic'] else 0.0)
        _set(principled, 'Coat Weight', spec['coat'])
        _set(principled, 'Coat Roughness', 0.05)
        coordinates = tree.nodes.new('ShaderNodeTexCoord')
        mapping = tree.nodes.new('ShaderNodeMapping')
        mapping.inputs['Scale'].default_value = (3.0, 1400.0, 1400.0)
        noise = tree.nodes.new('ShaderNodeTexNoise')
        noise.inputs['Scale'].default_value = 1.0
        noise.inputs['Detail'].default_value = 6.0
        roughness = tree.nodes.new('ShaderNodeMapRange')
        roughness.inputs['From Min'].default_value = 0.3
        roughness.inputs['From Max'].default_value = 0.7
        roughness.inputs['To Min'].default_value = spec['roughness'][0]
        roughness.inputs['To Max'].default_value = spec['roughness'][1]
        tree.links.new(coordinates.outputs['Object'], mapping.inputs['Vector'])
        tree.links.new(mapping.outputs['Vector'], noise.inputs['Vector'])
        tree.links.new(noise.outputs['Fac'], roughness.inputs['Value'])
        tree.links.new(roughness.outputs['Result'], principled.inputs['Roughness'])
        # Brushing streaks also darken the base slightly so the grain reads at film resolution
        grain = tree.nodes.new('ShaderNodeMix')
        grain.data_type = 'RGBA'
        grain.blend_type = 'MULTIPLY'
        grain.inputs['Factor'].default_value = 0.1
        grain.inputs['A'].default_value = base
        tree.links.new(noise.outputs['Color'], grain.inputs['B'])
        tree.links.new(grain.outputs['Result'], principled.inputs['Base Color'])
        tangent = tree.nodes.new('ShaderNodeTangent')
        tangent.direction_type = 'RADIAL'
        tangent.axis = 'X'
        tree.links.new(tangent.outputs['Tangent'], principled.inputs['Tangent'])
        _flash_emission(material, base)
    return _shared('MM · brass' if finish == 'gold' else 'MM · bar ' + finish, build)


def plastic_material(name, color, roughness, coat=0.0, flash=False):
    """Smooth plastic such as a white key or a grille's dark inside"""
    def build(material):
        base = (*color, 1.0)
        material.diffuse_color = base
        principled = _principled(material)
        _set(principled, 'Base Color', base)
        _set(principled, 'Roughness', roughness)
        _set(principled, 'Coat Weight', coat)
        _set(principled, 'Coat Roughness', 0.05)
        if flash:
            _flash_emission(material, base)
    return _shared('MM · ' + name, build)


# Note colours for Colour by Note, one per pitch class from C, after the boomwhacker colour wheel
NOTE_COLORS = (
    (0.86, 0.12, 0.12), (0.93, 0.33, 0.10), (0.98, 0.55, 0.10), (0.98, 0.75, 0.12),
    (0.95, 0.87, 0.16), (0.60, 0.84, 0.18), (0.20, 0.70, 0.32), (0.12, 0.62, 0.62),
    (0.18, 0.42, 0.86), (0.44, 0.26, 0.82), (0.64, 0.22, 0.74), (0.88, 0.26, 0.58),
)
NOTE_NAMES = ('C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B')


def note_color(pitch):
    """Linear colour of a MIDI pitch's pitch class, or None without a pitch. The table is in display (sRGB) values,
    so it is converted to the linear values Blender's shaders expect; that keeps the colours saturated"""
    if pitch is None:
        return None
    return tuple(_srgb_to_linear(value) for value in NOTE_COLORS[int(round(pitch)) % 12])


def note_material(pitch):
    """Glossy coloured plastic like a boomwhacker tube, shared per pitch class; flashes on a hit"""
    index = int(round(pitch)) % 12
    return plastic_material('note ' + NOTE_NAMES[index], note_color(index), 0.26, coat=0.7, flash=True)


def _srgb_to_linear(value):
    return value / 12.92 if value <= 0.04045 else ((value + 0.055) / 1.055) ** 2.4


def key_material():
    return plastic_material('key', (0.86, 0.87, 0.88), 0.22, coat=0.4, flash=True)


def housing_material():
    """Dark coated device housing; it never flashes, so a glowing lens on it stays the only light"""
    return plastic_material('housing', (0.035, 0.038, 0.045), 0.34, coat=0.6)


def slot_material():
    return plastic_material('slot', (0.012, 0.012, 0.016), 0.6)


def glow_material(color, idle=1.6):
    """Lit lens: a steady glow of strength `idle` that the reaction's `mm_flash` raises"""
    def build(material):
        tree = material.node_tree
        principled = _principled(material)
        base = (*color, 1.0)
        material.diffuse_color = base
        _set(principled, 'Base Color', base)
        _set(principled, 'Roughness', 0.18)
        _set(principled, 'Coat Weight', 1.0)
        _set(principled, 'Coat Roughness', 0.03)
        _set(principled, 'Emission Color', base)
        attribute = tree.nodes.new('ShaderNodeAttribute')
        attribute.attribute_type = 'OBJECT'
        attribute.attribute_name = 'mm_flash'
        strength = tree.nodes.new('ShaderNodeMath')
        strength.operation = 'ADD'
        strength.inputs[1].default_value = idle
        tree.links.new(attribute.outputs['Fac'], strength.inputs[0])
        tree.links.new(strength.outputs['Value'], principled.inputs['Emission Strength'])
    return _shared('MM · glow %.2f %.2f %.2f' % color, build)


def chrome_material():
    def build(material):
        principled = _principled(material)
        base = (0.88, 0.89, 0.92, 1.0)
        material.diffuse_color = base
        _set(principled, 'Base Color', base)
        _set(principled, 'Metallic', 1.0)
        _set(principled, 'Roughness', 0.09)
    return _shared('MM · chrome', build)


def frosted_material():
    """Satin frosted metal tube; opaque so the marble disappears inside it like in the film"""
    def build(material):
        principled = _principled(material)
        base = (0.80, 0.82, 0.87, 1.0)
        material.diffuse_color = base
        _set(principled, 'Base Color', base)
        _set(principled, 'Metallic', 0.65)
        _set(principled, 'Roughness', 0.38)
        _set(principled, 'Coat Weight', 0.5)
        _set(principled, 'Coat Roughness', 0.1)
    return _shared('MM · frosted tube', build)


def glass_marble_material(color):
    """Glass marble with a colored swirl core: glossy glass at the rim, a swirled core where the sphere faces the camera"""
    def build(material):
        tree = material.node_tree
        nodes, links = tree.nodes, tree.links
        output = nodes.get('Material Output')
        glass = _principled(material)
        linear = parse_color(color)
        material.diffuse_color = linear
        tint = tuple(0.25 + 0.75 * channel for channel in linear[:3]) + (1.0,)
        _set(glass, 'Base Color', tint)
        _set(glass, 'Roughness', 0.02)
        _set(glass, 'Transmission Weight', 1.0)
        _set(glass, 'IOR', 1.5)
        _set(glass, 'Coat Weight', 0.0)
        core = nodes.new('ShaderNodeBsdfPrincipled')
        coordinates = nodes.new('ShaderNodeTexCoord')
        wave = nodes.new('ShaderNodeTexWave')
        wave.wave_type = 'BANDS'
        wave.bands_direction = 'DIAGONAL'
        # Generated coordinates span the sphere once, so the swirl has the same size on any marble
        wave.inputs['Scale'].default_value = 1.1
        wave.inputs['Distortion'].default_value = 4.0
        wave.inputs['Detail'].default_value = 1.5
        wave.inputs['Detail Scale'].default_value = 1.0
        # Mostly the marble colour, with a thin lighter swirl band
        ramp = nodes.new('ShaderNodeValToRGB')
        deep = tuple(channel * 0.55 for channel in linear[:3]) + (1.0,)
        light = tuple(min(1.0, 0.12 + channel * 1.1) for channel in linear[:3]) + (1.0,)
        ramp.color_ramp.elements[0].color = deep
        ramp.color_ramp.elements[0].position = 0.3
        ramp.color_ramp.elements[1].color = linear
        ramp.color_ramp.elements[1].position = 0.92
        middle = ramp.color_ramp.elements.new(0.62)
        middle.color = linear
        band = ramp.color_ramp.elements.new(0.8)
        band.color = light
        links.new(coordinates.outputs['Generated'], wave.inputs['Vector'])
        links.new(wave.outputs['Fac'], ramp.inputs['Fac'])
        links.new(ramp.outputs['Color'], core.inputs['Base Color'])
        core.inputs['Roughness'].default_value = 0.25
        core.inputs['Coat Weight'].default_value = 1.0
        core.inputs['Coat Roughness'].default_value = 0.02
        # Light scattered inside the glass keeps the core luminous instead of a dark opaque ball
        links.new(ramp.outputs['Color'], core.inputs['Emission Color'])
        core.inputs['Emission Strength'].default_value = 0.2
        # The core shows through the middle of the sphere, the clear glass at the rim
        weight = nodes.new('ShaderNodeLayerWeight')
        weight.inputs['Blend'].default_value = 0.35
        curve = nodes.new('ShaderNodeMath')
        curve.operation = 'POWER'
        curve.inputs[1].default_value = 0.6
        links.new(weight.outputs['Facing'], curve.inputs[0])
        mix = nodes.new('ShaderNodeMixShader')
        links.new(curve.outputs['Value'], mix.inputs['Fac'])
        links.new(core.outputs['BSDF'], mix.inputs[1])
        links.new(glass.outputs['BSDF'], mix.inputs[2])
        links.new(mix.outputs['Shader'], output.inputs['Surface'])
        material.use_raytrace_refraction = True
    return _shared('MM · glass marble ' + color, build)


def glossy_marble_material(color):
    def build(material):
        linear = parse_color(color)
        material.diffuse_color = linear
        principled = _principled(material)
        _set(principled, 'Base Color', linear)
        _set(principled, 'Roughness', 0.12)
        _set(principled, 'Coat Weight', 0.6)
    return _shared('MM · marble ' + color, build)


def plaster_wall_material(color):
    """Matte painted wall with low-frequency mottling and a fine bump"""
    def build(material):
        tree = material.node_tree
        nodes, links = tree.nodes, tree.links
        principled = _principled(material)
        base = (*color, 1.0)
        material.diffuse_color = base
        coordinates = nodes.new('ShaderNodeTexCoord')
        mottle = nodes.new('ShaderNodeTexNoise')
        mottle.inputs['Scale'].default_value = 6.0
        mottle.inputs['Detail'].default_value = 3.0
        tint = nodes.new('ShaderNodeMix')
        tint.data_type = 'RGBA'
        tint.inputs['A'].default_value = tuple(channel * 0.94 for channel in color) + (1.0,)
        tint.inputs['B'].default_value = tuple(min(1.0, channel * 1.04) for channel in color) + (1.0,)
        links.new(coordinates.outputs['Object'], mottle.inputs['Vector'])
        links.new(mottle.outputs['Fac'], tint.inputs['Factor'])
        links.new(tint.outputs['Result'], principled.inputs['Base Color'])
        grain = nodes.new('ShaderNodeTexNoise')
        grain.inputs['Scale'].default_value = 900.0
        grain.inputs['Detail'].default_value = 2.0
        bump = nodes.new('ShaderNodeBump')
        bump.inputs['Strength'].default_value = 0.08
        bump.inputs['Distance'].default_value = 0.0003
        links.new(coordinates.outputs['Object'], grain.inputs['Vector'])
        links.new(grain.outputs['Fac'], bump.inputs['Height'])
        links.new(bump.outputs['Normal'], principled.inputs['Normal'])
        _set(principled, 'Roughness', 0.88)
    return _shared('MM · wall plaster', build)


def pegboard_wall_material(pitch):
    """Hardboard with recessed peg holes on a regular grid"""
    def build(material):
        tree = material.node_tree
        nodes, links = tree.nodes, tree.links
        principled = _principled(material)
        material.diffuse_color = (0.55, 0.42, 0.28, 1.0)
        coordinates = nodes.new('ShaderNodeTexCoord')
        mapping = nodes.new('ShaderNodeMapping')
        mapping.inputs['Scale'].default_value = (1 / pitch, 1 / pitch, 1.0)
        fraction = nodes.new('ShaderNodeVectorMath')
        fraction.operation = 'FRACTION'
        center = nodes.new('ShaderNodeVectorMath')
        center.operation = 'SUBTRACT'
        center.inputs[1].default_value = (0.5, 0.5, 0.0)
        length = nodes.new('ShaderNodeVectorMath')
        length.operation = 'LENGTH'
        ramp = nodes.new('ShaderNodeValToRGB')
        ramp.color_ramp.interpolation = 'EASE'
        ramp.color_ramp.elements[0].position = 0.13
        ramp.color_ramp.elements[0].color = (0.03, 0.02, 0.015, 1.0)
        ramp.color_ramp.elements[1].position = 0.16
        ramp.color_ramp.elements[1].color = (0.58, 0.42, 0.26, 1.0)
        links.new(coordinates.outputs['Object'], mapping.inputs['Vector'])
        links.new(mapping.outputs['Vector'], fraction.inputs[0])
        links.new(fraction.outputs['Vector'], center.inputs[0])
        links.new(center.outputs['Vector'], length.inputs[0])
        links.new(length.outputs['Value'], ramp.inputs['Fac'])
        grain = nodes.new('ShaderNodeTexNoise')
        grain.inputs['Scale'].default_value = 400.0
        tint = nodes.new('ShaderNodeMix')
        tint.data_type = 'RGBA'
        tint.blend_type = 'MULTIPLY'
        tint.inputs['Factor'].default_value = 0.15
        links.new(coordinates.outputs['Object'], grain.inputs['Vector'])
        links.new(ramp.outputs['Color'], tint.inputs['A'])
        links.new(grain.outputs['Color'], tint.inputs['B'])
        links.new(tint.outputs['Result'], principled.inputs['Base Color'])
        bump = nodes.new('ShaderNodeBump')
        bump.inputs['Strength'].default_value = 0.6
        bump.inputs['Distance'].default_value = 0.002
        links.new(ramp.outputs['Alpha'], bump.inputs['Height'])
        links.new(bump.outputs['Normal'], principled.inputs['Normal'])
        _set(principled, 'Roughness', 0.8)
    return _shared('MM · pegboard', build)


def wall_material(theme, pitch):
    wall = theme_settings(theme)['wall']
    if wall['kind'] == 'plaster':
        return plaster_wall_material(wall['color'])
    return pegboard_wall_material(pitch)


# Render look


def sun_rotation(direction):
    """Euler rotation of a sun whose light travels along `direction` given as (right, into wall, down)"""
    from mathutils import Vector
    travel = Vector((direction[0], direction[1], direction[2])).normalized()
    return travel.to_track_quat('-Z', 'Y').to_euler()


def apply_render_look(scene, theme):
    """Engine, color management and Eevee quality for a theme. Runs when the theme changes, not on every apply."""
    settings = theme_settings(theme)
    scene.render.engine = 'BLENDER_EEVEE'
    scene.view_settings.view_transform = 'AgX'
    try:
        scene.view_settings.look = settings['look']
    except TypeError:
        pass
    scene.view_settings.exposure = settings['exposure']
    eevee = scene.eevee
    eevee.taa_render_samples = 64
    eevee.use_shadows = True
    eevee.shadow_ray_count = 2
    eevee.shadow_step_count = 8
    eevee.use_raytracing = True
    eevee.ray_tracing_method = 'SCREEN'
    eevee.use_fast_gi = True
    eevee.fast_gi_method = 'GLOBAL_ILLUMINATION'
    try:
        eevee.ray_tracing_options.resolution_scale = '2'
        eevee.ray_tracing_options.use_denoise = True
    except (AttributeError, TypeError):
        pass
    scene.render.film_transparent = False
    scene.render.use_motion_blur = False
    # Cycles settings are prepared so switching the engine gives a good final render
    cycles = getattr(scene, 'cycles', None)
    if cycles is not None:
        cycles.samples = 128
        cycles.use_denoising = True
        cycles.max_bounces = 8
        cycles.glossy_bounces = 4
        cycles.transmission_bounces = 8
        cycles.caustics_reflective = False
        cycles.caustics_refractive = False
        cycles.blur_glossy = 1.0


def sun_settings(theme):
    sun = theme_settings(theme)['sun']
    return {
        'energy': sun['energy'],
        'angle': math.radians(sun['angle']),
        'color': sun['color'],
        'rotation': tuple(sun_rotation(sun['direction'])),
    }


STUDIO_NODE = 'MM studio environment'


def studio_environment(world, settings):
    """Soft studio surroundings for metal reflections: bright above, darker below, with large soft patches.

    The nodes feed the Background color only while `settings['studio']` is set; the Background node's own color
    input stays the theme color either way, so the world signature and Blender edits behave the same.
    """
    tree = world.node_tree
    nodes, links = tree.nodes, tree.links
    background = nodes['Background']
    for node in [node for node in nodes if node.get('mm_studio')]:
        nodes.remove(node)
    if not settings.get('studio'):
        return
    coordinates = nodes.new('ShaderNodeTexCoord')
    separate = nodes.new('ShaderNodeSeparateXYZ')
    links.new(coordinates.outputs['Generated'], separate.inputs['Vector'])
    gradient = nodes.new('ShaderNodeMapRange')
    gradient.inputs['From Min'].default_value = -0.4
    gradient.inputs['From Max'].default_value = 0.9
    links.new(separate.outputs['Z'], gradient.inputs['Value'])
    patches = nodes.new('ShaderNodeTexNoise')
    patches.inputs['Scale'].default_value = 2.2
    patches.inputs['Detail'].default_value = 1.0
    links.new(coordinates.outputs['Generated'], patches.inputs['Vector'])
    sharpen = nodes.new('ShaderNodeMapRange')
    sharpen.inputs['From Min'].default_value = 0.45
    sharpen.inputs['From Max'].default_value = 0.62
    links.new(patches.outputs['Fac'], sharpen.inputs['Value'])
    combine = nodes.new('ShaderNodeMath')
    combine.operation = 'MULTIPLY_ADD'
    combine.inputs[1].default_value = 0.6
    links.new(sharpen.outputs['Result'], combine.inputs[0])
    links.new(gradient.outputs['Result'], combine.inputs[2])
    ramp = nodes.new('ShaderNodeValToRGB')
    ramp.color_ramp.elements[0].position = 0.0
    ramp.color_ramp.elements[0].color = (0.01, 0.01, 0.015, 1.0)
    ramp.color_ramp.elements[1].position = 1.0
    ramp.color_ramp.elements[1].color = (3.0, 2.9, 3.1, 1.0)
    middle = ramp.color_ramp.elements.new(0.5)
    middle.color = (*settings['color'], 1.0)
    links.new(combine.outputs['Value'], ramp.inputs['Fac'])
    links.new(ramp.outputs['Color'], background.inputs['Color'])
    for node in (coordinates, separate, gradient, patches, sharpen, combine, ramp):
        node['mm_studio'] = True
