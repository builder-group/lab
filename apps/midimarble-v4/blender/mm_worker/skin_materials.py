"""Materials skins share across themes: tinted metal, glow and flash variants of a shared material, and the marble
skins Glass, Metal and Magic.

Both Glass and Magic are one surface that looks into the sphere: a few samples along the view ray in the marble's own
space, like the parallax of codrops' Magical Marbles, so they cost a few lookups instead of a volume or refraction. Glass
samples twisted sheets, the vanes of a play marble, in a blended surface that shows the wall around them, and they turn
as the marble rolls. Magic samples noise in an opaque dark orb; a Value node driven by the frame moves the noise, so the
smoke drifts whether or not the marble rolls.

Chrome and glass reflect a small painted studio instead of the world, so they look alike on every theme's wall.
"""
import colorsys

import bpy

from . import themes
from .util import parse_color

# `Skin` colors of the marble skins that have one, as `#rrggbb`
GLASS_SKIN = '#1f6fe0'
GLASS_GREEN_SKIN = '#0c8a3a'
GLASS_GREEN_VANES = 0.28
MAGIC_SKIN = '#7a3cff'
# The drift of Magic's smoke in noise units per second; slow enough to read as smoke, not as boiling
SMOKE_DRIFT = 0.16
# Radians per meter along a Candy Rail: a stripe about 16 mm long
CANDY_STRIPES = 200.0
SMOKE_TIME_NODE = 'MM smoke time'


def _math(tree, operation, a, b=None):
    node = tree.nodes.new('ShaderNodeMath')
    node.operation = operation
    for index, value in enumerate((a, b)):
        if value is None:
            continue
        if isinstance(value, (int, float)):
            node.inputs[index].default_value = value
        else:
            tree.links.new(value, node.inputs[index])
    return node.outputs[0]


def _scale(tree, color, factor):
    node = tree.nodes.new('ShaderNodeVectorMath')
    node.operation = 'SCALE'
    tree.links.new(color, node.inputs[0])
    if isinstance(factor, (int, float)):
        node.inputs['Scale'].default_value = factor
    else:
        tree.links.new(factor, node.inputs['Scale'])
    return node.outputs[0]


def _add_vectors(tree, a, b):
    node = tree.nodes.new('ShaderNodeVectorMath')
    node.operation = 'ADD'
    tree.links.new(a, node.inputs[0])
    tree.links.new(b, node.inputs[1])
    return node.outputs[0]


def _range(tree, value, low, high, smooth=True):
    node = tree.nodes.new('ShaderNodeMapRange')
    if smooth:
        node.interpolation_type = 'SMOOTHSTEP'
    node.inputs['From Min'].default_value = low
    node.inputs['From Max'].default_value = high
    tree.links.new(value, node.inputs['Value'])
    return node.outputs['Result']


def _new(name, build):
    return themes._shared(name, build)


def _camera_normal(tree):
    geometry = tree.nodes.new('ShaderNodeNewGeometry')
    transform = tree.nodes.new('ShaderNodeVectorTransform')
    transform.vector_type = 'NORMAL'
    transform.convert_from = 'WORLD'
    transform.convert_to = 'CAMERA'
    tree.links.new(geometry.outputs['Normal'], transform.inputs['Vector'])
    return transform.outputs[0]


