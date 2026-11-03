import type { TComponents, TEntity, TProject, TProjectCommand, TVec2 } from '@/modules/project';
import {
	findLongGaps,
	frameBand,
	freePose,
	getPieceDefinition,
	gravityOf,
	isMusicalPiece,
	layoutOf,
	shapesBounds,
	shapesDistance,
	soundsHit,
	trajectoryAt,
	transformShape,
	type TGapPieceType,
	type THitResult,
	type TLongGap,
	type TResolvedPiece,
	type TSimulationResult
} from '@/modules/simulation';
import { resolvedPieceShapes, shapesGap } from '@/modules/simulation/clearance';

// Fix-its after edits that break the run, like Xcode's: the edit's notice, the Blocked or Missed platform's
// inspector header and the hit summary's menu offer Re-place, which runs Auto place again for the broken hits.
// Blocked scenery (a windmill, switchback, rail or tunnel that follows a marble) gets Move Clear instead.

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

/** What Re-place Broken Platforms will do, so its button names every kind of change before it runs */
export interface TReplacePlan {
	/** Broken platforms it tilts again */
	platforms: number;
	/** Names of Blocked scenery pieces it moves clear */
	scenery: string[];
	/** Names of the marbles whose release moves to just before their first note */
	releases: string[];
	/** "Re-place 45 Platforms", "Move Release and Re-place 45 Platforms", "Move Windmill 1 Clear", "Re-place 46 Pieces" */
	label: string;
	/** The tooltip, a sentence naming each change */
	title: string;
	isEmpty: boolean;
}

/**
 * The plan of Re-place Broken Platforms for the run as it is: the broken platforms, the Blocked scenery and the
 * releases `releaseFix` moves given `before`, the hits from before the edit that broke the run
 */
export function replacePlan(project: TProject, result: TSimulationResult, before?: THitResult[]): TReplacePlan {
	const broken = brokenHits(result.hits);
	const platforms = broken.length;
	const names = (laneIds: Iterable<string>): string[] => [...laneIds].map((id) => project.music.lanes.find((lane) => lane.id === id)?.name ?? 'the marble');
	const releases = names([...new Set(broken.map((hit) => hit.laneId))].filter((laneId) => releaseFix(project, result.hits, laneId, before).length > 0));
	const scenery = blockedScenery(project, result).map((piece) => pieceName(project, piece.entityId));
	const core =
		scenery.length === 0
			? replaceLabel(platforms)
			: platforms === 0
				? scenery.length === 1
					? `Move ${scenery[0] ?? 'Piece'} Clear`
					: `Move ${scenery.length} Pieces Clear`
				: `Re-place ${platforms + scenery.length} Pieces`;
	const label = releases.length > 0 ? `Move Release and ${core}` : core;
	const steps = [
		releases.length > 0 ? `moves the release of ${releases.join(' and ')} to just before its first note` : '',
		platforms > 0 ? `tilts ${platforms === 1 ? 'the broken platform' : `${platforms} broken platforms`} again with Auto place` : '',
		scenery.length > 0 ? `moves ${scenery.join(', ')} clear of the run` : ''
	].filter(Boolean);
	const title = steps.length ? `${capitalize(joinWords(steps))}, as one undo step` : 'Nothing to re-place';
	return {
		platforms,
		scenery,
		releases,
		label,
		title,
		isEmpty: platforms === 0 && scenery.length === 0
	};
}

/**
 * The fix result after Re-place, in words.md's form: what changed, then how the run stands. It names how many
 * of the broken hits are fixed, since a moved release or one new tilt often fixes many platforms at once.
 */
