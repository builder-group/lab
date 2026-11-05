import { BOWL_TAIL, lastPlayingMarbles, projectSongEnd } from '@/modules/music';
import type { TEntity, TProject, TProjectCommand } from '@/modules/project';
import { BOWL_TYPE, bowlCatch, bowlOfMarble, getPieceDefinition, nextPieceName, type TBowlCatch, type THitResult, type TSimulationResult } from '@/modules/simulation';
import { formatTime } from '@/modules/project';
import { withEntity } from './attach-edit';

// Add Bowl: a Bowl on a marble's fall after its last hit, found by what-if runs. Each try anchors a Bowl to
// the last hit with its mouth where the marble is a little lower down, and is kept only when the marble lands in it
// and stays, no hit that played breaks, no other marble touches it and the marble touches no other marble's piece.

/**
 * How far below its last hit the marble may fall before the Bowl catches it, nearest first, in meters: the first
 * clears the last platform and its bounce, the last stays well inside the held ending's frame
 */
const BOWL_DROPS = [0.07, 0.1, 0.13, 0.17, 0.22, 0.28, 0.35];
/** Seconds after the last hit within which the Bowl has to catch the marble */
const BOWL_REACH = 1.2;
/** The run of a try goes on this long past the catch, so it shows whether the marble stays */
const BOWL_WATCH = 0.6;

export interface TBowlDeps {
	simulate: (project: TProject) => Promise<TSimulationResult> | TSimulationResult;
	isCanceled?: () => boolean;
}

export interface TBowlPlacement {
	entity: TEntity;
	commands: TProjectCommand[];
	/** The run of the try that passed, over the trial length */
	run: TSimulationResult;
	catch: TBowlCatch;
	/** The edit's notice */
	message: string;
}

export interface TBowlOptions {
	/** Keeps this entity's ID and name, for Place Bowl Again */
	entity?: TEntity;
}

/**
 * A Bowl for the marble of `marbleId` that its what-if runs passed, or why none did. The project's own Bowl of
 * that marble, if any, is left out of the tries, so this also places it again. The tries simulate past the
 * project's end when the film would end before the catch shows.
 */
