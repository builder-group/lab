import type { TComponents, TEntity, TProject, TProjectCommand } from '@/modules/project';
import { findLongGaps, frameBand, gravityOf, isMusicalPiece, type TGapPieceType, type THitResult, type TLongGap, type TSimulationResult } from '@/modules/simulation';

// Fix-its after edits that break the run, like Xcode's: the edit's notice, the Blocked or Missed platform's
// inspector header and the hit summary's menu offer Re-place, which runs Auto place again for the broken hits.

/** A hit whose platform no longer plays it: Blocked, Missed or Stopped */
export function isBroken(hit: THitResult): boolean {
	return hit.pieceEntityId != null && (hit.status === 'blocked' || hit.status === 'missed');
}

export function hitKeyOf(hit: Pick<THitResult, 'laneId' | 'hitId'>): string {
	return `${hit.laneId}/${hit.hitId}`;
}

/** Hits that are broken after an edit but were not before it, in time order */
export function newlyBroken(before: THitResult[], after: THitResult[]): THitResult[] {
	const wasBroken = new Set(before.filter(isBroken).map(hitKeyOf));
	return after.filter((hit) => isBroken(hit) && !wasBroken.has(hitKeyOf(hit))).sort((a, b) => a.targetTime - b.targetTime);
}

/** A hit that needs attention: broken, early or late, or on time but outside its marble's frame band */
function needsFix(project: TProject, hit: THitResult): boolean {
	if (isBroken(hit) || hit.status === 'drifting') return true;
	if (hit.dot == null) return false;
	const band = frameBand(project, hit.laneId);
	return Math.abs(hit.dot.x - band.centerX) > band.halfWidth;
}

/**
 * The broken hits Re-place counts in its label, in time order: Blocked, Missed or Stopped hits, and the early or
 * late ones after the first of them on the same marble, which the same edit usually pushed off. With `only`,
 * just those hits (`laneId/hitId` keys) when their platform does not land on time.
 */
export function brokenHits(results: THitResult[], only?: string[]): THitResult[] {
	const sorted = results.filter((hit) => hit.pieceEntityId != null).sort((a, b) => a.targetTime - b.targetTime);
	if (only != null) {
		const wanted = new Set(only);
		return sorted.filter((hit) => wanted.has(hitKeyOf(hit)) && hit.status !== 'onTime');
	}
	const firstBroken = new Map<string, number>();
	for (const hit of sorted) if (isBroken(hit) && !firstBroken.has(hit.laneId)) firstBroken.set(hit.laneId, hit.targetTime);
	return sorted.filter((hit) => {
		const from = firstBroken.get(hit.laneId);
		return from != null && hit.targetTime >= from && (isBroken(hit) || hit.status === 'drifting');
	});
}

/**
 * The platforms Re-place runs Auto place for, in time order: on each marble with a broken hit, from the hit
 * before the first one that needs attention onward, every platform that needs attention itself or whose next platform does.
 * Auto place picks a platform's tilt by where it sends the marble next, so a Blocked spot is fixed by the
 * platform before it, and a run that drifted out of the frame by the platform where it left.
 */
export function replaceTargets(project: TProject, results: THitResult[], only?: string[]): THitResult[] {
	if (only != null) return brokenHits(results, only);
	const linked = results.filter((hit) => hit.pieceEntityId != null).sort((a, b) => a.targetTime - b.targetTime);
	const targets: THitResult[] = [];
	for (const laneId of new Set(linked.map((hit) => hit.laneId))) {
		const run = linked.filter((hit) => hit.laneId === laneId);
		if (!run.some(isBroken)) continue;
		// A run that left the frame before its first broken hit is fixed from where it left
		const first = run.findIndex((hit) => needsFix(project, hit));
		for (let index = Math.max(0, first - 1); index < run.length; index++) {
			const hit = run[index];
			const next = run[index + 1];
			if (hit != null && (needsFix(project, hit) || (next != null && needsFix(project, next)))) targets.push(hit);
		}
	}
	return targets.sort((a, b) => a.targetTime - b.targetTime);
}

/** "Re-place 24 Platforms", or "Re-place Platform 3" for one */
export function replaceLabel(count: number, pieceName?: string): string {
	if (count === 1) return pieceName == null ? 'Re-place Platform' : `Re-place ${pieceName}`;
	return `Re-place ${count} Platforms`;
}

