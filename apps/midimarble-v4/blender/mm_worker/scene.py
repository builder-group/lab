"""`apply_scene` and `inspect`: app-owned holders, skins, wall text and keyframes from a scene description.

Coordinate mapping: a wall point (x, y) at distance d from the wall becomes Blender (x, -d, y). A wall angle a
(counter-clockwise as seen from the front) becomes a rotation of -a around Blender +Y, which is a
counter-clockwise rotation as seen by the front camera looking along +Y.
"""
import json
import math
import time

import bpy
import numpy as np

from . import anim, assets, camera, contacts, skins, studio, themes, walltext
from .util import (
    DEFAULT_MARBLE_RADIUS,
    DEFAULT_PIECE_DEPTH,
    DETACHED_COLLECTION,
    MARBLE_WALL_GAP,
    MANAGED_COLLECTION,
    OWNER,
    WorkerError,
    descendants,
    ensure_collection,
    finite,
    link_only_to,
    resolve_package_path,
    tag,
)

SCENE_DESCRIPTION_VERSION = 1
# `mm_hit` rises to 1 at a hit and decays to 0 over HIT_DECAY seconds
HIT_DECAY = skins.HIT_DECAY
HIT_TAU = skins.HIT_TAU

KEYED_PATHS = ('location', 'rotation_euler', '["mm_hit"]', '["mm_visible"]')
# Transform channels as [location xyz, rotation xyz, scale xyz]; animated channels are excluded from link checks
MARBLE_ANIMATED = {0, 2, 4}
MOVING_PIECE_ANIMATED = {4}


def apply_scene(project_dir, args, progress=lambda fraction, phase: None):
    began = time.perf_counter()
    description_path = resolve_package_path(project_dir, args.get('descriptionPath'))
    if not description_path.is_file():
        raise WorkerError('NOT_FOUND', 'Scene description not found: ' + str(description_path))
    description = json.loads(description_path.read_text())
    if description.get('version') != SCENE_DESCRIPTION_VERSION:
        raise WorkerError('UNSUPPORTED_VERSION', 'Unsupported scene description version: ' + str(description.get('version')))
    fps = finite(description.get('fps'), 'fps')
    duration = finite(description.get('duration'), 'duration')
    if fps <= 0 or duration < 0:
        raise WorkerError('INVALID_DESCRIPTION', 'fps must be positive and duration non-negative')
    marbles = description.get('marbles') or []
    pieces = description.get('pieces') or []
    relink = set(args.get('relink') or [])

    # Read every motion file before changing the scene, so a bad file leaves the scene untouched
    marble_motion = {marble['id']: read_motion(project_dir, marble['motionPath'], 4, marble.get('sampleCount')) for marble in marbles}
    piece_motion = {
        piece['id']: read_motion(project_dir, piece['motionPath'], 2, piece.get('sampleCount'))
        for piece in pieces
        if piece.get('motionPath')
    }

    scene = bpy.context.scene
    set_frame_rate(scene, fps, duration)
    studio.set_resolution(scene, description.get('frame') or {'width': 9, 'height': 16})
    theme = themes.theme_name(description.get('theme'))
    # A project theme: its base in `theme`, its colours here. Every theme lookup of this apply reads them.
    themes.set_overrides(description.get('themeOverrides'))
    marble_radius = max([float(marble['radius']) for marble in marbles] or [DEFAULT_MARBLE_RADIUS])
    context = skins.skin_context(theme, marble_radius, description.get('reactions'), description.get('themeOptions'))
    context['projectDir'] = project_dir
    context['assets'] = {}
    managed = ensure_collection(MANAGED_COLLECTION)
    holders = {obj['mm_id']: obj for obj in managed.objects if is_holder(obj)}
    report = {'created': [], 'updated': [], 'skipped': [], 'removed': [], 'keyframes': 0, 'skins': {}}
    total = max(1, len(marbles) + len(pieces))

    for index, marble in enumerate(marbles):
        progress(index / total, 'Writing marble ' + marble.get('name', marble['id']))
        holder, created = take_holder(holders, managed, marble['id'], marble.get('name'), 'marble', float(marble['radius']))
        if not created and marble['id'] not in relink and link_state(holder)[0] == 'unlinked':
            report['skipped'].append(marble['id'])
            continue
        report['keyframes'] += write_marble(holder, marble, marble_motion[marble['id']], fps, pieces)
        record_skins(report, marble['id'], ensure_skin(holder, 'marble', marble, managed, context))
        report['created' if created else 'updated'].append(marble['id'])

    for index, piece in enumerate(pieces):
        progress((len(marbles) + index) / total, 'Writing piece ' + piece.get('name', piece['id']))
        holder, created = take_holder(holders, managed, piece['id'], piece.get('name'), 'piece', 0.02)
        if not created and piece['id'] not in relink and link_state(holder)[0] == 'unlinked':
            report['skipped'].append(piece['id'])
            continue
        report['keyframes'] += write_piece(holder, piece, piece_motion.get(piece['id']), fps)
        record_skins(report, piece['id'], ensure_skin(holder, 'piece', piece, managed, context))
        report['created' if created else 'updated'].append(piece['id'])

    if holders:
        detached = ensure_collection(DETACHED_COLLECTION)
        for mm_id, holder in holders.items():
            detach(holder, managed, detached)
            report['removed'].append(mm_id)
    report['texts'] = walltext.apply_texts(
        project_dir, description.get('wallTexts') or [], managed, lambda: ensure_collection(DETACHED_COLLECTION),
        fps=fps, duration=duration)

    bounds = scene_bounds(marbles, marble_motion, pieces)
    studio_report = studio.ensure_studio(scene, theme)
    report['studioCreated'] = studio_report['created']
    report['themed'] = studio_report['themed']
    report['theme'] = theme
    camera_settings = None
    if description.get('camera') is not None:
        camera_settings = camera.settings_from(description['camera'], themes.theme_settings(theme))
    # A loop film renders [start, end); the camera closes the loop and `render_film` reads the range from the scene
    loop = loop_range(description.get('loop'))
    if loop is not None:
        scene['mm_loop'] = [loop['start'], loop['end'], loop['blend']]
    elif 'mm_loop' in scene:
        del scene['mm_loop']
    if camera_settings is not None:
        camera_settings['loop'] = loop
        camera_settings['pieceLength'] = typical_piece_length(pieces)
        camera_settings['opening'] = camera.opening_pieces(pieces)
    report['loop'] = loop
    report['camera'] = studio.update_camera(
        scene, bounds, camera_settings, marbles, marble_motion, fps, regenerate=bool(args.get('regenerateCamera')))
    report['cameraFramed'] = report['camera'] in ('framed', 'baked')
    # Captions and end cards hang from the film camera, which exists only once the studio is set up
    report['texts']['screen'] = walltext.attach_screen_texts(managed, studio.studio_object('studio.camera'), scene)
    # The wall covers the run and the camera's view, so the film never shows its edge
    report['wall'] = studio.fit_wall(scene, bounds, theme)
    scene['mm_revision'] = int(description.get('revision', 0))
    scene['mm_project_id'] = str(description.get('projectId', ''))
    scene.frame_set(scene.frame_current)
    report.update({
        'fps': fps,
        'frameStart': scene.frame_start,
        'frameEnd': scene.frame_end,
        'revision': scene['mm_revision'],
        'ms': round((time.perf_counter() - began) * 1000, 1),
    })
    return report


