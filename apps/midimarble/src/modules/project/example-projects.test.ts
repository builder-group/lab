import { readFile } from 'node:fs/promises';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { compilePerformance } from '../motion/compile-performance';
import { getMotionSignature } from '../motion/motion-signature';
import { evaluateCamera, samplePosition } from '../scene/scene-camera';
import { composeMidiNotes } from './compose-midi';
import { createExampleProject, exampleProjects } from './example-projects';
import { parseProjectFile, serializeProjectFile } from './project-file';

describe('createExampleProject function', () => {
	it('should keep both Counterpoint marbles in the shared frame throughout the film', async () => {
		const project = createExampleProject('counterpoint');
		const performance = await compilePerformance(project);
		const bodies = [performance, ...(performance.additionalMarbles ?? [])];
		expect(bodies).toHaveLength(2);
		for (let time = 0; time <= project.duration; time += 0.1) {
			const pose = evaluateCamera(project, performance, time, 1);
			const camera = new THREE.PerspectiveCamera(pose.fov, 1, 0.05, 1500);
			camera.position.fromArray(pose.position);
			camera.lookAt(new THREE.Vector3(...pose.target));
			camera.updateMatrixWorld();
			for (const body of bodies) {
				const position = new THREE.Vector3();
				samplePosition(body, time, project.launch.position, position);
				position.project(camera);
				expect(Math.abs(position.x)).toBeLessThan(0.9);
				expect(Math.abs(position.y)).toBeLessThan(0.9);
				expect(position.z).toBeGreaterThan(-1);
				expect(position.z).toBeLessThan(1);
			}
		}
	});

	it.each(exampleProjects)(
		'should reproduce every $title note with a real, timely collision',
		async (example) => {
			const project = createExampleProject(example.id);
			const performance = await compilePerformance(project);
			expect(performance.warnings).toEqual([]);
			expect(performance.noteMarkers).toHaveLength(project.notes.length);
			for (const marker of performance.noteMarkers) {
				expect(marker.objectId).not.toBeNull();
				expect(marker.error).not.toBeNull();
				expect(Math.abs(marker.error ?? Infinity)).toBeLessThanOrEqual(1 / 60);
			}
			expect(performance.impacts.filter((impact) => impact.noteId != null)).toHaveLength(
				project.notes.length
			);
		}
	);

	it.each(exampleProjects)('should keep $title finite and close to the wall', async (example) => {
		const project = createExampleProject(example.id);
		const performance = await compilePerformance(project);
		const samples = [
			...performance.samples,
			...(performance.additionalMarbles ?? []).flatMap((marble) => marble.samples)
		];
		for (const sample of samples) {
			expect(sample.position.every(Number.isFinite)).toBe(true);
			expect(Math.abs(sample.position[2] - 0.65)).toBeLessThan(0.025);
			expect(Math.abs(sample.position[0])).toBeLessThan(15);
			expect(sample.position[1]).toBeGreaterThan(-40);
		}
		for (const object of performance.objects) {
			expect(object.position[2] - object.size[2] / 2).toBeGreaterThan(0.02);
			expect(object.rotation.slice(0, 2)).toEqual([0, 0]);
			expect(object.disabled).not.toBe(true);
		}
		expect(project.scene?.wallPosition).toBe(0);
	});

	it.each(exampleProjects)(
		'should ship $title as an editable native project with matching physics',
		async (example) => {
			const source = await readFile(
				new URL(`../../../public${example.file}`, import.meta.url),
				'utf8'
			);
			const saved = parseProjectFile(source);
			const created = createExampleProject(example.id);
			const performance = await compilePerformance(created);
			const resolved = new Map(performance.objects.map((object) => [object.id, object]));
			created.objects = created.objects.map((object) => resolved.get(object.id) ?? object);
			expect(getMotionSignature(saved)).toBe(getMotionSignature(created));
			expect(parseProjectFile(serializeProjectFile(saved))).toEqual(saved);
			expect(
				saved.objects.every(
					(object) => object.locked !== true && (object.binding != null || object.kind === 'rail')
				)
			).toBe(true);
			expect(saved.objects.some((object) => object.position[1] !== 0)).toBe(true);
		}
	);

	it('should physically support the marble on an editable world rail between musical phrases', async () => {
		const project = createExampleProject('rolling-rhythm');
		const rail = project.objects.find((object) => object.kind === 'rail');
		expect(rail?.binding).toBeNull();
		expect(rail?.trajectoryAnchor).toBeUndefined();
		expect(rail?.path?.length).toBeGreaterThan(2);
		const performance = await compilePerformance(project);
		const support =
			performance.surfaceContacts?.filter((contact) => contact.objectId === rail?.id) ?? [];
		expect(support.some((contact) => contact.end - contact.start >= 0.6 && contact.speed > 1)).toBe(
			true
		);
		expect(support.every((contact) => contact.start > 1.65 && contact.end < 4)).toBe(true);
		expect(
			performance.impacts
				.filter((impact) => impact.objectId === rail?.id)
				.every((impact) => impact.noteId == null)
		).toBe(true);
		expect(project.notes).toHaveLength(7);
		expect(project.tracks.map((track) => track.name)).toEqual(['Soft mallets']);
	});

	it('should compose an independent editable copy of the supplied score', () => {
		const source = createExampleProject('first-light');
		const copy = composeMidiNotes(source, { angle: 0.8 });
		const note = copy.notes[0];
		if (note == null) throw new Error('The example needs a first note.');
		note.midi = 60;
		expect(source.notes[0]?.midi).toBe(72);
		expect(copy.objects[0]?.rotation[2]).toBe(0.8);
		expect(source.objects[0]?.rotation[2]).toBe(0.64);
	});

	it('should reject an unknown example instead of opening a different project', () => {
		expect(() => createExampleProject('missing')).toThrow('Unknown example project');
	});
});
