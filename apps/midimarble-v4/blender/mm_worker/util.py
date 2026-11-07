"""Shared helpers: errors, atomic files, package paths, colors and collections."""
import json
import math
import os
from pathlib import Path

import bpy

MANAGED_COLLECTION = 'MidiMarble · managed'
DETACHED_COLLECTION = 'MidiMarble · detached'
STUDIO_COLLECTION = 'MidiMarble · studio'
OWNER = 'midimarble'
# Space between a marble and the wall so its skin never intersects the wall plane
MARBLE_WALL_GAP = 0.0005


def path_depth(marble):
    """How far out from the wall a marble's path runs, a look only: `pathDepth` in pieces.ts, right at the wall when absent"""
    return float(marble.get('pathDepth', float(marble['radius']) + MARBLE_WALL_GAP))
DEFAULT_PIECE_DEPTH = 0.02
DEFAULT_MARBLE_RADIUS = 0.008


class WorkerError(Exception):
    """An expected failure reported to the host as `{code, message}`"""

    def __init__(self, code, message):
        super().__init__(message)
        self.code = code
        self.message = message


def write_json_atomic(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    # The temporary name does not end in `.json`, so mailbox readers never pick up a partial file
    temporary = path.with_name(path.name + '.tmp-' + str(os.getpid()))
    temporary.write_text(json.dumps(value, allow_nan=False))
    temporary.replace(path)


def resolve_package_path(project_dir, relative):
    """Resolves a package-relative path and rejects paths that leave the package"""
    if not isinstance(relative, str) or not relative:
        raise WorkerError('INVALID_ARGS', 'Expected a package-relative path')
    root = Path(project_dir).resolve()
    candidate = Path(relative)
    resolved = (candidate if candidate.is_absolute() else root / candidate).resolve()
    if resolved != root and root not in resolved.parents:
        raise WorkerError('INVALID_ARGS', 'Path leaves the package: ' + relative)
    return resolved


def srgb_to_linear(channel):
    if channel <= 0.04045:
        return channel / 12.92
    return ((channel + 0.055) / 1.055) ** 2.4


def parse_color(value, fallback=(0.8, 0.8, 0.8)):
    """Parses `#rrggbb` into a linear RGBA tuple for Blender material and object colors"""
    if isinstance(value, str) and len(value) == 7 and value.startswith('#'):
        try:
            srgb = [int(value[index:index + 2], 16) / 255 for index in (1, 3, 5)]
            return (*[srgb_to_linear(channel) for channel in srgb], 1.0)
        except ValueError:
            pass
    return (*fallback, 1.0)


def ensure_collection(name):
    scene = bpy.context.scene
    collection = bpy.data.collections.get(name)
    if collection is None:
        collection = bpy.data.collections.new(name)
    if collection.name not in scene.collection.children:
        scene.collection.children.link(collection)
    collection[OWNER] = True
    return collection


def ensure_detached_collection():
    """Blender work whose layer or piece is gone: kept for the person to recover, never drawn in a film"""
    collection = ensure_collection(DETACHED_COLLECTION)
    collection.hide_render = True
    collection.hide_viewport = True
    return collection


def link_only_to(obj, collection, remove_from=None):
    """Links `obj` to `collection`, unlinking it from `remove_from` when given"""
    if obj.name not in collection.objects:
        collection.objects.link(obj)
    if remove_from is not None and obj.name in remove_from.objects:
        remove_from.objects.unlink(obj)


def descendants(obj):
    result = []
    for child in obj.children:
        result.append(child)
        result.extend(descendants(child))
    return result


def tag(obj, mm_id, role):
    obj['mm_id'] = mm_id
    obj['mm_role'] = role
    obj['mm_owner'] = OWNER


def finite(value, name):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        raise WorkerError('INVALID_DESCRIPTION', 'Expected a finite number for ' + name)
    return float(value)
