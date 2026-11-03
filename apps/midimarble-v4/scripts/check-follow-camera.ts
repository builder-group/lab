// Compares the TypeScript follow camera with the keyframes Blender bakes. For each fixture it exports a package
// (`export-blender-fixture.ts`), applies it headless and dumps the camera (`blender/tests/dump_camera.py`), then
// bakes the same package with `bakeFollowCamera` and reports the per-frame error. Outputs go to `.local/camera/`.
// Usage: tsx scripts/check-follow-camera.ts [fixture ...] [--fps 30] [--skip-blender]
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { TMotionFile } from '../src/modules/blender/scene-builder';
import type { TSceneDescription } from '../src/modules/blender/scene-description';
import { compareCameraTrack, type TBlenderCameraDump } from '../src/modules/camera/compare-track';
import { bakeFollowCamera, followCameraInput } from '../src/modules/camera/follow-camera';

const BLENDER = '/Applications/Blender.app/Contents/MacOS/Blender';
const POSITION_LIMIT = 0.01;
const ANGLE_LIMIT = 0.5;

const args = process.argv.slice(2);
const fpsIndex = args.indexOf('--fps');
const fps = fpsIndex >= 0 ? Number(args[fpsIndex + 1]) : 30;
const isSkippingBlender = args.includes('--skip-blender');
const named = args.filter(
	(arg, index) => !arg.startsWith('--') && (fpsIndex < 0 || index !== fpsIndex + 1)
);
const fixtures = named.length > 0 ? named : ['zigzag', 'reference-20', 'jingle-bells'];
const root = new URL('..', import.meta.url).pathname;

let isFailing = false;
for (const fixture of fixtures) {
	const dir = join(root, '.local', 'camera', `${fixture}-${fps}`);
	const packageDir = join(dir, 'package');
	const dumpPath = join(dir, 'blender-camera.json');
	if (!isSkippingBlender || !existsSync(dumpPath)) {
		execFileSync(
			'pnpm',
			[
				'exec',
				'tsx',
				'scripts/export-blender-fixture.ts',
				fixture,
				packageDir,
				'brass',
				String(fps)
			],
			{
				cwd: root,
				stdio: ['ignore', 'ignore', 'inherit']
			}
		);
		execFileSync(
			BLENDER,
			[
				'--background',
				'--factory-startup',
				'--python-exit-code',
				'1',
				'--python',
				'blender/tests/dump_camera.py',
				'--',
				packageDir
			],
			{ cwd: root, stdio: ['ignore', 'ignore', 'inherit'] }
		);
	}
	const description = JSON.parse(
		readFileSync(join(packageDir, '.cache', 'scene.json'), 'utf8')
	) as TSceneDescription;
	const motionFiles: TMotionFile[] = description.marbles.map((marble) => ({
		path: marble.motionPath,
		bytes: new Uint8Array(readFileSync(join(packageDir, marble.motionPath)))
	}));
	const dump = JSON.parse(readFileSync(dumpPath, 'utf8')) as TBlenderCameraDump;
	const started = performance.now();
	const track = bakeFollowCamera(followCameraInput(description, motionFiles));
	const ms = performance.now() - started;
	if (track == null) {
		console.log(JSON.stringify({ fixture, error: 'no track', blender: dump.camera }));
		isFailing = true;
		continue;
	}
	const error = compareCameraTrack(track, dump);
	const isOk =
		error.maxPosition <= POSITION_LIMIT &&
		error.maxAngle <= ANGLE_LIMIT &&
		error.frameCountDelta === 0;
	if (!isOk) isFailing = true;
	console.log(
		JSON.stringify({
			fixture,
			fps,
			ok: isOk,
			frames: error.frames,
			bakeMs: Math.round(ms),
			maxPositionMm: +(error.maxPosition * 1000).toFixed(3),
			meanPositionMm: +(error.meanPosition * 1000).toFixed(4),
			maxAngleDeg: +error.maxAngle.toFixed(4),
			meanAngleDeg: +error.meanAngle.toFixed(5),
			maxFocusMm: +(error.maxFocus * 1000).toFixed(3),
			worstFrame: error.worstFrame,
			frameCountDelta: error.frameCountDelta
		})
	);
}
process.exit(isFailing ? 1 : 0);