/** Commands that give `entity` the angle and settings Auto place chose, keeping its name, skin and other components */
export function replaceCommands(project: TProject, placed: TEntity): TProjectCommand[] {
	const current = project.entities.find((entity) => entity.id === placed.id);
	const link = placed.components.hitLink;
	const piece = placed.components.piece;
	if (current == null || link == null || piece == null) return [];
	const commands: TProjectCommand[] = [];
	const currentLink = current.components.hitLink;
	if (currentLink == null || JSON.stringify(currentLink) !== JSON.stringify({ ...currentLink, angle: link.angle })) {
		commands.push({ type: 'setComponent', entityId: current.id, component: { name: 'hitLink', value: { ...(currentLink ?? link), angle: link.angle } } });
	}
	const currentPiece = current.components.piece;
	if (currentPiece != null && JSON.stringify(currentPiece.params) !== JSON.stringify(piece.params)) {
		commands.push({ type: 'setComponent', entityId: current.id, component: { name: 'piece', value: { ...currentPiece, params: piece.params } } });
	}
	return commands;
}

export interface TReplaceDeps {
	simulate: (project: TProject) => Promise<TSimulationResult>;
	/** Auto place for a hit's existing platform; rejects when no angle passes */
	autoPlace: (project: TProject, hit: THitResult, entity: TEntity) => Promise<TEntity>;
	/** A new switchback, rail or tunnel for a long gap, replacing `entityId`; rejects when none fits */
	gapPiece: (project: TProject, gap: TLongGap, type: TGapPieceType, entityId: string) => Promise<TEntity>;
	/** Applies one step's commands; the first step starts the undo step, later ones join it. Null stops. */
	commit: (project: TProject, commands: TProjectCommand[], isFirst: boolean) => TProject | null;
	/** `at` is the time of the hit being worked on, for progress through the song */
	onProgress?: (done: number, total: number, at: number) => void;
	isCancelled?: () => boolean;
}

export interface TReplaceOptions {
	/** Only these hits (`laneId/hitId` keys), without touching releases or the platforms before them */
	only?: string[];
	/** Hit results from before the edit that broke the run, so a moved release keeps the run as it was */
	before?: THitResult[];
}

export interface TReplaceOutcome {
	project: TProject;
	result: TSimulationResult;
	/** Platforms that got a new angle */
	replaced: number;
	/** Hits Auto place found no angle for */
	failed: number;
	/** Lanes whose marble release moved to just before its first note */
	releases: string[];
	/** Stopped by the user or by another edit */
	isStopped: boolean;
}

/**
 * Re-runs Auto place platform by platform in time order, like building the run again from the first broken
 * hit: after each new tilt the run is simulated again and the next target is taken from the new result,
 * because a new tilt moves every later platform with the run. A first fall that grew long because the
 * marble's first notes went elsewhere is fixed first by moving the release. Every platform is tried at most
 * twice, and one Auto place cannot improve is left as it is.
 */
export async function replaceBroken(project: TProject, result: TSimulationResult, deps: TReplaceDeps, options: TReplaceOptions = {}): Promise<TReplaceOutcome> {
	const { only, before } = options;
	let current = project;
	let latest = result;
	let replaced = 0;
	let failed = 0;
	let isFirst = true;
	const tries = new Map<string, number>();

	let total = replaceTargets(current, latest.hits, only).length;
	deps.onProgress?.(0, total, result.hits.length ? Math.min(...brokenHits(result.hits, only).map((hit) => hit.targetTime)) : 0);
	const releases: string[] = [];
	const stopped = (): TReplaceOutcome => ({ project: current, result: latest, replaced, failed, releases, isStopped: true });
	if (only == null) {
		for (const laneId of new Set(brokenHits(latest.hits).map((hit) => hit.laneId))) {
			const commands = releaseFix(current, latest.hits, laneId, before);
			if (!commands.length) continue;
			const next = deps.commit(current, commands, isFirst);
			if (next == null) return stopped();
			isFirst = false;
			current = next;
			releases.push(laneId);
			latest = await deps.simulate(current);
		}
		total = replaceTargets(current, latest.hits).length;
		deps.onProgress?.(0, total, result.hits.length ? Math.min(...brokenHits(result.hits, only).map((hit) => hit.targetTime)) : 0);
	}

	let done = 0;
	const rebridged = new Map<string, number>();
	// A switchback, rail or tunnel after a hit follows its trajectory; when the hit after the gap needs
	// attention, the bridge is suggested again for the run as it is now, at most twice per bridge
	const rebridge = async (target: THitResult): Promise<'rebridged' | 'none' | 'stopped'> => {
		if (only != null) return 'none';
		const gap = findLongGaps(current, target.laneId).find((item) => item.fromHitId === target.hitId && item.bridgedBy != null);
		const after = gap == null ? undefined : latest.hits.find((hit) => hit.laneId === gap.laneId && hit.hitId === gap.toHitId);
		const bridge = gap == null ? undefined : current.entities.find((item) => item.id === gap.bridgedBy);
		const bridgeType = bridge?.components.piece?.type;
		if (gap == null || after == null || bridge == null || !isGapPieceType(bridgeType) || !needsFix(current, after)) return 'none';
		const count = rebridged.get(bridge.id) ?? 0;
		if (count >= 2) return 'none';
		rebridged.set(bridge.id, count + 1);
		let suggested: TEntity | null;
		try {
			suggested = await deps.gapPiece({ ...current, entities: current.entities.filter((item) => item.id !== bridge.id) }, gap, bridgeType, bridge.id);
		} catch {
			suggested = null;
		}
		if (deps.isCancelled?.() === true) return 'stopped';
		if (suggested == null) return 'none';
		const next = deps.commit(current, [{ type: 'upsertEntity', entity: { ...suggested, id: bridge.id, name: bridge.name } }], isFirst);
		if (next == null) return 'stopped';
		isFirst = false;
		current = next;
		latest = await deps.simulate(current);
		replaced++;
		return 'rebridged';
	};
	while (deps.isCancelled?.() !== true) {
		const targets = replaceTargets(current, latest.hits, only).filter((hit) => (tries.get(hitKeyOf(hit)) ?? 0) < 2);
		const target = targets[0];
		if (target == null) break;
		const key = hitKeyOf(target);
		tries.set(key, (tries.get(key) ?? 0) + 1);
		total = Math.max(total, done + targets.length);
		// Before a long gap the bridge alone may be what no longer fits
		const first = needsFix(current, target) ? 'none' : await rebridge(target);
		if (first === 'stopped') return stopped();
		if (first === 'rebridged') {
			tries.set(key, (tries.get(key) ?? 1) - 1);
			continue;
		}
		const entity = current.entities.find((item) => item.id === target.pieceEntityId);
		const type = entity?.components.piece?.type;
		let placed: TEntity | null = null;
		if (entity != null && type != null && isMusicalPiece(type)) {
			try {
				placed = await deps.autoPlace(current, target, entity);
			} catch {
				placed = null;
			}
		}
		if (deps.isCancelled?.() === true) return stopped();
		done++;
		const commands = placed == null ? [] : replaceCommands(current, placed);
		if (commands.length) {
			const next = deps.commit(current, commands, isFirst);
			if (next == null) return stopped();
			isFirst = false;
			current = next;
			latest = await deps.simulate(current);
			replaced++;
		} else {
			// Nothing better exists for this platform; it is not asked again
			tries.set(key, 2);
			if (placed == null && isBroken(target)) failed++;
		}
		if ((await rebridge(target)) === 'stopped') return stopped();
		deps.onProgress?.(done, total, target.targetTime);
	}
	return { project: current, result: latest, replaced, failed, releases, isStopped: deps.isCancelled?.() === true };
}

