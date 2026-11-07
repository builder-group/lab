"""Entry point: `blender [--background] [scene.blend] --python worker.py -- --project-dir <package> [--host-pid <pid>]`"""
import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from mm_worker.bridge import run  # noqa: E402

parser = argparse.ArgumentParser()
parser.add_argument('--project-dir', required=True)
parser.add_argument('--host-pid', type=int, default=None)
arguments = parser.parse_args(sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else [])
run(arguments.project_dir, arguments.host_pid)
