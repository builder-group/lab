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
        'flat': {'exposure': 0.05, 'sheen': 0.025},
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
        'flat': {'exposure': 1.05, 'sheen': 0.025},
        'fstop': 8.0,
        'reactions': {'dip': 3.0, 'press': 0.0012, 'flash': 0.0},
    },
    'neon': {
        # Deep navy wall with a faint grid; saturated glossy pieces whose front trim glows and flashes on a hit
        'wall': {'kind': 'neon', 'color': (0.006, 0.008, 0.02), 'grid': (0.013, 0.019, 0.05)},
        # A cool key from the upper left; the dark wall keeps its shadows from reading as dirt
        'sun': {'energy': 2.6, 'angle': 10.0, 'color': (0.86, 0.92, 1.0), 'direction': (0.55, 0.62, -0.56)},
        # Studio patches give the glossy marbles and bodies their highlights; the navy keeps the fill cool
        'world': {'color': (0.05, 0.06, 0.12), 'strength': 0.7, 'studio': True},
        # Back light: a second sun from behind the pieces that only catches their top and side edges
        'rim': {'energy': 4.0, 'angle': 8.0, 'color': (0.7, 0.85, 1.0), 'direction': (-0.35, -0.75, -0.55)},
        'look': 'AgX - Punchy',
        'exposure': 0.0,
        'flat': {'exposure': 0.4, 'sheen': 0.012},
        'fstop': 8.0,
        'reactions': {'dip': 3.0, 'press': 0.0012, 'flash': 9.0},
    },
}


# Colours a project theme changes on top of its base, as `#rrggbb` display values; the same fields as
# `TSceneThemeOverrides` in scene-description.ts. Set for one apply by `set_overrides`.
OVERRIDE_FIELDS = ('wallColor', 'lightColor', 'glowColor', 'backgroundColor')
_overrides = {}


def clean_overrides(overrides):
    """The valid `#rrggbb` fields of a scene description's `themeOverrides`, lowercased"""
    cleaned = {}
    for field in OVERRIDE_FIELDS:
        value = (overrides or {}).get(field) if isinstance(overrides, dict) else None
        if isinstance(value, str) and len(value) == 7 and value.startswith('#'):
            try:
                int(value[1:], 16)
            except ValueError:
                continue
            cleaned[field] = value.lower()
    return cleaned


def set_overrides(overrides):
    """Project theme colours for the apply that follows; None or {} draws the built-in theme as it is"""
    global _overrides
    _overrides = clean_overrides(overrides)


def resolve_theme(name, overrides=None):
    """Settings of a built-in theme with a project theme's colours on top. Mirrors `resolveTheme` and
    `sceneThemeOverrides` in project-themes.ts: the base keeps its skins, reactions and render look."""
    base = THEMES.get(name) or THEMES[DEFAULT_THEME]
    overrides = clean_overrides(overrides)
    if not overrides:
        return base
    settings = {key: dict(value) if isinstance(value, dict) else value for key, value in base.items()}
    if 'wallColor' in overrides:
        settings['wall']['color'] = parse_color(overrides['wallColor'])[:3]
        if 'grid' in settings['wall']:
            # The grid lines stay a faint lighter shade of the new wall
            settings['wall']['grid'] = tuple(min(1.0, channel * 2.4 + 0.004) for channel in settings['wall']['color'])
    if 'lightColor' in overrides:
        settings['sun']['color'] = parse_color(overrides['lightColor'])[:3]
    if 'backgroundColor' in overrides:
        settings['world']['color'] = parse_color(overrides['backgroundColor'])[:3]
    if 'glowColor' in overrides:
        settings['glow'] = parse_color(overrides['glowColor'])[:3]
    return settings


def theme_settings(name):
    return resolve_theme(name, _overrides)


def theme_name(name):
    return name if name in THEMES else DEFAULT_THEME


def theme_key(name):
    """What the studio was last themed with: the base name, plus the project theme's colours when it has any"""
    name = theme_name(name)
    if not _overrides:
        return name
    return name + ' ' + ' '.join('%s=%s' % (field, _overrides[field]) for field in sorted(_overrides))


