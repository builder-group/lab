import { Err, Ok, type TResult } from 'tuple-result';
import { SProject, type TComponentName, type TComponents, type TDesign, type TEntity, type THit, type TLane, type TProject, type TSource } from './schema';

export type TProjectCommand =
	| { type: 'setTitle'; title: string }
	| { type: 'setEnd'; end: number }
	| { type: 'setFrame'; width: number; height: number }
	| { type: 'upsertSource'; source: TSource }
	| { type: 'removeSource'; sourceId: string }
	| { type: 'upsertLane'; lane: Omit<TLane, 'hits'> & { hits?: THit[] } }
	| { type: 'removeLane'; laneId: string }
	| { type: 'upsertHits'; laneId: string; hits: THit[] }
	| { type: 'removeHits'; laneId: string; hitIds: string[] }
	| { type: 'upsertEntity'; entity: TEntity }
	| { type: 'removeEntities'; entityIds: string[] }
	| { type: 'setComponent'; entityId: string; component: TComponentPatch }
	| { type: 'removeComponent'; entityId: string; name: TComponentName }
	| { type: 'setDesign'; design: Partial<TDesign> };

export type TComponentPatch = {
	[GName in TComponentName]: { name: GName; value: NonNullable<TComponents[GName]> };
}[TComponentName];

/**
 * Applies a batch of commands as one edit. The result is validated and the revision increases once.
 * An invalid batch leaves the source project untouched.
 */
export function applyProjectCommands(
	project: TProject,
	commands: TProjectCommand[]
): TResult<TProject, Error> {
	let next = structuredClone(project);
	for (const command of commands) {
		const [isApplied, applyErr, applied] = applyCommand(next, command);
		if (!isApplied) return Err(applyErr);
		next = applied;
	}
	next.revision = project.revision + 1;
	const parsed = SProject.safeParse(next);
	if (!parsed.success) {
		return Err(new Error(`Invalid edit: ${parsed.error.issues[0]?.message ?? 'unknown issue'}`));
	}
	return Ok(next);
}

function applyCommand(project: TProject, command: TProjectCommand): TResult<TProject, Error> {
	switch (command.type) {
		case 'setTitle':
			project.title = command.title;
			return Ok(project);
		case 'setEnd':
			project.end = command.end;
			return Ok(project);
		case 'setFrame':
			project.frame = { width: command.width, height: command.height };
			return Ok(project);
		case 'upsertSource':
			project.music.sources = upsertById(project.music.sources, command.source);
			return Ok(project);
		case 'removeSource':
			project.music.sources = project.music.sources.filter((source) => source.id !== command.sourceId);
			return Ok(project);
		case 'upsertLane': {
			const existing = project.music.lanes.find((lane) => lane.id === command.lane.id);
			const lane: TLane = { ...command.lane, hits: sortHits(command.lane.hits ?? existing?.hits ?? []) };
			project.music.lanes = upsertById(project.music.lanes, lane);
			return Ok(project);
		}
		case 'removeLane': {
			project.music.lanes = project.music.lanes.filter((lane) => lane.id !== command.laneId);
			// A lane owns its marble; pieces linked to its hits stay and surface as orphans
			project.entities = project.entities.filter(
				(entity) => entity.components.marble?.laneId !== command.laneId
			);
			return Ok(project);
		}
		case 'upsertHits': {
			const lane = project.music.lanes.find((item) => item.id === command.laneId);
			if (lane == null) return Err(new Error(`Lane ${command.laneId} does not exist`));
			let hits = lane.hits;
			for (const hit of command.hits) hits = upsertById(hits, hit);
			lane.hits = sortHits(hits);
			return Ok(project);
		}
		case 'removeHits': {
			const lane = project.music.lanes.find((item) => item.id === command.laneId);
			if (lane == null) return Err(new Error(`Lane ${command.laneId} does not exist`));
			const removed = new Set(command.hitIds);
			lane.hits = lane.hits.filter((hit) => !removed.has(hit.id));
			return Ok(project);
		}
		case 'upsertEntity':
			project.entities = upsertById(project.entities, command.entity);
			return Ok(project);
		case 'removeEntities': {
			const removed = new Set(command.entityIds);
			project.entities = project.entities.filter((entity) => !removed.has(entity.id));
			return Ok(project);
		}
		case 'setComponent': {
			const entity = project.entities.find((item) => item.id === command.entityId);
			if (entity == null) return Err(new Error(`Entity ${command.entityId} does not exist`));
			(entity.components as Record<string, unknown>)[command.component.name] = command.component.value;
			return Ok(project);
		}
		case 'removeComponent': {
			const entity = project.entities.find((item) => item.id === command.entityId);
			if (entity == null) return Err(new Error(`Entity ${command.entityId} does not exist`));
			entity.components = Object.fromEntries(
				Object.entries(entity.components).filter(([name]) => name !== command.name)
			) as TComponents;
			return Ok(project);
		}
		case 'setDesign':
			project.design = { ...project.design, ...command.design };
			return Ok(project);
	}
}

function upsertById<GItem extends { id: string }>(items: GItem[], item: GItem): GItem[] {
	const index = items.findIndex((existing) => existing.id === item.id);
	if (index < 0) return [...items, item];
	const next = [...items];
	next[index] = item;
	return next;
}

function sortHits(hits: THit[]): THit[] {
	return [...hits].sort((a, b) => a.time - b.time);
}
