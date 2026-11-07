import { createState } from 'feature-state';
import { host, type THostPickedFile } from '@/environment';
import { moveSongCommands } from '@/modules/building';
import { computePeaks, createImportCommands, IMPORT_RELEASE_LEAD, decodeAudioFile, detectOnsets, instruments, missingRecordings, mixToMono, parseMidiFile, marbleNamesFromTracks, proposeMarbles, type TMidiFile, type TMidiNote, type TProposeMarblesOptions } from '@/modules/music';
import { createId, earliestSongStart, formatTime, shownSongs, type TProject, type TSong, toSongKey } from '@/modules/project';
import { deleteSongCommands, deleteSongNotice, deleteSongQuestion } from './song-layer';
import type { StudioCx } from './StudioCx';

// A song's first note lands here, so the marble that plays it is released at 0: the film's first frame is 0 on the timeline
export const IMPORT_START = IMPORT_RELEASE_LEAD;
// What stays of a recording dragged before 0, so its clip can still be taken hold of
const KEPT_OF_RECORDING = 1;
// How often a missing recording is looked for again, so one put back counts without a restart
export const RECORDING_RECHECK_MS = 2000;

/** Owns MIDI and audio import and the derived analysis of audio sources: waveform peaks and onsets */
export class SourcesCx {
	readonly $midiImport = createState<TMidiImport | null>(null);
	readonly $analysis = createState<Record<string, TSourceAnalysis>>({});
	/** IDs of the open project's songs whose recording doesn't load, which `$problems` names */
	readonly $missingRecordings = createState<readonly string[]>([]);
	private readonly loading = new Set<string>();
	private recordingCheck = 0;
	private recordingTimer: ReturnType<typeof setTimeout> | undefined;

	constructor(private readonly studio: StudioCx) {}

	// MARK: - MIDI

	async pickMidi(replaces?: string): Promise<void> {
		const file = await host.chooseSourceFile('midi');
		if (file != null) await this.openMidi(file, replaces);
	}

	/** Opens the import sheet for a new song, or for the file of a song being replaced */
	async openMidi(file: THostPickedFile, replaces?: string): Promise<void> {
		const url = host.pickedFileUrl(file);
		if (url == null) return;
		const [isBytesOk, bytesErr, bytes] = await host.readFile(url);
		if (!isBytesOk) {
			this.studio.notifyFailed(`${file.name} couldn't be read. Choose the file again.`, bytesErr);
			return;
		}
		const [isMidiOk, midiErr, midi] = parseMidiFile(bytes, file.name);
		if (!isMidiOk) {
			this.studio.notify(midiErr.message, 'error');
			return;
		}
		const melodic = midi.tracks.filter((track) => !track.isDrums);
		this.$midiImport.set({
			file,
			midi,
			start: replaces == null ? this.nextStart() : IMPORT_START,
			...(replaces != null ? { replaces } : {}),
			trackIds: (melodic.length ? melodic : midi.tracks).map((track) => track.id),
			options: { strategy: 'split', maxMarbles: 4 }
		});
	}

	updateMidiImport(patch: Partial<Pick<TMidiImport, 'trackIds' | 'options'>>): void {
		const current = this.$midiImport.get();
		if (current != null) this.$midiImport.set({ ...current, ...patch });
	}

	cancelMidiImport(): void {
		this.$midiImport.set(null);
	}

