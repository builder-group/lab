import { createState } from 'feature-state';
import { host, type THostPickedFile } from '@/environment';
import {
	computePeaks,
	createImportCommands,
	decodeAudioFile,
	detectOnsets,
	instruments,
	mixToMono,
	parseMidiFile,
	proposeLanes,
	type TMidiFile,
	type TMidiNote,
	type TProposeLanesOptions
} from '@/modules/music';
import { createId, type TProject, type TSource } from '@/modules/project';
import { SONG_KEY } from './selection';
import { deleteSongCommands, deleteSongNotice, deleteSongQuestion, hasSongLayer } from './song-layer';
import type { StudioCx } from './StudioCx';

// Imported music starts after this lead-in so the first marble has time to fall
export const IMPORT_START = 1;

/** Owns MIDI and audio import and the derived analysis of audio sources: waveform peaks and onsets */
export class SourcesCx {
	readonly $midiImport = createState<TMidiImport | null>(null);
	readonly $analysis = createState<Record<string, TSourceAnalysis>>({});
	private readonly loading = new Set<string>();

	constructor(private readonly studio: StudioCx) {}

	// MARK: - MIDI

	async pickMidi(): Promise<void> {
		const file = await host.chooseSourceFile('midi');
		if (file != null) await this.openMidi(file);
	}

