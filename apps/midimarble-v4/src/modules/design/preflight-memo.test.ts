import { describe, expect, it } from 'vitest';
import { createProject } from '@/modules/project';
import type { TSimulationResult } from '@/modules/simulation';
import { preflightExport } from './export-preflight';

describe('preflightExport memo', () => {
	const project = createProject({ title: 'Song' });
	const run = (): TSimulationResult => ({ revision: project.revision, duration: project.end, marbles: [], pieces: [], contacts: [], hits: [], stats: { computeMs: 0, reusedUntil: 0, steps: 0 } });

	it('checks a run once for every caller', () => {
		const result = run();
		expect(preflightExport(project, result)).toBe(preflightExport(project, result));
	});

	it('checks again for another run, project or set of Blender objects', () => {
		const result = run();
		const first = preflightExport(project, result, []);
		expect(preflightExport(project, run(), [])).not.toBe(first);
		expect(preflightExport({ ...project }, result, [])).not.toBe(first);
		expect(preflightExport(project, result, [])).not.toBe(first);
	});
});
