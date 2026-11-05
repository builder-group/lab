import { Err, Ok, type TResult } from 'tuple-result';
import { BACKING_ID, SProject, type TComponentName, type TComponents, type TDesign, type TEntity, type TGroup, type THit, type TLane, type TPhysics, type TProject, type TSource, type TTempo } from './schema';

export type TProjectCommand =
	| { type: 'setTitle'; title: string }
	| { type: 'setEnd'; end: number }
	| { type: 'setFrame'; width: number; height: number }
	| { type: 'upsertSource'; source: TSource }
	| { type: 'removeSource'; sourceId: string }
	| { type: 'upsertLane'; lane: Omit<TLane, 'hits'> & { hits?: THit[] } }
	| { type: 'removeLane'; laneId: string }
	// `BACKING_ID` as the lane edits Backing
	| { type: 'upsertHits'; laneId: string; hits: THit[] }
	| { type: 'removeHits'; laneId: string; hitIds: string[] }
	// Moves hits from wherever they are to a lane or to Backing (`BACKING_ID`), keeping their IDs
	| { type: 'assignHits'; hitIds: string[]; laneId: string }
	| { type: 'setBackingInstrument'; instrument: number | null }
	| { type: 'upsertEntity'; entity: TEntity }
	| { type: 'removeEntities'; entityIds: string[] }
	| { type: 'upsertGroup'; group: TGroup }
	| { type: 'removeGroups'; groupIds: string[] }
	| { type: 'setComponent'; entityId: string; component: TComponentPatch }
	| { type: 'removeComponent'; entityId: string; name: TComponentName }
	| { type: 'setDesign'; design: Partial<TDesign> }
	| { type: 'setPhysics'; physics: Partial<TPhysics> }
	| { type: 'setTempo'; tempo: TTempo | null };

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
			syncMarbleToLane(project, lane);
			return Ok(project);
		}
		case 'removeLane': {
			project.music.lanes = project.music.lanes.filter((lane) => lane.id !== command.laneId);
			// A lane owns its marble; pieces linked to its hits stay and surface as orphans
			project.entities = project.entities.filter(
				(entity) => entity.components.marble?.laneId !== command.laneId
			);
			if (project.groups != null) setGroups(project, project.groups.filter((group) => group.laneId !== command.laneId));
			return Ok(project);
		}
		case 'upsertHits': {
			const [isOwnerOk, ownerErr, owner] = hitOwner(project, command.laneId);
			if (!isOwnerOk) return Err(ownerErr);
			let hits = owner.hits;
			for (const hit of command.hits) hits = upsertById(hits, hit);
			owner.hits = sortHits(hits);
			return Ok(project);
		}
		case 'removeHits': {
			const [isOwnerOk, ownerErr, owner] = hitOwner(project, command.laneId);
			if (!isOwnerOk) return Err(ownerErr);
			const removed = new Set(command.hitIds);
			owner.hits = owner.hits.filter((hit) => !removed.has(hit.id));
			return Ok(project);
		}
		case 'assignHits': {
			const [isTargetOk, targetErr, target] = hitOwner(project, command.laneId);
			if (!isTargetOk) return Err(targetErr);
			const wanted = new Set(command.hitIds);
			const owners = [...project.music.lanes, backingOwner(project)];
			const moved: THit[] = [];
			for (const owner of owners) {
				if (owner.id === command.laneId) continue;
				moved.push(...owner.hits.filter((hit) => wanted.has(hit.id)));
				owner.hits = owner.hits.filter((hit) => !wanted.has(hit.id));
			}
			const found = new Set([...moved, ...target.hits].map((hit) => hit.id));
			const missing = command.hitIds.find((id) => !found.has(id));
			if (missing != null) return Err(new Error(`Hit ${missing} does not exist`));
			target.hits = sortHits([...target.hits, ...moved]);
			return Ok(project);
		}
		case 'setBackingInstrument': {
			const { backingInstrument: _previous, ...music } = project.music;
			project.music = command.instrument == null ? music : { ...music, backingInstrument: command.instrument };
			return Ok(project);
		}
		case 'upsertEntity':
			project.entities = upsertById(project.entities, command.entity);
			syncLaneToMarble(project, command.entity);
			return Ok(project);
		case 'removeEntities': {
			const removed = new Set(command.entityIds);
			project.entities = project.entities.filter((entity) => !removed.has(entity.id));
			// A Group lists its pieces; one that lost them all is gone with them
			if (project.groups != null) setGroups(project, project.groups.map((group) => ({ ...group, pieceIds: group.pieceIds.filter((id) => !removed.has(id)) })).filter((group) => group.pieceIds.length > 0 || !project.groups?.find((item) => item.id === group.id)?.pieceIds.length));
			return Ok(project);
		}
		case 'upsertGroup':
			setGroups(project, upsertById(project.groups ?? [], command.group));
			return Ok(project);
		case 'removeGroups':
			setGroups(project, (project.groups ?? []).filter((group) => !command.groupIds.includes(group.id)));
			return Ok(project);
		case 'setComponent': {
			const entity = project.entities.find((item) => item.id === command.entityId);
			if (entity == null) return Err(new Error(`Entity ${command.entityId} does not exist`));
			(entity.components as Record<string, unknown>)[command.component.name] = command.component.value;
			syncLaneToMarble(project, entity);
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
		case 'setDesign': {
			const design = { ...project.design, ...command.design };
			// The follow camera reads shot markers in time order
			project.design = { ...design, camera: { ...design.camera, shots: [...design.camera.shots].sort((a, b) => a.time - b.time) } };
			return Ok(project);
		}
		case 'setPhysics':
			project.physics = { ...project.physics, ...command.physics };
			return Ok(project);
		case 'setTempo': {
			const { tempo: _previous, ...music } = project.music;
			project.music = command.tempo == null ? music : { ...music, tempo: command.tempo };
			return Ok(project);
		}
	}
}

/** A project without Groups has no list at all, as its file stays the same */
function setGroups(project: TProject, groups: TGroup[]): void {
	if (groups.length > 0) project.groups = groups;
	else delete project.groups;
}

/** The hit list a command edits: a lane's hits, or Backing for `BACKING_ID`. Writes to `hits` go to the project. */
function hitOwner(project: TProject, laneId: string): TResult<THitOwner, Error> {
	if (laneId === BACKING_ID) return Ok(backingOwner(project));
	const lane = project.music.lanes.find((item) => item.id === laneId);
	if (lane == null) return Err(new Error(`Lane ${laneId} does not exist`));
	return Ok(lane);
}

function backingOwner(project: TProject): THitOwner {
	return {
		id: BACKING_ID,
		get hits() {
			return project.music.backing;
		},
		set hits(hits) {
			project.music.backing = hits;
		}
	};
}

interface THitOwner {
	id: string;
	hits: THit[];
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

/** A marble has one colour: the lane's and the marble's stay the same however an edit sets them */
function syncMarbleToLane(project: TProject, lane: TLane): void {
	for (const entity of project.entities) {
		const marble = entity.components.marble;
		if (marble?.laneId === lane.id && marble.color !== lane.color) entity.components.marble = { ...marble, color: lane.color };
	}
}

function syncLaneToMarble(project: TProject, entity: TEntity): void {
	const marble = entity.components.marble;
	if (marble == null) return;
	const lane = project.music.lanes.find((item) => item.id === marble.laneId);
	if (lane != null && lane.color !== marble.color) lane.color = marble.color;
}
