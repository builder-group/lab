import { describe, expect, it } from 'vitest';
import { createProject, type TProject } from '@/modules/project';
import { StudioCx } from './StudioCx';

function opened(end: number): { cx: StudioCx; laneId: string } {
	const project = createProject({ title: 'Song' });
	const lane = project.music.lanes[0];
	if (lane == null) throw new Error('No lane');
	lane.hits = [{ id: 'h0', time: 1 }, { id: 'h1', time: 3.6 }];
	const cx = new StudioCx();
	(cx as unknown as { load: (project: TProject, path: string) => void }).load({ ...project, end }, '/tmp/Song.marble');
	return { cx, laneId: lane.id };
}

describe('the film length', () => {
	// 4 is the last hit plus its tail: it read as following the song, and edits dragged it along
	it.each([4, 34])('should stay %d through adding and deleting hits', (end) => {
		const { cx, laneId } = opened(end);
		cx.execute([{ type: 'upsertHits', laneId, hits: [{ id: 'h2', time: 3.9 }] }]);
		expect(cx.project?.end).toBe(end);
		cx.execute([{ type: 'removeHits', laneId, hitIds: ['h1', 'h2'] }]);
		expect(cx.project?.end).toBe(end);
	});

	it('should stay when a Bowl is added or removed', () => {
		const { cx, laneId } = opened(4);
		cx.execute([{ type: 'upsertEntity', entity: { id: 'bowl', components: { piece: { type: 'bowl', params: {} }, hitLink: { laneId, hitId: 'h1', angle: 0, contactAt: 0.5, anchored: true } } } }]);
		expect(cx.project?.end).toBe(4);
		cx.execute([{ type: 'removeEntities', entityIds: ['bowl'] }]);
		expect(cx.project?.end).toBe(4);
	});

	it('should change when the length itself is set', () => {
		const { cx } = opened(4);
		cx.execute([{ type: 'setEnd', end: 9 }]);
		expect(cx.project?.end).toBe(9);
	});
});
