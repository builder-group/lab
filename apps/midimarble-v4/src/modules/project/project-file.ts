import { prepareSchemaValue } from 'versjon';
import { Err, Ok, type TResult } from 'tuple-result';
import { projectDefinition, type TProject } from './schema';

export function serializeProject(project: TProject): string {
	return `${JSON.stringify(project, null, '\t')}\n`;
}

/** A file from before label colours kept a marble's film colour on the marble; it is its skin's now, so the film stays the same */
function moveMarbleColorsToSkins(value: unknown): void {
	const entities = (value as { entities?: unknown }).entities;
	if (!Array.isArray(entities)) return;
	for (const entity of entities as { components?: { marble?: { color?: string }; skin?: { color?: string } } }[]) {
		const marble = entity.components?.marble;
		if (marble?.color == null || entity.components == null) continue;
		entity.components.skin = { ...entity.components.skin, color: marble.color };
		delete marble.color;
	}
}

/** Parses stored project JSON. A file from another version fails: the app hasn't shipped, so there are no other migrations. */
export function parseProject(json: string): TResult<TProject, Error> {
	let value: unknown;
	try {
		value = JSON.parse(json);
	} catch (error) {
		return Err(new Error(`The project file is not valid JSON: ${(error as Error).message}`));
	}
	const version = typeof value === 'object' && value != null ? (value as Record<string, unknown>)['$schema'] : null;
	if (version !== 'marble-project@5') {
		const saved = typeof version === 'string' ? `It was saved as ${version}; this app` : 'This app';
		return Err(new Error(`This project can't be opened. ${saved} reads marble-project@5 files only, and older projects are not converted.`));
	}
	moveMarbleColorsToSkins(value);
	const [isProjectOk, projectErr, project] = prepareSchemaValue(projectDefinition, value);
	if (!isProjectOk) return Err(projectErr);
	return Ok(project);
}
