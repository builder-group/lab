"""`preview_frame`: an Eevee frame plus a flat object ID image for picking objects in the app.

The ID image is a Workbench render with flat object colors and antialiasing off. Every skin of a managed
holder, and every wall text, gets a unique color for the render only; `ids` maps each `#rrggbb` to its `mm_id`. Pixels of
other colors belong to unmanaged objects or the background.
"""
import colorsys
import math
import time
from contextlib import contextmanager
from pathlib import Path

import bpy

from . import decor_effects
from .util import MANAGED_COLLECTION, WorkerError, descendants, srgb_to_linear

KEEP_PREVIEWS = 8


def preview_frame(project_dir, args):
    scene = bpy.context.scene
    if scene.camera is None:
        raise WorkerError('NO_CAMERA', 'The scene has no active camera')
    seconds = float(args.get('time', 0.0))
    width = int(args.get('width', 540))
    if not 16 <= width <= 4096:
        raise WorkerError('INVALID_ARGS', 'Preview width must be between 16 and 4096')
    engine = args.get('engine', 'eevee')
    if engine != 'eevee':
        raise WorkerError('INVALID_ARGS', 'Only the eevee preview engine is supported')
    height = max(1, round(width * scene.render.resolution_y / scene.render.resolution_x))
    folder = Path(project_dir) / 'renders'
    folder.mkdir(parents=True, exist_ok=True)
    stamp = str(int(time.time() * 1000))
    image_path = folder / ('preview-' + stamp + '.png')
    id_path = folder / ('preview-' + stamp + '.ids.png')

    fps = scene.render.fps / scene.render.fps_base
    frame_float = seconds * fps
    frame = math.floor(frame_float)
    previous_frame = scene.frame_current
    scene.frame_set(frame, subframe=frame_float - frame)
    try:
        began = time.perf_counter()
        with temporary([
            (scene.render, 'resolution_x', width),
            (scene.render, 'resolution_y', height),
            (scene.render, 'resolution_percentage', 100),
            (scene.render, 'filepath', str(image_path)),
            (scene.render, 'engine', 'BLENDER_EEVEE'),
            (scene.render.image_settings, 'file_format', 'PNG'),
            (scene.render.image_settings, 'color_mode', 'RGBA'),
            (scene.eevee, 'taa_render_samples', min(scene.eevee.taa_render_samples, 16)),
        ]):
            bpy.ops.render.render(write_still=True)
        render_ms = (time.perf_counter() - began) * 1000
        began = time.perf_counter()
        ids = render_ids(scene, id_path, width, height)
        id_ms = (time.perf_counter() - began) * 1000
    finally:
        scene.frame_set(previous_frame)
    prune(folder)
    return {
        'path': str(image_path),
        'idPath': str(id_path),
        'ids': ids,
        'width': width,
        'height': height,
        'time': seconds,
        'frame': frame_float,
        'renderMs': round(render_ms, 1),
        'idMs': round(id_ms, 1),
    }


def render_ids(scene, id_path, width, height):
    managed = bpy.data.collections.get(MANAGED_COLLECTION)
    holders = [obj for obj in (managed.objects if managed else []) if obj.get('mm_id') is not None and obj.parent is None]
    ids, overrides = {}, []
    for index, holder in enumerate(sorted(holders, key=lambda obj: obj['mm_id'])):
        srgb = id_color(index)
        key = '#%02x%02x%02x' % srgb
        ids[key] = holder['mm_id']
        linear = (*[srgb_to_linear(channel / 255) for channel in srgb], 1.0)
        # Wall text has no holder: the object itself carries the ID
        for obj in [holder, *descendants(holder)]:
            overrides.append((obj, 'color', linear))
    shading = scene.display.shading
    settings = [
        (scene.render, 'resolution_x', width),
        (scene.render, 'resolution_y', height),
        (scene.render, 'resolution_percentage', 100),
        (scene.render, 'filepath', str(id_path)),
        (scene.render, 'engine', 'BLENDER_WORKBENCH'),
        (scene.render, 'film_transparent', True),
        (scene.render, 'dither_intensity', 0.0),
        (scene.render.image_settings, 'file_format', 'PNG'),
        (scene.render.image_settings, 'color_mode', 'RGBA'),
        (scene.render.image_settings, 'color_depth', '8'),
        (scene.display, 'render_aa', 'OFF'),
        (shading, 'light', 'FLAT'),
        (shading, 'color_type', 'OBJECT'),
        (shading, 'show_shadows', False),
        (shading, 'show_cavity', False),
        (shading, 'show_object_outline', False),
        (shading, 'show_specular_highlight', False),
        (shading, 'show_xray', False),
        (scene.view_settings, 'view_transform', 'Standard'),
        (scene.view_settings, 'look', 'None'),
        (scene.view_settings, 'exposure', 0.0),
        (scene.view_settings, 'gamma', 1.0),
        (scene.view_settings, 'use_curve_mapping', False),
        (scene.render, 'use_compositing', False),
        *decor_effects.id_pass_settings(managed),
        *overrides,
    ]
    with temporary(settings):
        bpy.ops.render.render(write_still=True)
    return ids


def id_color(index):
    """Well separated saturated colors; never gray, so they never match the white default object color"""
    hue = (index * 0.6180339887) % 1.0
    value = 0.95 if (index // 7) % 2 == 0 else 0.7
    red, green, blue = colorsys.hsv_to_rgb(hue, 0.85, value)
    return round(red * 255), round(green * 255), round(blue * 255)


@contextmanager
def temporary(settings):
    """Applies attribute values for the duration of a render and restores them afterward"""
    previous = []
    try:
        for owner, name, value in settings:
            try:
                old = getattr(owner, name)
                if hasattr(old, '__len__') and not isinstance(old, str):
                    old = tuple(old)
                setattr(owner, name, value)
                previous.append((owner, name, old))
            except (AttributeError, TypeError, ValueError):
                # Some color management values differ between OpenColorIO configs; skip what this build lacks
                pass
        yield
    finally:
        for owner, name, old in reversed(previous):
            try:
                setattr(owner, name, old)
            except (AttributeError, TypeError, ValueError):
                pass


def prune(folder):
    previews = sorted(path for path in folder.glob('preview-*.png') if not path.name.endswith('.ids.png'))
    for path in previews[:-KEEP_PREVIEWS]:
        path.unlink(missing_ok=True)
        path.with_name(path.stem + '.ids.png').unlink(missing_ok=True)
