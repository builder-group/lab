import { describe, expect, it } from 'vitest';
import { createProject, type TProject } from '@/modules/project';
import { StudioCx } from './StudioCx';

function opened(end: number): { cx: StudioCx; marbleId: string } {
	const project = createProject({ title: 'Song' });
	const marble = project.music.marbles[0];
	if (marble == null) throw new Error('No marble');
	marble.hits = [{ id: 'h0', time: 1 }, { id: 'h1', time: 3.6 }];
	const cx = new StudioCx();
	(cx as unknown as { load: (project: TProject, path: string) => void }).load({ ...project, length: end }, '/tmp/Song.marble');
	return { cx, marbleId: marble.id };
}

describe('the film length', () => {
	// 4 is the last hit plus its tail: it read as following the song, and edits dragged it along
	it.each([4, 34])('should stay %d through adding and deleting hits', (end) => {
		const { cx, marbleId } = opened(end);
		cx.execute([{ type: 'upsertHits', marbleId, hits: [{ id: 'h2', time: 3.9 }] }]);
		expect(cx.project?.length).toBe(end);
		cx.execute([{ type: 'removeHits', marbleId, hitIds: ['h1', 'h2'] }]);
		expect(cx.project?.length).toBe(end);
	});

	it('should stay when a Bowl is added or removed', () => {
		const { cx, marbleId } = opened(4);
		cx.execute([{ type: 'upsertEntity', entity: { id: 'bowl', components: { piece: { type: 'bowl', params: {} }, hitLink: { marbleId, hitId: 'h1', angle: 0, contactAt: 0.5, anchored: true } } } }]);
		expect(cx.project?.length).toBe(4);
		cx.execute([{ type: 'removeEntities', entityIds: ['bowl'] }]);
		expect(cx.project?.length).toBe(4);
	});

	it('should change when the length itself is set', () => {
		const { cx } = opened(4);
		cx.execute([{ type: 'updateProject', patch: { length: 9 } }]);
		expect(cx.project?.length).toBe(9);
	});
});
