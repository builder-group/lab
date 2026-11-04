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
	/** Broken hits left, and Blocked scenery that could not move clear */
	failed: number;
	/** Lanes whose marble release moved to just before its first note */
	releases: string[];
	/** Blocked scenery moved clear of the run */
	cleared: string[];
	/** Stopped by the user or by another edit */
	isStopped: boolean;
}

/**
 * Builds the run again from each marble's first problem onward, the way the step loop built it. A first fall that
 * grew long because the marble's first notes went elsewhere is fixed first by moving the release. Then, at the
 * earliest hit that needs attention, Auto place tilts the platform before it again; a launch into a bridged long
 * gap is tilted for the open gap and its switchback, rail or tunnel suggested again for the new launch, as Next
 * did. A change is kept only when the problem moves later and no other marble loses a hit. When the platform
 * before cannot fix it, the arrival there is what fails, so Re-place goes back up to `MAX_BACKTRACK` platforms
 * further and builds forward from there, and then turns one of the two platforms before the problem by hand, as the
 * fixture builds do. A problem nothing fixes is left as it is and Re-place carries on after it, up to `MAX_LEFT`
 * broken hits per marble. Blocked scenery still Blocked after the platforms gets a new bridge for its gap or moves
 * clear (Move Clear), and the platforms after it are fitted once more. With `only`, Auto place runs once for each
 * of those platforms.
 */
