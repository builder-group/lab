import { describe, expect, it } from 'vitest';
import {
	createDemoProject,
	createObjectForNote,
	createWorldObject
} from '../project/fixtures/sample-project';
import type { TProject, TSceneObject } from '../project/types';
import { compilePerformance, samplePerformance, type TMotionProgress } from './index';

describe('compilePerformance function', () => {
	it('should play the full demonstration with one accurately timed physical contact per note', async () => {
		const project = createDemoProject();
		const performance = await compilePerformance(project);
		expect(performance.impacts).toHaveLength(project.notes.length);
		expect(
			performance.noteMarkers.every(
				(marker) => marker.error != null && Math.abs(marker.error) < 1 / 60
			)
		).toBe(true);
		expect(performance.warnings).toEqual([]);
	});

	it('should preserve configured bumper tilt and play a chain of linked sphere contacts', async () => {
		const project = createDemoProject();
		project.notes = project.notes.slice(0, 6);
		project.duration = 5.5;
		project.objects = project.notes.map((note, index) =>
			createObjectForNote(project, note.id, 'bumper', index)
		);
		const performance = await compilePerformance(project);
		expect(performance.impacts).toHaveLength(project.notes.length);
		expect(
			performance.noteMarkers.every(
				(marker) => marker.error != null && Math.abs(marker.error) < 1 / 60
			)
		).toBe(true);
		expect(performance.warnings).toEqual([]);
		expect(project.objects.every((object) => object.size.every((size) => size === 0.65))).toBe(
			true
		);
		expect(createWorldObject('bumper', [0, 0, 0]).size).toEqual([0.65, 0.65, 0.65]);
	});

	it('should reject non-finite physical inputs before constructing a physics world', async () => {
		const project = createProject();
		project.launch.velocity = [Number.NaN, 0, 0];
		await expect(compilePerformance(project)).rejects.toThrow('finite values');
	});

	it.each([Number.NaN, Infinity, -0.1, 2.1])(
		'should reject invalid surface friction %s before constructing a physics world',
		async (friction) => {
			const project = createProject();
			const object = project.objects[0];
			if (object == null) throw new Error('Expected a test bar.');
			object.friction = friction;
			await expect(compilePerformance(project)).rejects.toThrow('Surface friction');
		}
	);

	it('should change real wire motion with surface friction while preserving its omitted default', async () => {
		const project = createProject();
		project.duration = 1.5;
		project.notes = [];
		project.launch = { position: [0.2, 0.3, 0], velocity: [1.5, 0, 0], radius: 0.24 };
		const wire: TSceneObject = {
			...createBar('wire', null),
			kind: 'rail',
			size: [4, 0.045, 0.34],
			restitution: 0,
			path: [
				[0, 0, 0],
				[4, -0.4, 0]
			]
		};
		project.objects = [wire];
		const implicit = await compilePerformance(project);
		wire.friction = 0.5;
		const explicit = await compilePerformance(project);
		expect(explicit.samples).toEqual(implicit.samples);
		expect(explicit.surfaceContacts).toEqual(implicit.surfaceContacts);
		const previous = { project: structuredClone(project), performance: explicit };
		wire.friction = 0.12;
		const changed = await compilePerformance(project, { previous });
		expect(changed).toEqual(await compilePerformance(project));
		expect(changed.samples).not.toEqual(explicit.samples);
		for (const performance of [explicit, changed])
			expect(
				performance.surfaceContacts?.some((contact) => contact.end - contact.start > 0.2)
			).toBe(true);
		const changedPosition = samplePerformance(changed, 0.8).position[0];
		const defaultPosition = samplePerformance(explicit, 0.8).position[0];
		expect(Math.abs(changedPosition - defaultPosition)).toBeGreaterThan(0.05);
	});

	it('should replace downstream placements after changing a world surface friction', async () => {
		const project = createProject();
		project.launch.velocity = [3, 0, 0];
		project.objects.push({
			...createBar('world-surface', null),
			position: [1, 3.5, 0],
			size: [5, 0.16, 1],
			friction: 0.12
		});
		const before = await compilePerformance(project);
		const changed = structuredClone(project);
		const surface = changed.objects.find((object) => object.id === 'world-surface');
		if (surface == null) throw new Error('Expected a world surface.');
		surface.friction = 0.9;
		const warm = await compilePerformance(changed, { previous: { project, performance: before } });
		expect(warm).toEqual(await compilePerformance(changed));
		expect(warm.objects.find((object) => object.id === 'bar-1')?.position).not.toEqual(
			before.objects.find((object) => object.id === 'bar-1')?.position
		);
	});

	it('should replace downstream placements when a world key gains a physical front lip', async () => {
		const project = createProject();
		project.launch.position[0] = 0.75;
		project.objects.push({
			...createBar('world-key', null),
			position: [0, 3.5, 0],
			size: [1.5, 0.045, 0.35]
		});
		const before = await compilePerformance(project);
		const changed = structuredClone(project);
		const surface = changed.objects.find((object) => object.id === 'world-key');
		if (surface == null) throw new Error('Expected a world key.');
		surface.mountStyle = 'folded-front';
		const updates: TMotionProgress[] = [];
		const warm = await compilePerformance(changed, {
			previous: { project, performance: before },
			onProgress: (progress) => updates.push(progress)
		});
		expect(updates[0]?.reused).toBe(0);
		expect(warm).toEqual(await compilePerformance(changed));
		expect(warm.objects.find((object) => object.id === 'bar-1')?.position).not.toEqual(
			before.objects.find((object) => object.id === 'bar-1')?.position
		);
	});

	it.each(['x', 'z'] as const)(
		'should collide with the physical front lip on a long-%s key above its flat face',
		async (axis) => {
			const project = createProject();
			project.duration = 0.3;
			project.gravity = 0.1;
			project.notes = [];
			project.launch = {
				position: axis === 'x' ? [1.2, 0.12, 0] : [0, 0.12, 1.2],
				velocity: axis === 'x' ? [-3, 0, 0] : [0, 0, -3],
				radius: 0.05
			};
			const bar: TSceneObject = {
				...createBar('front-lip', null),
				size: axis === 'x' ? [1.5, 0.045, 0.35] : [0.35, 0.045, 1.5]
			};
			project.objects = [bar];
			const plain = await compilePerformance(project);
			bar.mountStyle = 'folded';
			expect((await compilePerformance(project)).samples).toEqual(plain.samples);
			const previous = { project: structuredClone(project), performance: plain };
			bar.mountStyle = 'folded-front';
			const front = await compilePerformance(project, { previous });
			expect(front).toEqual(await compilePerformance(project));
			expect(plain.impacts).toEqual([]);
			expect(front.impacts).toHaveLength(1);
			expect(front.impacts[0]?.objectId).toBe(bar.id);
			const direction = axis === 'x' ? 0 : 2;
			expect(samplePerformance(front, 0.3).position[direction]).toBeGreaterThan(0.85);
			expect(samplePerformance(plain, 0.3).position[direction]).toBeLessThan(0.4);
		}
	);

	it('should preserve the full supported project duration through 120 seconds', async () => {
		const project = createProject();
		project.duration = 120;
		project.objects = [];
		const performance = await compilePerformance(project);
		expect(performance.duration).toBe(120);
		expect(samplePerformance(performance, 119.5).time).toBe(119.5);
		expect(samplePerformance(performance, 120).time).toBe(120);
	});

	it('should reject an unsupported duration rather than silently truncate export motion', async () => {
		const project = createProject();
		project.duration = 121;
		await expect(compilePerformance(project)).rejects.toThrow('between 0.1 and 120 seconds');
	});

	it('should identify simultaneous linked placements that a single marble cannot reliably play', async () => {
		const project = createProject();
		project.notes.push({
			id: 'chord-note',
			trackId: 'track',
			time: 0.7,
			duration: 0.3,
			midi: 64,
			velocity: 0.8
		});
		project.objects.push(createBar('chord-bar', 'chord-note'));
		const performance = await compilePerformance(project);
		expect(
			performance.warnings.some((warning) => warning.includes('share a physical instant'))
		).toBe(true);
	});

	it('should preserve a resolved instrument placement after unlinking when earlier motion changes', async () => {
		const project = createProject();
		const before = await compilePerformance(project);
		const placed = before.objects[0];
		if (placed == null) throw new Error('Expected a resolved instrument.');
		project.objects = [{ ...placed, binding: null }];
		project.launch.velocity = [3, 0, 0];
		const after = await compilePerformance(project);
		expect(after.objects[0]?.position).toEqual(placed.position);
		expect(after.objects[0]?.binding).toBeNull();
	});

	it('should place a linked bar at its note and record a real collision', async () => {
		const project = createProject();
		const performance = await compilePerformance(project);
		const impact = performance.impacts.find((candidate) => candidate.objectId === 'bar-1');
		expect(impact).toBeDefined();
		expect(Math.abs((impact?.time ?? 0) - 0.7)).toBeLessThan(1 / 30);
		expect(performance.objects[0]?.position[1]).toBeLessThan(project.launch.position[1]);
	});

	it('should refit downstream linked objects while preserving world objects', async () => {
		const project = createProject();
		project.objects.push(createBar('bar-2', 'note-2'));
		project.notes.push({
			id: 'note-2',
			trackId: 'track',
			time: 1.5,
			duration: 0.3,
			midi: 64,
			velocity: 0.8
		});
		const loose = createBar('loose', null);
		loose.position = [10, 1, 0];
		project.objects.push(loose);
		const before = await compilePerformance(project);
		project.objects = project.objects.map((object) =>
			object.id === 'bar-1' ? { ...object, rotation: [0, 0, 0.4] } : object
		);
		const after = await compilePerformance(project);
		expect(after.objects.find((object) => object.id === 'bar-2')?.position).not.toEqual(
			before.objects.find((object) => object.id === 'bar-2')?.position
		);
		expect(after.objects.find((object) => object.id === 'loose')?.position).toEqual([10, 1, 0]);
	});

	it('should change the physical trajectory when a loose object intersects the path', async () => {
		const project = createProject();
		project.objects = [];
		const before = await compilePerformance(project);
		const loose = createBar('loose', null);
		loose.position = [0, 3, 0];
		project.objects.push(loose);
		const after = await compilePerformance(project);
		expect(after.impacts.some((impact) => impact.objectId === 'loose')).toBe(true);
		expect(samplePerformance(after, 1).position[1]).toBeGreaterThan(
			samplePerformance(before, 1).position[1]
		);
	});

	it('should preserve project inputs and produce repeatable results', async () => {
		const project = createProject();
		const input = structuredClone(project);
		const first = await compilePerformance(project);
		const second = await compilePerformance(project);
		expect(project).toEqual(input);
		expect(first.samples).toEqual(second.samples);
		expect(first.impacts).toEqual(second.impacts);
	});

	it('should report a linked object moved away from its target as a missed hit', async () => {
		const project = createProject();
		project.objects = project.objects.map((object) => ({
			...object,
			binding: { noteId: 'note-1', offset: [8, 0, 0] }
		}));
		const performance = await compilePerformance(project);
		expect(performance.noteMarkers[0]?.error).toBeNull();
		expect(performance.warnings.some((warning) => warning.includes('missed'))).toBe(true);
	});

	it('should preserve disabled objects for editing without including their physical contacts', async () => {
		const project = createProject();
		const bar = project.objects[0];
		if (bar == null) throw new Error('Expected a test bar.');
		bar.disabled = true;
		const disabled = await compilePerformance(project);
		project.objects = [];
		const empty = await compilePerformance(project);
		expect(disabled.samples).toEqual(empty.samples);
		expect(disabled.objects).toHaveLength(1);
		expect(disabled.impacts).toEqual([]);
		expect(disabled.warnings).toEqual([]);
	});

	it('should roll along paired curved wires with physical spin and reproducible seeking', async () => {
		const project = createProject();
		project.duration = 1.5;
		project.notes = [];
		project.launch = { position: [0.2, 0.3, 0], velocity: [1.5, 0, 0], radius: 0.24 };
		project.objects = [
			{
				...createBar('wire-rail', null),
				kind: 'rail',
				position: [0, 0, 0],
				size: [4, 0.045, 0.34],
				restitution: 0,
				path: Array.from({ length: 33 }, (_, index) => {
					const x = index / 8;
					return [x, -0.12 * x + 0.02 * x * x, 0];
				})
			}
		];
		const performance = await compilePerformance(project);
		const middle = samplePerformance(performance, 0.8);
		expect(performance.impacts.some((impact) => impact.objectId === 'wire-rail')).toBe(true);
		expect(
			performance.surfaceContacts?.some(
				(contact) =>
					contact.objectId === 'wire-rail' && contact.end - contact.start > 0.2 && contact.speed > 0
			)
		).toBe(true);
		expect(middle.position[0]).toBeGreaterThan(1);
		expect(middle.position[1]).toBeGreaterThan(-0.2);
		expect(Math.abs(middle.position[2])).toBeLessThan(0.08);
		expect(Math.abs(middle.rotation[3])).toBeLessThan(0.98);
		samplePerformance(performance, 0.1);
		expect(samplePerformance(performance, 0.8)).toEqual(middle);
	});

	it('should collide additional marbles with the main marble in one shared physical world', async () => {
		const project = createProject();
		project.duration = 1;
		project.objects = [];
		project.notes = [];
		project.launch = { position: [-1, 5, 0], velocity: [2, 0, 0], radius: 0.24 };
		project.marbles = [
			{
				id: 'harmony',
				color: '#ffdd55',
				launch: { position: [1, 5, 0], velocity: [-2, 0, 0], radius: 0.24 }
			}
		];
		const performance = await compilePerformance(project);
		const harmony = performance.additionalMarbles?.[0];
		if (harmony == null) throw new Error('Expected a second marble trajectory.');
		expect(samplePerformance(performance, 0.8).position[0]).toBeLessThan(-0.4);
		expect(
			samplePerformance({ ...performance, samples: harmony.samples }, 0.8).position[0]
		).toBeGreaterThan(0.4);
		expect(harmony.samples).toHaveLength(performance.samples.length);
	});

	it('should activate a scheduled marble only at its launch time and sample its delayed trajectory', async () => {
		const project = createProject();
		project.notes = [];
		project.objects = [];
		project.marbles = [
			{
				id: 'later',
				color: '#ffdd55',
				startTime: 1,
				launch: { position: [4, 5, 0], velocity: [1, 0, 0], radius: 0.24 }
			}
		];
		const performance = await compilePerformance(project);
		const samples = performance.additionalMarbles?.[0]?.samples;
		if (samples == null) throw new Error('Expected a delayed trajectory.');
		expect(samples[0]).toMatchObject({ time: 1, position: [4, 5, 0] });
		expect(samplePerformance({ ...performance, samples }, 1.1).position[0]).toBeCloseTo(4.1, 4);
		expect(samplePerformance({ ...performance, samples }, 0.5).time).toBe(1);
	});

	it('should solve a linked note against its assigned marble and record that physical voice', async () => {
		const project = createProject();
		project.marbles = [
			{
				id: 'harmony',
				color: '#ffdd55',
				launch: { position: [4, 5, 0], velocity: [1, 0, 0], radius: 0.24 }
			}
		];
		const key = project.objects[0];
		if (key == null) throw new Error('Expected a linked key.');
		key.marbleId = 'harmony';
		const performance = await compilePerformance(project);
		expect(performance.objects[0]?.position[0]).toBeCloseTo(4.7, 3);
		expect(performance.impacts[0]).toMatchObject({ marbleId: 'harmony', noteId: 'note-1' });
		expect(performance.noteMarkers[0]?.position[0]).toBeCloseTo(4.7, 2);
		expect(Math.abs(performance.noteMarkers[0]?.error ?? 10)).toBeLessThan(1 / 60);
	});

	it('should place a transition rail at a trajectory time without assigning a MIDI note', async () => {
		const project = createProject();
		project.notes = [];
		project.objects = [
			{
				...createBar('transition', null),
				kind: 'rail',
				trajectoryAnchor: { time: 0.7, offset: [0, 0, 0] }
			}
		];
		const performance = await compilePerformance(project);
		expect(performance.objects[0]?.position[1]).toBeLessThan(4);
		expect(performance.impacts.some((impact) => impact.objectId === 'transition')).toBe(true);
		expect(performance.impacts.every((impact) => impact.noteId == null)).toBe(true);
		expect(performance.noteMarkers).toEqual([]);
	});

	it.each(['rotation', 'friction', 'mountStyle'] as const)(
		'should reuse only the unchanged placement prefix after a later %s edit',
		async (property) => {
			const project = createDemoProject();
			const original = project.objects[4];
			if (original == null) throw new Error('Expected five linked objects.');
			original.kind = 'bar';
			const before = await compilePerformance(project);
			const changed = structuredClone(project);
			const edited = changed.objects[4];
			if (edited == null) throw new Error('Expected five linked objects.');
			if (property === 'rotation') edited.rotation[2] += 0.2;
			else if (property === 'friction') edited.friction = 0.8;
			else edited.mountStyle = 'folded-front';
			const updates: TMotionProgress[] = [];
			const warm = await compilePerformance(changed, {
				previous: { project, performance: before },
				onProgress: (progress) => updates.push(progress)
			});
			const cold = await compilePerformance(changed);
			expect(updates[0]?.reused).toBe(4);
			// A warm build retains conservative sweep evidence from the earlier placement prediction.
			const { influenceBounds: _warmBounds, ...warmBake } = warm;
			const { influenceBounds: _coldBounds, ...coldBake } = cold;
			expect(warmBake).toEqual(coldBake);
			expect(warm.objects.slice(0, 4).map((object) => object.position)).toEqual(
				before.objects.slice(0, 4).map((object) => object.position)
			);
		}
	);

	it('should restart placement after a world obstacle edit that can change earlier motion', async () => {
		const project = createProject();
		const before = await compilePerformance(project);
		const changed = structuredClone(project);
		changed.objects.push({ ...createBar('obstacle', null), position: [0, 4, 0] });
		const updates: TMotionProgress[] = [];
		const warm = await compilePerformance(changed, {
			previous: { project, performance: before },
			onProgress: (progress) => updates.push(progress)
		});
		const cold = await compilePerformance(changed);
		expect(updates[0]?.reused).toBe(0);
		// A warm build retains conservative sweep evidence from the earlier placement prediction.
		const { influenceBounds: _warmBounds, ...warmBake } = warm;
		const { influenceBounds: _coldBounds, ...coldBake } = cold;
		expect(warmBake).toEqual(coldBake);
		expect(warm.objects.find((object) => object.id === 'bar-1')?.position).not.toEqual(
			before.objects[0]?.position
		);
	});

	it('should verify earlier interference from an oversized late surface instead of retaining stale samples', async () => {
		const project = createDemoProject();
		const before = await compilePerformance(project);
		const changed = structuredClone(project);
		const late = changed.objects[4];
		if (late?.binding == null) throw new Error('Expected a linked object.');
		late.size = [20, 8, 20];
		late.binding.offset[1] = 10;
		const warm = await compilePerformance(changed, { previous: { project, performance: before } });
		const cold = await compilePerformance(changed);
		// A warm build retains conservative sweep evidence from the earlier placement prediction.
		const { influenceBounds: _warmBounds, ...warmBake } = warm;
		const { influenceBounds: _coldBounds, ...coldBake } = cold;
		expect(warmBake).toEqual(coldBake);
		expect(warm.samples).not.toEqual(before.samples);
		expect(warm.warnings.length).toBeGreaterThan(0);
	});

	it('should publish immutable solved objects and only physically simulated sample prefixes', async () => {
		const updates: TMotionProgress[] = [];
		const performance = await compilePerformance(createProject(), {
			onProgress: (progress) => updates.push(progress)
		});
		const placing = updates.find(
			(update) => update.phase === 'placement' && update.completed === 0
		);
		const partial = updates.find((update) => update.phase === 'simulation');
		expect(placing?.performance?.objects).toEqual([]);
		expect(placing?.performance?.samples).toEqual([]);
		expect(partial?.simulatedUntil).toBe(1);
		expect(partial?.performance?.samples).toEqual(
			performance.samples.filter((sample) => sample.time <= 1)
		);
		expect(partial?.performance?.noteMarkers).toEqual(
			performance.noteMarkers.filter((marker) => marker.time <= 1)
		);
	});

	it('should stop a cancelled foreground build before the next placement or simulation update', async () => {
		const controller = new AbortController();
		const updates: TMotionProgress[] = [];
		await expect(
			compilePerformance(createDemoProject(), {
				signal: controller.signal,
				onProgress(progress) {
					updates.push(progress);
					if (progress.completed === 2) controller.abort();
				}
			})
		).rejects.toMatchObject({ name: 'AbortError' });
		expect(updates.at(-1)?.completed).toBe(2);
		expect(updates.every((update) => update.phase === 'placement')).toBe(true);
	});

	it('should let a small marble fall through the real opening between rail wires', async () => {
		const project = createProject();
		project.duration = 1;
		project.notes = [];
		project.launch = { position: [0, 0.4, 0], velocity: [0, 0, 0], radius: 0.05 };
		project.objects = [
			{
				...createBar('wire-rail', null),
				kind: 'rail',
				size: [4, 0.045, 0.34],
				path: [
					[-2, 0, 0],
					[2, 0, 0]
				]
			}
		];
		const performance = await compilePerformance(project);
		expect(performance.impacts).toEqual([]);
		expect(performance.surfaceContacts).toEqual([]);
		expect(samplePerformance(performance, 0.8).position[1]).toBeLessThan(-2);
	});
});

