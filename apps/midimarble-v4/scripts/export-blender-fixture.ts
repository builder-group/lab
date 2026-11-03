// Simulates a fixture and writes a package the Blender worker can apply headless: the scene description,
// motion files and the soundtrack WAV. Used by the Blender look and film checks.
// Usage: tsx scripts/export-blender-fixture.ts <fixture> <package-dir> [theme] [fps]
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { SoundBankLoader } from 'spessasynth_core';
import { buildSceneDescription, SCENE_DESCRIPTION_PATH } from '../src/modules/blender/scene-builder';
import { encodeWav } from '../src/modules/music/audio-engine';
import { foldLoopAudio, loopLanes } from '../src/modules/music/loop-audio';
import { renderLanes } from '../src/modules/music/synthesize';
import { parseProject, serializeProject } from '../src/modules/project';
import { createLoop } from '../src/modules/simulation/loop';
import { createSimulator } from '../src/modules/simulation/simulate';

const [fixture = 'zigzag', packageDir, theme = 'brass', fpsText = '60'] = process.argv.slice(2);
if (packageDir == null) throw new Error('Usage: export-blender-fixture <fixture> <package-dir> [theme] [fps]');

const json = readFileSync(new URL(`../fixtures/${fixture}.marble.json`, import.meta.url), 'utf8');
const [isProjectOk, projectErr, parsed] = parseProject(json);
if (!isProjectOk) throw projectErr;
const project = { ...parsed, design: { ...parsed.design, theme } };

const simulator = await createSimulator();
const result = simulator.simulate(project);
simulator.dispose();
const build = buildSceneDescription(project, result, { fps: Number(fpsText) });

const write = (relative: string, bytes: Uint8Array | string): void => {
	const path = join(packageDir, relative);
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, bytes);
};
write('project.json', serializeProject(project));
for (const file of build.motionFiles) write(file.path, file.bytes);
write(SCENE_DESCRIPTION_PATH, JSON.stringify(build.description));

const bank = SoundBankLoader.fromArrayBuffer(
	new Uint8Array(readFileSync(new URL('../public/audio/marble-instruments.sf2', import.meta.url))).buffer
);
// A loop's soundtrack covers the loop range with note tails folded onto its start, like `renderProjectAudio`
const loop = project.design.loop ? createLoop(project, result) : null;
const audio =
	loop != null
		? foldLoopAudio(renderLanes(loopLanes(project.music.lanes, loop), { sampleRate: 48000, duration: loop.length + 3, bank }), loop.length)
		: renderLanes(project.music.lanes, { sampleRate: 48000, duration: project.end, bank });
write('renders/soundtrack.wav', encodeWav(audio.left, audio.right, audio.sampleRate));

const hits = result.hits.filter((hit) => hit.actualTime != null).length;
console.log(
	JSON.stringify({
		fixture,
		theme,
		duration: result.duration,
		marbles: build.description.marbles.length,
		pieces: build.description.pieces.map((piece) => piece.type),
		hits,
		totalHits: result.hits.length,
		loop: loop != null ? { start: loop.start, end: loop.end } : null
	})
);
