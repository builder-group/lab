/** Seconds one snippet of the song plays for while the playhead is dragged */
export const SCRUB_SNIPPET = 0.12;
/** Seconds each end of a snippet fades over, so it starts and stops without a click */
export const SCRUB_FADE = 0.008;
/** Seconds the playhead has to move for the next snippet, so a drag held still does not repeat itself */
const SCRUB_MIN_MOVE = 0.001;

/** The part of the buffer a snippet at `time` plays, clamped to its end; past the end there is nothing to play */
export function scrubWindow(time: number, duration: number): TScrubWindow | null {
	const offset = Math.max(0, time);
	const length = Math.min(SCRUB_SNIPPET, duration - offset);
	if (length <= 0) return null;
	return { offset, length, fade: Math.min(SCRUB_FADE, length / 2) };
}

export interface TScrubWindow {
	offset: number;
	length: number;
	fade: number;
}

/**
 * Plays short snippets of a rendered soundtrack while the playhead is dragged, like Logic's Scrub. The next snippet
 * starts when the one before has ended, at the latest position, so there is only ever one voice and a fast drag
 * skips positions instead of piling them up.
 */
export function createScrubber(context: TScrubContext, destination: AudioNode): TScrubber {
	let isActive = false;
	let buffer: AudioBuffer | null = null;
	let latest: number | null = null;
	let played: number | null = null;
	let timer: ReturnType<typeof setTimeout> | null = null;
	let voice: { source: AudioBufferSourceNode; release: GainNode } | null = null;
	let voiceEnd = 0;

	function playLatest(): void {
		if (!isActive || buffer == null || timer != null || latest == null) return;
		const time = latest;
		latest = null;
		if (played != null && Math.abs(time - played) < SCRUB_MIN_MOVE) return;
		const window = scrubWindow(time, buffer.duration);
		if (window == null) return;
		played = time;
		const now = context.currentTime;
		const startAt = Math.max(now, voiceEnd);
		voiceEnd = startAt + window.length;
		voice = startVoice(buffer, window, startAt);
		timer = setTimeout(
			() => {
				timer = null;
				playLatest();
			},
			(voiceEnd - now) * 1000
		);
	}

	function startVoice(from: AudioBuffer, { offset, length, fade }: TScrubWindow, startAt: number): { source: AudioBufferSourceNode; release: GainNode } {
		const source = context.createBufferSource();
		source.buffer = from;
		const envelope = context.createGain();
		envelope.gain.setValueAtTime(0, startAt);
		envelope.gain.linearRampToValueAtTime(1, startAt + fade);
		envelope.gain.setValueAtTime(1, startAt + length - fade);
		envelope.gain.linearRampToValueAtTime(0, startAt + length);
		// A gain of its own for the release, since canceling a running ramp makes the envelope jump
		const release = context.createGain();
		source.connect(envelope);
		envelope.connect(release);
		release.connect(destination);
		const started = { source, release };
		source.onended = () => {
			source.disconnect();
			envelope.disconnect();
			release.disconnect();
			if (voice === started) voice = null;
		};
		source.start(startAt, offset, length);
		return started;
	}

	return {
		begin() {
			isActive = true;
			buffer = null;
			latest = null;
			played = null;
		},
		setBuffer(next) {
			buffer = next;
			playLatest();
		},
		move(time) {
			if (!isActive) return;
			latest = time;
			playLatest();
		},
		end() {
			isActive = false;
			buffer = null;
			latest = null;
			if (timer != null) clearTimeout(timer);
			timer = null;
			if (voice == null) return;
			const now = context.currentTime;
			voice.release.gain.setValueAtTime(1, now);
			voice.release.gain.linearRampToValueAtTime(0, now + SCRUB_FADE);
			voice.source.stop(now + SCRUB_FADE);
			voice = null;
			voiceEnd = now + SCRUB_FADE;
		}
	};
}

export type TScrubContext = Pick<BaseAudioContext, 'currentTime' | 'createBufferSource' | 'createGain'>;

export interface TScrubber {
	// Starts a drag; nothing plays until `setBuffer`, which keeps the latest position meanwhile
	begin: () => void;
	setBuffer: (buffer: AudioBuffer | null) => void;
	move: (time: number) => void;
	end: () => void;
}