// The release follows the first note by at most this long, like a new marble's
const RELEASE_LEAD = 0.5;
const MIN_RELEASE_LEAD = 0.1;

/**
 * When a marble's first notes went elsewhere, its remaining run starts with a long fall from the release that
 * breaks everything after it. This moves the release to just before the first remaining note, so the marble
 * arrives where and how fast it did in `before`, the hits from before the edit, which keeps the rest of the run
 * as it was. Returns no commands when nothing on the marble is broken, its first fall is short already or
 * `before` does not know the old arrival.
 */
export function releaseFix(project: TProject, results: THitResult[], laneId: string, before?: THitResult[]): TProjectCommand[] {
	const lane = project.music.lanes.find((item) => item.id === laneId);
	const marble = project.entities.find((entity) => entity.components.marble?.laneId === laneId);
	const release = marble?.components.release;
	const first = lane?.hits[0];
	if (lane == null || marble == null || release == null || first == null) return [];
	// A first fall longer than twice the lead is what handing the first notes away leaves behind
	if (!results.some((hit) => hit.laneId === laneId && isBroken(hit)) || first.time - release.time <= 2 * RELEASE_LEAD + 1e-6) return [];
	const old = before?.find((hit) => hit.laneId === laneId && hit.hitId === first.id);
	// Without the old arrival a later release only trades one broken run for another
	if (old?.dot == null || old.velocity == null || old.status !== 'onTime') return [];
	const g = -gravityOf(project);
	// Free flight back from the old arrival, short enough that the marble is not thrown upward
	const lead = Math.min(RELEASE_LEAD, Math.max(MIN_RELEASE_LEAD, -old.velocity.y / g));
	const velocity = { x: old.velocity.x, y: old.velocity.y + g * lead };
	const position = { x: old.dot.x - velocity.x * lead, y: old.dot.y - velocity.y * lead + (g * lead * lead) / 2 };
	const next: NonNullable<TComponents['release']> = {
		...release,
		time: round4(first.time - lead),
		position: { x: round4(position.x), y: round4(position.y) },
		velocity: { x: round4(velocity.x), y: round4(velocity.y) }
	};
	return [{ type: 'setComponent', entityId: marble.id, component: { name: 'release', value: next } }];
}

function isGapPieceType(type: string | undefined): type is TGapPieceType {
	return type === 'switchback' || type === 'rail' || type === 'tunnel';
}

function round4(value: number): number {
	return Math.round(value * 10000) / 10000;
}