	async confirmMidiImport(): Promise<void> {
		const pending = this.$midiImport.get();
		const project = this.studio.project;
		const packagePath = this.studio.$path.get();
		if (pending == null || project == null || packagePath == null) return;
		const preview = previewMidiImport(pending);
		const [isImportedOk, importedErr, relativePath] = await host.importSource(packagePath, pending.file);
		if (!isImportedOk) {
			this.studio.notifyFailed(`${pending.file.name} couldn't be copied into the project. Check there's room on the disk, then import it again.`, importedErr);
			return;
		}
		const replaced = project.songs.filter((item) => item.id === pending.replaces);
		const source: TSong = {
			id: createId('song'),
			kind: 'midi',
			path: relativePath,
			name: pending.file.name,
			start: preview.offset,
			...carriedOver(replaced),
			backingSound: backingSound(pending.midi),
			// The time signature is not parsed; most MIDI files are in four
			...(pending.midi.tempo != null ? { tempo: { bpm: pending.midi.tempo, beatsPerBar: 4 } } : {})
		};
		const firstTrack = pending.midi.tracks.find((track) => pending.trackIds.includes(track.id));
		const applied = this.studio.execute([
			...replaced.map((item) => ({ type: 'removeSong' as const, songId: item.id })),
			...createImportCommands(project, {
				marbles: preview.marbles,
				names: preview.names,
				backing: preview.backing,
				source,
				keepsBacking: shownSongs(project).some((item) => item.id !== pending.replaces),
				instrument: firstTrack == null ? undefined : suggestInstrument(firstTrack.program)
			})
		]);
		if (!applied) return;
		this.$midiImport.set(null);
		this.studio.$fitFirstHits.set(true);
		const marbles = `${preview.marbles.length} ${preview.marbles.length === 1 ? 'marble' : 'marbles'}`;
		const backing = preview.backing.length;
		const lands = shownSongs(project).length > 0 && pending.replaces == null && this.studio.$playhead.get() > 0 ? ` It starts at the playhead, ${formatTime(this.studio.$playhead.get())}.` : '';
		this.studio.notify(`${backing > 0 ? `Imported ${marbles}. ${backing} ${backing === 1 ? 'note plays' : 'notes play'} as Backing.` : `Imported ${marbles}.`}${lands}`);
	}

	// MARK: - Audio

	async pickAudio(replaces?: string): Promise<void> {
		const file = await host.chooseSourceFile('audio');
		if (file != null) await this.importAudio(file, replaces);
	}

	/** Adds a recording as a new song. Replacing one keeps its ID and start, so the hits tied to it stay tied. */
	async importAudio(file: THostPickedFile, replaces?: string): Promise<void> {
		const project = this.studio.project;
		const packagePath = this.studio.$path.get();
		if (project == null || packagePath == null) return;
		const [isImportedOk, importedErr, relativePath] = await host.importSource(packagePath, file);
		if (!isImportedOk) {
			this.studio.notifyFailed(`${file.name} couldn't be copied into the project. Check there's room on the disk, then import it again.`, importedErr);
			return;
		}
		const replaced = project.songs.find((item) => item.id === replaces);
		const opened: TSong = {
			id: replaced?.id ?? createId('song'),
			kind: 'audio',
			path: relativePath,
			name: file.name,
			start: replaced?.start ?? 0,
			...carriedOver(replaced == null ? [] : [replaced])
		};
		const analysis = await this.analyze(opened);
		if (analysis == null) return;
		const source = replaced != null ? opened : { ...opened, start: this.nextStart(analysis.onsets[0]) };
		this.studio.execute([
			{ type: 'addSong', song: source },
			{ type: 'updateProject', patch: { length: Math.max(project.length, Math.ceil(source.start + analysis.duration)) } }
		]);
		const lands = shownSongs(project).length > 0 && replaced == null && this.studio.$playhead.get() > 0 ? ` It starts at the playhead, ${formatTime(source.start)}.` : '';
		this.studio.notify(`${analysis.onsets.length} possible hits found. Add them from a marble's row menu or tap along.${lands}`);
	}

	// MARK: - Song

	/** Picks a new file of the same kind for a song; the import then replaces it */
	async replaceSong(song: TSong): Promise<void> {
		if (song.kind === 'audio') await this.pickAudio(song.id);
		else await this.pickMidi(song.id);
	}

	/**
	 * Deletes a Song layer: its file and Backing go as one undo step, the marbles keep their hits. Asks first only when
	 * Backing notes would be lost; the notice offers Undo.
	 */
	async deleteSong(songId: string): Promise<boolean> {
		const song = this.studio.project?.songs.find((item) => item.id === songId);
		if (song == null) return false;
		const question = deleteSongQuestion(song);
		if (question != null && !(await this.studio.confirm({ question, detail: 'The marbles keep their hits.', action: 'Delete' }))) return false;
		// The project may have changed while the alert was open
		const current = this.studio.project;
		const still = current?.songs.find((item) => item.id === songId);
		if (current == null || still == null) return false;
		const message = deleteSongNotice(still);
		if (!this.studio.execute(deleteSongCommands(current, songId))) return false;
		this.studio.$selection.set(this.studio.$selection.get().filter((key) => key !== toSongKey(songId)));
		this.studio.notifyEdit(message);
		return true;
	}

