import { describe, expect, it } from 'vitest';
import { host } from '@/environment';
import { copyExampleFiles, examples, loadExample, type TExample } from './examples';

function example(id: string): TExample {
	const found = examples.find((item) => item.id === id);
	if (found == null) throw new Error(`${id} is not an example`);
	return found;
}

describe('loadExample function', () => {
	it('should give the copy a fresh id and the example title', async () => {
		const [isLoadedOk, , first] = await loadExample(example('staircase'));
		const [, , second] = await loadExample(example('staircase'));

		expect(isLoadedOk).toBe(true);
		expect(first?.project.id).not.toBe(second?.project.id);
		expect(first?.project.title).toBe('Staircase');
		expect(first?.files).toEqual([]);
	});

	it('should list the song file each source of the example points at', async () => {
		const [isAudioOk, , tap] = await loadExample(example('tap-along'));

		expect(isAudioOk).toBe(true);
		expect(tap?.files).toEqual([{ path: 'audio/tap-along.wav', url: expect.stringContaining('tap-along.wav') }]);
		expect(tap?.project.songs[0]?.path).toBe('audio/tap-along.wav');
	});
});

describe('copyExampleFiles function', () => {
	it('should copy the song files into the package, where the source resolves', async () => {
		// Prepare
		const [, , loaded] = await loadExample(example('tap-along'));
		if (loaded == null) throw new Error('Tap Along did not load');
		const packagePath = '/browser/Copy Test.marble';
		expect(host.sourceUrl(packagePath, 'audio/tap-along.wav')).toBeNull();

		// Act
		const [isCopiedOk] = await copyExampleFiles(packagePath, loaded.files);

		// Assert
		expect(isCopiedOk).toBe(true);
		expect(host.sourceUrl(packagePath, 'audio/tap-along.wav')).toBe(loaded.files[0]?.url);
	});
});
