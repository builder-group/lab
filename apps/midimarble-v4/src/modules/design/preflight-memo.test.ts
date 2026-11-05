import { describe, expect, it } from 'vitest';
import { createProject } from '@/modules/project';
import type { TSimulationResult } from '@/modules/simulation';
import { NO_BLENDER_OBJECTS, preflightExport } from './export-preflight';

describe('preflightExport memo', () => {
	const project = createProject({ title: 'Song' });
	const run = (): TSimulationResult => ({ revision: project.revision, duration: project.end, marbles: [], pieces: [], contacts: [], hits: [], stats: { computeMs: 0, reusedUntil: 0, steps: 0 } });

	it('checks a run once for every caller', () => {
		const result = run();
		expect(preflightExport(project, result, NO_BLENDER_OBJECTS)).toBe(preflightExport(project, result, NO_BLENDER_OBJECTS));
	});

	it('knows the run under a copy stamped with the revision, as Fix asks', () => {
		const result = run();
		const objects: [] = [];
		const first = preflightExport(project, result, objects);
		expect(preflightExport(project, { ...result, revision: project.revision }, objects)).toBe(first);
	});

	it('checks again for a copy with the same hits but other pieces', () => {
		const result = run();
		const objects: [] = [];
		const first = preflightExport(project, result, objects);
		expect(preflightExport(project, { ...result, pieces: [] }, objects)).not.toBe(first);
	});

	it('checks again for another run, project or set of Blender objects', () => {
		const result = run();
		const first = preflightExport(project, result, []);
		expect(preflightExport(project, run(), [])).not.toBe(first);
		expect(preflightExport({ ...project }, result, [])).not.toBe(first);
		expect(preflightExport(project, result, [])).not.toBe(first);
	});
});
