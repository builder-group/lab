// Simulates a fixture, scatters a Decor set over it and writes a package the Blender worker can apply headless, with a
// report of what Scatter Decor did: how many items, how long it took and how many the film camera shows per frame.
// Usage: tsx scripts/export-decor-fixture.ts <fixture> <package-dir> [theme] [density] [seed]
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { projectToFrame } from '../src/modules/camera';
import { buildSceneDescription, SCENE_DESCRIPTION_PATH } from '../src/modules/blender/scene-builder';
import { builtInSource } from '../src/modules/design/decor';
import { scatterDecorCommands } from '../src/modules/design/decor-scatter';
import { filmCamera } from '../src/modules/design/film-camera';
import { applyProjectCommands, parseProject, serializeProject } from '../src/modules/project';
import { createSimulator } from '../src/modules/simulation/simulate';

const [fixture = 'jingle-bells', packageDir, theme = 'brass', densityText = '0.5', seedText = '1'] = process.argv.slice(2);
if (packageDir == null) throw new Error('Usage: export-decor-fixture <fixture> <package-dir> [theme] [density] [seed]');

const [isProjectOk, projectErr, parsed] = parseProject(readFileSync(new URL(`../fixtures/${fixture}.marble.json`, import.meta.url), 'utf8'));
if (!isProjectOk) throw projectErr;
const base = { ...parsed, design: { ...parsed.design, theme } };

const simulator = await createSimulator();
const result = simulator.simulate(base);
simulator.dispose();
const track = filmCamera(base, result).track;
if (track == null) throw new Error('The fixture has no film camera');

const items = ['decor:bauble-red', 'decor:bauble-gold', 'decor:snowflake-gold', 'decor:gift-box', 'decor:star', 'decor:fairy-light'].map(builtInSource);
const started = performance.now();
const { commands, count } = scatterDecorCommands(base, result, track, { items, density: Number(densityText), seed: Number(seedText) });
const ms = Math.round(performance.now() - started);
const [isAppliedOk, appliedErr, project] = applyProjectCommands(base, commands);
if (!isAppliedOk) throw appliedErr;

const write = (relative: string, bytes: Uint8Array | string): void => {
	const path = join(packageDir, relative);
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, bytes);
};
const build = buildSceneDescription(project, result, { fps: 30 });
write('project.json', serializeProject(project));
for (const file of build.motionFiles) write(file.path, file.bytes);
write(SCENE_DESCRIPTION_PATH, JSON.stringify(build.description));

const inFrame: number[] = [];
for (let frame = 0; frame < track.frameCount; frame += 15) {
	inFrame.push(
		(project.design.decor ?? []).filter((item) => {
			const [u, v] = projectToFrame(track, frame, item.position.x, item.position.y, 0);
			return u >= 0 && u <= 1 && v >= 0 && v <= 1;
		}).length
	);
}
inFrame.sort((a, b) => a - b);
console.log(
	JSON.stringify({
		fixture,
		theme,
		items: count,
		ms,
		duration: result.duration,
		marbles: result.marbles.length,
		perFrame: { min: inFrame[0], median: inFrame[Math.floor(inFrame.length / 2)], max: inFrame[inFrame.length - 1] },
		bySource: Object.fromEntries(items.map((item) => [item.label, project.design.decor?.filter((decor) => decor.source === item.source).length]))
	})
);
