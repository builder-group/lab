import { createState } from 'feature-state';
import { host, type THostPickedFile } from '@/environment';
import {
	alignNotes,
	computePeaks,
	createImportCommands,
	decodeAudioFile,
	detectOnsets,
	mixToMono,
	parseMidiFile,
	proposeLanes,
	type TMidiFile,
	type TProposeLanesOptions
} from '@/modules/music';
import { createId, type TProject, type TSource } from '@/modules/project';
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
		const lastTime = preview.lanes.flat().reduce((max, note) => Math.max(max, note.time + note.duration), 0);
		const applied = this.studio.execute(
			createImportCommands(project, {
				lanes: preview.lanes,
				source,
				instrument: firstTrack == null ? undefined : suggestInstrument(firstTrack.program),
				end: Math.ceil(lastTime + 1.5)
			})
		);
		if (!applied) return;
		this.$midiImport.set(null);
		const dropped = preview.dropped.length;
		this.studio.notify(
			dropped > 0
				? `Imported ${preview.lanes.length} marbles. ${dropped} notes did not fit and were left out.`
				: `Imported ${preview.lanes.length} marbles.`
		);
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
		this.studio.notify(`${analysis.onsets.length} possible hits found. Add them from the lane inspector or tap along.`);
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

/** Proposed lanes for the current import settings, aligned to the import start */
export function previewMidiImport(pending: TMidiImport): ReturnType<typeof proposeLanes> & { offset: number } {
	const notes = pending.midi.tracks
		.filter((track) => pending.trackIds.includes(track.id))
		.flatMap((track) => track.notes);
	const first = notes.reduce((min, note) => Math.min(min, note.time), Number.POSITIVE_INFINITY);
	const proposal = proposeLanes(alignNotes(notes, IMPORT_START), pending.options);
	return { ...proposal, offset: Number.isFinite(first) ? IMPORT_START - first : IMPORT_START };
}

// Pitched percussion suits marble strikes; other instruments keep their own sound
function suggestInstrument(program: number): number {
	return program >= 8 && program <= 15 ? program : 9;
}