def painted_studio(tree, horizon=True):
    """Color a mirror ball shows, in camera space so it looks the same from every camera angle and on every wall.
    With `horizon`, chrome: a pale sky, a curved horizon above the middle, near-black under it fading to a soft floor.
    Without, for glass: only a band of sky along the top edge. Both have a softbox high on the left and a small window
    low on the right."""
    normal = _camera_normal(tree)
    separate = tree.nodes.new('ShaderNodeSeparateXYZ')
    tree.links.new(normal, separate.inputs['Vector'])
    ramp = tree.nodes.new('ShaderNodeValToRGB')
    ramp.color_ramp.interpolation = 'LINEAR'
    elements = ramp.color_ramp.elements
    if horizon:
        elements[0].position, elements[0].color = 0.0, (0.5, 0.5, 0.51, 1.0)
        elements[1].position, elements[1].color = 1.0, (0.16, 0.19, 0.26, 1.0)
        stops = ((0.22, 0.3), (0.36, 0.07), (0.43, 0.012), (0.455, 0.02), (0.48, 1.25), (0.68, 0.42))
    else:
        elements[0].position, elements[0].color = 0.0, (0.012, 0.012, 0.014, 1.0)
        elements[1].position, elements[1].color = 1.0, (0.85, 0.88, 0.95, 1.0)
        stops = ((0.78, 0.012), (0.93, 0.34))
    for position, value in stops:
        element = elements.new(position)
        element.color = (value, value * 1.01, value * 1.05, 1.0)
    # A sphere's horizon curves away from the middle
    bend = _math(tree, 'MULTIPLY', _math(tree, 'MULTIPLY', separate.outputs['X'], separate.outputs['X']), 0.18 if horizon else 0.0)
    fac = _math(tree, 'ADD', _math(tree, 'MULTIPLY', _math(tree, 'ADD', separate.outputs['Y'], bend), 0.5), 0.5)
    tree.links.new(fac, ramp.inputs['Fac'])
    color = ramp.outputs['Color']
    for direction, low, high, strength in (((-0.42, 0.58, 0.7), 0.955, 0.975, 3.5), ((0.5, -0.56, 0.66), 0.985, 0.992, 1.1)):
        dot = tree.nodes.new('ShaderNodeVectorMath')
        dot.operation = 'DOT_PRODUCT'
        tree.links.new(normal, dot.inputs[0])
        dot.inputs[1].default_value = direction
        light = _scale(tree, _white(tree), _math(tree, 'MULTIPLY', _range(tree, dot.outputs['Value'], low, high), strength))
        color = _add_vectors(tree, color, light)
    return color


def _white(tree):
    node = tree.nodes.new('ShaderNodeRGB')
    node.outputs[0].default_value = (1.0, 1.0, 1.0, 1.0)
    return node.outputs[0]


def tinted_metal_material(color):
    """Polished metal in a `#rrggbb` color: Color: Marble on a metal skin"""
    def build(material):
        linear = parse_color(color)
        material.diffuse_color = linear
        principled = themes._principled(material)
        themes._set(principled, 'Base Color', linear)
        themes._set(principled, 'Metallic', 1.0)
        themes._set(principled, 'Roughness', 0.22)
        themes._flash_emission(material, linear)
    return _new('MM · metal ' + color, build)


def paper_material(color, roughness=0.46, coat=0.2):
    """Satin wrapping paper in a `#rrggbb` color, with the flash a reaction drives"""
    def build(material):
        linear = parse_color(color)
        material.diffuse_color = linear
        principled = themes._principled(material)
        themes._set(principled, 'Base Color', linear)
        themes._set(principled, 'Roughness', roughness)
        themes._set(principled, 'Coat Weight', coat)
        themes._set(principled, 'Coat Roughness', 0.2)
        themes._flash_emission(material, linear)
    return _new('MM · paper %s r%.2f c%.2f' % (color, roughness, coat), build)