def inspect():
    managed = bpy.data.collections.get(MANAGED_COLLECTION)
    detached = bpy.data.collections.get(DETACHED_COLLECTION)
    holders = []
    for obj in (managed.objects if managed else []):
        if not is_holder(obj):
            continue
        state, reason = link_state(obj)
        holders.append({
            'mmId': obj['mm_id'],
            'role': obj['mm_role'],
            'name': obj.name,
            'link': state,
            'reason': reason,
            'skins': [child.name for child in obj.children],
            'skinKind': next((child.get('mm_skin') for child in obj.children if child.get('mm_skin')), None),
        })
    studio_collection = bpy.data.collections.get(studio.STUDIO_COLLECTION)
    scene = bpy.context.scene
    return {
        'holders': holders,
        'detached': [obj.name for obj in (detached.objects if detached else [])],
        'texts': walltext.inspect(managed),
        'studio': [
            {'name': obj.name, 'role': obj.get('mm_role')}
            for obj in (studio_collection.objects if studio_collection else [])
        ],
        'revision': scene.get('mm_revision'),
        'frameStart': scene.frame_start,
        'frameEnd': scene.frame_end,
        'fps': scene.render.fps / scene.render.fps_base,
    }


# Holders


def is_holder(obj):
    return obj.get('mm_owner') == OWNER and obj.get('mm_role') in ('marble', 'piece') and obj.type == 'EMPTY'


