import { FINISH_TAIL, lastPlayingLanes, projectSongEnd } from '@/modules/music/lane-commands';
import type { TEntity, TProject, TProjectCommand } from '@/modules/project';
import {
	FINISH_TYPE,
	finishCatch,
	finishOfLane,
	getPieceDefinition,
	nextPieceName,
	type TFinishCatch,
	type THitResult,
	type TSimulationResult
} from '@/modules/simulation';
import { formatTime } from '@/modules/studio/format';
import { withEntity } from './attach-edit';

// Add Finish: a Finish on a marble's fall after its last hit, found by what-if runs. Each try anchors a Finish to
// the last hit with its mouth where the marble is a little lower down, and is kept only when the marble lands in it
// and stays, no hit that played breaks, no other marble touches it and the marble touches no other lane's piece.

/**
 * How far below its last hit the marble may fall before the Finish catches it, nearest first, in metres: the first
 * clears the last platform and its bounce, the last stays well inside the held ending's frame
 */
const FINISH_DROPS = [0.07, 0.1, 0.13, 0.17, 0.22, 0.28, 0.35];
/** Seconds after the last hit within which the Finish has to catch the marble */
const FINISH_REACH = 1.2;
/** The run of a try goes on this long past the catch, so it shows whether the marble stays */
const FINISH_WATCH = 0.6;

export interface TFinishDeps {
	simulate: (project: TProject) => Promise<TSimulationResult> | TSimulationResult;
	isCancelled?: () => boolean;
}

export interface TFinishPlacement {
	entity: TEntity;
	commands: TProjectCommand[];
	/** The run of the try that passed, over the trial length */
	run: TSimulationResult;
	catch: TFinishCatch;
	/** The edit's notice */
	message: string;
}

export interface TFinishOptions {
	/** Keeps this entity's ID and name, for Place Finish Again */
	entity?: TEntity;
	/** Chute (0) or Cup (1); the entity's style or the definition's default when unset */
	style?: number;
}

/**
 * A Finish for the marble of `laneId` that its what-if runs passed, or why none did. The project's own Finish of
 * that marble, if any, is left out of the tries, so this also places it again. The tries simulate past the
 * project's end when the film would end before the catch shows.
 */