export async function findBowl(
	project: TProject,
	marbleId: string,
	deps: TBowlDeps,
	options: TBowlOptions = {}
): Promise<TBowlPlacement | { error: string }> {
	const marble = project.music.marbles.find((item) => item.id === marbleId);
	const marbleEntity = marble?.name ?? 'The marble';
	const last =
		marble?.hits.reduce<(typeof marble.hits)[number] | null>(
			(best, hit) => (best == null || hit.time > best.time ? hit : best),
			null
		) ?? null;
	if (marble == null || last == null)
		return { error: `${marbleEntity} has no notes yet, so there is nothing to collect` };
	const existing = options.entity ?? bowlOfMarble(project, marbleId);
	const without: TProject = {
		...project,
		entities: project.entities.filter((entity) => entity.id !== existing?.id)
	};
	const trial: TProject = {
		...without,
		length: Math.max(without.length, last.time + BOWL_TAIL + BOWL_WATCH)
	};
	const base = await deps.simulate(trial);
	const hit = base.hits.find((item) => item.marbleId === marbleId && item.hitId === last.id);
	if (hit?.pieceEntityId == null || hit.actualTime == null)
		return {
			error: `${marbleEntity}'s last note has no platform yet. Add Bowl once ${marbleEntity} plays it.`
		};
	const samples = base.marbles.find((track) => track.marbleId === marbleId)?.samples ?? [];
	const dotY =
		hit.dot?.y ?? samples.find((sample) => sample.time >= hit.targetTime)?.position.y ?? null;
	if (dotY == null) return { error: `${marbleEntity} has no run after its last note` };
	const definition = getPieceDefinition(BOWL_TYPE);
	const params: Record<string, number> = {};
	for (const [name, spec] of Object.entries(definition?.params ?? {})) params[name] = spec.default;
	for (const [name, value] of Object.entries(existing?.components.piece?.params ?? {}))
		params[name] = value;
	const tried = new Set<number>();
	let reason = '';
	const struck = hit.actualTime;
	for (const drop of BOWL_DROPS) {
		if (deps.isCanceled?.() === true) return { error: '' };
		const at = samples.find(
			(sample) =>
				sample.time > struck + 0.02 &&
				sample.time <= hit.targetTime + BOWL_REACH &&
				sample.velocity.y < 0 &&
				sample.position.y <= dotY - drop
		);
		if (at == null || tried.has(at.time)) continue;
		tried.add(at.time);
		const entryDelay = Math.round((at.time - last.time) * 1e4) / 1e4;
		// The center lies on the side the marble moves toward; the other side second
		const toward = at.velocity.x < 0 ? 1 : 0;
		for (const mirror of [toward, 1 - toward]) {
			const entity: TEntity = {
				id: existing?.id ?? `bowl-${marbleId}`.slice(0, 64),
				name: existing?.name ?? nextPieceName(BOWL_TYPE, without.entities),
				components: {
					...(existing?.components.skin != null ? { skin: existing.components.skin } : {}),
					piece: { type: BOWL_TYPE, params: { ...params, mirror, entryDelay } },
					hitLink: {
						marbleId,
						hitId: last.id,
						angle: 0,
						contactAt: 0.5,
						anchored: true
					}
				}
			};
			const next = withEntity(trial, entity);
			const run = await deps.simulate(next);
			const caught = bowlCatch(run, entity.id);
			if (caught.status !== 'caught') {
				reason ||=
					caught.status === 'blocked'
						? `${marbleEntity}'s run passes through every spot below its last note`
						: `${marbleEntity} bounces out of every Bowl tried`;
				continue;
			}
			const broken = newlyBroken(base.hits, run.hits);
			if (broken.length) {
				reason ||= `a Bowl there would break ${broken.length === 1 ? 'a hit' : `${broken.length} hits`}`;
				continue;
			}
			if (
				isTouchedByOthers(run, entity.id, marbleId) ||
				touchesOtherMarbles(next, run, marbleId, last.time)
			) {
				reason ||= 'a Bowl there would touch another marble or its pieces';
				continue;
			}
			const id = createBowlId(project, entity.id, existing);
			const placed = { ...entity, id };
			return {
				entity: placed,
				commands: [{ type: 'upsertEntity', entity: placed }],
				run,
				catch: caught,
				message: `${placed.name ?? 'Bowl'} ${existing != null ? 'placed again' : 'added'}: ${marbleEntity} lands in it at ${formatTime(caught.enterTime ?? at.time)}`
			};
		}
	}
	return {
		error: `No Bowl catches ${marbleEntity} after its last note: ${reason || `${marbleEntity} leaves the track too soon`}. Drop one on its fall by hand.`
	};
}

/** Hits that played (a platform struck them) before an edit and are Blocked or Missed after it, in time order */
export function newlyBroken(before: THitResult[], after: THitResult[]): THitResult[] {
	const was = new Set(before.filter(isBroken).map(hitKeyOf));
	return after.filter((hit) => isBroken(hit) && !was.has(hitKeyOf(hit))).sort((a, b) => a.targetTime - b.targetTime);
}

/** A platform that should play its hit and doesn't */
export function isBroken(hit: THitResult): boolean {
	return hit.pieceEntityId != null && (hit.status === 'blocked' || hit.status === 'missed');
}

export function hitKeyOf(hit: Pick<THitResult, 'marbleId' | 'hitId'>): string {
	return `${hit.marbleId}/${hit.hitId}`;
}

/** Whether a marble other than the Bowl's own touches it */
function isTouchedByOthers(run: TSimulationResult, entityId: string, marbleId: string): boolean {
	const own = run.marbles.find((track) => track.marbleId === marbleId)?.entityId;
	return run.contacts.some((contact) => contact.otherEntityId === entityId && contact.marbleEntityId !== own && contact.time <= run.duration);
}