	async openMidi(file: THostPickedFile): Promise<void> {
		const url = host.pickedFileUrl(file);
		if (url == null) return;
		const [isBytesOk, bytesErr, bytes] = await host.readFile(url);
		if (!isBytesOk) {
			this.studio.notify(`${file.name} could not be read: ${bytesErr.message}`, 'error');
			return;
		}
		const [isMidiOk, midiErr, midi] = parseMidiFile(bytes);
		if (!isMidiOk) {
			this.studio.notify(midiErr.message, 'error');
			return;
		}
		const melodic = midi.tracks.filter((track) => !track.isDrums);
		this.$midiImport.set({
			file,
			midi,
			trackIds: (melodic.length ? melodic : midi.tracks).map((track) => track.id),
			options: { strategy: 'split', maxLanes: 4 }
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
			this.studio.notify(`${pending.file.name} could not be copied: ${importedErr.message}`, 'error');
			return;
		}
		const source: TSource = {
			id: createId('source'),
			kind: 'midi',
			path: relativePath,
			name: pending.file.name,
			offset: preview.offset
		};
		const firstTrack = pending.midi.tracks.find((track) => pending.trackIds.includes(track.id));
		// A film has one song, so a new MIDI file replaces the previous one, as a new recording does
		const replaced = project.music.sources.filter((item) => item.kind === 'midi');
		const applied = this.studio.execute([
			...replaced.map((item) => ({ type: 'removeSource' as const, sourceId: item.id })),
			...createImportCommands(project, {
				lanes: preview.lanes,
				backing: preview.backing,
				backingInstrument: backingInstrument(pending.midi),
				source,
				instrument: firstTrack == null ? undefined : suggestInstrument(firstTrack.program)
			}),
			// The time signature is not parsed; most MIDI files are in four
			...(pending.midi.tempo != null ? [{ type: 'setTempo' as const, tempo: { bpm: pending.midi.tempo, beatsPerBar: 4 } }] : [])
		]);
		if (!applied) return;
		this.$midiImport.set(null);
		this.studio.$fitFirstHits.set(true);
		const marbles = `${preview.lanes.length} ${preview.lanes.length === 1 ? 'marble' : 'marbles'}`;
		const backing = preview.backing.length;
		this.studio.notify(backing > 0 ? `Imported ${marbles}. ${backing} ${backing === 1 ? 'note plays' : 'notes play'} as Backing.` : `Imported ${marbles}.`);
	}

	// MARK: - Audio

	async pickAudio(): Promise<void> {
		const file = await host.chooseSourceFile('audio');
		if (file != null) await this.importAudio(file);
	}

	async importAudio(file: THostPickedFile): Promise<void> {
		const project = this.studio.project;
		const packagePath = this.studio.$path.get();
		if (project == null || packagePath == null) return;
		const [isImportedOk, importedErr, relativePath] = await host.importSource(packagePath, file);
		if (!isImportedOk) {
			this.studio.notify(`${file.name} could not be copied: ${importedErr.message}`, 'error');
			return;
		}
		const source: TSource = {
			id: createId('source'),
			kind: 'audio',
			path: relativePath,
			name: file.name,
			offset: IMPORT_START
		};
		const analysis = await this.analyze(source);
		if (analysis == null) return;
		const replaced = project.music.sources.filter((item) => item.kind === 'audio');
		this.studio.execute([
			...replaced.map((item) => ({ type: 'removeSource' as const, sourceId: item.id })),
			{ type: 'upsertSource', source },
			{ type: 'setEnd', end: Math.max(project.end, Math.ceil(source.offset + analysis.duration)) }
		]);
		this.studio.notify(`${analysis.onsets.length} possible hits found. Add them from a marble's inspector or tap along.`);
	}

	// MARK: - Song

	/** Picks a new file of the same kind as the current song; the import then replaces it */
	async replaceSong(): Promise<void> {
		const song = this.studio.project == null ? undefined : songSource(this.studio.project);
		if (song?.kind === 'audio') await this.pickAudio();
		else await this.pickMidi();
	}

	/**
	 * Deletes the Song layer: the song files and Backing go as one undo step, the marbles keep their hits. Asks
	 * first only when Backing notes would be lost; the notice offers Undo.
	 */
	async deleteSong(): Promise<boolean> {
		const project = this.studio.project;
		if (project == null || !hasSongLayer(project)) return false;
		const question = deleteSongQuestion(project);
		if (question != null && !(await this.studio.confirm({ question, detail: 'The marbles keep their hits.', action: 'Delete' }))) return false;
		// The project may have changed while the alert was open
		const current = this.studio.project;
		if (current == null || !hasSongLayer(current)) return false;
		const message = deleteSongNotice(current);
		if (!this.studio.execute(deleteSongCommands(current))) return false;
		this.studio.$selection.set(this.studio.$selection.get().filter((key) => key !== SONG_KEY));
		this.studio.notifyEdit(message);
		return true;
	}

	/** Loads waveform and onsets for audio sources of a reopened project */
	ensureAnalysis(project: TProject): void {
		for (const source of project.music.sources) {
			if (source.kind !== 'audio') continue;
			if (this.$analysis.get()[source.id] != null || this.loading.has(source.id)) continue;
			void this.analyze(source);
		}
	}

	private async analyze(source: TSource): Promise<TSourceAnalysis | null> {
		const packagePath = this.studio.$path.get();
		if (packagePath == null) return null;
		const url = host.sourceUrl(packagePath, source.path);
		if (url == null) return null;
		this.loading.add(source.id);
		try {
			const [isBytesOk, bytesErr, bytes] = await host.readFile(url);
			if (!isBytesOk) {
				this.studio.notify(`${source.name} could not be read: ${bytesErr.message}`, 'error');
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
			this.studio.notify(`${source.name} could not be decoded: ${(error as Error).message}`, 'error');
			return null;
		} finally {
			this.loading.delete(source.id);
		}
	}
}

export interface TMidiImport {
	file: THostPickedFile;
	midi: TMidiFile;
	trackIds: string[];
	options: TProposeLanesOptions;
}

export interface TSourceAnalysis {
	duration: number;
	bucketSeconds: number;
	peaks: Float32Array;
	// Source-relative seconds
	onsets: number[];
}

/** The project's song: the recording when there is one, since it is what plays, otherwise the MIDI file */
export function songSource(project: TProject): TSource | undefined {
	const sources = project.music.sources;
	return sources.find((source) => source.kind === 'audio') ?? sources[0];
}

/**
 * What an import makes with the current settings: notes of the chosen tracks spread over marbles, and Backing for
 * the notes no marble can play and for the other melodic tracks. Drum tracks are left out, as the instrument bank
 * has no drums. Every note moves by the same offset, so the first note of the song starts at the import start.
 */
export function previewMidiImport(pending: TMidiImport): TMidiImportPreview {
	const melodic = pending.midi.tracks.filter((track) => pending.trackIds.includes(track.id) || !track.isDrums);
	const first = melodic.flatMap((track) => track.notes).reduce((min, note) => Math.min(min, note.time), Number.POSITIVE_INFINITY);
	const offset = Number.isFinite(first) ? IMPORT_START - first : IMPORT_START;
	const shift = (notes: TMidiNote[]): TMidiNote[] => notes.map((note) => ({ ...note, time: note.time + offset }));
	const chosen = melodic.filter((track) => pending.trackIds.includes(track.id));
	const others = melodic.filter((track) => !pending.trackIds.includes(track.id));
	const proposal = proposeLanes(shift(chosen.flatMap((track) => track.notes)), pending.options);
	const backing = [...proposal.backing.map((item) => item.note), ...shift(others.flatMap((track) => track.notes))].sort((a, b) => a.time - b.time || b.pitch - a.pitch);
	return { lanes: proposal.lanes, backing, offset };
}

export interface TMidiImportPreview {
	lanes: TMidiNote[][];
	backing: TMidiNote[];
	// Seconds added to every note time of the file
	offset: number;
}

/** The song's first melodic MIDI program when the instrument bank has it, otherwise piano */
function backingInstrument(midi: TMidiFile): number {
	const program = midi.tracks.find((track) => !track.isDrums)?.program;
	return instruments.some((instrument) => instrument.program === program) && program != null ? program : 0;
}

// Pitched percussion suits marble strikes; other instruments keep their own sound
function suggestInstrument(program: number): number {
	return program >= 8 && program <= 15 ? program : 9;
}