def candy_material(color):
    """Soft glossy stripes of `color` and white, set by the point's place along both wall axes so a wire of any slope
    shows them"""
    def build(material):
        tree = material.node_tree
        nodes, links = tree.nodes, tree.links
        principled = themes._principled(material)
        linear = parse_color(color)
        material.diffuse_color = linear
        coordinates = nodes.new('ShaderNodeTexCoord')
        separate = nodes.new('ShaderNodeSeparateXYZ')
        links.new(coordinates.outputs['Object'], separate.inputs['Vector'])
        across = _math(tree, 'SINE', _math(tree, 'MULTIPLY', separate.outputs['X'], CANDY_STRIPES))
        along = _math(tree, 'SINE', _math(tree, 'MULTIPLY', separate.outputs['Z'], CANDY_STRIPES))
        stripe = _range(tree, _math(tree, 'MULTIPLY', across, along), -0.12, 0.12)
        mix = nodes.new('ShaderNodeMix')
        mix.data_type = 'RGBA'
        links.new(stripe, mix.inputs['Factor'])
        mix.inputs['A'].default_value = (0.88, 0.87, 0.85, 1.0)
        mix.inputs['B'].default_value = linear
        links.new(mix.outputs['Result'], principled.inputs['Base Color'])
        themes._set(principled, 'Roughness', 0.32)
        themes._set(principled, 'Coat Weight', 0.5)
        themes._set(principled, 'Coat Roughness', 0.1)
    return _new('MM · candy ' + color, build)


def flash_ready(material):
    """The shared material, or a copy that reads the object's `mm_flash`, for a skin's root flash"""
    if material is None or material.node_tree is None:
        return material
    principled = themes._principled(material)
    strength = principled.inputs.get('Emission Strength') if principled is not None else None
    if strength is None or strength.is_linked:
        return material
    name = material.name + ' flash'
    existing = bpy.data.materials.get(name)
    if existing is not None:
        return existing
    copy = material.copy()
    copy.name = name
    tree = copy.node_tree
    principled = themes._principled(copy)
    attribute = tree.nodes.new('ShaderNodeAttribute')
    attribute.attribute_type = 'OBJECT'
    attribute.attribute_name = 'mm_flash'
    tree.links.new(attribute.outputs['Fac'], principled.inputs['Emission Strength'])
    if max(principled.inputs['Emission Color'].default_value[:3]) < 1e-4:
        principled.inputs['Emission Color'].default_value = (*material.diffuse_color[:3], 1.0)
    return copy


def glow_tinted(material, color):
    """A copy of a shared material that glows in the `#rrggbb` Glow Color; one that never glows stays as it is"""
    if material is None or material.node_tree is None:
        return material
    principled = themes._principled(material)
    strength = principled.inputs.get('Emission Strength') if principled is not None else None
    if strength is None or not (strength.is_linked or strength.default_value > 0):
        return material
    name = material.name + ' glow ' + color
    existing = bpy.data.materials.get(name)
    if existing is not None:
        return existing
    copy = material.copy()
    copy.name = name
    principled = themes._principled(copy)
    socket = principled.inputs['Emission Color']
    for link in list(socket.links):
        copy.node_tree.links.remove(link)
    socket.default_value = parse_color(color)
    return copy


# Marbles


def _hue(color, value=1.0, saturation=None, shift=0.0):
    """Linear RGB of a `#rrggbb` color's hue at a brightness; a gray stays cool"""
    linear = parse_color(color)
    hue, sat, _ = colorsys.rgb_to_hsv(*linear[:3])
    if sat < 0.08:
        hue, sat = 0.6, 0.25
    return colorsys.hsv_to_rgb((hue + shift) % 1.0, sat if saturation is None else saturation, value)


def _blended(material):
    if hasattr(material, 'surface_render_method'):
        material.surface_render_method = 'BLENDED'
    material.use_backface_culling = True
    if hasattr(material, 'show_transparent_back'):
        material.show_transparent_back = False


