import { melodyMarbleId } from '@/modules/music';
import { filmStartOf, type TProject } from '@/modules/project';
import { decorItem, decorList } from '@/modules/scene';
import type { TSimulationResult } from '@/modules/simulation';
import type { TCameraTrack } from './follow-camera';
import { marbleFrameShare, marblePosition, projectToFrame } from './framing';

// What a viewer's first frame holds, in numbers anyone can check on the still. Measurable facts only, and never taste: each
// one is a note a person can ignore.

/** The marble's width as a share of the frame's width that still reads on a phone; top shorts show 6.5 to 8 % */
export const MARBLE_SHARE = 0.06;
/** Pieces a first frame shows, so it reads as a track rather than a marble on a wall */
export const OPENING_PIECES_IN_FRAME = 6;
/** A song that strikes fewer pieces than `OPENING_PIECES_IN_FRAME` within this many seconds truly begins bare */
const BEGINS_BARE_WITHIN = 3;
/** YouTube's title, buttons and caption cover this share of the frame's bottom */
const FRAME_UI_BOTTOM = 0.2;
/** A round Decor item within this share of the frame's width of the marble can pass for it */
const LOOK_ALIKE_NEAR = 0.15;
/** Round Decor smaller than this share of the marble doesn't pass for it */
const LOOK_ALIKE_SIZE = 0.5;

export interface TOpeningFrame {
	time: number;
	/** The marble a viewer should find: the melody, or else the first marble that has hits */
	heroName: string | null;
	/** That marble's width as a share of the frame's width, 0 when it isn't in frame */
	heroShare: number;
	lookAlike: string | null;
	piecesInFrame: number;
	beginsBare: boolean;
	/** What vital sits in the bottom of the frame: a marble's name, "The first piece" or a title's name */
	underButtons: string[];
}

/** The first frame by the camera the film bakes. Null without a marble that has hits */
export function measureOpeningFrame(project: TProject, result: TSimulationResult, track: TCameraTrack): TOpeningFrame | null {
	const heroId = melodyMarbleId(project) ?? project.marbles.find((marble) => marble.hits.length > 0)?.id;
	const hero = project.marbles.find((marble) => marble.id === heroId);
	const heroTrack = result.marbles.find((marble) => marble.marbleId === heroId);
	if (hero == null || heroTrack == null) return null;
	const time = filmStartOf(project);
	const frame = Math.min(track.frameCount - 1, Math.round(time * track.fps));
	const inFrame = ([u, v]: [number, number]): boolean => u >= 0 && u <= 1 && v >= 0 && v <= 1;

	const heroPoint = marblePosition(heroTrack, time);
	const heroAt = heroPoint != null ? projectToFrame(track, frame, heroPoint.x, heroPoint.y) : null;
	const isHeroShown = heroAt != null && inFrame(heroAt);
	const heroShare = isHeroShown && heroPoint != null ? marbleFrameShare(track, frame, heroPoint, hero.radius) : 0;

	const aspect = project.format.width / project.format.height;
	const lookAlike = isHeroShown
		? decorList(project.film).find((decor) => {
				const item = decorItem(decor.source);
				if (item?.round !== true || decor.hidden === true || time < (decor.in ?? 0) || time >= (decor.out ?? Infinity)) return false;
				if (item.halfWidth * decor.scale < hero.radius * LOOK_ALIKE_SIZE) return false;
				const at = projectToFrame(track, frame, decor.position.x, decor.position.y, 0);
				return inFrame(at) && Math.hypot(at[0] - heroAt[0], (at[1] - heroAt[1]) / aspect) < LOOK_ALIKE_NEAR;
			})
		: undefined;

	const piecesInFrame = result.pieces.filter((piece) => inFrame(projectToFrame(track, frame, piece.position.x, piece.position.y, 0))).length;
	const struckSoon = new Set(result.hits.filter((hit) => hit.pieceId != null && hit.targetTime <= time + BEGINS_BARE_WITHIN).map((hit) => hit.pieceId));

	const underButtons: string[] = [];
	for (const marble of project.marbles) {
		const track_ = result.marbles.find((item) => item.marbleId === marble.id);
		const point = track_ != null && marble.hits.length > 0 ? marblePosition(track_, time) : null;
		if (point != null && isUnderButtons(projectToFrame(track, frame, point.x, point.y))) underButtons.push(marble.name);
	}
	const firstHit = result.hits.reduce<(typeof result.hits)[number] | null>((first, hit) => (hit.dot != null && (first == null || hit.targetTime < first.targetTime) ? hit : first), null);
	if (firstHit?.dot != null && isUnderButtons(projectToFrame(track, frame, firstHit.dot.x, firstHit.dot.y, 0))) underButtons.push('The first piece');
	for (const title of project.film.titles) {
		if ((title.style != null && title.style !== 'wall') || time < (title.in ?? 0) || time >= (title.out ?? Infinity)) continue;
		if (isUnderButtons(projectToFrame(track, frame, title.position.x, title.position.y, 0))) underButtons.push(title.name ?? `“${title.text.split('\n')[0]}”`);
	}

	return { time, heroName: hero.name, heroShare, lookAlike: lookAlike?.name ?? null, piecesInFrame, beginsBare: struckSoon.size < OPENING_PIECES_IN_FRAME, underButtons };
}

function isUnderButtons([u, v]: [number, number]): boolean {
	return u >= 0 && u <= 1 && v >= 0 && v < FRAME_UI_BOTTOM;
}

/** The facts that fall short, each in plain words; empty when the frame holds up */
export function openingFrameNotes(opening: TOpeningFrame): string[] {
	const notes: string[] = [];
	const name = opening.heroName ?? 'The marble';
	if (opening.heroShare === 0) notes.push(`${name} isn't in the first frame.`);
	else if (opening.heroShare < MARBLE_SHARE) notes.push(`${name} is ${(opening.heroShare * 100).toFixed(1)} % of the frame's width, and about ${Math.round(MARBLE_SHARE * 100)} % reads on a phone.`);
	if (opening.lookAlike != null) notes.push(`${opening.lookAlike} is round and close enough to ${name} to pass for it.`);
	if (opening.piecesInFrame < OPENING_PIECES_IN_FRAME && !opening.beginsBare) notes.push(`${opening.piecesInFrame} ${opening.piecesInFrame === 1 ? 'piece is' : 'pieces are'} in the first frame, and ${OPENING_PIECES_IN_FRAME} or more show a track at once.`);
	for (const item of opening.underButtons) notes.push(`${item} is in the bottom fifth, where YouTube's buttons cover it.`);
	return notes;
}