def take_holder(holders, managed, mm_id, name, role, display_size):
    holder = holders.pop(mm_id, None)
    if holder is not None:
        if name and holder.name != name:
            holder.name = name
        return holder, False
    holder = bpy.data.objects.new(name or mm_id, None)
    holder.empty_display_type = 'PLAIN_AXES'
    holder.empty_display_size = display_size
    holder.rotation_mode = 'XYZ'
    holder.lock_location = (True, True, True)
    holder.lock_rotation = (True, True, True)
    holder.lock_scale = (True, True, True)
    tag(holder, mm_id, role)
    managed.objects.link(holder)
    return holder, True


def ensure_skin(holder, kind, entity, managed, context):
    """Keeps existing child skins and their local offsets, rebuilding only unedited app skins; creates the wanted
    skin for a bare holder. Returns the state of each skin.

    A piece wants its library skin when `assetPath` names a loadable asset and the theme default otherwise. An
    unedited app skin of the other kind is replaced, and the new skin takes over its root offset.
    """
    if kind == 'marble':
        if holder.children:
            return [skins.refresh_default_skin(child, kind, entity, context, managed) for child in holder.children]
        skins.create_marble_skin(holder, entity, managed, context)
        return ['created']

    states = []
    template, manifest = None, None
    relative = entity.get('assetPath')
    if relative:
        template, manifest, problem = assets.load_asset(context['projectDir'], relative, context['assets'])
        if problem:
            states.append(problem)
    current = [child for child in holder.children if child.get('mm_skin') == assets.ASSET_SKIN and child.get('mm_asset') == relative]
    if template is None and current:
        # Keep a skin whose asset file is missing for now rather than swapping it for the default
        return states + ['kept']

    def create(offset=None):
        if template is not None:
            assets.create_asset_skin(holder, entity, template, manifest, managed, context, offset)
        else:
            skin = skins.create_piece_skin(holder, entity, managed, context)
            skins.apply_offset(skin, offset)

    if not holder.children:
        create()
        return states + ['created']
    for child in list(holder.children):
        owner = child.get('mm_skin')
        if owner not in (skins.DEFAULT_SKIN, assets.ASSET_SKIN):
            states.append('custom')
        elif template is None and owner == skins.DEFAULT_SKIN:
            states.append(skins.refresh_default_skin(child, kind, entity, context, managed))
        elif template is not None and owner == assets.ASSET_SKIN and child.get('mm_asset') == relative:
            states.append(assets.refresh_asset_skin(child, entity, template, manifest, context, managed))
        elif skins.is_edited(child):
            states.append('edited')
        else:
            offset = skins.user_offset(child)
            for obj in [child, *descendants(child)]:
                skins.release_reactions(obj)
            skins.remove_object(child)
            create(offset)
            states.append('replaced')
    return states


def record_skins(report, mm_id, states):
    for state in states:
        if state in ('edited', 'custom', 'missingAsset', 'invalidAsset'):
            report['skins'][mm_id] = state


def detach(holder, managed, detached):
    """Moves the holder's skins to the detached collection in place and deletes the holder"""
    for child in list(holder.children):
        for obj in [child, *descendants(child)]:
            skins.release_reactions(obj)
        matrix = child.matrix_world.copy()
        child.parent = None
        child.matrix_world = matrix
        for obj in [child, *descendants(child)]:
            link_only_to(obj, detached, remove_from=managed)
    action = holder.animation_data.action if holder.animation_data else None
    bpy.data.objects.remove(holder)
    if action is not None and action.get('mm_owner') == OWNER and action.users == 0:
        bpy.data.actions.remove(action)


# Link state


def transform_values(holder):
    return [*holder.location, *holder.rotation_euler, *holder.scale]


def remember_written(holder, animated):
    values = transform_values(holder)
    holder['mm_written'] = [round(value, 6) for value in values]
    holder['mm_animated'] = sorted(animated)
    holder['mm_keys'] = anim.keyframe_signature(holder, KEYED_PATHS)


def link_state(holder):
    """`unlinked` when the user marked the holder or changed what the app last wrote"""
    if holder.get('mm_link') == 'unlinked':
        return 'unlinked', 'marked'
    written = holder.get('mm_written')
    if written is None:
        return 'linked', None
    animated = set(holder.get('mm_animated', []))
    current = transform_values(holder)
    for index, value in enumerate(written):
        if index not in animated and abs(current[index] - value) > 1e-5:
            return 'unlinked', 'transform'
    signature = list(holder.get('mm_keys', [0.0, 0]))
    current_signature = anim.keyframe_signature(holder, KEYED_PATHS)
    if current_signature[1] != signature[1] or abs(current_signature[0] - signature[0]) > 1e-2 + abs(signature[0]) * 1e-6:
        return 'unlinked', 'keyframes'
    return 'linked', None


