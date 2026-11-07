import { describe, expect, it, vi } from 'vitest';
import { createHistory, createMarble, createProject, type TPatternGroup, type TProject } from '@/modules/project';
import { createLinkedPiece } from '@/modules/simulation';
import { PatternCanceledError, type TProposeDeps } from '@/modules/building';
import type { TSimulationResult } from '@/modules/simulation';
import { type TPatternAnswer } from '@/modules/building/patterns/pattern.worker';
import { StudioCx } from '@/modules/studio';
import { PatternsCx } from './PatternsCx';

function studio(): { cx: StudioCx; patterns: PatternsCx; group: TPatternGroup; run: ReturnType<typeof vi.fn> } {
	const created = createProject({ title: 'Song' });
	const marble = { ...createMarble(0, { x: 0, y: 0 }), hits: [{ id: 'hit1', time: 1, pitch: 60 }, { id: 'hit2', time: 2, pitch: 62 }] };
	const pieces = marble.hits.map((hit, index) => createLinkedPiece('platform', marble.id, hit.id, 0.3, { id: `piece-${index}` }));
	const group: TPatternGroup = { id: 'group-1', name: 'Zigzag', marbleId: marble.id, pieceIds: pieces.map((piece) => piece.id), pattern: { kind: 'zigzag', hitIds: ['hit1', 'hit2'], width: 0.14, bounce: 0.5 } };
	const project: TProject = { ...created, marbles: [marble], track: { ...created.track, pieces, groups: [group] } };
	const cx = new StudioCx();
	cx.$history.set(createHistory(project));
	const patterns = new PatternsCx(cx);
	const run = vi.fn();
	(patterns as unknown as { client: unknown }).client = { run, cancel: () => run.mock.results.at(-1), dispose: () => undefined };
	return { cx, patterns, group, run };
}

describe('Gravity and live Patterns', () => {
	it('should fit a Pattern again in the same Undo step as the change', async () => {
		const { cx, patterns, group, run } = studio();
		const steps = cx.$history.get()?.past.length ?? 0;
		const answer = { commands: [{ type: 'addGroup', group: { ...group, pattern: { ...group.pattern, width: 0.15 } } }], groupId: group.id, name: group.name, problems: [], later: [], laterLateHits: 0, otherMarbleTouches: [], notes: [] } as unknown as TPatternAnswer;
		run.mockResolvedValue(answer);

		await patterns.setGravity(0.5);

		expect(run.mock.calls[0]?.[1]).toMatchObject({ groupId: group.id, kind: 'zigzag' });
		expect(run.mock.calls[0]?.[0].gravity).toBe(0.5);
		expect(cx.project?.track.groups[0]).toMatchObject({ pattern: { width: 0.15 } });
		expect(cx.$history.get()?.past.length).toBe(steps + 1);
	});

	it('should take the change back and say so when a note stops playing, with Change Anyway to land it', async () => {
		const { cx, patterns, group, run } = studio();
		const before = cx.project?.gravity;
		run.mockResolvedValue({ commands: [{ type: 'addGroup', group }], groupId: group.id, name: group.name, problems: [], later: [], laterLateHits: 0, otherMarbleTouches: [], notes: [] } as unknown as TPatternAnswer);
		const marbleId = cx.project?.marbles[0]?.id ?? '';
		const runOf = (status: 'onTime' | 'missed'): TSimulationResult => ({ hits: [{ marbleId, hitId: 'hit1', status: 'onTime' }, { marbleId, hitId: 'hit2', status }] }) as unknown as TSimulationResult;
		cx.assist.proposeDeps = () => ({ simulate: (project: TProject) => runOf(project.gravity === 0.5 ? 'missed' : 'onTime') }) as unknown as TProposeDeps;

		await patterns.setGravity(0.5);

		expect(cx.project?.gravity).toEqual(before);
		const notice = cx.$notice.get();
		expect(notice?.message).toBe(`Note 2 of Marble 1 stops playing at Gravity 0.50. Gravity stays ${before?.toFixed(2)}.`);
		notice?.actions?.find((action) => action.label === 'Change Anyway')?.run();
		await vi.waitFor(() => expect(cx.project?.gravity).toBe(0.5));
	});

	it('should take the change back on Stop', async () => {
		const { cx, patterns, run } = studio();
		const before = cx.project?.gravity;
		run.mockImplementation(async () => {
			patterns.stop();
			throw new PatternCanceledError();
		});

		await patterns.setGravity(0.5);

		expect(cx.project?.gravity).toEqual(before);
	});
});
