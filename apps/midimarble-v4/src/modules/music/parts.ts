import { BACKING_ID, type TProject, type TProjectCommand } from '@/modules/project';
import { DEFAULT_BACKING_INSTRUMENT } from './synthesize';

/** Backing notes are gray: heard, but no marble plays them */
export const BACKING_COLOR = '#8e8e93';

/** The one mute and solo of a recording, which cannot be split into marbles */
export const SONG_MIX_ID = 'song';

/** Muted and soloed Parts, or `SONG_MIX_ID` for a recording, like the M and S of a Logic track. View state, not saved. */
export interface TSongMix {
	muted: string[];
	solo: string[];
}

const MIDDLE_C = 60;

export const EMPTY_MIX: TSongMix = { muted: [], solo: [] };

/** A slice of a MIDI Song: the notes one marble plays, or Backing, with the General MIDI program they sound with */
export interface TPart {
	// The marble's ID, or `BACKING_ID`
	id: string;
	name: string;
	color: string;
	instrument: number;
	noteCount: number;
	// Lowest-time pitch, played when the Sound changes
	firstPitch: number;
}

/** The project has a Song: a song file or Backing notes. Without one a project opens and plays silently. */
export function hasSong(project: TProject): boolean {
	return project.music.sources.length > 0 || project.music.backing.length > 0;
}

export function isAudioSong(project: TProject): boolean {
	return project.music.sources.some((source) => source.kind === 'audio');
}

/** Whether notes are synthesized: a Song without a recording, since a recording already contains the music */
export function soundsNotes(project: TProject): boolean {
	return hasSong(project) && !isAudioSong(project);
}

/**
 * The Parts of a MIDI Song: one per marble that plays notes, in track order, then Backing when it has notes. A
 * marble with only tapped hits plays no notes, so it has no Part. A recording and a project without a Song have none.
 */
export function songParts(project: TProject): TPart[] {
	if (!soundsNotes(project)) return [];
	const owners = [
		...project.music.marbles,
		{ id: BACKING_ID, name: 'Backing', color: BACKING_COLOR, instrument: project.music.backingInstrument ?? DEFAULT_BACKING_INSTRUMENT, hits: project.music.backing }
	];
	return owners.flatMap((owner) => {
		const notes = owner.hits.flatMap((hit) => (hit.pitch == null ? [] : [{ time: hit.time, pitch: hit.pitch }]));
		if (!notes.length) return [];
		const first = notes.reduce<(typeof notes)[number] | undefined>((earliest, note) => (earliest == null || note.time < earliest.time ? note : earliest), undefined);
		return [{ id: owner.id, name: owner.name, color: owner.color, instrument: owner.instrument, noteCount: notes.length, firstPitch: first?.pitch ?? MIDDLE_C }];
	});
}

/** Whether a Part sounds: soloed Parts win over everything, otherwise every Part that is not muted */
export function isPartAudible(mix: TSongMix, partId: string): boolean {
	return mix.solo.length > 0 ? mix.solo.includes(partId) : !mix.muted.includes(partId);
}

/**
 * The mix limited to what the project has: a Part that lost its last note can no longer be unsoloed, so it stops
 * counting instead of silencing the whole Song
 */
export function currentMix(project: TProject, mix: TSongMix): TSongMix {
	if (!mix.muted.length && !mix.solo.length) return mix;
	const ids = new Set(isAudioSong(project) ? [SONG_MIX_ID] : songParts(project).map((part) => part.id));
	return { muted: mix.muted.filter((id) => ids.has(id)), solo: mix.solo.filter((id) => ids.has(id)) };
}

/**
 * The project as it sounds with this mix. Soloing Bass leaves the slice Bass plays. A muted recording has no audio
 * source and no notes left, which renders as silence.
 */
export function audibleProject(project: TProject, mix: TSongMix): TProject {
	const current = currentMix(project, mix);
	if (!current.muted.length && !current.solo.length) return project;
	const { music } = project;
	if (isAudioSong(project)) {
		if (isPartAudible(current, SONG_MIX_ID)) return project;
		return { ...project, music: { ...music, sources: music.sources.filter((source) => source.kind !== 'audio'), marbles: [], backing: [] } };
	}
	return {
		...project,
		music: {
			...music,
			marbles: music.marbles.filter((marble) => isPartAudible(current, marble.id)),
			backing: isPartAudible(current, BACKING_ID) ? music.backing : []
		}
	};
}

/**
 * The project as the film's soundtrack hears it: muted Parts stay out, so what is muted while exporting is what the
 * film leaves out, and the export sheet says so. Solo is for listening while editing and never shapes the film.
 */
export function soundtrackProject(project: TProject, mix: TSongMix): TProject {
	return audibleProject(project, { muted: mix.muted, solo: [] });
}

/** The quiet line in the export sheet while the mix changes the film's soundtrack; null when nothing is muted */
export function mutedSoundtrackNote(project: TProject, mix: TSongMix): string | null {
	const { muted } = currentMix(project, mix);
	if (!muted.length) return null;
	if (isAudioSong(project)) return 'The Song is muted, so the film has no sound.';
	const names = songParts(project)
		.filter((part) => muted.includes(part.id))
		.map((part) => part.name);
	return `${joinNames(names)} ${names.length === 1 ? 'is' : 'are'} muted and left out of the film's sound.`;
}

/** What the mix does, for the Song row's subtitle: "Solo Bass", "Bass, Backing muted"; null with everything on */
export function mixLabel(project: TProject, mix: TSongMix): string | null {
	const { muted, solo } = currentMix(project, mix);
	if (isAudioSong(project)) return solo.length > 0 ? 'Solo' : muted.length > 0 ? 'Muted' : null;
	const named = (ids: string[]): string[] =>
		songParts(project)
			.filter((part) => ids.includes(part.id))
			.map((part) => part.name);
	if (solo.length > 0) return `Solo ${named(solo).join(', ')}`;
	return muted.length > 0 ? `${named(muted).join(', ')} muted` : null;
}

/** The edit that gives a Part another Sound */
export function setPartSoundCommands(project: TProject, partId: string, instrument: number): TProjectCommand[] {
	if (partId === BACKING_ID) return [{ type: 'setBackingInstrument', instrument }];
	const marble = project.music.marbles.find((item) => item.id === partId);
	return marble == null ? [] : [{ type: 'upsertLane', marble: { ...marble, instrument } }];
}

function joinNames(names: string[]): string {
	if (names.length < 2) return names.join('');
	return `${names.slice(0, -1).join(', ')} and ${names.at(-1) ?? ''}`;
}