def _inside_ray(tree):
    """(surface point in radii from the center, direction into the sphere away from the camera), in the marble's space"""
    coordinates = tree.nodes.new('ShaderNodeTexCoord')
    centered = tree.nodes.new('ShaderNodeVectorMath')
    centered.operation = 'SUBTRACT'
    tree.links.new(coordinates.outputs['Generated'], centered.inputs[0])
    centered.inputs[1].default_value = (0.5, 0.5, 0.5)
    position = _scale(tree, centered.outputs[0], 2.0)
    geometry = tree.nodes.new('ShaderNodeNewGeometry')
    transform = tree.nodes.new('ShaderNodeVectorTransform')
    transform.vector_type = 'VECTOR'
    transform.convert_from = 'WORLD'
    transform.convert_to = 'OBJECT'
    tree.links.new(geometry.outputs['Incoming'], transform.inputs['Vector'])
    normalize = tree.nodes.new('ShaderNodeVectorMath')
    normalize.operation = 'NORMALIZE'
    tree.links.new(transform.outputs[0], normalize.inputs[0])
    return position, _scale(tree, normalize.outputs[0], -1.0)


def _sheet(tree, x, y, z, radial, blades, phase, twist, width):
    """How much a point lies in a sheet of `blades` blades around the marble's z axis, turning `twist` radians per radius"""
    angle = _math(tree, 'ADD', _math(tree, 'ARCTAN2', y, x), _math(tree, 'ADD', _math(tree, 'MULTIPLY', z, twist), phase))
    across = _math(tree, 'ABSOLUTE', _math(tree, 'SINE', _math(tree, 'MULTIPLY', angle, blades / 2)))
    distance = _math(tree, 'MULTIPLY', radial, across)
    return _math(tree, 'SUBTRACT', 1.0, _range(tree, distance, width * 0.55, width))


# Depths along the view ray a Glass marble samples, in radii, front to back
GLASS_DEPTHS = tuple(0.16 + 0.13 * index for index in range(12))
# Sheets per variant: (blades, phase, twist, width, pale)
GLASS_SHEETS = {
    'swirl': ((2, 0.0, 3.0, 0.24, False), (2, 1.57, 3.0, 0.1, True)),
    'cats-eye': ((3, 0.0, 0.7, 0.16, False),),
}


