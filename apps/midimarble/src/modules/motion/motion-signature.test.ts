import { describe, expect, it } from 'vitest';
import { createDemoProject } from '../project/fixtures/sample-project';
import type { TProject } from '../project/types';
import { getMotionSignature } from './motion-signature';

describe('getMotionSignature function', () => {
	it('should ignore appearance, musical sound, naming, and editor locks', () => {
		const project = createDemoProject();
		const edited = structuredClone(project);
		edited.id = 'another-document';
		edited.name = 'Another title';
		edited.bpm = 87;
		edited.aspectRatio = '16:9';
		edited.marbleColor = '#123456';
		edited.marbleEffect = 'flow';
		edited.marbleEffectSpeed = 0.4;
		edited.audio = { musicVolume: 0.4, surfaceVolume: 0.7, surfacesEnabled: true };
		for (const track of edited.tracks) {
			track.instrument = 7;
			track.muted = !track.muted;
		}
		for (const note of edited.notes) {
			note.midi += 1;
			note.duration += 0.1;
			note.velocity = 0.5;
		}
		for (const object of edited.objects) {
			object.name = 'Renamed';
			object.color = '#abcdef';
			object.material = 'glass';
			object.mountStyle = 'folded';
			object.roundedNose = true;
			object.glowMode = 'contact';
			object.locked = true;
			object.emission = 3;
			object.flex = 2;
		}
		expect(getMotionSignature(edited)).toBe(getMotionSignature(project));
	});

	it.each<[string, (project: TProject) => void]>([
		[
			'duration',
			(project) => {
				project.duration += 1;
			}
		],
		[
			'note timing',
			(project) => {
				const note = project.notes[0];
				if (note != null) note.time += 0.1;
			}
		],
		[
			'note identity',
			(project) => {
				const note = project.notes[0];
				if (note != null) note.id = 'replacement';
			}
		],
		[
			'launch velocity',
			(project) => {
				project.launch.velocity[0] += 1;
			}
		],
		[
			'launch radius',
			(project) => {
				project.launch.radius += 0.01;
			}
		],
		[
			'gravity',
			(project) => {
				project.gravity += 1;
			}
		],
		[
			'marble bounce',
			(project) => {
				project.restitution -= 0.1;
			}
		],
		[
			'object rotation',
			(project) => {
				const object = project.objects[0];
				if (object != null) object.rotation[1] += 0.1;
			}
		],
		[
			'object dimensions',
			(project) => {
				const object = project.objects[0];
				if (object != null) object.size[0] += 0.1;
			}
		],
		[
			'object position',
			(project) => {
				const object = project.objects[0];
				if (object != null) object.position[0] += 0.1;
			}
		],
		[
			'object bounce',
			(project) => {
				const object = project.objects[0];
				if (object != null) object.restitution -= 0.1;
			}
		],
		[
			'physical front lip',
			(project) => {
				const object = project.objects[0];
				if (object != null) object.mountStyle = 'folded-front';
			}
		],
		[
			'surface friction',
			(project) => {
				const object = project.objects[0];
				if (object != null) object.friction = 0.3;
			}
		],
		[
			'object enable state',
			(project) => {
				const object = project.objects[0];
				if (object != null) object.disabled = true;
			}
		],
		[
			'note link offset',
			(project) => {
				const object = project.objects[0];
				if (object?.binding != null) object.binding.offset[0] += 0.1;
			}
		],
		[
			'rail control points',
			(project) => {
				const object = project.objects[0];
				if (object != null)
					object.path = [
						[0, 0, 0],
						[1, 1, 0]
					];
			}
		]
	])('should change when %s changes', (_, edit) => {
		const project = createDemoProject();
		const edited = structuredClone(project);
		edit(edited);
		expect(getMotionSignature(edited)).not.toBe(getMotionSignature(project));
	});

	it('should treat an omitted enabled flag as explicitly enabled', () => {
		const project = createDemoProject();
		const edited = structuredClone(project);
		for (const object of edited.objects) object.disabled = false;
		expect(getMotionSignature(edited)).toBe(getMotionSignature(project));
	});

	it('should reuse physics when an unlinked musical note is added, retimed, or removed', () => {
		const project = createDemoProject();
		const signature = getMotionSignature(project);
		const firstNote = project.notes[0];
		if (firstNote == null) throw new Error('Expected a demo note');
		const note = { ...firstNote, id: 'music-only', time: 1.25 };
		project.notes.push(note);
		expect(getMotionSignature(project)).toBe(signature);
		note.time = 2.5;
		expect(getMotionSignature(project)).toBe(signature);
		project.notes = project.notes.filter((item) => item.id !== note.id);
		expect(getMotionSignature(project)).toBe(signature);
	});
});
