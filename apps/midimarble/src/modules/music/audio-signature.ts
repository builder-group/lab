import type { TProject } from '../project';
import { createAudioEvents } from './audio-events';

/** Only acoustic inputs invalidate the sampled score; track labels and colors are editorial metadata. */
export function getAudioSignature(project: TProject): string {
	return JSON.stringify([
		project.duration,
		project.tracks.map((track) => [
			track.instrument,
			track.muted,
			track.percussion ?? false,
			track.solo ?? false
		]),
		createAudioEvents(project, 44100)
	]);
}