export async function findFinish(
	project: TProject,
	laneId: string,
	deps: TFinishDeps,
	options: TFinishOptions = {}
): Promise<TFinishPlacement | { error: string }> {
	const lane = project.music.lanes.find((item) => item.id === laneId);
	const marble = lane?.name ?? 'The marble';
	const last =
		lane?.hits.reduce<(typeof lane.hits)[number] | null>(
			(best, hit) => (best == null || hit.time > best.time ? hit : best),
			null
		) ?? null;
	if (lane == null || last == null)
		return { error: `${marble} has no notes yet, so there is nothing to finish` };
	const existing = options.entity ?? finishOfLane(project, laneId);
	const without: TProject = {
		...project,
		entities: project.entities.filter((entity) => entity.id !== existing?.id)
	};
	const trial: TProject = {
		...without,
		end: Math.max(without.end, last.time + FINISH_TAIL + FINISH_WATCH)
	};
	const base = await deps.simulate(trial);
	const hit = base.hits.find((item) => item.laneId === laneId && item.hitId === last.id);
	if (hit?.pieceEntityId == null || hit.actualTime == null)
		return {
			error: `${marble}'s last note has no platform yet. Add Finish once ${marble} plays it.`
		};
	const samples = base.marbles.find((track) => track.laneId === laneId)?.samples ?? [];
	const dotY =
		hit.dot?.y ?? samples.find((sample) => sample.time >= hit.targetTime)?.position.y ?? null;
	if (dotY == null) return { error: `${marble} has no run after its last note` };
	const definition = getPieceDefinition(FINISH_TYPE);
	const params: Record<string, number> = {};
	for (const [name, spec] of Object.entries(definition?.params ?? {})) params[name] = spec.default;
	for (const [name, value] of Object.entries(existing?.components.piece?.params ?? {}))
		params[name] = value;
	if (options.style != null) params['style'] = options.style;
	const tried = new Set<number>();
	let reason = '';
	const struck = hit.actualTime;
	for (const drop of FINISH_DROPS) {
		if (deps.isCancelled?.() === true) return { error: '' };
		const at = samples.find(
			(sample) =>
				sample.time > struck + 0.02 &&
				sample.time <= hit.targetTime + FINISH_REACH &&
				sample.velocity.y < 0 &&
				sample.position.y <= dotY - drop
		);
		if (at == null || tried.has(at.time)) continue;
		tried.add(at.time);
		const entryDelay = Math.round((at.time - last.time) * 1e4) / 1e4;
		// The backstop stands on the side the marble moves toward; the other side second
		const toward = at.velocity.x < 0 ? 1 : 0;
		for (const mirror of [toward, 1 - toward]) {
			const entity: TEntity = {
				id: existing?.id ?? `finish-${laneId}`.slice(0, 64),
				name: existing?.name ?? nextPieceName(FINISH_TYPE, without.entities),
				components: {
					...(existing?.components.skin != null ? { skin: existing.components.skin } : {}),
					...(existing?.components.reaction != null
						? { reaction: existing.components.reaction }
						: {}),
					piece: { type: FINISH_TYPE, params: { ...params, mirror, entryDelay } },
					hitLink: {
						laneId,
						hitId: last.id,
						angle: 0,
						contactAt: 0.5,
						pinned: false,
						anchored: true
					}
				}
			};
			const next = withEntity(trial, entity);
			const run = await deps.simulate(next);
			const caught = finishCatch(run, entity.id);
			if (caught.status !== 'caught') {
				reason ||=
					caught.status === 'blocked'
						? `${marble}'s run passes through every spot below its last note`
						: `${marble} bounces out of every Finish tried`;
				continue;
			}
			const broken = newlyBroken(base.hits, run.hits);
			if (broken.length) {
				reason ||= `a Finish there would break ${broken.length === 1 ? 'a hit' : `${broken.length} hits`}`;
				continue;
			}
			if (
				isTouchedByOthers(run, entity.id, laneId) ||
				touchesOtherLanes(next, run, laneId, last.time)
			) {
				reason ||= 'a Finish there would touch another marble or its pieces';
				continue;
			}
			const id = createFinishId(project, entity.id, existing);
			const placed = { ...entity, id };
			return {
				entity: placed,
				commands: [{ type: 'upsertEntity', entity: placed }],
				run,
				catch: caught,
				message: `${placed.name ?? 'Finish'} ${existing != null ? 'placed again' : 'added'}: ${marble} lands in it at ${formatTime(caught.enterTime ?? at.time)}`
			};
		}
	}
	return {
		error: `No Finish catches ${marble} after its last note: ${reason || `${marble} leaves the run too soon`}. Drop one on its fall by hand.`
	};
}

/** Hits that played (a platform struck them) before and are Blocked or Missed now, like Re-place's `newlyBroken` */
function newlyBroken(before: THitResult[], after: THitResult[]): THitResult[] {
	const key = (hit: THitResult): string => `${hit.laneId}/${hit.hitId}`;
	const isBroken = (hit: THitResult): boolean => hit.pieceEntityId != null && (hit.status === 'blocked' || hit.status === 'missed');
	const was = new Set(before.filter(isBroken).map(key));
	return after.filter((hit) => isBroken(hit) && !was.has(key(hit)));
}

/** Whether a marble other than the Finish's own touches it */
function isTouchedByOthers(run: TSimulationResult, entityId: string, laneId: string): boolean {
	const own = run.marbles.find((track) => track.laneId === laneId)?.entityId;
	return run.contacts.some((contact) => contact.otherEntityId === entityId && contact.marbleEntityId !== own && contact.time <= run.duration);
}