export function replaceResultMessage(
	project: TProject,
	before: THitResult[],
	outcome: Pick<TReplaceOutcome, 'project' | 'result' | 'replaced' | 'cleared' | 'releases'>,
	summaryLabel: string,
	problems: number
): string {
	const releases = outcome.releases.map((laneId) => outcome.project.music.lanes.find((lane) => lane.id === laneId)?.name ?? 'the marble');
	const moved = releases.length
		? `${releases.join(' and ')} now ${releases.length === 1 ? 'starts' : 'start'} just before ${releases.length === 1 ? 'its' : 'their'} first note. `
		: '';
	const wasBroken = brokenHits(before).map(hitKeyOf);
	const still = new Set(brokenHits(outcome.result.hits).map(hitKeyOf));
	const fixed = wasBroken.filter((key) => !still.has(key)).length;
	const changes = [
		outcome.replaced > 0 ? `re-placed ${outcome.replaced} ${outcome.replaced === 1 ? 'platform' : 'platforms'}` : '',
		outcome.cleared.length > 0 ? `moved ${outcome.cleared.map((id) => pieceName(project, id)).join(', ')} clear` : ''
	].filter(Boolean);
	const did = capitalize(changes.length ? joinWords(changes) : 'moved the release');
	const fixedText = !wasBroken.length
		? ''
		: fixed === wasBroken.length
			? ` and fixed all ${fixed} broken ${fixed === 1 ? 'hit' : 'hits'}`
			: ` and fixed ${fixed} of ${wasBroken.length} broken hits`;
	const left = blockedScenery(outcome.project, outcome.result).map((piece) => pieceName(outcome.project, piece.entityId));
	const leftText = left.length
		? ` ${joinWords(left)} ${left.length === 1 ? 'stays' : 'stay'} Blocked, since moving ${left.length === 1 ? 'it' : 'them'} clear would break other hits. Move Clear in the inspector moves ${left.length === 1 ? 'it' : 'one'} anyway.`
		: '';
	return problems > 0
		? `${moved}${did}${fixedText}. ${summaryLabel}: turn ${problems === 1 ? 'it' : 'them'} by hand or undo the edit.${leftText}`
		: `${moved}${did}${fixedText}: ${summaryLabel}${leftText ? `.${leftText}` : ''}`;
}

// MARK: - Move Clear

/** Scenery that follows a marble but is left out because the marble's earlier run passes through it */
export function blockedScenery(project: TProject, result: TSimulationResult): TResolvedPiece[] {
	return result.pieces.filter((piece) => {
		if (piece.status !== 'blocked') return false;
		const entity = project.entities.find((item) => item.id === piece.entityId);
		const link = entity?.components.hitLink;
		return link != null && !soundsHit(entity?.components.piece?.type ?? piece.type, link);
	});
}

// Clearance kept from the earlier run, beyond the marble's radius
const CLEAR_MARGIN = 0.003;
// Samples this close before the piece starts may touch it, as a piece that follows the marble touches it
const TOUCH_WINDOW = 0.1;
const CLEAR_STEP = 0.005;
const CLEAR_MAX = 0.4;
const CLEAR_DIRECTIONS = 24;

/**
 * Move Clear for a Blocked piece that follows a marble: the smallest nudge of its offset from the marble that
 * clears every marble's run before the piece starts, without overlapping another piece. Its tie stays, so it
 * still follows the same marble at the same moment. The earlier run does not depend on the piece, which was
 * left out, so the check on the current result holds after the move. Null when no spot within 40 cm clears.
 */
