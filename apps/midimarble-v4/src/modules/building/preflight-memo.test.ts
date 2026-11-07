import { describe, expect, it } from 'vitest';
import { createProject } from '@/modules/project';
import type { TSimulationResult } from '@/modules/simulation';
import { checkRun, NO_BLENDER_OBJECTS } from './export-preflight';

describe('checkRun memo', () => {
	const project = createProject({ title: 'Song' });
	const run = (): TSimulationResult => ({ revision: project.revision, duration: project.length, marbles: [], pieces: [], contacts: [], hits: [], stats: { computeMs: 0, reusedUntil: 0, steps: 0 } });

	it('checks a run once for every caller', () => {
		const result = run();
		expect(checkRun(project, result, NO_BLENDER_OBJECTS)).toBe(checkRun(project, result, NO_BLENDER_OBJECTS));
	});

	it('checks again for another run, project or set of Blender objects', () => {
		const result = run();
		const first = checkRun(project, result, []);
		expect(checkRun(project, run(), [])).not.toBe(first);
		expect(checkRun({ ...project }, result, [])).not.toBe(first);
		expect(checkRun(project, result, [])).not.toBe(first);
	});
});