	/** The length stays with a move, so hits it took past the film's end say so, with what brings them back */
	private sayHitsPastEnd(): void {
		const project = this.studio.project;
		if (project == null) return;
		const past = project.marbles.flatMap((marble) => marble.hits).filter((hit) => hit.time > project.length).length;
		if (past === 0) return;
		const words = past === 1 ? '1 hit now falls' : `${past} hits now fall`;
		this.studio.notifyEdit(`${words} after the film's end at ${formatTime(project.length)}.`, [{ label: 'Fit to Song', title: 'End the film just after the song', run: () => void this.studio.fitToSong() }], { isUndoFirst: true });
	}

	/**
	 * Where a new song starts: at the playhead beside other songs, like Logic. The first one starts so its first note lands
	 * at `IMPORT_START`; a recording at 0, later only by what its first beat, `firstBeat` into the file, needs for a marble to reach it.
	 */
	private nextStart(firstBeat?: number): number {
		const project = this.studio.project;
		const playhead = this.studio.$playhead.get();
		if (project != null && shownSongs(project).length > 0 && playhead > 0) return Math.round(playhead * 1000) / 1000;
		return firstBeat == null ? IMPORT_START : Math.max(0, Math.round((IMPORT_START - firstBeat) * 1000) / 1000);
	}

	/** The earliest this song can start, keeping a piece of a recording on the timeline */
	earliestStart(songId: string): number {
		const project = this.studio.project;
		const song = project?.songs.find((item) => item.id === songId);
		if (project == null || song == null) return 0;
		const duration = this.$analysis.get()[songId]?.duration;
		return Math.max(earliestSongStart(project, songId), Math.min(song.start, duration != null ? KEPT_OF_RECORDING - duration : 0));
	}

	/** Moves a song and everything tied to it as one undo step, no earlier than it can go */
	moveSong(songId: string, start: number): boolean {
		const project = this.studio.project;
		const song = project?.songs.find((item) => item.id === songId);
		if (project == null || song == null) return false;
		const to = Math.round(Math.max(this.earliestStart(songId), start) * 10000) / 10000;
		if (to === song.start || !this.studio.execute(moveSongCommands(project, this.studio.simulation.$result.get(), songId, to))) return false;
		this.sayHitsPastEnd();
		return true;
	}

	/** Loads waveform and onsets for audio sources of a reopened project */
	ensureAnalysis(project: TProject): void {
		for (const source of project.songs) {
			if (source.kind !== 'audio' || source.path == null) continue;
			if (this.$analysis.get()[source.id] != null || this.loading.has(source.id)) continue;
			void this.analyze(source);
		}
	}

	/** Finds which recordings don't load, and goes on looking while any is missing. One that comes back gets its waveform */
	async checkRecordings(): Promise<void> {
		const run = ++this.recordingCheck;
		clearTimeout(this.recordingTimer);
		const project = this.studio.project;
		const missing = project != null ? (await missingRecordings(project, this.studio.resolveSourceUrl)).map((song) => song.id) : [];
		if (run !== this.recordingCheck) return;
		const before = this.$missingRecordings.get();
		if (missing.length !== before.length || missing.some((id) => !before.includes(id))) this.$missingRecordings.set(missing);
		for (const song of project?.songs ?? []) if (before.includes(song.id) && !missing.includes(song.id) && this.$analysis.get()[song.id] == null) void this.analyze(song);
		if (missing.length > 0) this.recordingTimer = setTimeout(() => void this.checkRecordings(), RECORDING_RECHECK_MS);
	}

	/** Ends the looking when the window goes */
	stopCheckingRecordings(): void {
		this.recordingCheck++;
		clearTimeout(this.recordingTimer);
	}

