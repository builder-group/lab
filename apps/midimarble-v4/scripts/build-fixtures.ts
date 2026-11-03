// Writes the example projects in `fixtures/`. Pieces are linked to hits, so the files do not depend on
// simulation output and stay stable between runs.
import { writeFileSync } from 'node:fs';
import { parseProject, serializeProject, type TProject } from '../src/modules/project';
import { createStaircaseProject } from '../src/modules/simulation/fixture-projects';

const fixtures: [string, TProject][] = [['staircase.marble.json', createStaircaseProject()]];

for (const [name, project] of fixtures) {
	const json = serializeProject(project);
	const [isProjectOk, projectErr] = parseProject(json);
	if (!isProjectOk) throw new Error(`${name} is not a valid project: ${projectErr.message}`);
	writeFileSync(new URL(`../fixtures/${name}`, import.meta.url), json);
	console.log(`Wrote fixtures/${name}`);
}