export function moveClear(project: TProject, result: TSimulationResult, entityId: string): { commands: TProjectCommand[]; distance: number } | null {
	const entity = project.entities.find((item) => item.id === entityId);
	const link = entity?.components.hitLink;
	const resolved = result.pieces.find((piece) => piece.entityId === entityId);
	if (entity == null || link == null || resolved?.status !== 'blocked') return null;
	const type = entity.components.piece?.type ?? resolved.type;
	const time = resolved.entryTime ?? resolved.hitTime ?? 0;
	const shapes = resolvedPieceShapes(resolved);
	const bounds = shapesBounds(shapes);
	// A turning windmill sweeps a disc around its hub
	const isTurning = layoutOf(type) === 'rotor' && (resolved.params['motorSpeed'] ?? 0) !== 0;
	const hub = resolved.position;
	const reach = Math.max(...[bounds.minX, bounds.maxX].flatMap((x) => [bounds.minY, bounds.maxY].map((y) => Math.hypot(x - hub.x, y - hub.y))));
	const pad = CLEAR_MAX + CLEAR_MARGIN + 0.05;

	const near: { x: number; y: number; clear: number }[] = [];
	for (const track of result.marbles) {
		for (const sample of track.samples) {
			if (sample.time > time + 1e-9) break;
			const { x, y } = sample.position;
			if (x < bounds.minX - pad || x > bounds.maxX + pad || y < bounds.minY - pad || y > bounds.maxY + pad) continue;
			near.push({
				x,
				y,
				clear: track.radius + (sample.time < time - TOUCH_WINDOW ? CLEAR_MARGIN : 0)
			});
		}
	}
	const others = result.pieces
		.filter((piece) => piece.entityId !== entityId && piece.status !== 'blocked' && piece.status !== 'unreached')
		.map(resolvedPieceShapes)
		.filter((items) => {
			const other = shapesBounds(items);
			return other.maxX > bounds.minX - pad && other.minX < bounds.maxX + pad && other.maxY > bounds.minY - pad && other.minY < bounds.maxY + pad;
		});

	// The smallest clearance to the earlier run with the piece moved by `d`, minus what each sample needs
	const slack = (d: TVec2): number => {
		let least = Infinity;
		for (const sample of near) {
			const x = sample.x - d.x;
			const y = sample.y - d.y;
			const distance = isTurning ? Math.hypot(x - hub.x, y - hub.y) - reach : shapesDistance(shapes, x, y);
			least = Math.min(least, distance - sample.clear);
			if (least < 0) return least;
		}
		return least;
	};
	const overlaps = (d: TVec2): boolean => {
		if (!others.length) return false;
		const moved = shapes.map((shape) => transformShape(shape, d, 0));
		return others.some((items) => shapesGap(moved, items, 0.01) < 0.002);
	};

	let best: { d: TVec2; slack: number } | null = null;
	for (let radius = CLEAR_STEP; radius <= CLEAR_MAX + 1e-9 && best == null; radius += CLEAR_STEP) {
		for (let index = 0; index < CLEAR_DIRECTIONS; index++) {
			const angle = (index / CLEAR_DIRECTIONS) * 2 * Math.PI;
			const d = { x: radius * Math.cos(angle), y: radius * Math.sin(angle) };
			const value = slack(d);
			// The roomiest spot on the first ring that clears
			if (value >= 0 && (best == null || value > best.slack) && !overlaps(d)) best = { d, slack: value };
		}
	}
	if (best == null) return null;

	let offset: TVec2;
	let angle = link.angle;
	if (link.offset != null) {
		offset = { x: link.offset.x + best.d.x, y: link.offset.y + best.d.y };
	} else {
		// A piece placed touching the marble gets the offset that keeps its pose, then the nudge
		const track = result.marbles.find((item) => item.laneId === link.laneId);
		const sample = track != null ? trajectoryAt(track.samples, time, gravityOf(project)) : null;
		if (track == null || sample == null) return null;
		const pose = freePose(entity, resolved, track.radius);
		offset = {
			x: pose.position.x + best.d.x - sample.position.x,
			y: pose.position.y + best.d.y - sample.position.y
		};
		angle = pose.angle;
	}
	const hitLink = { ...link, angle, offset: { x: round4(offset.x), y: round4(offset.y) } };
	return {
		commands: [{ type: 'setComponent', entityId, component: { name: 'hitLink', value: hitLink } }],
		distance: Math.hypot(best.d.x, best.d.y)
	};
}

function pieceName(project: TProject, entityId: string): string {
	const entity = project.entities.find((item) => item.id === entityId);
	return entity?.name ?? getPieceDefinition(entity?.components.piece?.type ?? '')?.label ?? 'Piece';
}