	private async analyze(source: TSong): Promise<TSourceAnalysis | null> {
		const url = this.studio.resolveSourceUrl(source);
		if (url == null) return null;
		this.loading.add(source.id);
		try {
			const [isBytesOk, bytesErr, bytes] = await host.readFile(url);
			if (!isBytesOk) {
				this.studio.notifyFailed(`${source.name} couldn't be read. Put the file back, or choose Replace Song… on its row.`, bytesErr);
				return null;
			}
			const decoded = await decodeAudioFile(bytes);
			const mono = mixToMono(decoded.channels);
			const analysis: TSourceAnalysis = {
				duration: decoded.duration,
				bucketSeconds: 0.01,
				peaks: computePeaks(mono, decoded.sampleRate, 0.01),
				onsets: detectOnsets(mono, decoded.sampleRate)
			};
			this.$analysis.set({ ...this.$analysis.get(), [source.id]: analysis });
			return analysis;
		} catch (error) {
			this.studio.notifyFailed(`${source.name} isn't a recording MidiMarble can play. Choose Replace Song… on its row and pick a .wav, .mp3 or .m4a file.`, error);
			return null;
		} finally {
			this.loading.delete(source.id);
		}
	}
}

export interface TMidiImport {
	file: THostPickedFile;
	midi: TMidiFile;
	// Timeline time of the song's first note
	start?: number;
	// The song this file takes the place of
	replaces?: string;
	trackIds: string[];
	options: TProposeMarblesOptions;
}

export interface TSourceAnalysis {
	duration: number;
	bucketSeconds: number;
	peaks: Float32Array;
	// Source-relative seconds
	onsets: number[];
}

/** What a new file takes over from the songs it replaces, which outlives their files: Backing, its sound and the tempo */
function carriedOver(replaced: readonly TSong[]): Pick<TSong, 'backing' | 'backingSound' | 'tempo'> {
	const backingSound = replaced.find((song) => song.backingSound != null)?.backingSound;
	const tempo = replaced.find((song) => song.tempo != null)?.tempo;
	return { backing: replaced.flatMap((song) => song.backing), ...(backingSound != null ? { backingSound } : {}), ...(tempo != null ? { tempo } : {}) };
}

/**
 * What an import makes with the current settings: notes of the chosen tracks spread over marbles, and Backing for
 * the notes no marble can play and for the other melodic tracks. Drum tracks are left out, as the instrument bank
 * has no drums. Every note moves by the same offset, so the first note of the song starts at its start.
 */
export function previewMidiImport(pending: TMidiImport): TMidiImportPreview {
	const melodic = pending.midi.tracks.filter((track) => pending.trackIds.includes(track.id) || !track.isDrums);
	const first = melodic.flatMap((track) => track.notes).reduce((min, note) => Math.min(min, note.time), Number.POSITIVE_INFINITY);
	const start = pending.start ?? IMPORT_START;
	const offset = Number.isFinite(first) ? start - first : start;
	const shift = (notes: TMidiNote[]): TMidiNote[] => notes.map((note) => ({ ...note, time: note.time + offset }));
	const chosen = melodic.filter((track) => pending.trackIds.includes(track.id));
	const others = melodic.filter((track) => !pending.trackIds.includes(track.id));
	const shifted = chosen.map((track) => ({ ...track, notes: shift(track.notes) }));
	const proposal = proposeMarbles(shifted.flatMap((track) => track.notes), pending.options);
	const backing = [...proposal.backing.map((item) => item.note), ...shift(others.flatMap((track) => track.notes))].sort((a, b) => a.time - b.time || b.pitch - a.pitch);
	return { marbles: proposal.marbles, names: marbleNamesFromTracks(proposal.marbles, shifted), backing, offset };
}

export interface TMidiImportPreview {
	marbles: TMidiNote[][];
	// What the file calls each marble; null keeps "Marble 1"
	names: (string | null)[];
	backing: TMidiNote[];
	// Seconds added to every note time of the file
	offset: number;
}

/** The song's first melodic MIDI program when the instrument bank has it, otherwise piano */
function backingSound(midi: TMidiFile): number {
	const program = midi.tracks.find((track) => !track.isDrums)?.program;
	return instruments.some((instrument) => instrument.program === program) && program != null ? program : 0;
}

// Pitched percussion suits marble strikes; other instruments keep their own sound
function suggestInstrument(program: number): number {
	return program >= 8 && program <= 15 ? program : 9;
}