export async function replaceBroken(project: TProject, result: TSimulationResult, deps: TReplaceDeps, options: TReplaceOptions = {}): Promise<TReplaceOutcome> {
	const { only, before } = options;
	let current = project;
	let latest = result;
	let failed = 0;
	let isFirst = true;
	const changed = new Set<string>();
	const releases: string[] = [];
	const cleared: string[] = [];
	const isCancelled = (): boolean => deps.isCancelled?.() === true;
	const outcome = (isStopped: boolean): TReplaceOutcome => ({
		project: current,
		result: latest,
		replaced: changed.size,
		failed: failed + brokenHits(latest.hits, only).length,
		releases,
		cleared,
		isStopped
	});
	/** Applies `commands`; `run` is the trial run of the same edit, which saves simulating it again */
	const commit = async (commands: TProjectCommand[], isPiece = true, run?: TSimulationResult): Promise<boolean> => {
		const next = deps.commit(current, commands, isFirst);
		if (next == null) return false;
		isFirst = false;
		current = next;
		if (isPiece) for (const command of commands) changed.add(command.type === 'upsertEntity' ? command.entity.id : command.type === 'setComponent' ? command.entityId : '');
		latest = run != null ? { ...run, revision: current.revision } : await deps.simulate(current);
		return true;
	};
	const placeAgain = async (base: TProject, target: THitResult): Promise<TEntity | null> => {
		const entity = base.entities.find((item) => item.id === target.pieceEntityId);
		const type = entity?.components.piece?.type;
		if (entity == null || type == null || !isMusicalPiece(type)) return null;
		try {
			return await deps.autoPlace(base, target, entity);
		} catch {
			return null;
		}
	};

	deps.onProgress?.(0, brokenHits(result.hits, only).length, firstBrokenTime(result, only));
	if (only != null) {
		const keys = brokenHits(result.hits, only).map(hitKeyOf);
		for (const [index, key] of keys.entries()) {
			const target = latest.hits.find((hit) => hitKeyOf(hit) === key);
			if (target == null || target.status === 'onTime') continue;
			const placed = await placeAgain(current, target);
			if (isCancelled()) return outcome(true);
			const commands = placed == null ? [] : replaceCommands(current, placed);
			if (commands.length && !(await commit(commands))) return outcome(true);
			deps.onProgress?.(index + 1, keys.length, target.targetTime);
		}
		return outcome(isCancelled());
	}

	for (const laneId of new Set(brokenHits(latest.hits).map((hit) => hit.laneId))) {
		const commands = releaseFix(current, latest.hits, laneId, before);
		if (!commands.length) continue;
		if (!(await commit(commands, false))) return outcome(true);
		releases.push(laneId);
	}
	const total = Math.max(1, brokenHits(latest.hits).length);

	/** A new switchback, rail or tunnel for `gap` in place of `bridge`, for the run in `base` without it */
	const bridgeCommands = async (base: TProject, gap: TLongGap, bridge: TEntity): Promise<TProjectCommand[] | null> => {
		const bridgeType = bridge.components.piece?.type;
		if (!isGapPieceType(bridgeType)) return null;
		// Like Next, a rail where no switchback fits any more, and a switchback where no rail does
		const types: TGapPieceType[] = bridgeType === 'switchback' ? ['switchback', 'rail'] : bridgeType === 'rail' ? ['rail', 'switchback'] : [bridgeType];
		const without = { ...base, entities: base.entities.filter((item) => item.id !== bridge.id) };
		for (const type of types) {
			let suggested: TEntity | null;
			try {
				suggested = await deps.gapPiece(without, gap, type, bridge.id);
			} catch {
				suggested = null;
			}
			if (isCancelled()) return null;
			if (suggested == null) continue;
			// A bridge of another kind takes that kind's name
			const name = type === bridgeType ? bridge.name : (suggested.name ?? bridge.name);
			return [{ type: 'upsertEntity', entity: { ...suggested, id: bridge.id, name } }];
		}
		return null;
	};
	// Bridges suggested per launch, since a backtrack may ask for the same one again
	const bridges = new Map<string, TProjectCommand[] | null>();
	/** The bridge after `launch` suggested again for the run in `base`, when the hit after it needs attention */
	const suggestBridge = async (base: TProject, run: TSimulationResult, launch: THitResult): Promise<TProjectCommand[] | null> => {
		const gap = findLongGaps(base, launch.laneId).find((item) => item.fromHitId === launch.hitId && item.bridgedBy != null);
		const after = gap == null ? undefined : run.hits.find((hit) => hit.laneId === gap.laneId && hit.hitId === gap.toHitId);
		const bridge = gap == null ? undefined : base.entities.find((item) => item.id === gap.bridgedBy);
		if (gap == null || after == null || bridge == null || !needsFix(base, after)) return null;
		const dot = run.hits.find((hit) => hitKeyOf(hit) === hitKeyOf(launch))?.dot;
		const angle = base.entities.find((item) => item.id === launch.pieceEntityId)?.components.hitLink?.angle;
		const key = `${bridge.id}@${dot?.x.toFixed(4)},${dot?.y.toFixed(4)},${angle?.toFixed(5)}`;
		if (bridges.has(key)) return bridges.get(key) ?? null;
		const commands = await bridgeCommands(base, gap, bridge);
		if (!isCancelled()) bridges.set(key, commands);
		return commands;
	};
	/**
	 * The commands that tilt `target` again for the run in `base`, with its bridge when it launches into one: by
	 * Auto place, or turned by `turn` from its tilt as a user turns a piece by hand. Null when Auto place finds nothing.
	 */
	const replaceStep = async (base: TProject, run: TSimulationResult, target: THitResult, turn?: number): Promise<TProjectCommand[] | null> => {
		// A launch into a bridged gap is tilted for the open gap, as Next placed it before the bridge existed
		const gap = findLongGaps(base, target.laneId).find((item) => item.fromHitId === target.hitId && item.bridgedBy != null);
		let commands: TProjectCommand[];
		if (turn != null) {
			const entity = base.entities.find((item) => item.id === target.pieceEntityId);
			const link = entity?.components.hitLink;
			const type = entity?.components.piece?.type;
			if (entity == null || link == null || type == null || !isMusicalPiece(type)) return null;
			commands = [{ type: 'setComponent', entityId: entity.id, component: { name: 'hitLink', value: { ...link, angle: round4(link.angle + turn) } } }];
		} else {
			const open = gap == null ? base : { ...base, entities: base.entities.filter((item) => item.id !== gap.bridgedBy) };
			const placed = await placeAgain(open, target);
			if (placed == null || isCancelled()) return null;
			commands = replaceCommands(base, placed);
		}
		if (gap == null) return commands;
		const tilted = withCommands(base, commands);
		const bridge = await suggestBridge(tilted, commands.length ? await deps.simulate(tilted) : run, target);
		return [...commands, ...(bridge ?? [])];
	};

	// Problems up to this time are left as they are, per marble, and how many were
	const left = new Map<string, number>();
	const leftCount = new Map<string, number>();
	// Like Re-place's targets, a marble without broken hits is done, even with hits outside its band
	const firstProblem = (base: TProject, run: TSimulationResult, laneId?: string): THitResult | undefined => {
		const open = run.hits.filter((hit) => hit.pieceEntityId != null && (laneId == null || hit.laneId === laneId) && hit.targetTime > (left.get(hit.laneId) ?? -Infinity) + 1e-6);
		const lanes = new Set(open.filter(isBroken).map((hit) => hit.laneId));
		return open.filter((hit) => lanes.has(hit.laneId) && needsFix(base, hit)).sort((a, b) => a.targetTime - b.targetTime)[0];
	};
	/**
	 * Whether `trial` fixes `problem` without setting another marble back. A hit that plays on time but outside its
	 * frame band is fixed only without breaking hits after it.
	 */
	const advances = (base: TProject, trial: TSimulationResult, problem: THitResult): boolean => {
		if ((firstProblem(base, trial, problem.laneId)?.targetTime ?? Infinity) <= problem.targetTime + 1e-6) return false;
		const broken = (hits: THitResult[]): number => brokenHits(hits).filter((hit) => hit.laneId === problem.laneId).length;
		if (!isBroken(problem) && problem.status !== 'drifting' && broken(trial.hits) > broken(latest.hits)) return false;
		for (const lane of base.music.lanes) {
			if (lane.id === problem.laneId) continue;
			const was = firstProblem(current, latest, lane.id)?.targetTime ?? Infinity;
			if ((firstProblem(base, trial, lane.id)?.targetTime ?? Infinity) < was - 1e-6) return false;
		}
		return !newlyBroken(latest.hits, trial.hits).some((hit) => hit.laneId !== problem.laneId);
	};
	/**
	 * Commands that fix `problem`, re-placing from `depth` platforms before the one before it onward; null when none
	 * does. With `turn`, the first of them is turned by hand by that much instead.
	 */
	const rebuild = async (run: THitResult[], index: number, depth: number, problem: THitResult, turn?: number): Promise<TFix | null> => {
		let base = current;
		let trial = latest;
		const commands: TProjectCommand[] = [];
		const start = index - 1 - depth;
		for (let k = start; k < index; k++) {
			const key = hitKeyOf(run[k] ?? problem);
			const target = trial.hits.find((hit) => hitKeyOf(hit) === key);
			if (target == null) return null;
			const step = await replaceStep(base, trial, target, k === start ? turn : undefined);
			if (isCancelled()) return null;
			// The platform just before the problem must take a new tilt; earlier ones may keep theirs. When the first
			// platform of a deeper window keeps its tilt, the rest repeats the shallower try.
			if (step == null && k === index - 1) return null;
			if (k === start && depth > 0 && turn == null && !step?.length) return null;
			if (step == null || !step.length) continue;
			base = withCommands(base, step);
			commands.push(...step);
			trial = await deps.simulate(base);
		}
		return commands.length && advances(base, trial, problem) ? { commands, run: trial } : null;
	};
	const fix = async (problem: THitResult): Promise<TFix | null> => {
		const run = latest.hits.filter((hit) => hit.laneId === problem.laneId && hit.pieceEntityId != null).sort((a, b) => a.targetTime - b.targetTime);
		const index = run.findIndex((hit) => hitKeyOf(hit) === hitKeyOf(problem));
		// A marble's first hit depends on its release alone
		const previous = run[index - 1];
		if (previous == null) return null;
		// Before a long gap the bridge alone may be what no longer fits
		const bridge = await suggestBridge(current, latest, previous);
		if (bridge != null && !isCancelled()) {
			const base = withCommands(current, bridge);
			const trial = await deps.simulate(base);
			if (advances(base, trial, problem)) return { commands: bridge, run: trial };
		}
		for (let depth = 0; depth <= MAX_BACKTRACK && index - 1 - depth >= 0 && !isCancelled(); depth++) {
			const rebuilt = await rebuild(run, index, depth, problem);
			if (rebuilt != null) return rebuilt;
		}
		// Auto place gives the same tilts for the same run, so what a user tries next: turning the platform before
		// the problem, or the one before that, by hand, and placing from there
		for (let depth = 0; depth < TURN_DEPTH && index - 1 - depth >= 0; depth++) {
			for (const degrees of TURNS) {
				if (isCancelled()) return null;
				const rebuilt = await rebuild(run, index, depth, problem, degrees * DEGREE);
				if (rebuilt != null) return rebuilt;
			}
		}
		return null;
	};

	// Platforms first, since the run they make often clears scenery by itself; then Blocked scenery moves clear,
	// and the platforms after it are fitted once more to the run with the piece in it
	for (let pass = 0; pass < 2; pass++) {
		left.clear();
		leftCount.clear();
		while (!isCancelled()) {
			const problem = firstProblem(current, latest);
			if (problem == null) break;
			deps.onProgress?.(Math.max(0, total - brokenHits(latest.hits).length), total, problem.targetTime);
			const fixed = await fix(problem);
			if (isCancelled()) return outcome(true);
			if (fixed != null) {
				if (!(await commit(fixed.commands, true, fixed.run))) return outcome(true);
				continue;
			}
			// Only broken hits count toward giving up on a marble; one outside its band is just left as it is
			const count = (leftCount.get(problem.laneId) ?? 0) + (isBroken(problem) ? 1 : 0);
			leftCount.set(problem.laneId, count);
			left.set(problem.laneId, count >= MAX_LEFT ? Infinity : problem.targetTime);
		}
		if (pass > 0 || isCancelled()) break;
		const scenery = blockedScenery(current, latest);
		for (const piece of scenery) {
			// A bridge the new run passes through is suggested again for its gap, when the new one keeps every hit
			const entity = current.entities.find((item) => item.id === piece.entityId);
			const laneId = entity?.components.hitLink?.laneId;
			const gap = laneId == null ? undefined : findLongGaps(current, laneId).find((item) => item.bridgedBy === piece.entityId);
			const fresh = entity == null || gap == null ? null : await bridgeCommands(current, gap, entity);
			if (isCancelled()) return outcome(true);
			if (fresh != null) {
				const trial = await deps.simulate(withCommands(current, fresh));
				if (isCancelled()) return outcome(true);
				const isPlaying = trial.pieces.find((item) => item.entityId === piece.entityId)?.status !== 'blocked';
				if (isPlaying && !newlyBroken(latest.hits, trial.hits).length) {
					if (!(await commit(fresh, false, trial))) return outcome(true);
					cleared.push(piece.entityId);
					continue;
				}
			}
			const move = moveClear(current, latest, piece.entityId);
			if (move == null) {
				failed++;
				continue;
			}
			// Re-place keeps its promise to fix the run: a move that breaks hits now on time is left to the user,
			// who has Move Clear in the piece's inspector
			const trial = await deps.simulate(withCommands(current, move.commands));
			if (isCancelled()) return outcome(true);
			if (newlyBroken(latest.hits, trial.hits).length > 0) {
				failed++;
				continue;
			}
			if (!(await commit(move.commands, false, trial))) return outcome(true);
			cleared.push(piece.entityId);
		}
		if (!cleared.length) break;
	}
	return outcome(isCancelled());
}

/** Commands that fix a problem, with the run they make */
interface TFix {
	commands: TProjectCommand[];
	run: TSimulationResult;
}

// Platforms Re-place goes back before the one before a problem that it cannot fix
const MAX_BACKTRACK = 3;
// Problems per marble that nothing fixes before Re-place stops working on that marble
const MAX_LEFT = 3;
// Turns by hand in degrees, nearest first, like the fixture builds, of the platform before a problem and the one before it
const TURNS = [3, -3, 6, -6, 9, -9, 12, -12];
const TURN_DEPTH = 2;
const DEGREE = Math.PI / 180;

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

/** `project` with `setComponent` and `upsertEntity` commands applied, for a trial run before a commit */
function withCommands(project: TProject, commands: TProjectCommand[]): TProject {
	let entities = project.entities;
	for (const command of commands) {
		if (command.type === 'upsertEntity') {
			const isNew = !entities.some((entity) => entity.id === command.entity.id);
			entities = isNew ? [...entities, command.entity] : entities.map((entity) => (entity.id === command.entity.id ? command.entity : entity));
		}
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