def flat_look(key):
    """(stops, sheen) Flat Light adds in the theme of `theme_key`: to the scene's exposure, for the light Eevee's sun and
    world put on a wall facing the camera, and to the colour of a painted surface, for its satin reflections. Measured
    per theme against Fast frames; a project theme keeps its base's values."""
    flat = THEMES.get(str(key).split(' ')[0], {}).get('flat', {})
    return flat.get('exposure', 0.0), flat.get('sheen', 0.0)


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


def clear_material():
    """Clear acrylic, for a Finish's covered run-out: nearly invisible but for its highlights, so the marble shows
    through it"""
    def build(material):
        principled = _principled(material)
        base = (0.95, 0.97, 1.0, 1.0)
        material.diffuse_color = (0.95, 0.97, 1.0, 0.25)
        _set(principled, 'Base Color', base)
        _set(principled, 'Roughness', 0.04)
        _set(principled, 'Alpha', 0.14)
        _set(principled, 'Coat Weight', 1.0)
        _set(principled, 'Coat Roughness', 0.02)
        if hasattr(material, 'surface_render_method'):
            material.surface_render_method = 'BLENDED'
        if hasattr(material, 'use_backface_culling'):
            material.use_backface_culling = False
    return _shared('MM · clear acrylic', build)


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


def _wall_name(name, color, default):
    """A wall material per colour; the base theme's own colour keeps the original name"""
    if default is not None and all(abs(a - b) < 1e-4 for a, b in zip(color, default)):
        return name
    return name + ' %.4f %.4f %.4f' % tuple(color[:3])


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
    return _shared(_wall_name('MM · wall plaster', color, THEMES['brass']['wall']['color']), build)


PEGBOARD_COLOR = (0.58, 0.42, 0.26)


def pegboard_wall_material(pitch, color=PEGBOARD_COLOR):
    """Hardboard in `color` with recessed peg holes on a regular grid"""
    color = tuple(color[:3])

    def build(material):
        tree = material.node_tree
        nodes, links = tree.nodes, tree.links
        principled = _principled(material)
        material.diffuse_color = (*(channel * 0.95 for channel in color), 1.0)
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
        ramp.color_ramp.elements[1].color = (*color, 1.0)
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
    return _shared(_wall_name('MM · pegboard', color, PEGBOARD_COLOR), build)


def neon_wall_material(color, grid, spacing=0.05):
    """Deep navy wall with faint grid lines every `spacing` metres and a soft satin sheen"""
    def build(material):
        tree = material.node_tree
        nodes, links = tree.nodes, tree.links
        principled = _principled(material)
        material.diffuse_color = (*color, 1.0)
        coordinates = nodes.new('ShaderNodeTexCoord')
        mapping = nodes.new('ShaderNodeMapping')
        mapping.inputs['Scale'].default_value = (1 / spacing, 1 / spacing, 1.0)
        # Distance to the nearest grid line along x and y, as a share of the cell
        fraction = nodes.new('ShaderNodeVectorMath')
        fraction.operation = 'FRACTION'
        centre = nodes.new('ShaderNodeVectorMath')
        centre.operation = 'SUBTRACT'
        centre.inputs[1].default_value = (0.5, 0.5, 0.0)
        absolute = nodes.new('ShaderNodeVectorMath')
        absolute.operation = 'ABSOLUTE'
        separate = nodes.new('ShaderNodeSeparateXYZ')
        nearest = nodes.new('ShaderNodeMath')
        nearest.operation = 'MAXIMUM'
        line = nodes.new('ShaderNodeMapRange')
        line.inputs['From Min'].default_value = 0.485
        line.inputs['From Max'].default_value = 0.5
        links.new(coordinates.outputs['Object'], mapping.inputs['Vector'])
        links.new(mapping.outputs['Vector'], fraction.inputs[0])
        links.new(fraction.outputs['Vector'], centre.inputs[0])
        links.new(centre.outputs['Vector'], absolute.inputs[0])
        links.new(absolute.outputs['Vector'], separate.inputs['Vector'])
        links.new(separate.outputs['X'], nearest.inputs[0])
        links.new(separate.outputs['Y'], nearest.inputs[1])
        links.new(nearest.outputs['Value'], line.inputs['Value'])
        # Low-frequency mottling so the dark wall reads as a surface, not a void
        mottle = nodes.new('ShaderNodeTexNoise')
        mottle.inputs['Scale'].default_value = 5.0
        mottle.inputs['Detail'].default_value = 2.0
        base = nodes.new('ShaderNodeMix')
        base.data_type = 'RGBA'
        base.inputs['A'].default_value = tuple(channel * 0.8 for channel in color) + (1.0,)
        base.inputs['B'].default_value = tuple(channel * 1.25 for channel in color) + (1.0,)
        links.new(coordinates.outputs['Object'], mottle.inputs['Vector'])
        links.new(mottle.outputs['Fac'], base.inputs['Factor'])
        tint = nodes.new('ShaderNodeMix')
        tint.data_type = 'RGBA'
        tint.inputs['B'].default_value = (*grid, 1.0)
        links.new(line.outputs['Result'], tint.inputs['Factor'])
        links.new(base.outputs['Result'], tint.inputs['A'])
        links.new(tint.outputs['Result'], principled.inputs['Base Color'])
        _set(principled, 'Roughness', 0.55)
    return _shared(_wall_name('MM · wall neon', color, THEMES['neon']['wall']['color']), build)


