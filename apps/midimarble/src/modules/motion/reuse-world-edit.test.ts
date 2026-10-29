import { describe, expect, it } from 'vitest';
import { createDemoProject } from '../project/fixtures/sample-project';
import type { TPerformance } from '../project/types';
import { compilePerformance } from './compile-performance';
import { canReuseWorldEdit } from './reuse-world-edit';

describe('canReuseWorldEdit function', () => {
	it('should reuse distant world edits but rebuild when either old or new geometry enters a sweep', async () => {
		const project = createDemoProject();
		project.duration = 1;
		project.objects = [];
		project.notes = [];
		const performance = await compilePerformance(project);
		const changed = structuredClone(project);
		const model = createDemoProject().objects[0];
		if (model == null) throw new Error('Expected an instrument.');
		changed.objects.push({ ...model, binding: null, position: [100, 100, 100] });
		const previous = { project, performance };
		expect(canReuseWorldEdit(changed, previous)).toBe(true);
		const object = changed.objects[0];
		if (object == null) throw new Error('Expected a world object.');
		object.position = [...project.launch.position];
		expect(canReuseWorldEdit(changed, previous)).toBe(false);
		const intersecting = structuredClone(changed);
		object.position = [100, 100, 100];
		expect(canReuseWorldEdit(changed, { project: intersecting, performance })).toBe(false);
	});

	it('should include long rail paths even when their object origin is distant', async () => {
		const project = createDemoProject();
		project.duration = 1;
		project.objects = [];
		project.notes = [];
		const performance = await compilePerformance(project);
		const model = createDemoProject().objects[0];
		if (model == null) throw new Error('Expected an instrument.');
		const changed = structuredClone(project);
		changed.objects = [
			{
				...model,
				binding: null,
				kind: 'rail',
				position: [100, 0, 0],
				path: [
					[0, 0, 0],
					[-100, 0, 0]
				]
			}
		];
		expect(canReuseWorldEdit(changed, { project, performance })).toBe(false);
	});

	it('should require complete sweep evidence and unchanged launch, linked placements and duration', async () => {
		const project = createDemoProject();
		project.duration = 1;
		const performance = await compilePerformance(project);
		const legacy: TPerformance = { ...performance, influenceBounds: undefined };
		expect(canReuseWorldEdit(project, { project, performance: legacy })).toBe(false);
		for (const changed of [
			{ ...project, gravity: project.gravity + 1 },
			{ ...project, duration: 2 },
			{ ...project, launch: { ...project.launch, velocity: [1, 2, 3] as [number, number, number] } }
		])
			expect(canReuseWorldEdit(changed, { project, performance })).toBe(false);
		const linked = structuredClone(project);
		const linkedObject = linked.objects[0];
		if (linkedObject == null) throw new Error('Expected a linked object.');
		linkedObject.rotation[0] += 0.1;
		expect(canReuseWorldEdit(linked, { project, performance })).toBe(false);
	});

	it('should cover the additional marble and every sampled center with its collision radius', async () => {
		const project = createDemoProject();
		project.duration = 1;
		project.objects = [];
		project.notes = [];
		project.marbles = [
			{ id: 'second', launch: { ...project.launch, position: [20, 30, 40] }, color: '#ffffff' }
		];
		const performance = await compilePerformance(project);
		const bounds = performance.influenceBounds;
		if (bounds == null) throw new Error('Expected swept influence bounds.');
		for (const sample of [
			...performance.samples,
			...(performance.additionalMarbles ?? []).flatMap((marble) => marble.samples)
		]) {
			for (let axis = 0; axis < 3; axis++) {
				expect(bounds.min[axis]).toBeLessThanOrEqual(
					(sample.position[axis] ?? 0) - project.launch.radius
				);
				expect(bounds.max[axis]).toBeGreaterThanOrEqual(
					(sample.position[axis] ?? 0) + project.launch.radius
				);
			}
		}
	});
});
