// Runs the app's own Fix Hits on committed fixtures in place, for the ones whose builders no longer reproduce them or
// leave a look problem by hand. Run it after `fixtures:build` or `fixtures:reference`. Usage: tsx scripts/fix-fixtures.ts staircase reference-20
import { readFileSync, writeFileSync } from 'node:fs';
import { replaceBroken } from '../src/modules/compose/fix-it';
import { applyProjectCommands, parseProject, serializeProject, type TProject } from '../src/modules/project';
import { autoPlace, createChainForGap, createRailForGap, createSimulator, createSwitchbackForGap, createTunnelForGap } from '../src/modules/simulation';

const simulator = await createSimulator();
const simulate = (project: TProject): ReturnType<typeof simulator.simulate> => simulator.simulate(project);

for (const name of process.argv.slice(2)) {
	const url = new URL(`../fixtures/${name}.marble.json`, import.meta.url);
	const [isProjectOk, projectErr, project] = parseProject(readFileSync(url, 'utf8'));
	if (!isProjectOk) throw projectErr;
	const outcome = await replaceBroken(project, simulate(project), {
		simulate: async (next) => simulate(next),
		autoPlace: async (next, target, entity) => {
			const [isOk, error, placement] = autoPlace(next, simulate(next), target.laneId, target.hitId, { simulate, type: entity.components.piece?.type });
			if (!isOk) throw error;
			return placement.entity;
		},
		gapPiece: async (next, gap, type, id) => {
			const create = type === 'switchback' ? createSwitchbackForGap : type === 'chain' ? createChainForGap : type === 'rail' ? createRailForGap : createTunnelForGap;
			const [isOk, error, proposal] = create(next, simulate(next), gap.laneId, gap.fromHitId, gap.toHitId, { simulate, id });
			if (!isOk) throw error;
			return proposal.entity;
		},
		commit: (current, commands) => {
			const [isOk, error, next] = applyProjectCommands(current, commands);
			if (!isOk) throw error;
			return next;
		}
	});
	writeFileSync(url, serializeProject(outcome.project));
	console.log(`fixtures/${name}: ${outcome.replaced} platforms placed again, ${outcome.result.hits.filter((hit) => hit.status === 'onTime').length} of ${outcome.result.hits.length} hits on time`);
}
simulator.dispose();
