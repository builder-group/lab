import { prepareSchemaValue } from 'versjon';
import { migrateSkins } from './skin-ids';
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
	const [isProjectOk, projectErr, project] = prepareSchemaValue(projectDefinition, withoutRemovedFields(value));
	if (!isProjectOk) return Err(projectErr);
	return Ok(migrateSkins(project as TProject));
}

/**
 * What older files may still hold and the app no longer has, within the same schema version: Tinsel walls read as Plaster,
 * their Layout goes, and a theme no longer carries a Decor set. The schema is strict, so this runs before it.
 */
function withoutRemovedFields(value: unknown): unknown {
	if (!isRecord(value) || !isRecord(value['design'])) return value;
	const { wall, themes } = value['design'];
	const design: Record<string, unknown> = { ...value['design'] };
	if (isRecord(wall)) {
		const { band: _band, ...rest } = wall;
		design['wall'] = rest['kind'] === 'tinsel' ? { ...rest, kind: 'plaster' } : rest;
	}
	if (Array.isArray(themes)) {
		design['themes'] = themes.map((theme: unknown) => {
			if (!isRecord(theme)) return theme;
			const { decorSet: _decorSet, wallBand: _wallBand, ...rest } = theme;
			return rest['wallKind'] === 'tinsel' ? { ...rest, wallKind: 'plaster' } : rest;
		});
	}
	return { ...value, design };
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value != null && !Array.isArray(value);
}
