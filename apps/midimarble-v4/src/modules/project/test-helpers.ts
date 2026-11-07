import { readFileSync } from 'node:fs';
import { applyProjectCommands, type TProjectCommand } from './commands';
import { parseProject } from './project-file';
import { type TProject } from './schema';

// Shared by the tests; not part of the module's barrel, as it reads the file system

export function loadFixture(name: string): TProject {
	const [isOk, err, project] = parseProject(readFileSync(new URL(`../../../fixtures/${name}.marble.json`, import.meta.url), 'utf8'));
	if (!isOk) throw err;
	return project;
}

export function apply(project: TProject, commands: TProjectCommand[]): TProject {
	const [isOk, err, next] = applyProjectCommands(project, commands);
	if (!isOk) throw err;
	return next;
}