function joinWords(items: string[]): string {
	if (items.length < 2) return items[0] ?? '';
	return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1] ?? ''}`;
}

function capitalize(text: string): string {
	return text.charAt(0).toUpperCase() + text.slice(1);
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
		commands.push({
			type: 'setComponent',
			entityId: current.id,
			component: { name: 'hitLink', value: { ...(currentLink ?? link), angle: link.angle } }
		});
	}
	const currentPiece = current.components.piece;
	if (currentPiece != null && JSON.stringify(currentPiece.params) !== JSON.stringify(piece.params)) {
		commands.push({
			type: 'setComponent',
			entityId: current.id,
			component: { name: 'piece', value: { ...currentPiece, params: piece.params } }
		});
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
	/** Blocked scenery moved clear of the run */
	cleared: string[];
	/** Stopped by the user or by another edit */
	isStopped: boolean;
}

/**
 * Re-runs Auto place platform by platform in time order, like building the run again from the first broken
 * hit: after each new tilt the run is simulated again and the next target is taken from the new result,
 * because a new tilt moves every later platform with the run. A first fall that grew long because the
 * marble's first notes went elsewhere is fixed first by moving the release. Every platform is tried at most
 * twice, and one Auto place cannot improve is left as it is. Blocked scenery still Blocked after the platforms
 * moves clear (Move Clear), and the platforms after it are re-placed once more.
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
	deps.onProgress?.(0, total, firstBrokenTime(result, only));
	const releases: string[] = [];
	const cleared: string[] = [];
	const stopped = (): TReplaceOutcome => ({
		project: current,
		result: latest,
		replaced,
		failed,
		releases,
		cleared,
		isStopped: true
	});
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
		deps.onProgress?.(0, total, firstBrokenTime(result, only));
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
	// Platforms first, since the run they make often clears scenery by itself; then Blocked scenery moves clear,
	// and the platforms after it are fitted once more to the run with the piece in it
	for (let pass = 0; pass < 2; pass++) {
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
		if (only != null || pass > 0 || deps.isCancelled?.() === true) break;
		const scenery = blockedScenery(current, latest);
		for (const piece of scenery) {
			const move = moveClear(current, latest, piece.entityId);
			if (move == null) {
				failed++;
				continue;
			}
			// Re-place keeps its promise to fix the run: a move that breaks hits now on time is left to the user,
			// who has Move Clear in the piece's inspector
			const trial = await deps.simulate(withCommands(current, move.commands));
			if (deps.isCancelled?.() === true) return stopped();
			if (newlyBroken(latest.hits, trial.hits).length > 0) {
				failed++;
				continue;
			}
			const next = deps.commit(current, move.commands, isFirst);
			if (next == null) return stopped();
			isFirst = false;
			current = next;
			cleared.push(piece.entityId);
			latest = await deps.simulate(current);
		}
		if (!cleared.length) break;
		tries.clear();
	}
	return {
		project: current,
		result: latest,
		replaced,
		failed,
		releases,
		cleared,
		isStopped: deps.isCancelled?.() === true
	};
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
	const position = {
		x: old.dot.x - velocity.x * lead,
		y: old.dot.y - velocity.y * lead + (g * lead * lead) / 2
	};
	const next: NonNullable<TComponents['release']> = {
		...release,
		time: round4(first.time - lead),
		position: { x: round4(position.x), y: round4(position.y) },
		velocity: { x: round4(velocity.x), y: round4(velocity.y) }
	};
	return [{ type: 'setComponent', entityId: marble.id, component: { name: 'release', value: next } }];
}

/** `project` with `setComponent` commands applied, for a trial run before a commit */
function withCommands(project: TProject, commands: TProjectCommand[]): TProject {
	let entities = project.entities;
	for (const command of commands) {
		if (command.type !== 'setComponent') continue;
		entities = entities.map((entity) =>
			entity.id === command.entityId ? { ...entity, components: { ...entity.components, [command.component.name]: command.component.value } } : entity
		);
	}
	return { ...project, entities, revision: project.revision + 1 };
}

/** Where Re-place starts in the song: the first broken hit, or the first Blocked piece */
function firstBrokenTime(result: TSimulationResult, only?: string[]): number {
	const times = [
		...brokenHits(result.hits, only).map((hit) => hit.targetTime),
		...(only == null ? result.pieces.filter((piece) => piece.status === 'blocked').map((piece) => piece.entryTime ?? piece.hitTime ?? 0) : [])
	];
	return times.length ? Math.min(...times) : 0;
}

function isGapPieceType(type: string | undefined): type is TGapPieceType {
	return type === 'switchback' || type === 'rail' || type === 'tunnel';
}

function round4(value: number): number {
	return Math.round(value * 10000) / 10000;
}
