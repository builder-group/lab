import { createState } from 'feature-state';
import { describe, expect, it, vi } from 'vitest';
import { createProject, type TProject } from '@/modules/project';
import { toHitKey } from '../selection';
import type { StudioCx } from '../StudioCx';
import { removeSelectedHits } from './hand-notes';

function fake(project: TProject) {
	return { project, simulation: { $result: createState(null) }, $selection: createState<string[]>([]), execute: vi.fn(() => true), notify: vi.fn(), notifyEdit: vi.fn() };
}

function withHit(hit: { id: string; time: number; pitch?: number }, hasSong: boolean): { project: TProject; key: string } {
	const base = createProject({ title: 'Hits' });
	const lane = base.music.lanes[0];
	if (lane == null) throw new Error('A new project has a marble');
	const sources = hasSong ? [{ id: 'song', kind: 'midi', path: 'song.mid', offset: 0 }] : [];
	const project = { ...base, music: { ...base.music, sources, lanes: [{ ...lane, hits: [hit] }] } } as unknown as TProject;
	return { project, key: toHitKey(lane.id, hit.id) };
}

describe('removeSelectedHits function', () => {
	it('should remove a tapped hit, in one step', () => {
		const { project, key } = withHit({ id: 'a', time: 1 }, false);
		const cx = fake(project);

		expect(removeSelectedHits(cx as unknown as StudioCx, [key], false)).toBe(true);

		const commands = cx.execute.mock.calls[0] as unknown as [{ type: string }[]];
		expect(cx.execute).toHaveBeenCalledTimes(1);
		expect(commands[0].some((command) => command.type === 'removeHits')).toBe(true);
	});

	it('should keep a song note sounding as Backing, unless in the piano roll', () => {
		const { project, key } = withHit({ id: 'a', time: 1, pitch: 60 }, true);
		const cx = fake(project);

		removeSelectedHits(cx as unknown as StudioCx, [key], false);
		const kept = cx.execute.mock.calls[0] as unknown as [{ type: string }[]];
		expect(kept[0].some((command) => command.type === 'removeHits')).toBe(false);

		removeSelectedHits(cx as unknown as StudioCx, [key], true);
		const gone = cx.execute.mock.calls[1] as unknown as [{ type: string }[]];
		expect(gone[0].some((command) => command.type === 'removeHits')).toBe(true);
	});
});
