import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHistory, createProject, type TProject } from '@/modules/project';
import type { TSimulationResult } from '@/modules/simulation';
import { RECORDING_RECHECK_MS } from './SourcesCx';
import { StudioCx } from './StudioCx';

const samples = new Float32Array(4800).fill(0.5);

function opened(id: string): { cx: StudioCx; project: TProject } {
	const created = createProject({ id, title: 'Song' });
	const project: TProject = { ...created, songs: [{ id: 'song-take', kind: 'audio', path: `audio/${id}.wav`, name: 'take.wav', start: 0, backing: [] }] };
	const cx = new StudioCx();
	cx.resolveSourceUrl = (song) => `asset://${song.path ?? ''}`;
	cx.$history.set(createHistory(project));
	cx.simulation.$result.set({ revision: project.revision, duration: project.length, marbles: [], pieces: [], contacts: [], hits: [], stats: { computeMs: 0, reusedUntil: 0, steps: 0 } } as unknown as TSimulationResult);
	return { cx, project };
}

const namesFile = (cx: StudioCx): boolean => cx.simulation.$problems.get().issues.some((issue) => issue.title.includes('take.wav'));

describe('SourcesCx recordings', () => {
	let isGone = true;

	beforeEach(() => {
		vi.useFakeTimers();
		isGone = true;
		vi.stubGlobal('fetch', vi.fn(async () => (isGone ? new Response(null, { status: 404 }) : new Response(new Uint8Array(4)))));
		vi.stubGlobal('OfflineAudioContext', class {
			decodeAudioData = async (): Promise<unknown> => ({ numberOfChannels: 1, length: samples.length, sampleRate: 48000, duration: 0.1, getChannelData: () => samples });
		});
	});

	afterEach(() => {
		vi.useRealTimers();
		vi.unstubAllGlobals();
	});

	it('should name a file that doesn\'t load in the Problems', async () => {
		// Prepare
		const { cx } = opened('gone');

		// Act
		await cx.sources.checkRecordings();

		// Assert
		expect(namesFile(cx)).toBe(true);
		cx.sources.stopCheckingRecordings();
	});

	it('should drop the Problem and draw the waveform once the file is back, with no restart', async () => {
		// Prepare
		const { cx } = opened('restored');
		await cx.sources.checkRecordings();

		// Act
		isGone = false;
		await vi.advanceTimersByTimeAsync(RECORDING_RECHECK_MS);

		// Assert
		expect(namesFile(cx)).toBe(false);
		await vi.waitFor(() => expect(cx.sources.$analysis.get()['song-take']).toBeDefined());
	});

	it('should look no more once nothing is missing', async () => {
		// Prepare
		const { cx } = opened('found');
		isGone = false;
		await cx.sources.checkRecordings();
		const fetches = vi.mocked(fetch).mock.calls.length;

		// Act
		await vi.advanceTimersByTimeAsync(RECORDING_RECHECK_MS * 3);

		// Assert
		expect(namesFile(cx)).toBe(false);
		expect(vi.mocked(fetch).mock.calls.length).toBe(fetches);
	});
});
