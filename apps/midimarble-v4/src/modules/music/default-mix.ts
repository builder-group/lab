import type { TMarble, TProject } from '@/modules/project';
import { backingVoices, renderMarbles, soundingMarbles, type TBackingVoice, type TRenderMarblesOptions, type TStereoAudio } from './synthesize';

// The default balance of a song's parts: phones reproduce little under 200 Hz and marble notes blur together there, so the
// melody sits on top. Nobody chooses this; a part with its own Level plays at that instead.

/** Where the other parts sit against the melody, in dB */
export const UNDER_MELODY = -10;
/** The other parts lose what's under this, in Hz: their energy there is what phones can't play and what blurs the melody */
export const LOW_CUT = 150;
/** What a person can choose for a part's Level, in dB */
export const LEVEL_CHOICES = [0, -3, -6, -10, -15, -20] as const;

const BUTTERWORTH_Q = Math.SQRT1_2;

/** The melody: of the marbles that sound, the one whose notes sit highest, by their median pitch, the first on a tie. Null when no marble sounds. */
export function melodyMarbleId(project: Pick<TProject, 'songs' | 'marbles'>): string | null {
	let melody: string | null = null;
	let highest = -Infinity;
	for (const marble of soundingMarbles(project)) {
		const pitches = marble.hits.flatMap((hit) => (hit.pitch != null ? [hit.pitch] : [])).sort((a, b) => a - b);
		if (!pitches.length) continue;
		const median = ((pitches[Math.floor((pitches.length - 1) / 2)] ?? 0) + (pitches[Math.ceil((pitches.length - 1) / 2)] ?? 0)) / 2;
		if (median > highest) {
			highest = median;
			melody = marble.id;
		}
	}
	return melody;
}

/** How a part plays: its gain in dB, and whether it loses what's under `LOW_CUT` */
export interface TPartLevel {
	gain: number;
	isLowCut: boolean;
}

const AS_IT_IS: TPartLevel = { gain: 0, isLowCut: false };
const UNDER: TPartLevel = { gain: UNDER_MELODY, isLowCut: true };

/** A marble's or Backing's level: its own when a person set one; the melody or a part with no melody to sit under as it is; the rest under the melody */
export function partLevel(level: number | undefined, id: string | null, melodyId: string | null): TPartLevel {
	if (level != null) return { gain: level, isLowCut: false };
	return melodyId == null || id === melodyId ? AS_IT_IS : UNDER;
}

/** The Level menu's automatic row, which says what automatic means for this part */
export function autoLevelLabel(id: string | null, melodyId: string | null): string {
	if (melodyId == null) return 'Auto';
	return id === melodyId ? 'Auto · Melody' : `Auto · ${formatLevel(UNDER_MELODY)}`;
}

export function formatLevel(level: number): string {
	return `${String(level).replace('-', '−')} dB`;
}

/**
 * Marbles and Backing rendered part by part at their levels and mixed. `melodyId` comes from the whole project: muting or
 * soloing a part must not change who the melody is, so a part heard alone is as it is in the mix.
 */
export function renderMix(marbles: TMarble[], backing: TBackingVoice[], melodyId: string | null, options: Omit<TRenderMarblesOptions, 'backing'>): TStereoAudio {
	const groups = new Map<string, TPartLevel & { marbles: TMarble[]; backing: TBackingVoice[] }>();
	const groupOf = (level: TPartLevel): TPartLevel & { marbles: TMarble[]; backing: TBackingVoice[] } => {
		const key = `${level.gain}:${level.isLowCut}`;
		const group = groups.get(key) ?? { ...level, marbles: [], backing: [] };
		groups.set(key, group);
		return group;
	};
	for (const marble of marbles) if (marble.hits.length > 0) groupOf(partLevel(marble.level, marble.id, melodyId)).marbles.push(marble);
	for (const voice of backing) groupOf(partLevel(voice.level, null, melodyId)).backing.push(voice);

	const length = Math.max(1, Math.ceil(options.duration * options.sampleRate));
	const mix: TStereoAudio = { sampleRate: options.sampleRate, left: new Float32Array(length), right: new Float32Array(length) };
	for (const group of groups.values()) {
		const part = renderMarbles(group.marbles, { ...options, backing: group.backing });
		if (group.isLowCut) {
			highPass(part.left, LOW_CUT, options.sampleRate);
			highPass(part.right, LOW_CUT, options.sampleRate);
		}
		const gain = 10 ** (group.gain / 20);
		for (let index = 0; index < length; index++) {
			mix.left[index] = (mix.left[index] ?? 0) + (part.left[index] ?? 0) * gain;
			mix.right[index] = (mix.right[index] ?? 0) + (part.right[index] ?? 0) * gain;
		}
	}
	return mix;
}

/** The levels a soundtrack depends on, for its signature */
export function levelSignature(project: Pick<TProject, 'songs' | 'marbles'>, melodyId: string | null): unknown {
	return { melodyId, marbles: project.marbles.map((marble) => marble.level ?? null), backing: backingVoices(project).map((voice) => voice.level ?? null) };
}

/** A second-order Butterworth high-pass, in place */
function highPass(channel: Float32Array, frequency: number, sampleRate: number): void {
	const omega = (2 * Math.PI * frequency) / sampleRate;
	const alpha = Math.sin(omega) / (2 * BUTTERWORTH_Q);
	const cos = Math.cos(omega);
	const a0 = 1 + alpha;
	const b0 = (1 + cos) / 2 / a0;
	const b1 = -(1 + cos) / a0;
	const a1 = (-2 * cos) / a0;
	const a2 = (1 - alpha) / a0;
	let z1 = 0;
	let z2 = 0;
	for (let index = 0; index < channel.length; index++) {
		const value = channel[index] ?? 0;
		const out = b0 * value + z1;
		z1 = b1 * value - a1 * out + z2;
		z2 = b0 * value - a2 * out;
		channel[index] = out;
	}
}
