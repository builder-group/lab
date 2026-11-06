import { describe, expect, it, vi } from 'vitest';
import { checkPattern } from '@/modules/building';
import { type TPatternAnswer } from '@/modules/building/patterns/pattern.worker';
import { createHistory, type TProject, type TProjectHistory } from '@/modules/project';
import { loadFixture } from '@/modules/project/test-helpers';
import { answerSettle, createSimulator, type TEditRequest } from '@/modules/simulation';
import { StudioCx } from '@/modules/studio';
import { PatternsCx } from './PatternsCx';

const client = vi.hoisted(() => ({ current: null as unknown }));

vi.mock('@/modules/simulation', async (original) => ({
	...(await original<typeof import('@/modules/simulation/index')>()),
	createSimulationClient: () => client.current
}));
vi.mock('@/modules/studio/next-frame', () => ({
	onNextFrame: (run: () => void) => {
		const timer = setTimeout(run, 0);
		return () => clearTimeout(timer);
	}
}));

const flush = async (): Promise<void> => {
	for (let i = 0; i < 20; i++) await new Promise((resolve) => setTimeout(resolve, 5));
};

describe('a Pattern asked for while an edit settles', () => {
	it('should fit the settled project and keep every hit on time', async () => {
		// Prepare
		const sim = await createSimulator();
		let openSettle: () => void = () => undefined;
		const settleGate = new Promise<void>((resolve) => (openSettle = resolve));
		client.current = {
			simulate: async (project: TProject) => sim.simulate(project),
			settle: async (request: TEditRequest) => {
				await settleGate;
				return answerSettle(sim, request, null).answer;
			},
			dispose: () => undefined
		};
		const cx = new StudioCx();
		const unmount = cx.simulation.mount();
		cx.$history.set(createHistory(loadFixture('zigzag')));
		await flush();
		const project = cx.project as TProject;
		const marble = project.marbles[0];
		const edited = project.track.pieces.find((piece) => piece.id === 'piece-1-5');
		if (marble == null || edited == null) throw new Error('Missing fixture parts');
		const patterns = new PatternsCx(cx);
		const fitted: TProject[] = [];
		let openFit: () => void = () => undefined;
		const fitGate = new Promise<void>((resolve) => (openFit = resolve));
		(patterns as unknown as { client: unknown }).client = {
			run: async (asked: TProject, change: Parameters<typeof checkPattern>[1]): Promise<TPatternAnswer> => {
				fitted.push(asked);
				const { project: _after, ...answer } = checkPattern(asked, change, { sim });
				await fitGate;
				return { ...answer, pieces: [] };
			},
			cancel: () => undefined,
			cancelPreview: () => undefined,
			dispose: () => undefined
		};
		cx.execute([{ type: 'updatePiece', pieceId: edited.id, patch: { angle: edited.angle + 0.08 } }]);
		expect(cx.simulation.isSettling).toBe(true);
		const unsettled = cx.project as TProject;

		// Act
		const fitting = patterns.apply({ marbleId: marble.id, from: marble.hits[5]?.time ?? 0, to: marble.hits[9]?.time ?? 0 }, 'zigzag');
		await flush();
		openSettle();
		await flush();
		openFit();
		await fitting;

		// Assert
		const history = cx.$history.get() as TProjectHistory;
		const hits = sim.simulate(history.present).hits;
		expect(hits.filter((hit) => hit.status === 'onTime')).toHaveLength(hits.length);
		expect(fitted).toHaveLength(1);
		expect(fitted[0]?.revision).toBeGreaterThan(unsettled.revision);
		unmount();
	}, 30000);
});