def wall_material(theme, pitch):
    wall = theme_settings(theme)['wall']
    if wall['kind'] == 'plaster':
        return plaster_wall_material(wall['color'])
    if wall['kind'] == 'neon':
        return neon_wall_material(wall['color'], wall['grid'])
    return pegboard_wall_material(pitch, wall.get('color', PEGBOARD_COLOR))


# Neon: saturated glossy bodies with glowing trim on a dark wall


def neon_color(color, value=0.75):
    """Linear colour of a hex or linear colour pushed to full saturation at brightness `value`, so every piece reads
    as a strong hue on the dark wall whatever its marble colour"""
    import colorsys
    linear = parse_color(color) if isinstance(color, str) else color
    hue, saturation, _ = colorsys.rgb_to_hsv(*linear[:3])
    if saturation < 0.08:
        # A grey marble keeps a cool white-blue instead of a random hue
        return (value * 0.7, value * 0.82, value)
    return colorsys.hsv_to_rgb(hue, max(saturation, 0.88), value)


def neon_body_material(color):
    """Glossy coated plastic in `color` (linear) with a faint inner glow that brightens on a hit"""
    def build(material):
        tree = material.node_tree
        principled = _principled(material)
        base = (*color, 1.0)
        material.diffuse_color = base
        _set(principled, 'Base Color', base)
        _set(principled, 'Roughness', 0.2)
        _set(principled, 'Coat Weight', 1.0)
        _set(principled, 'Coat Roughness', 0.03)
        _set(principled, 'Emission Color', base)
        attribute = tree.nodes.new('ShaderNodeAttribute')
        attribute.attribute_type = 'OBJECT'
        attribute.attribute_name = 'mm_flash'
        strength = tree.nodes.new('ShaderNodeMath')
        strength.operation = 'MULTIPLY_ADD'
        strength.inputs[1].default_value = NEON_BODY_FLASH
        strength.inputs[2].default_value = NEON_BODY_GLOW
        tree.links.new(attribute.outputs['Fac'], strength.inputs[0])
        tree.links.new(strength.outputs['Value'], principled.inputs['Emission Strength'])
    return _shared('MM · neon body %.3f %.3f %.3f' % tuple(color), build)


# Steady glow of a neon body and the share of the hit flash it takes; the trim takes all of it
NEON_BODY_GLOW = 0.12
NEON_BODY_FLASH = 0.22
NEON_TRIM_GLOW = 1.8


