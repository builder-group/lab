// Writes the example projects in `fixtures/`. Pieces are linked to hits, so their positions come from the
// simulation when a project is opened. The M3 fixtures are built with the assists, which simulate while
// building, so regenerating them after an engine change may change their angles; commit the result.
import { writeFileSync } from 'node:fs';
import { parseProject, serializeProject, type TProject } from '../src/modules/project';
import {
	buildLongGapProject,
	buildTwoMarblesProject,
	buildWindmillProject,
	buildZigzagProject
} from '../src/modules/simulation/fixture-builders';
import { createStaircaseProject } from '../src/modules/simulation/fixture-projects';
import { namePiecesInOrder } from '../src/modules/simulation/piece-names';
import { createSimulator } from '../src/modules/simulation/simulate';

const simulator = await createSimulator();
const simulate = (project: TProject) => simulator.simulate(project);

const fixtures: [string, TProject][] = [
	['staircase.marble.json', createStaircaseProject()],
	['zigzag.marble.json', buildZigzagProject(simulate)],
	['long-gap.marble.json', buildLongGapProject(simulate)],
	['windmill.marble.json', buildWindmillProject(simulate)],
	['two-marbles.marble.json', buildTwoMarblesProject(simulate)]
];
simulator.dispose();

for (const [name, project] of fixtures) {
	// Pieces are named in time order last, so the Layers list reads Platform 1, 2, 3 down each marble
	const json = serializeProject(namePiecesInOrder(project));
	const [isProjectOk, projectErr] = parseProject(json);
	if (!isProjectOk) throw new Error(`${name} is not a valid project: ${projectErr.message}`);
	writeFileSync(new URL(`../fixtures/${name}`, import.meta.url), json);
	console.log(`Wrote fixtures/${name}`);
}
