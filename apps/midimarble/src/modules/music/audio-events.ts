import type { TProject } from '../project';

export function createAudioEvents(project: TProject, sampleRate: number): TAudioEvent[] {
	const channels = new Map(project.tracks.map((track, index) => [track.id, index]));
	const soloActive = project.tracks.some((track) => track.solo);
	const audible = new Set(
		project.tracks
			.filter((track) => !track.muted && (!soloActive || track.solo))
			.map((track) => track.id)
	);
	const events: TAudioEvent[] = [];
	for (const note of project.notes) {
		if (!audible.has(note.trackId) || note.time >= project.duration || note.velocity <= 0) {
			continue;
		}
		const channel = channels.get(note.trackId);
		if (channel == null) continue;
		events.push({
			sample: Math.round(Math.max(0, note.time) * sampleRate),
			kind: 'on',
			channel,
			value: note.midi,
			velocity: Math.max(1, Math.round(note.velocity * 127))
		});
		events.push({
			sample: Math.round(Math.min(project.duration, note.time + note.duration) * sampleRate),
			kind: 'off',
			channel,
			value: note.midi,
			velocity: 0
		});
	}
	for (const track of project.tracks) {
		if (!audible.has(track.id)) continue;
		const channel = channels.get(track.id);
		if (channel == null) continue;
		for (const control of track.controls ?? []) {
			events.push({
				sample: Math.round(Math.max(0, control.time) * sampleRate),
				kind: 'cc',
				channel,
				value: control.number,
				velocity: Math.round(control.value * 127)
			});
		}
		for (const bend of track.pitchBends ?? []) {
			events.push({
				sample: Math.round(Math.max(0, bend.time) * sampleRate),
				kind: 'bend',
				channel,
				value: Math.max(0, Math.min(16383, Math.round((bend.value + 1) * 8192))),
				velocity: 0
			});
		}
	}
	return events.sort((a, b) => a.sample - b.sample || priority[a.kind] - priority[b.kind]);
}

export interface TAudioEvent {
	sample: number;
	kind: 'on' | 'off' | 'cc' | 'bend';
	channel: number;
	value: number;
	velocity: number;
}

const priority = { off: 0, cc: 1, bend: 2, on: 3 };