# Keyframes


def write_marble(holder, marble, motion, fps, pieces=()):
    radius = finite(marble['radius'], 'radius')
    channelbag = anim.ensure_channelbag(holder)
    anim.clear_channels(holder, KEYED_PATHS)
    holder.location = (0.0, -(radius + MARBLE_WALL_GAP), 0.0)
    holder.rotation_euler = (0.0, 0.0, 0.0)
    holder.scale = (1.0, 1.0, 1.0)
    holder.empty_display_size = radius
    count = 0
    if len(motion):
        frames, times = frames_covering(motion[:, 0], fps)
        # Every hit lands on a frame, so contact frames show the marble touching its piece
        hits = contacts.marble_contacts(motion, radius, pieces)
        motion = contacts.with_contact_samples(motion, hits)
        times = np.clip(contacts.warp(times, hits, contacts.snap_grid(fps)), motion[0, 0], motion[-1, 0])
        x = np.interp(times, motion[:, 0], motion[:, 1])
        y = np.interp(times, motion[:, 0], motion[:, 2])
        angle = np.interp(times, motion[:, 0], np.unwrap(motion[:, 3]))
        anim.write_fcurve(channelbag, 'location', 0, frames, x)
        anim.write_fcurve(channelbag, 'location', 2, frames, y)
        anim.write_fcurve(channelbag, 'rotation_euler', 1, frames, -angle)
        count = len(frames) * 3
        visible = contacts.tunnel_visibility(x, y, radius, pieces)
        if marble.get('ghostOf'):
            # A loop ghost is hidden until its replay begins; the marble it replays has left the release point by
            # the loop start, so nothing waits there in the first frame either
            frames = np.concatenate([[frames[0] - 1], frames])
            visible = np.concatenate([[0.0], visible])
        if not visible.all():
            anim.write_fcurve(channelbag, '["mm_visible"]', 0, frames, visible)
            count += len(frames)
    holder['mm_visible'] = 1.0
    remember_written(holder, MARBLE_ANIMATED)
    return count


def write_piece(holder, piece, motion, fps):
    params = piece.get('params') or {}
    depth = float(params.get('depth', DEFAULT_PIECE_DEPTH))
    wall_offset = finite(piece.get('wallOffset', 0.0), 'wallOffset')
    position = piece['position']
    channelbag = anim.ensure_channelbag(holder)
    anim.clear_channels(holder, KEYED_PATHS)
    holder.location = (finite(position['x'], 'x'), -(wall_offset + depth / 2), finite(position['y'], 'y'))
    holder.rotation_euler = (0.0, -finite(piece.get('angle', 0.0), 'angle'), 0.0)
    holder.scale = (1.0, 1.0, 1.0)
    count = 0
    animated = set()
    if motion is not None and len(motion):
        frames, times = frames_covering(motion[:, 0], fps)
        angle = np.interp(times, motion[:, 0], np.unwrap(motion[:, 1]))
        anim.write_fcurve(channelbag, 'rotation_euler', 1, frames, -angle)
        count += len(frames)
        animated = MOVING_PIECE_ANIMATED
    holder['mm_hit'] = 0.0
    holder.id_properties_ui('mm_hit').update(min=0.0, max=1.0, soft_min=0.0, soft_max=1.0)
    grid = contacts.snap_grid(fps)
    times = reaction_times(piece)
    hit_frames, hit_values = hit_keys([contacts.snap(value, grid) for value in times], fps)
    anim.write_fcurve(channelbag, '["mm_hit"]', 0, hit_frames, hit_values)
    count += len(hit_frames)
    holder['mm_hit_times'] = times
    remember_written(holder, animated)
    return count


def is_musical(piece):
    """Music pieces sound their hits; scenery (rails, tunnels, windmills, switchbacks) never has hits"""
    musical = piece.get('musical')
    return musical if isinstance(musical, bool) else piece.get('type', 'platform') == 'platform'


def reaction_times(piece):
    """Times `mm_hit` fires: the hits of a music piece, the contact starts of scenery"""
    values = piece.get('hitTimes') if is_musical(piece) else piece.get('contactTimes')
    return sorted(float(value) for value in values or [] if isinstance(value, (int, float)) and math.isfinite(value))


def frames_covering(times, fps):
    """Whole frames inside the sampled time range; the curve holds its end values outside it"""
    first = math.ceil(times[0] * fps - 1e-6)
    last = math.floor(times[-1] * fps + 1e-6)
    if last < first:
        last = first
    frames = np.arange(first, last + 1, dtype=np.float64)
    return frames, frames / fps


