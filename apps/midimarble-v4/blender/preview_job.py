"""Preview frames job: `blender --background --factory-startup <folder>/scene.blend --python preview_job.py -- <folder>/job.json`"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from mm_worker.live_preview import main  # noqa: E402

main()