describe('samplePerformance function', () => {
	it('should seek backward and forward without changing the performance', async () => {
		const performance = await compilePerformance(createProject());
		const atOne = samplePerformance(performance, 1.1234);
		samplePerformance(performance, 0.2);
		samplePerformance(performance, 1.8);
		expect(samplePerformance(performance, 1.1234)).toEqual(atOne);
		expect(Math.hypot(...atOne.rotation)).toBeCloseTo(1);
		expect(samplePerformance(performance, -1).time).toBe(0);
		expect(samplePerformance(performance, 99).time).toBe(performance.duration);
	});
});

function createProject(): TProject {
	return {
		version: 1,
		id: 'test',
		name: 'Test phrase',
		bpm: 100,
		duration: 2,
		notes: [{ id: 'note-1', trackId: 'track', time: 0.7, duration: 0.3, midi: 60, velocity: 0.8 }],
		tracks: [{ id: 'track', name: 'Marimba', color: '#8ba49a', instrument: 12, muted: false }],
		objects: [createBar('bar-1', 'note-1')],
		launch: { position: [0, 5, 0], velocity: [0, 0, 0], radius: 0.24 },
		gravity: 9.81,
		restitution: 0.65,
		aspectRatio: '9:16',
		marbleColor: '#60b48c'
	};
}

function createBar(id: string, noteId: string | null): TSceneObject {
	return {
		id,
		name: id,
		kind: 'bar',
		binding: noteId == null ? null : { noteId, offset: [0, 0, 0] },
		position: [0, 0, 0],
		rotation: [0, 0, 0],
		size: [2.4, 0.16, 0.65],
		restitution: 0.65,
		material: 'wood'
	};
}
