import { prepareSchemaValue } from 'versjon';
import { Err, Ok, type TResult } from 'tuple-result';
import { projectDefinition, type TProject } from './schema';

export function serializeProject(project: TProject): string {
	return `${JSON.stringify(project, null, '\t')}\n`;
}

/** Parses stored project JSON, migrating older versions to the current schema */
export function parseProject(json: string): TResult<TProject, Error> {
	let value: unknown;
	try {
		value = JSON.parse(json);
	} catch (error) {
		return Err(new Error(`The project file is not valid JSON: ${(error as Error).message}`));
	}
	const [isProjectOk, projectErr, project] = prepareSchemaValue(projectDefinition, value);
	if (!isProjectOk) return Err(projectErr);
	return Ok(project as TProject);
}
