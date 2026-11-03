"""File mailbox between the app host and this Blender process.

The host writes `{id, op, args}` to `.bridge/host-inbox/<id>.json`. The worker answers with
`{id, ok, result | error: {code, message}}` in `.bridge/outbox/<id>.json` and may write progress to
`.bridge/outbox/<id>.progress.json`. `.bridge/status.json` reports liveness. All files are written atomically.
Requests run on Blender's main thread: a `bpy.app.timers` poller in GUI mode, a poll loop in background mode.
"""
import fcntl
import json
import os
import re
import time
import traceback

import bpy

from .ops import Worker, open_scene
from .util import WorkerError, write_json_atomic

POLL_SECONDS = 0.02
STATUS_SECONDS = 0.5
HOST_CHECK_SECONDS = 1.0
MAX_REQUEST_BYTES = 8 * 1024 * 1024
REQUEST_ID = re.compile(r'[A-Za-z0-9_-]{1,100}')


class Bridge:
    def __init__(self, project_dir, host_pid=None):
        self.worker = Worker(project_dir)
        self.bridge = self.worker.project_dir / '.bridge'
        self.host_inbox = self.bridge / 'host-inbox'
        self.outbox = self.bridge / 'outbox'
        self.host_inbox.mkdir(parents=True, exist_ok=True)
        self.outbox.mkdir(parents=True, exist_ok=True)
        self.lock = (self.bridge / 'worker.lock').open('a')
        try:
            fcntl.flock(self.lock.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise SystemExit('Another Blender worker already serves ' + str(self.worker.project_dir))
        self.host_pid = host_pid
        self.busy = None
        self.ready = False
        self.last_status = 0.0
        self.last_host_check = time.monotonic()
        self.last_progress = 0.0

    @property
    def stop(self):
        return self.worker.stop

    def start(self):
        open_scene(self.worker.project_dir)
        self.ready = True
        self.write_status()

    def write_status(self):
        write_json_atomic(self.bridge / 'status.json', {
            'pid': os.getpid(),
            'ready': self.ready and not self.stop,
            'projectDir': str(self.worker.project_dir),
            'background': bpy.app.background,
            'busy': self.busy,
            'updatedAt': time.time(),
        })
        self.last_status = time.monotonic()

    def respond(self, identity, result=None, error=None):
        envelope = {'id': identity, 'ok': error is None}
        if error is None:
            envelope['result'] = result
        else:
            envelope['error'] = error
        write_json_atomic(self.outbox / (identity + '.json'), envelope)
        (self.outbox / (identity + '.progress.json')).unlink(missing_ok=True)

    def tick(self):
        for path in sorted(self.host_inbox.glob('*.json')):
            self.handle_file(path)
            if self.stop:
                break
        now = time.monotonic()
        if now - self.last_host_check > HOST_CHECK_SECONDS:
            self.last_host_check = now
            if not self.host_alive():
                self.on_host_gone()
        if now - self.last_status > STATUS_SECONDS or self.stop:
            self.write_status()

    def handle_file(self, path):
        identity = path.stem
        if not REQUEST_ID.fullmatch(identity):
            path.unlink(missing_ok=True)
            return
        try:
            if path.stat().st_size > MAX_REQUEST_BYTES:
                raise WorkerError('TOO_LARGE', 'Requests are limited to 8 MB')
            try:
                request = json.loads(path.read_text())
            except (json.JSONDecodeError, UnicodeDecodeError) as error:
                raise WorkerError('INVALID_REQUEST', 'Request is not valid JSON: ' + str(error))
            path.unlink(missing_ok=True)
            if not isinstance(request, dict) or request.get('id') != identity or not isinstance(request.get('op'), str):
                raise WorkerError('INVALID_REQUEST', 'Request id must match its file name and op must be a string')
            self.busy = request['op']
            self.write_status()
            result = self.worker.handle(request['op'], request.get('args') or {}, lambda fraction, phase: self.progress(identity, fraction, phase))
            self.respond(identity, result)
        except WorkerError as error:
            path.unlink(missing_ok=True)
            self.respond(identity, error={'code': error.code, 'message': error.message})
        except Exception as error:
            path.unlink(missing_ok=True)
            traceback.print_exc()
            self.respond(identity, error={'code': 'FAILED', 'message': type(error).__name__ + ': ' + str(error)})
        finally:
            self.busy = None

    def progress(self, identity, fraction, phase):
        now = time.monotonic()
        if now - self.last_progress < 0.1:
            return
        self.last_progress = now
        write_json_atomic(self.outbox / (identity + '.progress.json'), {
            'id': identity, 'progress': max(0.0, min(1.0, float(fraction))), 'phase': phase, 'updatedAt': time.time()})

    def host_alive(self):
        if not self.host_pid:
            return True
        try:
            os.kill(self.host_pid, 0)
            return True
        except ProcessLookupError:
            return False
        except PermissionError:
            return True

    def on_host_gone(self):
        self.host_pid = None
        if bpy.app.background:
            # The app quit without stopping this session; keep the user's work and exit
            try:
                if bpy.data.is_dirty:
                    self.worker.save()
            finally:
                self.worker.stop = True
        else:
            # The user keeps working in this window; only the mailbox stops
            self.worker.stop = True


def run(project_dir, host_pid=None):
    bridge = Bridge(project_dir, host_pid)
    if bpy.app.background:
        bridge.start()
        try:
            while not bridge.stop:
                bridge.tick()
                time.sleep(POLL_SECONDS)
        finally:
            bridge.ready = False
            bridge.write_status()
        return

    def poll():
        try:
            if not bridge.ready:
                bridge.start()
            bridge.tick()
        except Exception:
            traceback.print_exc()
        if bridge.stop:
            bridge.ready = False
            bridge.write_status()
            if bridge.host_pid is not None:
                bpy.ops.wm.quit_blender()
            return None
        return POLL_SECONDS

    bpy.app.timers.register(poll, first_interval=POLL_SECONDS, persistent=True)