def glass_marble_material(color, variant='swirl', vane_value=0.85):
    """A play marble: tinted clear glass with a dark colored edge where its glass bends the wall away, light gathered low
    in the ball, the painted studio on top, and in the middle the vanes: Swirl two bands winding with a pale ribbon between
    them, Cat's-Eye three blades that meet along the axis. `vane_value` is the vanes' brightness: lower keeps them colored
    in a bright theme's light"""
    sheets = GLASS_SHEETS.get(variant, GLASS_SHEETS['swirl'])

    def build(material):
        tree = material.node_tree
        nodes, links = tree.nodes, tree.links
        output = nodes.get('Material Output')
        nodes.remove(themes._principled(material))
        vivid = _hue(color, vane_value, 1.0)
        pale = _hue(color, 1.0, 0.07)
        material.diffuse_color = (*_hue(color, 0.75, 0.6), 1.0)
        position, into = _inside_ray(tree)
        # Back to front: each sample covers what lies behind it
        layer_color, alpha = None, None
        for depth in reversed(GLASS_DEPTHS):
            point = _add_vectors(tree, position, _scale(tree, into, depth))
            separate = nodes.new('ShaderNodeSeparateXYZ')
            links.new(point, separate.inputs['Vector'])
            x, y, z = separate.outputs['X'], separate.outputs['Y'], separate.outputs['Z']
            radial = _math(tree, 'SQRT', _math(tree, 'ADD', _math(tree, 'MULTIPLY', x, x), _math(tree, 'MULTIPLY', y, y)))
            length = nodes.new('ShaderNodeVectorMath')
            length.operation = 'LENGTH'
            links.new(point, length.inputs[0])
            inside = _math(tree, 'SUBTRACT', 1.0, _range(tree, length.outputs['Value'], 0.68, 0.84))
            # Deeper parts of the vanes sit in the glass's shade
            shade = 1.0 - 0.22 * depth
            for blades, phase, twist, width, is_pale in sheets:
                amount = _math(tree, 'MULTIPLY', _sheet(tree, x, y, z, radial, blades, phase, twist, width), inside)
                tone = nodes.new('ShaderNodeRGB')
                tone.outputs[0].default_value = (*(channel * shade for channel in (pale if is_pale else vivid)), 1.0)
                if layer_color is None:
                    layer_color, alpha = tone.outputs[0], amount
                    continue
                mix = nodes.new('ShaderNodeMix')
                mix.data_type = 'RGBA'
                links.new(amount, mix.inputs['Factor'])
                links.new(layer_color, mix.inputs['A'])
                links.new(tone.outputs[0], mix.inputs['B'])
                layer_color = mix.outputs['Result']
                alpha = _math(tree, 'MAXIMUM', alpha, amount)
        # The vanes take the scene's light and a little of their own, so they stay colored in the shade
        lit = nodes.new('ShaderNodeBsdfDiffuse')
        links.new(layer_color, lit.inputs['Color'])
        own = nodes.new('ShaderNodeEmission')
        links.new(layer_color, own.inputs['Color'])
        own.inputs['Strength'].default_value = 0.4
        vane = nodes.new('ShaderNodeAddShader')
        links.new(lit.outputs[0], vane.inputs[0])
        links.new(own.outputs[0], vane.inputs[1])
        clear = nodes.new('ShaderNodeBsdfTransparent')
        clear.inputs['Color'].default_value = (*_hue(color, 1.0, 0.26), 1.0)
        through = nodes.new('ShaderNodeMixShader')
        links.new(alpha, through.inputs['Fac'])
        links.new(clear.outputs[0], through.inputs[1])
        links.new(vane.outputs[0], through.inputs[2])
        edge = nodes.new('ShaderNodeBsdfDiffuse')
        edge.inputs['Color'].default_value = (*_hue(color, 0.07, 0.95), 1.0)
        weight = nodes.new('ShaderNodeLayerWeight')
        weight.inputs['Blend'].default_value = 0.5
        rim = nodes.new('ShaderNodeMixShader')
        links.new(_math(tree, 'MULTIPLY', _range(tree, weight.outputs['Facing'], 0.5, 0.96), 0.92), rim.inputs['Fac'])
        links.new(through.outputs[0], rim.inputs[1])
        links.new(edge.outputs[0], rim.inputs[2])
        # Light gathered in the lower right of the ball
        dot = nodes.new('ShaderNodeVectorMath')
        dot.operation = 'DOT_PRODUCT'
        links.new(_camera_normal(tree), dot.inputs[0])
        dot.inputs[1].default_value = (0.42, -0.72, 0.55)
        gather = nodes.new('ShaderNodeEmission')
        gather.inputs['Color'].default_value = (*_hue(color, 1.0, 0.55), 1.0)
        links.new(_math(tree, 'MULTIPLY', _range(tree, dot.outputs['Value'], 0.5, 0.98), 0.5), gather.inputs['Strength'])
        studio = nodes.new('ShaderNodeEmission')
        links.new(_scale(tree, painted_studio(tree, horizon=False), _math(tree, 'ADD', _math(tree, 'MULTIPLY', weight.outputs['Facing'], 0.5), 0.5)), studio.inputs['Color'])
        add = nodes.new('ShaderNodeAddShader')
        links.new(gather.outputs[0], add.inputs[0])
        links.new(studio.outputs[0], add.inputs[1])
        total = nodes.new('ShaderNodeAddShader')
        links.new(rim.outputs[0], total.inputs[0])
        links.new(add.outputs[0], total.inputs[1])
        links.new(total.outputs[0], output.inputs['Surface'])
        _blended(material)
    return _new('MM · glass %s %s' % (variant, color) + ('' if vane_value == 0.85 else ' v%.2f' % vane_value), build)


