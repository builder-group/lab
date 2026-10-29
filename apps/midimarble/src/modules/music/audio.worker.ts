import { SoundBankLoader, type BasicSoundBank } from 'spessasynth_core';
import type { TProject } from '../project';
import { synthesizeAudio } from './synthesize';

let bankPromise: Promise<BasicSoundBank> | null = null;
let queue = Promise.resolve();

self.onmessage = (message: MessageEvent<{ id: number; project: TProject; sampleRate: number }>) => {
	const request = message.data;
	queue = queue.then(async () => {
		try {
			const result = await renderAudio(request.project, request.sampleRate);
			self.postMessage(
				{ id: request.id, ...result },
				{ transfer: [result.left.buffer, result.right.buffer] }
			);
		} catch (error) {
			self.postMessage({
				id: request.id,
				error: error instanceof Error ? error.message : 'Audio rendering failed.'
			});
		}
	});
};

async function renderAudio(project: TProject, sampleRate: number) {
	bankPromise ??= fetch('/audio/general-user-gs.sf2')
		.then(async (response) => {
			if (!response.ok) throw new Error('The instrument sound bank could not be loaded.');
			return SoundBankLoader.fromArrayBuffer(await response.arrayBuffer());
		})
		.catch((error: unknown) => {
			bankPromise = null;
			throw error;
		});
	const bank = await bankPromise;
	return synthesizeAudio(project, bank, sampleRate);
}