def hit_keys(hit_times, fps):
    """`mm_hit` keys: 0 on the frame before a hit, 1 at the exact hit time, exponential decay to 0 over HIT_DECAY"""
    if not hit_times:
        return [0.0], [0.0]
    hits = np.asarray(sorted(float(value) for value in hit_times), dtype=np.float64)
    frames = set()
    for hit in hits:
        hit_frame = hit * fps
        frames.add(round(hit_frame, 4))
        frames.add(float(math.floor(hit_frame - 1e-4)))
        for frame in range(math.ceil(hit_frame + 1e-4), math.ceil((hit + HIT_DECAY) * fps) + 1):
            frames.add(float(frame))
    frames = np.asarray(sorted(frames), dtype=np.float64)
    times = frames / fps
    elapsed = times[:, None] - hits[None, :]
    active = (elapsed >= -1e-6) & (elapsed < HIT_DECAY)
    values = np.where(active, np.exp(-np.clip(elapsed, 0, None) / HIT_TAU), 0.0).max(axis=1)
    return frames, values


# Files and bounds


def read_motion(project_dir, relative, columns, expected_count):
    path = resolve_package_path(project_dir, relative)
    if not path.is_file():
        raise WorkerError('NOT_FOUND', 'Motion file not found: ' + relative)
    data = np.fromfile(path, dtype='<f4')
    if data.size % columns:
        raise WorkerError('INVALID_MOTION', relative + ' is not a sequence of ' + str(columns) + '-float records')
    records = data.reshape(-1, columns).astype(np.float64)
    if expected_count is not None and len(records) != expected_count:
        raise WorkerError('INVALID_MOTION', relative + ' has ' + str(len(records)) + ' records, expected ' + str(expected_count))
    if not np.isfinite(records).all():
        raise WorkerError('INVALID_MOTION', relative + ' contains non-finite values')
    if len(records) > 1 and np.any(np.diff(records[:, 0]) <= 0):
        raise WorkerError('INVALID_MOTION', relative + ' times must increase')
    return records


def loop_range(value):
    """`{start, end, blend}` of a loop description, or None"""
    if not isinstance(value, dict):
        return None
    start = finite(value.get('start'), 'loop.start')
    end = finite(value.get('end'), 'loop.end')
    blend = finite(value.get('blend', 0.0), 'loop.blend')
    if end <= start:
        raise WorkerError('INVALID_DESCRIPTION', 'loop.end must be after loop.start')
    return {'start': start, 'end': end, 'blend': max(0.0, min(blend, (end - start) / 2))}


def set_frame_rate(scene, fps, duration):
    whole = max(1, round(fps))
    scene.render.fps = whole
    scene.render.fps_base = whole / fps
    scene.frame_start = 0
    scene.frame_end = max(1, math.ceil(duration * fps - 1e-6))


def typical_piece_length(pieces):
    """Median length of the bars and blades on the wall, which sets how far the camera may pull back"""
    lengths = []
    for piece in pieces:
        params = piece.get('params') or {}
        if 'bladeLength' in params:
            lengths.append(2 * float(params['bladeLength']) + 2 * float(params.get('hubRadius', 0.0)))
        elif piece.get('type', 'platform') == 'platform' and 'length' in params:
            lengths.append(float(params['length']))
    return float(np.median(lengths)) if lengths else None


def scene_bounds(marbles, marble_motion, pieces):
    xs, ys = [], []
    for marble in marbles:
        motion = marble_motion[marble['id']]
        if len(motion):
            radius = float(marble['radius'])
            xs += [motion[:, 1].min() - radius, motion[:, 1].max() + radius]
            ys += [motion[:, 2].min() - radius, motion[:, 2].max() + radius]
    for piece in pieces:
        params = piece.get('params') or {}
        half = float(params.get('length', 0.02)) / 2
        if 'bladeLength' in params:
            half = float(params['bladeLength']) + float(params.get('hubRadius', 0.0))
        xs += [piece['position']['x'] - half, piece['position']['x'] + half]
        ys += [piece['position']['y'] - half, piece['position']['y'] + half]
        for point in [*(piece.get('path') or []), *(point for wire in piece.get('paths') or [] for point in wire)]:
            xs.append(float(point['x']))
            ys.append(float(point['y']))
    if not xs:
        return (-0.5, -0.5), (0.5, 0.5)
    return (float(min(xs)), float(min(ys))), (float(max(xs)), float(max(ys)))
