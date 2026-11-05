// Writes the scene descriptions `blender/tests/check_marble_look.py` applies: each comes from a project command, the way
// MCP and the inspector's tiles send one, through `buildSceneDescription`, so that check covers the path end to end.
// Usage: tsx scripts/export-marble-skin-scenes.ts <package-dir>
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { buildSceneDescription } from '../src/modules/scene/scene-builder';
import { builtInSkinCommands } from '../src/modules/film/film-commands';
import type { TLibraryItem } from '../src/modules/scene/pack-data';
import { expandCommands, type TAgentCommand } from '../src/modules/mcp/project-commands';
import { applyProjectCommands, type TProjectCommand } from '../src/modules/project/commands';
import { parseProject } from '../src/modules/project/project-file';
import { type TProject } from '../src/modules/project/schema';
import { createSimulator } from '../src/modules/simulation/simulate';

const [packageDir] = process.argv.slice(2);
if (packageDir == null) throw new Error('Usage: export-marble-skin-scenes <package-dir>');

const [isProjectOk, projectErr, parsed] = parseProject(readFileSync(new URL('../fixtures/two-marbles.marble.json', import.meta.url), 'utf8'));
if (!isProjectOk) throw projectErr;
const project: TProject = { ...parsed, film: { ...parsed.film, theme: 'brass', decor: [], camera: { ...parsed.film.camera, distance: 0.5 } } };
const [first, second] = project.marbles.map((entity) => entity.id);
if (first == null || second == null) throw new Error('The fixture needs two marbles');

const simulator = await createSimulator();
const result = simulator.simulate(project);
simulator.dispose();

const write = (relative: string, bytes: Uint8Array | string): void => {
	const path = join(packageDir, relative);
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, bytes);
};

const items = [{ id: 'marble-test-glass', scope: 'project', manifest: { id: 'marble-test-glass', label: 'Test Glass', role: 'skin', pieceType: 'marble' } }] as unknown as TLibraryItem[];

function agent(commands: TAgentCommand[]): TProjectCommand[] {
	const [isOk, err, expanded] = expandCommands(project, result, items, commands);
	if (!isOk) throw err;
	return expanded.commands;
}

/** An inspector tile's edit: what clicking Glass on a selected marble runs */
const tile = (entityId: string, skinId: string): TProjectCommand[] => builtInSkinCommands(project, { kind: 'entities', entityIds: [entityId] }, skinId);

const scenes: Record<string, TProjectCommand[]> = {
	default: [],
	'agent-glass-metal': agent([
		{ type: 'applySkin', assetId: 'marble:glass', ids: [first] },
		{ type: 'applySkin', assetId: 'marble:metal', ids: [second] }
	]),
	'agent-magic-library': agent([
		{ type: 'applySkin', assetId: 'marble:magic', ids: [first] },
		{ type: 'applySkin', assetId: 'marble-test-glass', ids: [second] }
	]),
	'tiles-glass-metal': [...tile(first, 'marble:glass'), ...tile(second, 'marble:metal')],
	steady: agent([{ type: 'updateFilm', film: { camera: { sway: 0 }, wall: { kind: 'plain', color: '#ffefc8' } } } as unknown as TAgentCommand])
};

for (const [name, commands] of Object.entries(scenes)) {
	const [isAppliedOk, appliedErr, applied] = applyProjectCommands(project, commands);
	if (!isAppliedOk) throw appliedErr;
	const build = buildSceneDescription(applied, result, { fps: 30 });
	for (const file of build.motionFiles) write(file.path, file.bytes);
	write(`.cache/scene-${name}.json`, JSON.stringify(build.description));
}
console.log(JSON.stringify({ scenes: Object.keys(scenes), marbles: [first, second] }));
