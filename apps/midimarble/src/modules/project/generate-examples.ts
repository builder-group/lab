import { writeFile } from 'node:fs/promises';
import { compilePerformance } from '../motion/compile-performance';
import { createExampleProject, exampleProjects } from './example-projects';
import { serializeProjectFile } from './project-file';

for (const example of exampleProjects) {
	const project = createExampleProject(example.id);
	const performance = await compilePerformance(project);
	const invalid = performance.noteMarkers.filter(
		(marker) => marker.error == null || Math.abs(marker.error) > 1 / 60
	);
	if (performance.warnings.length > 0 || invalid.length > 0) {
		throw new Error(
			`${example.title}: ${invalid.length} unaligned notes. ${performance.warnings.join(' ')}`
		);
	}
	const resolved = new Map(performance.objects.map((object) => [object.id, object]));
	project.objects = project.objects.map((object) => resolved.get(object.id) ?? object);
	await writeFile(
		new URL(`../../../public${example.file}`, import.meta.url),
		serializeProjectFile(project)
	);
	console.info(`${example.title}: ${project.notes.length} verified contacts, ${project.duration}s`);
}