/** Whether the marble of `marbleId` touches another marble's piece after `from` */
function touchesOtherMarbles(
	project: TProject,
	run: TSimulationResult,
	marbleId: string,
	from: number
): boolean {
	const marble = run.marbles.find((track) => track.marbleId === marbleId)?.entityId;
	const marbleOf = new Map<string, string>();
	for (const entity of project.entities)
		if (entity.components.hitLink != null) marbleOf.set(entity.id, entity.components.hitLink.marbleId);
	return run.contacts.some((contact) => {
		if (contact.marbleEntityId !== marble || contact.time <= from) return false;
		if (contact.kind === 'marble') return true;
		const other = marbleOf.get(contact.otherEntityId);
		return other != null && other !== marbleId;
	});
}

function createBowlId(project: TProject, id: string, existing: TEntity | undefined): string {
	if (existing != null) return existing.id;
	if (!project.entities.some((entity) => entity.id === id)) return id;
	let index = 2;
	while (project.entities.some((entity) => entity.id === `${id}-${index}`)) index++;
	return `${id}-${index}`;
}

/** The marbles that play last and have no Bowl yet, which Insert, the Track menu and ⌘K offer Add Bowl for */
export function marblesWithoutBowl(project: TProject): string[] {
	return lastPlayingMarbles(project).filter((marbleId) => bowlOfMarble(project, marbleId) == null);
}

/**
 * The project with a Bowl for every marble that plays last and has none, each found by `findBowl`, and its
 * length fitted to the song with the Bowl's tail, as Add Bowl and then Fit to Song would leave it. Fixture
 * builds use it; `messages` says what each marble got.
 */
export async function withBowls(project: TProject, deps: TBowlDeps, options: TBowlOptions & { marbles?: string[] } = {}): Promise<{ project: TProject; messages: string[] }> {
	let current = project;
	const messages: string[] = [];
	// The marbles that play last, or the given ones, without a Bowl
	const marbles = options.marbles?.filter((marbleId) => bowlOfMarble(project, marbleId) == null) ?? marblesWithoutBowl(project);
	for (const marbleId of marbles) {
		const placed = await findBowl(current, marbleId, deps, options);
		if ('error' in placed) {
			messages.push(placed.error);
			continue;
		}
		messages.push(placed.message);
		current = { ...current, entities: [...current.entities, placed.entity] };
	}
	// A film that would end before the catch is lengthened; a longer one stays what it is
	const end = projectSongEnd(current);
	return { project: end == null || end <= current.length ? current : { ...current, length: end }, messages };
}

/**
 * The Fix of a Bowl that misses its marble or is Blocked: a new spot on the marble's fall that
 * a what-if run passes, keeping the Bowl's ID, name and skin; or why none does
 */
export async function bowlFix(project: TProject, result: TSimulationResult, entityId: string, deps: TBowlDeps): Promise<{ commands: TProjectCommand[] | null; message: string }> {
	const entity = project.entities.find((item) => item.id === entityId);
	const marbleId = entity?.components.hitLink?.marbleId;
	const name = entity?.name ?? 'Bowl';
	if (entity == null || marbleId == null) return { commands: null, message: `${name} follows no marble. Drop it on a marble's fall after its last note.` };
	const marble = project.music.marbles.find((marble) => marble.id === marbleId)?.name ?? 'The marble';
	const caught = bowlCatch(result, entityId);
	if (caught.status === 'caught' && !isTouchedByOthers(result, entityId, marbleId)) return { commands: null, message: `${name} already catches ${marble}` };
	const placed = await findBowl(project, marbleId, deps, { entity });
	if ('error' in placed) return { commands: null, message: `${placed.error.replace(/\.$/, '')}, so nothing changed` };
	return { commands: placed.commands, message: placed.message };
}