def neon_trim_material(color, idle=NEON_TRIM_GLOW):
    """Glowing tube light in `color` (linear): a steady glow the hit flash `mm_flash` raises"""
    def build(material):
        tree = material.node_tree
        principled = _principled(material)
        # A dark base keeps the strip its own colour; a light one would wash the glow out toward white
        base = tuple(channel * 0.35 for channel in color) + (1.0,)
        material.diffuse_color = base
        _set(principled, 'Base Color', base)
        _set(principled, 'Roughness', 0.3)
        _set(principled, 'Emission Color', (*color, 1.0))
        attribute = tree.nodes.new('ShaderNodeAttribute')
        attribute.attribute_type = 'OBJECT'
        attribute.attribute_name = 'mm_flash'
        strength = tree.nodes.new('ShaderNodeMath')
        strength.operation = 'ADD'
        strength.inputs[1].default_value = idle
        tree.links.new(attribute.outputs['Fac'], strength.inputs[0])
        tree.links.new(strength.outputs['Value'], principled.inputs['Emission Strength'])
    return _shared('MM · neon trim %.3f %.3f %.3f i%.1f' % (*color, idle), build)


def neon_mount_material():
    """Dark gloss mounts and posts; they never glow, so the trim stays the only light"""
    return plastic_material('neon mount', (0.012, 0.014, 0.024), 0.25, coat=0.8)


def neon_marble_core(color):
    """Linear colour of a Neon marble's body: near-white with a hint of its lane's hue. The pieces glow in the lane's
    saturated hue, so a marble in that hue vanished against its own platforms; the reference channels light their
    marbles white or pearl and keep the colour for the rim"""
    hue = neon_color(color, 1.0)
    return tuple(NEON_MARBLE_WHITE + (1.0 - NEON_MARBLE_WHITE) * channel for channel in hue)


def neon_marble_material(color):
    """Glossy pearl-white marble with a faint glow of its own and a rim in its lane's saturated hue, so it reads
    against the dark wall and against its own lane's glowing pieces"""
    def build(material):
        tree = material.node_tree
        nodes, links = tree.nodes, tree.links
        principled = _principled(material)
        core = (*neon_marble_core(color), 1.0)
        hue = (*neon_color(color, 1.0), 1.0)
        material.diffuse_color = core
        _set(principled, 'Base Color', core)
        _set(principled, 'Roughness', 0.12)
        _set(principled, 'Coat Weight', 1.0)
        _set(principled, 'Coat Roughness', 0.02)
        # Facing rises toward the silhouette; the power keeps the coloured glow to a thin rim around a white core
        weight = nodes.new('ShaderNodeLayerWeight')
        weight.inputs['Blend'].default_value = 0.5
        rim = nodes.new('ShaderNodeMath')
        rim.operation = 'POWER'
        rim.inputs[1].default_value = 3.0
        links.new(weight.outputs['Facing'], rim.inputs[0])
        mix = nodes.new('ShaderNodeMix')
        mix.data_type = 'RGBA'
        mix.inputs['A'].default_value = core
        mix.inputs['B'].default_value = hue
        links.new(rim.outputs['Value'], mix.inputs['Factor'])
        links.new(mix.outputs['Result'], principled.inputs['Emission Color'])
        strength = nodes.new('ShaderNodeMath')
        strength.operation = 'MULTIPLY_ADD'
        strength.inputs[1].default_value = NEON_MARBLE_RIM
        strength.inputs[2].default_value = NEON_MARBLE_GLOW
        links.new(rim.outputs['Value'], strength.inputs[0])
        links.new(strength.outputs['Value'], principled.inputs['Emission Strength'])
    return _shared('MM · neon pearl marble ' + color, build)


# Share of white in a Neon marble's body, its steady self-glow and the strength of its coloured rim
NEON_MARBLE_WHITE = 0.86
NEON_MARBLE_GLOW = 0.35
NEON_MARBLE_RIM = 3.5


# Marble contrast: the marble is the film's subject, so it stays 3:1 apart from its wall and its own pieces in every
# theme. Pearl white with its lane's hue on the rim on a dark wall (Neon), its lane's hue made deep on a light one
# (Pegboard's birch, Brass's lavender), whichever contrasts more with both. The rule works on the Draft Preview's
# display colours so both previews choose alike: the same values and steps as `draftMarble` in draft-look.ts.