def metal_marble_material(color=None):
    """A polished ball bearing: steel with the painted studio in it, in `color` for Color: Marble"""
    def build(material):
        tree = material.node_tree
        nodes, links = tree.nodes, tree.links
        output = nodes.get('Material Output')
        principled = themes._principled(material)
        tint = _hue(color, 1.0, 0.72) if color else (1.0, 1.0, 1.0)
        material.diffuse_color = (*(channel * 0.72 for channel in tint), 1.0)
        themes._set(principled, 'Base Color', (*(channel * 0.05 for channel in tint), 1.0))
        themes._set(principled, 'Metallic', 1.0)
        themes._set(principled, 'Roughness', 0.12)
        studio = nodes.new('ShaderNodeEmission')
        multiply = nodes.new('ShaderNodeVectorMath')
        multiply.operation = 'MULTIPLY'
        links.new(painted_studio(tree), multiply.inputs[0])
        multiply.inputs[1].default_value = tint
        links.new(multiply.outputs[0], studio.inputs['Color'])
        studio.inputs['Strength'].default_value = 1.0
        add = nodes.new('ShaderNodeAddShader')
        links.new(principled.outputs[0], add.inputs[0])
        links.new(studio.outputs[0], add.inputs[1])
        links.new(add.outputs[0], output.inputs['Surface'])
    return _new('MM · metal marble ' + (color or 'steel'), build)


def _smoke_layer(tree, position, into, depth, time, colors):
    """Color of one layer of smoke at `depth` along the view ray, in radii below the surface"""
    a, b = colors
    offset = _add_vectors(tree, position, _scale(tree, into, depth))
    length = tree.nodes.new('ShaderNodeVectorMath')
    length.operation = 'LENGTH'
    tree.links.new(offset, length.inputs[0])
    inside = _math(tree, 'SUBTRACT', 1.0, _range(tree, length.outputs['Value'], 0.62, 0.98))
    noise = tree.nodes.new('ShaderNodeTexNoise')
    noise.noise_dimensions = '4D'
    noise.inputs['Scale'].default_value = 1.35
    noise.inputs['Detail'].default_value = 3.0
    noise.inputs['Distortion'].default_value = 0.6
    tree.links.new(offset, noise.inputs['Vector'])
    tree.links.new(_math(tree, 'ADD', time, depth * 3.0), noise.inputs['W'])
    density = _math(tree, 'MULTIPLY', _range(tree, noise.outputs['Fac'], 0.47, 0.7), inside)
    hue = tree.nodes.new('ShaderNodeTexNoise')
    hue.noise_dimensions = '4D'
    hue.inputs['Scale'].default_value = 0.8
    hue.inputs['Detail'].default_value = 1.0
    tree.links.new(offset, hue.inputs['Vector'])
    tree.links.new(_math(tree, 'MULTIPLY', time, 0.7), hue.inputs['W'])
    mix = tree.nodes.new('ShaderNodeMix')
    mix.data_type = 'RGBA'
    mix.inputs['A'].default_value = (*a, 1.0)
    mix.inputs['B'].default_value = (*b, 1.0)
    tree.links.new(_range(tree, hue.outputs['Fac'], 0.38, 0.62), mix.inputs['Factor'])
    return _scale(tree, mix.outputs['Result'], density)


