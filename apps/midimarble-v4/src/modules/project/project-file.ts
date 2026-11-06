import { prepareSchemaValue } from 'versjon';
import { Err, Ok, type TResult } from 'tuple-result';
import { projectDefinition, type TProject } from './schema';

export function serializeProject(project: TProject): string {
	return `${JSON.stringify(project, null, '\t')}\n`;
}

/** What anyone opening a file from another version is told: the app hasn't shipped, so files aren't converted */
const OTHER_VERSION_WORDS = "This project was made with a different version of MidiMarble and can't be opened.";

/** Parses stored project JSON. A file of another version says so, and one of this version says what about it is wrong. */
export function parseProject(json: string): TResult<TProject, Error> {
	let value: unknown;
	try {
		value = JSON.parse(json);
	} catch (error) {
		return Err(new Error("This project's file is damaged and can't be opened. A copy from before its last opening may be in the package as project.json1.", { cause: error }));
	}
	const version = typeof value === 'object' && value != null ? (value as Record<string, unknown>)['$schema'] : null;
	if (version !== 'marble-project@6') return Err(new Error(OTHER_VERSION_WORDS));
	const [isProjectOk, projectErr, project] = prepareSchemaValue(projectDefinition, value);
	if (!isProjectOk) return Err(new Error(shapeWords(value), { cause: projectErr }));
	return Ok(project);
}

/** What's wrong with a file of this version, naming its first fields: "film.theme should be an object" */
function shapeWords(value: unknown): string {
	const parsed = projectDefinition.schema.safeParse(value);
	const wrong = parsed.success ? [] : parsed.error.issues.flatMap(issueWords);
	const named = wrong.slice(0, NAMED_FIELDS);
	const more = wrong.length - named.length;
	const list = [named.join(', '), more > 0 ? `${more} more` : ''].filter(Boolean).join(' and ');
	return `This project can't be opened: ${list || 'its file has the wrong shape'}. The file doesn't match this version of MidiMarble.`;
}

const NAMED_FIELDS = 2;

function issueWords(issue: { code: string; path: readonly PropertyKey[]; message: string; keys?: readonly string[]; expected?: string }): string[] {
	const path = issue.path.map(String).join('.');
	if (issue.code === 'unrecognized_keys') return (issue.keys ?? []).map((key) => `${path === '' ? key : `${path}.${key}`} is unknown`);
	if (issue.code === 'invalid_type' && issue.message.endsWith('undefined')) return [`${path} is missing`];
	if (issue.code === 'invalid_type' && issue.expected != null) return [`${path} should be ${/^[aeiou]/.test(issue.expected) ? 'an' : 'a'} ${issue.expected}`];
	return [`${path} isn't valid`];
}
