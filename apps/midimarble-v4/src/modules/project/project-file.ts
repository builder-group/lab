import { prepareSchemaValue } from 'versjon';
import { Err, Ok, type TResult } from 'tuple-result';
import { projectDefinition, type TProject } from './schema';

export function serializeProject(project: TProject): string {
	return `${JSON.stringify(project, null, '\t')}\n`;
}

/** What anyone opening a file from another version is told: the app hasn't shipped, so files aren't converted */
const OTHER_VERSION_WORDS = "This project was made with a different version of MidiMarble and can't be opened.";

/** Parses stored project JSON. A file of another version or another shape fails in the same plain words. */
export function parseProject(json: string): TResult<TProject, Error> {
	let value: unknown;
	try {
		value = JSON.parse(json);
	} catch (error) {
		return Err(new Error(`The project file is not valid JSON: ${(error as Error).message}`));
	}
	const version = typeof value === 'object' && value != null ? (value as Record<string, unknown>)['$schema'] : null;
	if (version !== 'marble-project@6') return Err(new Error(OTHER_VERSION_WORDS));
	const [isProjectOk, projectErr, project] = prepareSchemaValue(projectDefinition, value);
	if (!isProjectOk) return Err(new Error(OTHER_VERSION_WORDS, { cause: projectErr }));
	return Ok(project);
}
