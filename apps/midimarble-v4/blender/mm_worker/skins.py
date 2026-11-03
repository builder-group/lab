"""Default graybox skins in a pegboard toy look: bevelled flat-colored boxes and glossy marbles."""
import bmesh
import bpy

from .util import parse_color

DEFAULT_SKIN = 'default'


def material(name, color, roughness, coat=0.0):
    """Returns a shared app material for a color, creating it once. Existing materials are never changed."""
    full_name = 'MM · ' + name + ' ' + color
    existing = bpy.data.materials.get(full_name)
    if existing is not None:
        return existing
    created = bpy.data.materials.new(full_name)
    created['mm_owner'] = 'midimarble'
    linear = parse_color(color)
    created.diffuse_color = linear
    principled = created.node_tree.nodes.get('Principled BSDF') if created.node_tree else None
    if principled is not None:
        principled.inputs['Base Color'].default_value = linear
        principled.inputs['Roughness'].default_value = roughness
        principled.inputs['Coat Weight'].default_value = coat
    return created


def box_mesh(name, size):
    mesh = bpy.data.meshes.new(name)
    builder = bmesh.new()
    bmesh.ops.create_cube(builder, size=1.0)
    for vertex in builder.verts:
        vertex.co.x *= size[0]
        vertex.co.y *= size[1]
        vertex.co.z *= size[2]
    builder.to_mesh(mesh)
    builder.free()
    return mesh


def sphere_mesh(name, radius):
    mesh = bpy.data.meshes.new(name)
    builder = bmesh.new()
    bmesh.ops.create_uvsphere(builder, u_segments=32, v_segments=16, radius=radius)
    builder.to_mesh(mesh)
    builder.free()
    mesh.shade_smooth()
    return mesh


def piece_size(params):
    """Box size in Blender axes: length along x, depth into the wall along y, thickness along z"""
    return (
        float(params.get('length', 0.02)),
        float(params.get('depth', 0.02)),
        float(params.get('thickness', params.get('length', 0.02))),
    )


def skin_key(kind, size):
    return kind + ':' + ','.join('%.6f' % value for value in size)


def create_piece_skin(holder, piece, collection):
    size = piece_size(piece['params'])
    mesh = box_mesh(holder.name + ' skin', size)
    skin = bpy.data.objects.new(holder.name + ' skin', mesh)
    bevel = skin.modifiers.new('Bevel', 'BEVEL')
    bevel.width = min(size) * 0.2
    bevel.segments = 3
    bevel.limit_method = 'ANGLE'
    mesh.materials.append(material('piece', piece.get('color', '#c8b89a'), 0.55))
    return attach_default_skin(holder, skin, collection, skin_key('piece', size))


def create_marble_skin(holder, marble, collection):
    radius = float(marble['radius'])
    mesh = sphere_mesh(holder.name + ' skin', radius)
    skin = bpy.data.objects.new(holder.name + ' skin', mesh)
    mesh.materials.append(material('marble', marble.get('color', '#d0d4dc'), 0.12, coat=0.6))
    return attach_default_skin(holder, skin, collection, skin_key('marble', (radius,)))


def attach_default_skin(holder, skin, collection, key):
    collection.objects.link(skin)
    skin.parent = holder
    skin.matrix_parent_inverse.identity()
    skin['mm_skin'] = DEFAULT_SKIN
    skin['mm_skin_key'] = key
    skin['mm_owner'] = 'midimarble'
    return skin


def refresh_default_skin(skin, kind, piece_or_marble):
    """Rebuilds the mesh of an untouched default skin when its parameters changed, keeping the object and offset"""
    if skin.get('mm_skin') != DEFAULT_SKIN or skin.type != 'MESH':
        return
    if kind == 'marble':
        size = (float(piece_or_marble['radius']),)
        key = skin_key('marble', size)
        if skin.get('mm_skin_key') == key:
            return
        replacement = sphere_mesh(skin.name, size[0])
    else:
        size = piece_size(piece_or_marble['params'])
        key = skin_key('piece', size)
        if skin.get('mm_skin_key') == key:
            return
        replacement = box_mesh(skin.name, size)
    for slot_material in skin.data.materials:
        replacement.materials.append(slot_material)
    previous = skin.data
    skin.data = replacement
    if previous.users == 0:
        bpy.data.meshes.remove(previous)
    skin['mm_skin_key'] = key
