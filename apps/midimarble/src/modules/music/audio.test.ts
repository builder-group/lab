import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createEmptyProject } from '../project/project';

describe('renderPerformanceAudio function', () => {
	beforeEach(() => {
		vi.resetModules();
		vi.stubGlobal('AudioBuffer', TestAudioBuffer);
		vi.stubGlobal('Worker', TestAudioWorker);
	});
	afterEach(() => vi.unstubAllGlobals());

	it('should apply each mix to a separate buffer without changing the cached score', async () => {
		const { renderPerformanceAudio, renderProjectAudio } = await import('./audio');
		const project = createEmptyProject();
		project.audio = { musicVolume: 0.5, surfaceVolume: 0, surfacesEnabled: false };
		const music = await renderProjectAudio(project);
		const left = Array.from(music.getChannelData(0));
		const right = Array.from(music.getChannelData(1));

		const first = await renderPerformanceAudio(project);
		project.audio.musicVolume = 0.25;
		const second = await renderPerformanceAudio(project);

		expect(first).not.toBe(music);
		expect(second).not.toBe(first);
		expect(Array.from(first.getChannelData(0))).toEqual(left.map((value) => value * 0.5));
		expect(Array.from(second.getChannelData(1))).toEqual(right.map((value) => value * 0.25));
		expect(Array.from(music.getChannelData(0))).toEqual(left);
		expect(Array.from(music.getChannelData(1))).toEqual(right);
		expect(await renderProjectAudio(project)).toBe(music);
	});
});

class TestAudioBuffer {
	readonly length: number;
	readonly sampleRate: number;
	private readonly channels: Float32Array[];

	constructor(options: AudioBufferOptions) {
		this.length = options.length;
		this.sampleRate = options.sampleRate;
		this.channels = Array.from(
			{ length: options.numberOfChannels ?? 1 },
			() => new Float32Array(options.length)
		);
	}

	getChannelData(channel: number): Float32Array {
		const data = this.channels[channel];
		if (data == null) throw new Error('Missing test audio channel.');
		return data;
	}

	copyToChannel(data: Float32Array, channel: number): void {
		this.getChannelData(channel).set(data);
	}
}

class TestAudioWorker {
	onmessage:
		| ((event: {
				data: { id: number; left: Float32Array; right: Float32Array; sampleRate: number };
		  }) => void)
		| null = null;

	postMessage(request: { id: number }): void {
		queueMicrotask(() =>
			this.onmessage?.({
				data: {
					id: request.id,
					left: new Float32Array([1, -1, 0.5, -0.5]),
					right: new Float32Array([-0.5, 0.5, -1, 1]),
					sampleRate: 44100
				}
			})
		);
	}
}
