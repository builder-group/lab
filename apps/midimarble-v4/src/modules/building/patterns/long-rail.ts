import { type THit, type TPiece, type TProject, tieOf } from '@/modules/project';
import { hasRide, soundsHit, startRailOf, type TSimulator } from '@/modules/simulation';
import type { TPatternDefinition, TPatternFit, TPatternInput, TPatternWorld, THitVerdict } from './contract';
import { fitLongRail, HOLD_LIMIT } from './fit-rail';
import { exitAt, verdictsFor } from './verdicts';
import { formatSeconds, wordsForHitTime } from './words';

/** The rail there now, when it already holds the marble through this silence and the note after it plays on time */
export function railHolding(sim: TSimulator, project: TProject, marbleId: string, hits: readonly THit[]): TPiece | null {
	const [previous, to] = hits.length === 1 ? [null, hits[0]] : hits;
	if (to == null) return null;
	const rail = previous == null ? startRailOf(project, marbleId) : project.track.pieces.find((piece) => {
		const tie = tieOf(piece);
		return tie != null && tie.marbleId === marbleId && tie.hitId === previous.id && !soundsHit(piece.type, tie) && hasRide(piece.type);
	});
	if (rail == null) return null;
	const played = sim.simulate({ ...project, length: to.time + 0.02 }).hits.find((hit) => hit.marbleId === marbleId && hit.hitId === to.id);
	return played?.status === 'onTime' ? rail : null;
}

/** Fills a silence with one rail whose shape is solved so the marble leaves it in time for the next note */
function fitRailPattern(input: TPatternInput, world: TPatternWorld): TPatternFit {
	const { project, marbleId, sim } = world;
	const marble = project.marbles.find((item) => item.id === marbleId);
	// One hit is the marble's first note: the rail opens the track, from the marble's release
	const [previous, to] = input.hits.length === 1 ? [null, input.hits[0]] : input.hits;
	const startTime = previous?.time ?? marble?.start.time;
	const nothing = (said: THitVerdict): TPatternFit => ({ pieces: [], exit: null, verdicts: verdictsFor(input.hits, [said]), ending: null, notes: [], project, width: input.settings.width, drop: null, sims: 0, tries: 0 });
	if (startTime == null || to == null) return nothing({ hitId: input.hits[0]?.id ?? '', fits: false, words: 'A Curved Rail ends at a note, and starts at the note before it or at the marble’s release.' });
	const held = railHolding(sim, project, marbleId, input.hits);
	if (held != null) return { pieces: [held], exit: exitAt(sim.simulate({ ...project, length: to.time + 0.02 }), marbleId, to.time), verdicts: verdictsFor(input.hits, []), ending: null, notes: [], project, width: input.settings.width, drop: null, sims: 1, tries: 0 };
	const hitId = previous?.id ?? to.id;
	const gap = to.time - startTime;
	let tries = 0;
	const { fit, why } = fitLongRail(sim, project, marbleId, { hitId: previous?.id ?? null, time: startTime }, to.id, {
		onTry: () => {
			tries++;
			world.onProgress?.(Math.min(0.95, tries / 80));
		}
	});
	if (fit == null) return { ...nothing({ hitId, fits: false, words: `No rail holds the marble for ${formatSeconds(gap)} here${why != null ? `: ${why}` : ''}.` }), sims: tries };
	const said: THitVerdict[] = [];
	if (Math.abs(fit.holdErr) > HOLD_LIMIT) said.push({ hitId, fits: false, words: `The rail lets go ${formatSeconds(Math.abs(fit.holdErr))} ${fit.holdErr > 0 ? 'late' : 'early'} for the note at ${wordsForHitTime(to.time)}.` });
	if (fit.isTouching) said.push({ hitId, fits: false, words: `The rail touches a piece beside it at ${wordsForHitTime(startTime)}.` });
	return {
		pieces: [fit.piece],
		exit: exitAt(sim.simulate({ ...fit.project, length: to.time + 0.02 }), marbleId, to.time),
		verdicts: verdictsFor(input.hits, said),
		ending: null,
		notes: [],
		project: fit.project,
		width: fit.width,
		drop: null,
		sims: fit.sims,
		tries: 1
	};
}

export const longRail: TPatternDefinition = {
	label: 'Curved Rail',
	title: 'A rail that holds the marble through the silence and lets go in time for the next note',
	takes: 'silence',
	defaults: { width: 0.14, bounce: 0.5 },
	widthRange: null,
	drop: null,
	glyph: { marks: ['M8 8 C 16 8, 30 12, 40 16 C 44 18, 44 22, 38 23 C 30 25, 20 25, 14 28'], markWidth: 1.5, marble: { x: 8, y: 5 } },
	fit: fitRailPattern
};
