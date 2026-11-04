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
import { crossesOtherLanes, openFrontiers } from '@/modules/simulation/assists';
import { resolvedPieceShapes, shapesGap } from '@/modules/simulation/clearance';
import { preflightExport, type TPreflightIssue } from '@/modules/design/export-preflight';

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
	/**
	 * The one label of the command, in the edit's notice, the hit summary's menu and ⌘K: "Re-place 45 Platforms",
	 * "Re-place Platform 7", "Move Release and Re-place 45 Platforms", "Move Windmill 1 Clear",
	 * "Re-place 4 Platforms and Move Windmill 1 Clear"
	 */
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
	const only = broken.length === 1 ? broken[0]?.pieceEntityId : null;
	const replace = platforms > 0 ? replaceLabel(platforms, only == null ? undefined : pieceName(project, only)) : '';
	const move = scenery.length === 0 ? '' : scenery.length <= 2 ? `Move ${joinWords(scenery)} Clear` : `Move ${scenery.length} Pieces Clear`;
	const core = [replace, move].filter(Boolean).join(' and ');
	const label = releases.length > 0 ? `Move Release and ${core}` : core;
	const steps = [
		releases.length > 0 ? `moves the release of ${releases.join(' and ')} to just before its first note` : '',
		platforms > 0 ? `tilts ${platforms === 1 ? 'the broken platform' : `the ${platforms} broken platforms`} again so each lands on time, with the platforms before them when needed` : '',
		scenery.length > 0 ? `moves ${joinWords(scenery)} clear of the run` : ''
	].filter(Boolean);
	const title = steps.length ? `${capitalize(joinWords(steps))}, as one undo step. It keeps no change that adds a problem.` : 'Nothing to re-place';
	return {
		platforms,
		scenery,
		releases,
		label: core === '' ? 'Re-place Broken Platforms' : label,
		title,
		isEmpty: platforms === 0 && scenery.length === 0
	};
}

/** How the run stands after a fix, from the one problem model: the hit summary's label and the problems the fix added */
export interface TFixStanding {
	/** The hit summary's label, such as "108 of 108 hits on time · 3 other problems" */
	label: string;
	/** Hits that still need attention */
	hitProblems: number;
	/** Problems the run did not have before the fix (`addedProblems`) */
	added: TPreflightIssue[];
}

/**
 * The fix result after Re-place, in words.md's form: what changed, then how the run stands, ending with the hit
 * summary's label and the problems the fix added, like Xcode's new issues after a Fix-it. It names every piece it
 * changed besides platforms, and how many of the broken hits are fixed, since a moved release or one new tilt
 * often fixes many platforms at once.
 */
export function replaceResultMessage(
	project: TProject,
	before: THitResult[],
	outcome: Pick<TReplaceOutcome, 'project' | 'result' | 'replaced' | 'moved' | 'cleared' | 'releases'>,
	standing: TFixStanding
): string {
	const releases = outcome.releases.map((laneId) => outcome.project.music.lanes.find((lane) => lane.id === laneId)?.name ?? 'the marble');
	const started = releases.length
		? `${releases.join(' and ')} now ${releases.length === 1 ? 'starts' : 'start'} just before ${releases.length === 1 ? 'its' : 'their'} first note. `
		: '';
	const changes = [
		outcome.replaced > 0 ? `re-placed ${outcome.replaced} ${outcome.replaced === 1 ? 'platform' : 'platforms'}` : '',
		outcome.moved.length > 0 ? `placed ${joinWords(outcome.moved.map((id) => pieceName(outcome.project, id)))} again` : '',
		outcome.cleared.length > 0 ? `moved ${joinWords(outcome.cleared.map((id) => pieceName(project, id)))} clear` : ''
	].filter(Boolean);
	const wasBroken = brokenHits(before).map(hitKeyOf);
	const still = new Set(brokenHits(outcome.result.hits).map(hitKeyOf));
	const fixed = wasBroken.filter((key) => !still.has(key)).length;
	const parts = [...(changes.length ? changes : ['moved the release']), fixedWords(fixed, wasBroken.length)].filter(Boolean);
	// Names inside a part are joined with "and", so a list of three parts takes a serial comma
	const did = capitalize(parts.length > 2 ? `${parts.slice(0, -1).join(', ')}, and ${parts.at(-1) ?? ''}` : parts.join(' and '));
	const added = standing.added.length ? ` · ${standing.added.length} new ${standing.added.length === 1 ? 'problem' : 'problems'}: ${standing.added.map((issue) => issue.title).join('; ')}` : '';
	const advice = standing.hitProblems > 0 ? `. Turn ${standing.hitProblems === 1 ? 'it' : 'them'} by hand or undo the edit.` : '';
	return `${started}${did}: ${standing.label}${added}${advice}`;
}

