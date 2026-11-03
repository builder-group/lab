"""Film render job: `blender --background --factory-startup <job>/scene.blend --python render_job.py -- <job>/job.json`"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from mm_worker.render import run_job  # noqa: E402

run_job(sys.argv[sys.argv.index('--') + 1])