def magic_marble_material(color, glow=None):
    """A dark glass orb holding softly glowing smoke in `color` and a neighboring hue, or `glow` as the second"""
    def build(material):
        tree = material.node_tree
        nodes, links = tree.nodes, tree.links
        output = nodes.get('Material Output')
        principled = themes._principled(material)
        first = _hue(color, 1.0, 1.0)
        second = (*parse_color(glow)[:3],) if glow else _hue(color, 1.0, 1.0, -0.11)
        material.diffuse_color = (*(channel * 0.8 for channel in first), 1.0)
        themes._set(principled, 'Base Color', (*_hue(color, 0.015, 1.0), 1.0))
        themes._set(principled, 'Roughness', 0.05)
        themes._set(principled, 'Coat Weight', 1.0)
        themes._set(principled, 'Coat Roughness', 0.02)
        position, into = _inside_ray(tree)
        time = nodes.new('ShaderNodeValue')
        time.name = SMOKE_TIME_NODE
        _drive_time(tree, time)
        # Light and thin near the surface, denser further in, so the eye reads depth
        total = None
        for depth, weight in ((0.28, 0.4), (0.62, 0.6), (1.0, 0.8)):
            layer = _scale(tree, _smoke_layer(tree, position, into, depth, time.outputs[0], (first, second)), weight)
            total = layer if total is None else _add_vectors(tree, total, layer)
        smoke = nodes.new('ShaderNodeEmission')
        links.new(total, smoke.inputs['Color'])
        smoke.inputs['Strength'].default_value = 2.0
        # Specks of light hang in the smoke and drift with it
        specks = nodes.new('ShaderNodeTexVoronoi')
        specks.voronoi_dimensions = '4D'
        specks.feature = 'F1'
        specks.inputs['Scale'].default_value = 5.5
        links.new(_add_vectors(tree, position, _scale(tree, into, 0.55)), specks.inputs['Vector'])
        links.new(_math(tree, 'MULTIPLY', time.outputs[0], 1.6), specks.inputs['W'])
        spark = nodes.new('ShaderNodeEmission')
        links.new(_math(tree, 'MULTIPLY', _math(tree, 'SUBTRACT', 1.0, _range(tree, specks.outputs['Distance'], 0.03, 0.09)), 3.0), spark.inputs['Strength'])
        with_specks = nodes.new('ShaderNodeAddShader')
        links.new(smoke.outputs[0], with_specks.inputs[0])
        links.new(spark.outputs[0], with_specks.inputs[1])
        # A thin line of the marble's hue along the edge and the studio's highlights keep it a glass ball
        weight = nodes.new('ShaderNodeLayerWeight')
        weight.inputs['Blend'].default_value = 0.5
        edge = nodes.new('ShaderNodeEmission')
        edge.inputs['Color'].default_value = (*first, 1.0)
        links.new(_math(tree, 'MULTIPLY', _range(tree, weight.outputs['Facing'], 0.72, 1.0), 1.4), edge.inputs['Strength'])
        studio = nodes.new('ShaderNodeEmission')
        links.new(_scale(tree, painted_studio(tree, horizon=False), _math(tree, 'ADD', _math(tree, 'MULTIPLY', weight.outputs['Facing'], 0.5), 0.5)), studio.inputs['Color'])
        sum_one = nodes.new('ShaderNodeAddShader')
        links.new(principled.outputs[0], sum_one.inputs[0])
        links.new(with_specks.outputs[0], sum_one.inputs[1])
        sum_two = nodes.new('ShaderNodeAddShader')
        links.new(edge.outputs[0], sum_two.inputs[0])
        links.new(studio.outputs[0], sum_two.inputs[1])
        final = nodes.new('ShaderNodeAddShader')
        links.new(sum_one.outputs[0], final.inputs[0])
        links.new(sum_two.outputs[0], final.inputs[1])
        links.new(final.outputs[0], output.inputs['Surface'])
    return _new('MM · magic marble %s %s' % (color, glow or ''), build)


def _drive_time(tree, node):
    """Seconds of film times the drift, from the frame, in a simple expression that needs no Python to evaluate"""
    driver = tree.driver_add('nodes["%s"].outputs[0].default_value' % SMOKE_TIME_NODE).driver
    driver.type = 'SCRIPTED'
    variable = driver.variables.new()
    variable.name = 'fps'
    variable.type = 'SINGLE_PROP'
    variable.targets[0].id_type = 'SCENE'
    variable.targets[0].id = bpy.context.scene
    variable.targets[0].data_path = 'render.fps'
    driver.expression = 'frame/max(fps,1)*%.4f' % SMOKE_DRIFT
