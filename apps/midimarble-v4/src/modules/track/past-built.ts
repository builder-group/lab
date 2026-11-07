import { hitOwners } from '@/modules/building';
import type { TProject, TVec2 } from '@/modules/project';
import { bandAlongGuide, type TSimulationResult } from '@/modules/simulation';
import type { TBarTarget } from './bar';

/** How fast a built run comes down, in meters per second, when nothing built says it yet: about Jingle Bells' at Gravity 0.25 */
const DEFAULT_PACE = 0.15;

/** The shortest stretch of built run whose pace is read from it, in seconds */
const MIN_PACE_SPAN = 0.25;

/** Where a note past the built ones would be, and the last built piece the wall shows with it */
export interface TPastBuiltMark {
	/** On the guide line, as far below where building stands as the built run's pace carries it by the note's time */
	point: TVec2;
	/** "Note 31 · build up to here", "Rest · build up to here" */
	words: string;
	/** The last piece built before it, or null when nothing is */
	lastPieceId: string | null;
}

/**
 * The wall's mark for a note or rest past what's built. The marble never gets there, so there is no dot: the mark stands
 * on the guide line where the run would be if it went on at the pace of what's built, and says what the bar offers
 */
export function pastBuiltMark(project: TProject, result: TSimulationResult | null, target: TBarTarget): TPastBuiltMark | null {
	if (target.kind === 'notes' || target.stage !== 'pastBuilt') return null;
	const marble = project.marbles.find((item) => item.id === target.marbleId);
	if (marble == null) return null;
	const time = target.kind === 'note' ? target.time : target.gap.from;
	const owners = hitOwners(project, marble.id);
	const dots = new Map((result?.hits ?? []).filter((hit) => hit.marbleId === marble.id && hit.dot != null).map((hit) => [hit.hitId, hit.dot as TVec2]));
	const built = marble.hits.filter((hit) => hit.time < time && owners.has(hit.id) && dots.has(hit.id)).at(-1);
	// The first open note is where the marble really is next, falling from the last piece, so the mark goes on from there
	const frontier = marble.hits.find((hit) => !owners.has(hit.id));
	const next = frontier != null && frontier.time < time && dots.has(frontier.id) ? frontier : built;
	const release = { time: marble.start.time, point: marble.start.position };
	const anchor = next != null ? { time: next.time, point: dots.get(next.id) as TVec2 } : release;
	const span = anchor.time - release.time;
	const pace = next != null && span >= MIN_PACE_SPAN ? Math.max(0, (release.point.y - anchor.point.y) / span) || DEFAULT_PACE : DEFAULT_PACE;
	const y = anchor.point.y - pace * Math.max(0, time - anchor.time);
	const words = target.kind === 'note' ? `Note ${target.number} · build up to here` : 'Rest · build up to here';
	return { point: { x: bandAlongGuide(project, marble.id)(y).centerX, y }, words, lastPieceId: built != null ? (owners.get(built.id)?.id ?? null) : null };
}
