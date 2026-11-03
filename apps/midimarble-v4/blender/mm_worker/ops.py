"""Operation dispatcher shared by the mailbox bridge and the headless checks."""
import os
from pathlib import Path

import bpy

from . import preview, render, scene
from .util import WorkerError

PROTOCOL_VERSION = 1


class Worker:
    def __init__(self, project_dir):
        self.project_dir = Path(project_dir).resolve()
        self.stop = False
        self.host_pid = None
        # Film render processes by job ID
        self.jobs = {}

    def handle(self, op, args, progress=lambda fraction, phase: None):
        if not isinstance(args, dict):
            raise WorkerError('INVALID_ARGS', 'Request args must be an object')
        if op == 'ping':
            return {
                'protocol': PROTOCOL_VERSION,
                'blenderVersion': bpy.app.version_string,
                'background': bpy.app.background,
                'pid': os.getpid(),
                'projectDir': str(self.project_dir),
            }
        if op == 'apply_scene':
            return scene.apply_scene(self.project_dir, args, progress)
        if op == 'preview_frame':
            return preview.preview_frame(self.project_dir, args)
        if op == 'render_film':
            return render.start_render_film(self, args)
        if op == 'cancel':
            return render.cancel(self, args)
        if op == 'inspect':
            return scene.inspect()
        if op == 'save':
            return self.save()
        if op == 'shutdown':
            result = self.save()
            render.stop_all(self)
            self.stop = True
            return {**result, 'closing': True}
        raise WorkerError('UNKNOWN_OP', 'Unknown operation: ' + str(op))

    def poll_jobs(self):
        render.poll_jobs(self)

    def save(self):
        target = self.project_dir / 'scene.blend'
        bpy.ops.wm.save_as_mainfile(filepath=str(target), relative_remap=True, compress=False)
        return {'path': str(target), 'saved': True}


def open_scene(project_dir):
    """Opens the package scene, or starts from an empty scene that keeps the user's preferences"""
    target = Path(project_dir) / 'scene.blend'
    if bpy.data.filepath and Path(bpy.data.filepath).resolve() == target.resolve():
        return
    if target.is_file():
        bpy.ops.wm.open_mainfile(filepath=str(target))
    else:
        bpy.ops.wm.read_homefile(use_empty=True)