/** Whether the marble of `laneId` touches another lane's piece after `from` */
function touchesOtherLanes(
	project: TProject,
	run: TSimulationResult,
	laneId: string,
	from: number
): boolean {
	const marble = run.marbles.find((track) => track.laneId === laneId)?.entityId;
	const laneOf = new Map<string, string>();
	for (const entity of project.entities)
		if (entity.components.hitLink != null) laneOf.set(entity.id, entity.components.hitLink.laneId);
	return run.contacts.some((contact) => {
		if (contact.marbleEntityId !== marble || contact.time <= from) return false;
		if (contact.kind === 'marble') return true;
		const other = laneOf.get(contact.otherEntityId);
		return other != null && other !== laneId;
	});
}

function createFinishId(project: TProject, id: string, existing: TEntity | undefined): string {
	if (existing != null) return existing.id;
	if (!project.entities.some((entity) => entity.id === id)) return id;
	let index = 2;
	while (project.entities.some((entity) => entity.id === `${id}-${index}`)) index++;
	return `${id}-${index}`;
}

/** The marbles that play last and have no Finish yet, which the hit summary's menu and ⌘K offer Add Finish for */
export function lanesWithoutFinish(project: TProject): string[] {
	return lastPlayingLanes(project).filter((laneId) => finishOfLane(project, laneId) == null);
}

/** "Add Finish", or "Add Finish for Bass" when several marbles play last */
export function addFinishLabel(project: TProject, laneId: string, count: number): string {
	if (count <= 1) return 'Add Finish';
	return `Add Finish for ${project.music.lanes.find((lane) => lane.id === laneId)?.name ?? 'Marble'}`;
}

/** The hit result of a lane's last note, if any */
export function lastHitOf(result: TSimulationResult, laneId: string): THitResult | null {
	let last: THitResult | null = null;
	for (const hit of result.hits)
		if (hit.laneId === laneId && (last == null || hit.targetTime > last.targetTime)) last = hit;
	return last;
}

/**
 * The project with a Finish for every marble that plays last and has none, each found by `findFinish`, and its
 * length fitted to the song with the Finish's tail, as Add Finish and then Fit to Song would leave it. Fixture
 * builds use it; `messages` says what each marble got.
 */
export async function withFinishes(project: TProject, deps: TFinishDeps, options: TFinishOptions & { lanes?: string[] } = {}): Promise<{ project: TProject; messages: string[] }> {
	let current = project;
	const messages: string[] = [];
	// The marbles that play last, or the given ones, without a Finish
	const lanes = options.lanes?.filter((laneId) => finishOfLane(project, laneId) == null) ?? lanesWithoutFinish(project);
	for (const laneId of lanes) {
		const placed = await findFinish(current, laneId, deps, options);
		if ('error' in placed) {
			messages.push(placed.error);
			continue;
		}
		messages.push(placed.message);
		current = { ...current, entities: [...current.entities, placed.entity] };
	}
	const end = projectSongEnd(current);
	return { project: end == null ? current : { ...current, end }, messages };
}

/**
 * The Fix-it of a Finish that misses its marble or is Blocked: Place Finish Again, a new spot on the marble's fall that
 * a what-if run passes, keeping the Finish's ID, name, style and skin; or why none does
 */
export async function finishFix(project: TProject, result: TSimulationResult, entityId: string, deps: TFinishDeps): Promise<{ commands: TProjectCommand[] | null; message: string; label?: string }> {
	const entity = project.entities.find((item) => item.id === entityId);
	const laneId = entity?.components.hitLink?.laneId;
	const name = entity?.name ?? 'Finish';
	if (entity == null || laneId == null) return { commands: null, message: `${name} follows no marble. Drop it on a marble's fall after its last note.` };
	const marble = project.music.lanes.find((lane) => lane.id === laneId)?.name ?? 'The marble';
	const caught = finishCatch(result, entityId);
	if (caught.status === 'caught' && !isTouchedByOthers(result, entityId, laneId)) return { commands: null, message: `${name} already catches ${marble}` };
	const placed = await findFinish(project, laneId, deps, { entity });
	if ('error' in placed) return { commands: null, message: `${placed.error.replace(/\.$/, '')}, so nothing changed` };
	return { commands: placed.commands, message: placed.message, label: 'Place Finish Again' };
}