/** "fixed the broken hit", "fixed both broken hits", "fixed all 38 broken hits" or "fixed 37 of 38 broken hits" */
export function fixedWords(fixed: number, total: number): string {
	if (total === 0) return '';
	if (fixed < total) return `fixed ${fixed} of ${total} broken ${total === 1 ? 'hit' : 'hits'}`;
	if (total === 1) return 'fixed the broken hit';
	if (total === 2) return 'fixed both broken hits';
	return `fixed all ${total} broken hits`;
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
 * Move Clear for a piece that follows a marble and is Blocked or hit by another marble: the smallest nudge of
 * its offset from the marble that clears every marble's run before the piece starts and the other marbles' runs
 * after it, without overlapping another piece. Its tie stays, so it still follows the same marble at the same
 * moment. The earlier run does not depend on the piece, which was left out, so the check on the current result
 * holds after the move; the other marbles' later runs hold while the move does not change them, which callers
 * check with a what-if run (`moveClearWhatIf`). Null when no spot within 40 cm clears.
 */
export function moveClear(project: TProject, result: TSimulationResult, entityId: string): { commands: TProjectCommand[]; distance: number } | null {
	const entity = project.entities.find((item) => item.id === entityId);
	const link = entity?.components.hitLink;
	const resolved = result.pieces.find((piece) => piece.entityId === entityId);
	if (entity == null || link == null || resolved == null) return null;
	const ownMarble = result.marbles.find((track) => track.laneId === link.laneId)?.entityId;
	if (resolved.status !== 'blocked' && !strayHitters(project, result, entityId).length) return null;
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
		// Other marbles' runs stay obstacles while the piece is there; its own marble rides it after it starts
		const isOther = track.entityId !== ownMarble;
		for (const sample of track.samples) {
			if (sample.time > time + 1e-9 && !isOther) break;
			const { x, y } = sample.position;
			if (x < bounds.minX - pad || x > bounds.maxX + pad || y < bounds.minY - pad || y > bounds.maxY + pad) continue;
			near.push({
				x,
				y,
				clear: track.radius + (sample.time < time - TOUCH_WINDOW || isOther ? CLEAR_MARGIN : 0)
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

/** A fix for one piece, checked with a what-if run before it is applied */
export interface TPieceFix {
	/** Null when no change passes the check; `message` then says why and what to do */
	commands: TProjectCommand[] | null;
	/** The edit's notice, or why nothing changed */
	message: string;
	/** The run with the fix applied */
	run?: TSimulationResult;
}

/**
 * The Fix-it of a piece that follows a marble and is Blocked or hit by another marble, checked like the windmill
 * hover's "Breaks no hits": Move Clear nudges scenery off the runs, and a platform another marble hits gets that
 * marble's platform before the hit tilted again by Auto place, which keeps clear of the other lanes. A change is
 * kept only when the what-if run clears the piece, breaks no hit that is on time and adds no problem.
 */
export async function fixPiece(project: TProject, result: TSimulationResult, entityId: string, deps: Pick<TReplaceDeps, 'simulate' | 'autoPlace'>): Promise<TPieceFix> {
	const entity = project.entities.find((item) => item.id === entityId);
	const link = entity?.components.hitLink;
	const type = entity?.components.piece?.type;
	const name = pieceName(project, entityId);
	if (entity == null || link == null || type == null) return { commands: null, message: `${name} follows no marble` };
	const laneName = (laneId: string): string => project.music.lanes.find((lane) => lane.id === laneId)?.name ?? 'the marble';
	const hitters = strayHitters(project, result, entityId);
	const isBlocked = result.pieces.find((piece) => piece.entityId === entityId)?.status === 'blocked';
	const check = async (commands: TProjectCommand[]): Promise<{ run: TSimulationResult; broken: number; added: TPreflightIssue[]; isClear: boolean }> => {
		const next = withCommands(project, commands);
		const run = await deps.simulate(next);
		const added = addedProblems(project, result, next, run);
		const isClear = run.pieces.find((piece) => piece.entityId === entityId)?.status !== 'blocked' && !strayHitters(next, run, entityId).length;
		return { run: { ...run, revision: project.revision }, broken: newlyBroken(result.hits, run.hits).length, added, isClear };
	};
	const refusal = (what: string, broken: number, added: TPreflightIssue[]): string =>
		broken > 0
			? `${what} would break ${broken === 1 ? 'a hit' : `${broken} hits`}, so nothing moved`
			: `${what} would add a problem (${added[0]?.title ?? 'another marble'}), so nothing moved`;

	if (!soundsHit(type, link)) {
		if (!isBlocked && !hitters.length) return { commands: null, message: `${name} is clear of every run` };
		const move = moveClear(project, result, entityId);
		const runs = joinWords([...new Set([link.laneId, ...hitters.map((hitter) => hitter.laneId)])].map(laneName));
		if (move == null) return { commands: null, message: `No spot within 40 cm clears ${name} of ${runs}'s run. Drag it by hand or Detach it.` };
		const what = await check(move.commands);
		if (!what.isClear || what.broken > 0 || what.added.length > 0) {
			return { commands: null, message: !what.isClear ? `Moving ${name} clear changes the run so it is in the way again. Drag it by hand or Detach it.` : `${refusal(`Moving ${name} clear`, what.broken, what.added)}. Drag it by hand or Detach it.` };
		}
		return { commands: move.commands, run: what.run, message: `${name} moved ${Math.max(1, Math.round(move.distance * 100))} cm, clear of ${runs}'s run` };
	}

	// A platform another marble hits: that marble's platform before the hit tilts so it passes clear
	const hitter = hitters[0];
	if (hitter == null) return { commands: null, message: `No other marble hits ${name}` };
	const before = result.hits
		.filter((hit) => hit.laneId === hitter.laneId && hit.pieceEntityId != null && hit.targetTime < hitter.time - 1e-6)
		.sort((a, b) => b.targetTime - a.targetTime)
		.slice(0, 2);
	let refused = '';
	for (const target of before) {
		const platform = project.entities.find((item) => item.id === target.pieceEntityId);
		if (platform == null) continue;
		let placed: TEntity;
		try {
			placed = await deps.autoPlace(project, target, platform);
		} catch {
			continue;
		}
		const commands = replaceCommands(project, placed);
		if (!commands.length) continue;
		const what = await check(commands);
		if (what.isClear && what.broken === 0 && what.added.length === 0) {
			return { commands, run: what.run, message: `Re-placed ${pieceName(project, platform.id)}: ${laneName(hitter.laneId)} now passes clear of ${name}` };
		}
		refused ||= what.isClear ? refusal(`Re-placing ${pieceName(project, platform.id)}`, what.broken, what.added) : '';
	}
	return { commands: null, message: `${refused || `No new tilt of ${laneName(hitter.laneId)}'s platforms before it keeps ${laneName(hitter.laneId)} clear of ${name}`}. Drag it by hand, or move ${laneName(hitter.laneId)}'s platforms.` };
}

/**
 * The other marbles that hit a piece tied to a marble, in the order they first do, as the problem model reports
 * them ("Bass hits Switchback 6 of Melody"): a marble touching another lane's piece outside a note
 */
export function strayHitters(project: TProject, result: TSimulationResult, entityId: string): { marbleEntityId: string; laneId: string; time: number }[] {
	const link = project.entities.find((entity) => entity.id === entityId)?.components.hitLink;
	if (link == null) return [];
	const hitters = new Map<string, { marbleEntityId: string; laneId: string; time: number }>();
	for (const contact of result.contacts) {
		if (contact.otherEntityId !== entityId || contact.time > result.duration || hitters.has(contact.marbleEntityId)) continue;
		const laneId = result.marbles.find((track) => track.entityId === contact.marbleEntityId)?.laneId;
		if (laneId == null || laneId === link.laneId) continue;
		hitters.set(contact.marbleEntityId, { marbleEntityId: contact.marbleEntityId, laneId, time: contact.time });
	}
	return [...hitters.values()].sort((a, b) => a.time - b.time);
}

/** A piece tied to a marble that plays no note, such as a windmill, switchback, rail or tunnel */
function isStrayScenery(project: TProject, entityId: string): boolean {
	const entity = project.entities.find((item) => item.id === entityId);
	const link = entity?.components.hitLink;
	const type = entity?.components.piece?.type;
	return link != null && type != null && !soundsHit(type, link);
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
	/** Switchbacks, rails and tunnels suggested again for their gap */
	moved: string[];
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
 * did. Each try is simulated up to `TRY_HORIZON` past the problem, resuming from the snapshot before its first
 * change, and steps are remembered for the next problem that goes back over the same platforms. A change is kept
 * only when, simulated to the end, the problem moves later, no other marble loses a hit, it crosses no other lane
 * and it adds no problem besides the work still ahead on that marble (`addedProblems`). When the platform
 * before cannot fix it, the arrival there is what fails, so Re-place goes back up to `MAX_BACKTRACK` platforms
 * further and builds forward from there, and then turns one of the two platforms before the problem by hand, as the
 * fixture builds do. A problem nothing fixes is left as it is and Re-place carries on after it, up to `MAX_LEFT`
 * broken hits per marble. Blocked scenery still Blocked after the platforms, and scenery the new run carried into
 * another marble's way, gets a new bridge for its gap or moves clear (Move Clear) when that breaks no hit and adds
 * no problem, and the platforms after it are fitted once more. With `only`, Auto place runs once for each
 * of those platforms.
 */
export async function replaceBroken(project: TProject, result: TSimulationResult, deps: TReplaceDeps, options: TReplaceOptions = {}): Promise<TReplaceOutcome> {
	const { only, before } = options;
	let current = project;
	let latest = result;
	let failed = 0;
	let isFirst = true;
	const changed = new Set<string>();
	const moved = new Set<string>();
	const releases: string[] = [];
	const cleared: string[] = [];
	const isCancelled = (): boolean => deps.isCancelled?.() === true;
	const outcome = (isStopped: boolean): TReplaceOutcome => ({
		project: current,
		result: latest,
		replaced: changed.size,
		moved: [...moved].filter((id) => !cleared.includes(id)),
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
		// Platforms count as re-placed; a switchback, rail or tunnel suggested again is named in the result
		for (const id of isPiece ? new Set(commands.map(commandEntityId)) : []) {
			const type = next.entities.find((entity) => entity.id === id)?.components.piece?.type;
			if (type != null && isMusicalPiece(type)) changed.add(id);
			else if (type != null) moved.add(id);
		}
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
		// A try simulated only up to its horizon is judged on the hits before it
		const end = trial.duration - 1e-6;
		const tried = { ...trial, hits: trial.hits.filter((hit) => hit.targetTime < end) };
		const was = latest.hits.filter((hit) => hit.targetTime < end);
		if ((firstProblem(base, tried, problem.laneId)?.targetTime ?? Infinity) <= problem.targetTime + 1e-6) return false;
		const broken = (hits: THitResult[]): number => brokenHits(hits).filter((hit) => hit.laneId === problem.laneId).length;
		// Broken hits are counted over the whole song only, since a try may break one early and mend many after it
		const isWhole = trial.duration >= current.end - 1e-6;
		if (isWhole && !isBroken(problem) && problem.status !== 'drifting' && broken(tried.hits) > broken(was)) return false;
		for (const lane of base.music.lanes) {
			if (lane.id === problem.laneId) continue;
			const first = firstProblem(current, latest, lane.id)?.targetTime ?? Infinity;
			if ((firstProblem(base, tried, lane.id)?.targetTime ?? Infinity) < Math.min(first, end) - 1e-6) return false;
		}
		return !newlyBroken(was, tried.hits).some((hit) => hit.laneId !== problem.laneId);
	};
	/**
	 * Whether the pieces `commands` change cross another marble's run in `trial` where they did not before:
	 * Auto place's own lane check (`crossesOtherLanes`), from the earliest changed piece's hit to the trial's end
	 */
	const crossesLanes = (base: TProject, trial: TSimulationResult, problem: THitResult, commands: TProjectCommand[]): boolean => {
		const frontiers = openFrontiers(base, latest);
		for (const id of new Set(commands.map(commandEntityId))) {
			const link = base.entities.find((entity) => entity.id === id)?.components.hitLink;
			if (link == null || id === '') continue;
			const from = latest.hits.find((hit) => hit.laneId === link.laneId && hit.hitId === link.hitId)?.targetTime ?? problem.targetTime;
			const until = trial.duration;
			if (crossesOtherLanes(latest, trial, base, link.laneId, id, from, until, frontiers) && !crossesOtherLanes(latest, latest, current, link.laneId, id, from, until, frontiers)) return true;
		}
		return false;
	};
	/**
	 * Keeps a try that fixes `problem` within its horizon only when the whole song agrees: the try is simulated to
	 * the end, from the snapshot at the horizon, and must still fix the problem without adding a problem of
	 * another kind (`addedProblems`), such as another marble hitting one of the moved pieces
	 */
	const keep = async (base: TProject, trial: TSimulationResult, problem: THitResult, commands: TProjectCommand[]): Promise<TFix | null> => {
		if (!advances(base, trial, problem) || crossesLanes(base, trial, problem, commands)) return null;
		const whole = { ...base, end: current.end };
		const run = trial.duration >= current.end - 1e-6 ? trial : await deps.simulate(whole);
		if (isCancelled() || !advances(whole, run, problem)) return null;
		const added = addedProblems(current, latest, whole, run, { laneId: problem.laneId, from: problem.targetTime });
		return added.length ? null : { commands, run };
	};
	/**
	 * Steps already worked out, by the run they start from (its revision and the steps before them in the try) and
	 * their hit. Problems next to each other go back over the same platforms, and a step Auto place chose once
	 * for a run is the same the next time, since the run up to the hit is.
	 */
	const steps = new Map<string, TProjectCommand[] | null>();
	/** The project as Re-place tries it for `problem`: simulated up to `TRY_HORIZON` after it */
	const clipped = (problem: THitResult): TProject => ({ ...current, end: Math.min(current.end, problem.targetTime + TRY_HORIZON) });
	/**
	 * Commands that fix `problem`, re-placing from `depth` platforms before the one before it onward; null when none
	 * does. With `turn`, the first of them is turned by hand by that much instead.
	 */
	const rebuild = async (run: THitResult[], index: number, depth: number, problem: THitResult, turn?: number): Promise<TFix | null> => {
		let base = clipped(problem);
		let trial = latest;
		// Whether `trial` is behind `base`; it is simulated only when a step is not remembered
		let isStale = false;
		const commands: TProjectCommand[] = [];
		const start = index - 1 - depth;
		for (let k = start; k < index; k++) {
			const key = hitKeyOf(run[k] ?? problem);
			const stepTurn = k === start ? turn : undefined;
			const memoKey = `${current.revision}|${key}|${stepTurn ?? ''}|${JSON.stringify(commands)}`;
			let step = steps.get(memoKey);
			if (step === undefined) {
				if (isStale) {
					trial = await deps.simulate(base);
					isStale = false;
				}
				const target = trial.hits.find((hit) => hitKeyOf(hit) === key);
				if (target == null) return null;
				step = await replaceStep(base, trial, target, stepTurn);
				if (isCancelled()) return null;
				steps.set(memoKey, step);
			}
			// The platform just before the problem must take a new tilt; earlier ones may keep theirs. When the first
			// platform of a deeper window keeps its tilt, the rest repeats the shallower try.
			if (step == null && k === index - 1) return null;
			if (k === start && depth > 0 && turn == null && !step?.length) return null;
			if (step == null || !step.length) continue;
			base = withCommands(base, step);
			commands.push(...step);
			isStale = true;
		}
		if (!commands.length) return null;
		return keep(base, isStale ? await deps.simulate(base) : trial, problem, commands);
	};
	const fix = async (problem: THitResult): Promise<TFix | null> => {
		const run = latest.hits.filter((hit) => hit.laneId === problem.laneId && hit.pieceEntityId != null).sort((a, b) => a.targetTime - b.targetTime);
		const index = run.findIndex((hit) => hitKeyOf(hit) === hitKeyOf(problem));
		// A marble's first hit depends on its release alone
		const previous = run[index - 1];
		if (previous == null) return null;
		// Before a long gap the bridge alone may be what no longer fits
		const bridge = await suggestBridge(clipped(problem), latest, previous);
		if (bridge != null && !isCancelled()) {
			const base = withCommands(clipped(problem), bridge);
			const kept = await keep(base, await deps.simulate(base), problem, bridge);
			if (kept != null) return kept;
		}
		for (let depth = 0; depth <= MAX_BACKTRACK && index - 1 - depth >= 0 && !isCancelled(); depth++) {
			const rebuilt = await rebuild(run, index, depth, problem);
			if (rebuilt != null) return rebuilt;
		}
		// A hit that plays on time outside its marble's part of the frame is not turned by hand: turns rarely bring
		// it in, and they cost most of the time
		if (!isBroken(problem) && problem.status !== 'drifting') return null;
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
		// Blocked scenery, and scenery the new run carries into another marble's way that was clear before
		const strays = addedProblems(project, result, current, latest)
			.filter((issue) => issue.kind === 'contact')
			.flatMap((issue) => issue.target?.ids ?? [])
			.filter((id) => isStrayScenery(current, id));
		const pieces = [...new Set([...blockedScenery(current, latest).map((piece) => piece.entityId), ...strays])];
		for (const entityId of pieces) {
			// A bridge the new run passes through is suggested again for its gap, when the new one keeps every hit
			const entity = current.entities.find((item) => item.id === entityId);
			const laneId = entity?.components.hitLink?.laneId;
			const gap = laneId == null ? undefined : findLongGaps(current, laneId).find((item) => item.bridgedBy === entityId);
			const fresh = entity == null || gap == null ? null : await bridgeCommands(current, gap, entity);
			if (isCancelled()) return outcome(true);
			// Re-place keeps its promise to fix the run: a change that breaks hits now on time or adds a problem is left
			// to the user, who has Move Clear in the piece's inspector
			const isClear = (base: TProject, trial: TSimulationResult): boolean =>
				trial.pieces.find((item) => item.entityId === entityId)?.status !== 'blocked' &&
				!strayHitters(base, trial, entityId).length &&
				!newlyBroken(latest.hits, trial.hits).length &&
				!addedProblems(current, latest, base, trial).length;
			if (fresh != null) {
				const base = withCommands(current, fresh);
				const trial = await deps.simulate(base);
				if (isCancelled()) return outcome(true);
				if (isClear(base, trial)) {
					if (!(await commit(fresh, false, trial))) return outcome(true);
					cleared.push(entityId);
					continue;
				}
			}
			const move = moveClear(current, latest, entityId);
			const base = move == null ? null : withCommands(current, move.commands);
			const trial = base == null ? null : await deps.simulate(base);
			if (isCancelled()) return outcome(true);
			if (move == null || base == null || trial == null || !isClear(base, trial)) {
				failed++;
				continue;
			}
			if (!(await commit(move.commands, false, trial))) return outcome(true);
			cleared.push(entityId);
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
// Seconds after a problem that Re-place simulates each try; one that fixes it is then simulated to the end
const TRY_HORIZON = 3;
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

function commandEntityId(command: TProjectCommand): string {
	return command.type === 'upsertEntity' ? command.entity.id : command.type === 'setComponent' ? command.entityId : '';
}

/**
 * Problems of the one problem model (`preflightExport`) that `after` has and `before` did not, which a fix must
 * not add: another marble's hits, framing or pace, Blocked scenery, and contacts such as "Bass hits Switchback 6
 * of Melody". With `working`, that marble's problems from `from` on (its hits, framing, Blocked scenery and its
 * pieces another marble hits) are left out, since Re-place works through them next.
 */
export function addedProblems(
	beforeProject: TProject,
	before: TSimulationResult,
	afterProject: TProject,
	after: TSimulationResult,
	working?: { laneId: string; from: number }
): TPreflightIssue[] {
	const warnings = (project: TProject, result: TSimulationResult): TPreflightIssue[] =>
		preflightExport(project, { ...result, revision: project.revision }).issues.filter((issue) => issue.severity === 'warning');
	const had = new Set(warnings(beforeProject, before).map((issue) => issue.id));
	return warnings(afterProject, after).filter((issue) => {
		if (had.has(issue.id)) return false;
		if (working == null || issue.laneId !== working.laneId) return true;
		// The marble being re-placed: its later hits, framing, Blocked scenery and pieces another marble hits are the
		// work still ahead, since its later platforms move them again; what is left at the end counts
		return (issue.time ?? Infinity) < working.from - 1e-6;
	});
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
