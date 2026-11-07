"""Procedural meshes for skins: bevelled boxes, cylinders, spheres and tubes along polylines, with material slots."""
import math

import bmesh
import bpy
from mathutils import Matrix, Vector

SMOOTH_ANGLE = math.radians(40)


class MeshBuilder:
    """Collects primitives in one bmesh. Each primitive gets a material slot index."""

    def __init__(self):
        self.bm = bmesh.new()

    def _assign(self, before, material_index, smooth):
        for face in self.bm.faces:
            if face not in before:
                face.material_index = material_index
                face.smooth = smooth

    def box(self, size, center=(0.0, 0.0, 0.0), bevel=0.0, material=0, segments=3, tilt=0.0):
        """A box, turned `tilt` radians about its own x axis before it is placed, so a plate's end can bend"""
        before = set(self.bm.faces)
        result = bmesh.ops.create_cube(self.bm, size=1.0)
        verts = result['verts']
        turn = Matrix.Rotation(tilt, 3, 'X') if tilt else None
        for vertex in verts:
            scaled = Vector((vertex.co.x * size[0], vertex.co.y * size[1], vertex.co.z * size[2]))
            if turn is not None:
                scaled = turn @ scaled
            vertex.co = scaled + Vector(center)
        if bevel > 0:
            edges = list({edge for vertex in verts for edge in vertex.link_edges})
            bmesh.ops.bevel(self.bm, geom=edges + list(verts), offset=min(bevel, min(size) * 0.45), segments=segments,
                            profile=0.5, affect='EDGES', clamp_overlap=True)
        self._assign(before, material, bevel > 0)

    def cylinder(self, radius, depth, center=(0.0, 0.0, 0.0), axis='Y', material=0, segments=24, bevel=0.0):
        before = set(self.bm.faces)
        rotation = {'X': Matrix.Rotation(math.pi / 2, 4, 'Y'), 'Y': Matrix.Rotation(math.pi / 2, 4, 'X'), 'Z': Matrix.Identity(4)}[axis]
        matrix = Matrix.Translation(Vector(center)) @ rotation
        result = bmesh.ops.create_cone(self.bm, cap_ends=True, cap_tris=False, segments=segments, radius1=radius,
                                       radius2=radius, depth=depth, matrix=matrix)
        if bevel > 0:
            verts = result['verts']
            edges = [edge for edge in {edge for vertex in verts for edge in vertex.link_edges}
                     if edge.calc_face_angle(0.0) > math.radians(60)]
            bmesh.ops.bevel(self.bm, geom=edges, offset=min(bevel, radius * 0.4, depth * 0.4), segments=2,
                            profile=0.5, affect='EDGES', clamp_overlap=True)
        self._assign(before, material, True)

    def sphere(self, radius, center=(0.0, 0.0, 0.0), material=0, segments=32, rings=16):
        before = set(self.bm.faces)
        bmesh.ops.create_uvsphere(self.bm, u_segments=segments, v_segments=rings, radius=radius,
                                  matrix=Matrix.Translation(Vector(center)))
        self._assign(before, material, True)

    def tube(self, points, radius, material=0, sides=12, cap=True):
        """Round tube through 3D points with parallel-transported rings"""
        points = [Vector(point) for point in points]
        points = [point for index, point in enumerate(points) if index == 0 or (point - points[index - 1]).length > 1e-7]
        if len(points) < 2:
            return
        before = set(self.bm.faces)
        tangents = []
        for index in range(len(points)):
            previous = points[max(0, index - 1)]
            following = points[min(len(points) - 1, index + 1)]
            tangents.append((following - previous).normalized())
        seed = Vector((0, 1, 0)) if abs(tangents[0].y) < 0.9 else Vector((1, 0, 0))
        normal = tangents[0].cross(seed).normalized()
        rings = []
        for index, point in enumerate(points):
            tangent = tangents[index]
            if index:
                # Parallel transport keeps the rings from twisting along the path
                normal = (normal - tangent * normal.dot(tangent)).normalized()
            binormal = tangent.cross(normal)
            ring = []
            for side in range(sides):
                angle = 2 * math.pi * side / sides
                ring.append(self.bm.verts.new(point + (normal * math.cos(angle) + binormal * math.sin(angle)) * radius))
            rings.append(ring)
        for first, second in zip(rings, rings[1:]):
            for side in range(sides):
                following = (side + 1) % sides
                self.bm.faces.new((first[side], first[following], second[following], second[side]))
        if cap:
            self.bm.faces.new(list(reversed(rings[0])))
            self.bm.faces.new(rings[-1])
        self._assign(before, material, True)

    def to_mesh(self, name, materials):
        mesh = bpy.data.meshes.new(name)
        bmesh.ops.recalc_face_normals(self.bm, faces=self.bm.faces)
        self.bm.to_mesh(mesh)
        self.bm.free()
        for material in materials:
            mesh.materials.append(material)
        try:
            mesh.set_sharp_from_angle(angle=SMOOTH_ANGLE)
        except (AttributeError, TypeError):
            pass
        return mesh


def rounded_polyline(points, corner_radius, steps=6):
    """Replaces inner corners of a polyline by quadratic Bezier arcs"""
    points = [Vector(point) for point in points]
    if len(points) < 3 or corner_radius <= 0:
        return points
    result = [points[0]]
    for index in range(1, len(points) - 1):
        previous, corner, following = points[index - 1], points[index], points[index + 1]
        into = corner - previous
        out = following - corner
        reach = min(corner_radius, into.length / 2, out.length / 2)
        start = corner - into.normalized() * reach
        end = corner + out.normalized() * reach
        for step in range(steps + 1):
            t = step / steps
            result.append(start * (1 - t) ** 2 + corner * 2 * (1 - t) * t + end * t * t)
    result.append(points[-1])
    return result
