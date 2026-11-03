"""F-curve writing for app-owned holders. Blender 4.4+ stores F-curves in slotted action channelbags."""
import bpy
import numpy as np
from bpy_extras import anim_utils

# `KeyframePoint.interpolation` enum value for LINEAR (CONSTANT = 0, LINEAR = 1, BEZIER = 2)
INTERPOLATION_LINEAR = 1


def ensure_channelbag(holder):
    """Returns the channelbag of the holder's own action, creating the action and slot when missing"""
    action_name = 'MM · ' + holder['mm_id']
    animation = holder.animation_data or holder.animation_data_create()
    action = animation.action
    if action is None or action.get('mm_owner') != 'midimarble':
        action = bpy.data.actions.get(action_name) or bpy.data.actions.new(action_name)
        action['mm_owner'] = 'midimarble'
        animation.action = action
    slot = animation.action_slot
    if slot is None:
        slot = action.slots[0] if len(action.slots) else action.slots.new('OBJECT', holder.name)
        animation.action_slot = slot
    return anim_utils.action_ensure_channelbag_for_slot(action, slot)


def clear_channels(holder, data_paths):
    """Removes the holder's F-curves for the given data paths and returns the remaining channelbag"""
    if holder.animation_data is None or holder.animation_data.action is None:
        return None
    channelbag = anim_utils.animdata_get_channelbag_for_assigned_slot(holder.animation_data)
    if channelbag is None:
        return None
    for fcurve in list(channelbag.fcurves):
        if fcurve.data_path in data_paths:
            channelbag.fcurves.remove(fcurve)
    return channelbag


def write_fcurve(channelbag, data_path, index, frames, values):
    """Writes one linear F-curve in bulk with `foreach_set`"""
    frames = np.asarray(frames, dtype=np.float32)
    values = np.asarray(values, dtype=np.float32)
    fcurve = channelbag.fcurves.find(data_path, index=index)
    if fcurve is None:
        fcurve = channelbag.fcurves.new(data_path, index=index)
    else:
        fcurve.keyframe_points.clear()
    count = len(frames)
    if not count:
        return fcurve
    fcurve.keyframe_points.add(count)
    coordinates = np.empty(count * 2, dtype=np.float32)
    coordinates[0::2] = frames
    coordinates[1::2] = values
    fcurve.keyframe_points.foreach_set('co', coordinates)
    fcurve.keyframe_points.foreach_set('interpolation', np.full(count, INTERPOLATION_LINEAR, dtype=np.int32))
    fcurve.update()
    return fcurve


def keyframe_signature(holder, data_paths):
    """Sum and count of the holder's keys on the given paths, used to detect Blender-side edits"""
    if holder.animation_data is None or holder.animation_data.action is None:
        return [0.0, 0]
    channelbag = anim_utils.animdata_get_channelbag_for_assigned_slot(holder.animation_data)
    if channelbag is None:
        return [0.0, 0]
    total, count = 0.0, 0
    for fcurve in channelbag.fcurves:
        if fcurve.data_path not in data_paths:
            continue
        points = len(fcurve.keyframe_points)
        buffer = np.empty(points * 2, dtype=np.float32)
        fcurve.keyframe_points.foreach_get('co', buffer)
        total += float(np.abs(buffer.astype(np.float64)).sum())
        count += points
    return [round(total, 3), count]
