import { compilePerformance } from '../modules/motion/compile-performance';
import { composeMidiNotes, createCloseWallStyle } from '../modules/project/compose-midi';
import { createEmptyProject } from '../modules/project/project';
import type { TPerformance, TProject } from '../modules/project/types';

/** Composes a short monophonic track and returns a draft only after physical verification succeeds. */
export async function composeProject(
	input: TProject,
	trackId?: string
): Promise<{ project: TProject; performance: TPerformance }> {
	if (input.duration > 20) {
		throw new Error(
			'Compose accepts projects up to 20 seconds. Save a shorter MIDI excerpt first.'
		);
	}
	const musicalTracks = input.tracks.filter((track) =>
		input.notes.some((note) => note.trackId === track.id)
	);
	if (trackId == null && musicalTracks.length > 1) {
		throw new Error(
			`Choose one monophonic track with --track. Available tracks: ${musicalTracks.map((track) => track.id).join(', ')}`
		);
	}
	const track =
		trackId == null ? musicalTracks[0] : input.tracks.find((item) => item.id === trackId);
	if (track == null)
		throw new Error(
			trackId == null ? 'The project has no musical notes to compose.' : `Unknown track: ${trackId}`
		);
	const notes = input.notes
		.filter((note) => note.trackId === track.id)
		.sort((a, b) => a.time - b.time);
	if (!notes.length) throw new Error(`Track ${track.id} has no notes to compose.`);
	for (let index = 1; index < notes.length; index++) {
		const previous = notes[index - 1];
		const current = notes[index];
		if (
			previous != null &&
			current != null &&
			current.time < previous.time + previous.duration - 1e-7
		) {
			throw new Error(
				`Compose requires a monophonic track with non-overlapping notes. ${previous.id} and ${current.id} overlap; choose or edit a monophonic excerpt.`
			);
		}
	}
	const project = composeMidiNotes({
		...createEmptyProject(),
		name: `${input.name.slice(0, 140)} · composition`,
		bpm: input.bpm,
		tempos: input.tempos == null ? undefined : structuredClone(input.tempos),
		duration: input.duration,
		tracks: [{ ...structuredClone(track), muted: false, solo: false }],
		notes: structuredClone(notes),
		launch: { position: [0, 4, 0.65], velocity: [0.6, -0.2, 0], radius: 0.22 },
		gravity: 9.81,
		restitution: 0.25,
		aspectRatio: '9:16',
		marbleColor: '#589b87',
		marbleStyle: 'ribbon',
		marbleEffect: 'none',
		audio: { musicVolume: 0.8, surfaceVolume: 0.18, surfacesEnabled: true },
		scene: createCloseWallStyle(),
		camera: {
			fov: 38,
			distance: 10,
			azimuth: 0.1,
			elevation: 0.03,
			lead: 0.15,
			followMarbles: true,
			keyframes: []
		}
	});
	const performance = await compilePerformance(project);
	const invalid = performance.noteMarkers.filter(
		(marker) => marker.error == null || Math.abs(marker.error) > 1 / 60
	);
	if (invalid.length > 0 || performance.warnings.length > 0) {
		const details = invalid
			.slice(0, 4)
			.map(
				(marker) =>
					`${marker.noteId}: ${marker.error == null ? 'missed' : `${(marker.error * 1000).toFixed(1)} ms`}`
			);
		throw new Error(
			`Composition did not pass physical verification (${invalid.length}/${notes.length} unaligned notes). ${[...details, ...performance.warnings].join(' ')} No project was written. Try a slower or more evenly spaced excerpt.`
		);
	}
	project.objects = performance.objects;
	return { project, performance };
}
