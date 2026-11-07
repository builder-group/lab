import type { TPatternDefinition, TPatternFit, TPatternInput, TPatternWorld, THitVerdict } from './contract';
import { createSwitchbackForGap } from '../gap-pieces';
import { railHolding } from './long-rail';
import { exitAt, verdictsFor } from './verdicts';
import { formatSeconds } from './words';

/**
 * Fills a silence with one Rail in the Switchback layout, the gap search Build uses: its turns hold the marble through
 * the silence and it drops out near the pace for the next note. As a Pattern it stands in the strip and in Layers as
 * a Curved Rail does, and Flatten makes it a plain Rail.
 */
function fitSwitchbackPattern(input: TPatternInput, world: TPatternWorld): TPatternFit {
	const { project, marbleId, sim } = world;
	const [previous, to] = input.hits.length === 1 ? [null, input.hits[0]] : input.hits;
	const nothing = (said: THitVerdict, sims = 0): TPatternFit => ({ pieces: [], exit: null, verdicts: verdictsFor(input.hits, [said]), ending: null, notes: [], project, width: input.settings.width, drop: null, sims, tries: 0 });
	if (previous == null || to == null) return nothing({ hitId: input.hits[0]?.id ?? '', fits: false, words: 'A Switchback starts at the note before a rest: from the release a Curved Rail opens the track.' });
	const held = railHolding(sim, project, marbleId, input.hits);
	if (held != null) return { pieces: [held], exit: exitAt(sim.simulate({ ...project, length: to.time + 0.02 }), marbleId, to.time), verdicts: verdictsFor(input.hits, []), ending: null, notes: [], project, width: input.settings.width, drop: null, sims: 1, tries: 0 };
	world.onProgress?.(0.1);
	const [isOk, error, found] = createSwitchbackForGap(project, sim.simulate(project), marbleId, previous.id, to.id, { simulate: (trial) => sim.simulate(trial) });
	if (!isOk) return nothing({ hitId: previous.id, fits: false, words: `No Switchback holds the marble for ${formatSeconds(to.time - previous.time)} here: ${error.message.charAt(0).toLowerCase()}${error.message.slice(1).replace(/\.$/, '')}.` });
	const placed = { ...project, track: { ...project.track, pieces: [...project.track.pieces, found.piece] } };
	return { pieces: [found.piece], exit: exitAt(sim.simulate({ ...placed, length: to.time + 0.02 }), marbleId, to.time), verdicts: verdictsFor(input.hits, []), ending: null, notes: [], project: placed, width: input.settings.width, drop: null, sims: 0, tries: 1 };
}

export const switchback: TPatternDefinition = {
	label: 'Switchback',
	title: 'A rail that turns back and forth through the silence and drops the marble in time for the next note',
	takes: 'silence',
	defaults: { width: 0.14, bounce: 0.5 },
	widthRange: null,
	drop: null,
	glyph: { marks: ['M8 8 L 40 13 L 12 19 L 40 25'], markWidth: 1.5, marble: { x: 8, y: 5 } },
	fit: fitSwitchbackPattern
};