MARBLE_CONTRAST = 3.0
PEARL_WHITE = 0.8
DEEP_LUMINANCE = 0.03
NEON_BODY_VALUE = 0.62
PEGBOARD_TINT = 0.4
# `draftWall` and the gold `FINISHES` entry in draft-look.ts
DRAFT_WALLS = {'pegboard': '#b3a38f', 'brass': '#a098ac', 'neon': '#141a2a'}
DRAFT_GOLD = '#b8863f'


def _hex_channels(color):
    value = int(color.lstrip('#')[:6], 16)
    return ((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255


def _to_hex(r, g, b):
    return '#' + ''.join('%02x' % int(math.floor(max(0.0, min(1.0, channel)) * 255 + 0.5)) for channel in (r, g, b))


def display_luminance(color):
    """WCAG relative luminance of a `#rrggbb` display colour"""
    r, g, b = (_srgb_to_linear(channel) for channel in _hex_channels(color))
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def contrast_ratio(a, b):
    high, low = sorted((display_luminance(a), display_luminance(b)), reverse=True)
    return (high + 0.05) / (low + 0.05)


def display_saturate(color, value):
    """`saturate` in draft-look.ts: `color` at full saturation and brightness `value`; a grey turns cool blue-white"""
    r, g, b = _hex_channels(color)
    top, bottom = max(r, g, b), min(r, g, b)
    if top == 0 or (top - bottom) / top < 0.08:
        return _to_hex(value * 0.82, value * 0.9, value)
    saturation = max((top - bottom) / top, 0.88)
    return _to_hex(*(value * (1 - ((top - channel) / (top - bottom)) * saturation) for channel in (r, g, b)))


def display_tint(color, amount):
    return _to_hex(*(channel * (1 - amount) + amount for channel in _hex_channels(color)))


def deep_color(color):
    """`color` at full saturation, dark enough to reach `DEEP_LUMINANCE`, found by halving like `deepColor`"""
    low, high = 0.0, 1.0
    for _ in range(24):
        middle = (low + high) / 2
        if display_luminance(display_saturate(color, middle)) > DEEP_LUMINANCE:
            high = middle
        else:
            low = middle
    return display_saturate(color, low)


def marble_surfaces(theme, color):
    """Display colours a marble rolls over without Colour by Note, `marbleSurfaces` in draft-look.ts"""
    if theme == 'brass':
        return [DRAFT_GOLD]
    if theme == 'neon':
        return [display_saturate(color, NEON_BODY_VALUE)]
    return [display_tint(color, PEGBOARD_TINT)]


def marble_look(name, color, overrides=None):
    """A marble's tone (`pearl` or `deep`), display body colour and lowest contrast against its wall and pieces in
    theme `name`, with the project theme's Wall colour from `overrides` or this apply's"""
    theme = theme_name(name)
    overrides = clean_overrides(_overrides if overrides is None else overrides)
    color = color if isinstance(color, str) and len(color) == 7 and color.startswith('#') else '#d0d4dc'
    around = [overrides.get('wallColor') or DRAFT_WALLS[theme], *marble_surfaces(theme, color)]
    hue = display_saturate(color, 1.0)
    candidates = (('pearl', display_tint(hue, PEARL_WHITE)), ('deep', deep_color(color)))
    looks = [{'tone': tone, 'body': body, 'contrast': min(contrast_ratio(body, other) for other in around)} for tone, body in candidates]
    return looks[0] if looks[0]['contrast'] >= looks[1]['contrast'] else looks[1]


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


def rim_settings(theme):
    """The theme's back light like `sun_settings`, or None for a theme without one"""
    rim = theme_settings(theme).get('rim')
    if rim is None:
        return None
    return {
        'energy': rim['energy'],
        'angle': math.radians(rim['angle']),
        'color': rim['color'],
        'rotation': tuple(sun_rotation(rim['direction'])),
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
