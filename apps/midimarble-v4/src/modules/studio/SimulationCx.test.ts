import { createState } from 'feature-state';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { amendHistory, applyProjectCommands, createHistory, pushHistory, undoHistory, type TProject, type TProjectCommand, type TProjectHistory, tieOf } from '@/modules/project';
import { loadFixture } from '@/modules/project/test-helpers';
import { answerSettle, createSimulator, type TSettleBase, type TSettleRequest, type TSimulationResult } from '@/modules/simulation';
import { SimulationCx } from './SimulationCx';
import type { StudioCx } from './StudioCx';

const client = vi.hoisted(() => ({ current: null as unknown }));

vi.mock('@/modules/simulation', async (original) => ({
	...(await original<typeof import('@/modules/simulation/index')>()),
	createSimulationClient: () => client.current
}));
vi.mock('./next-frame', () => ({
	onNextFrame: (run: () => void) => {
		const timer = setTimeout(run, 0);
		return () => clearTimeout(timer);
	}
}));

async function setup(): Promise<{ cx: SimulationCx; studio: StudioCx; simulated: TProject[]; asked: TSettleRequest[]; execute: (commands: TProjectCommand[]) => void; flush: () => Promise<void> }> {
	const simulator = await createSimulator();
	const settleSimulator = await createSimulator();
	const simulated: TProject[] = [];
	const asked: TSettleRequest[] = [];
	let memo: TSettleBase | null = null;
	client.current = {
		simulate: async (project: TProject): Promise<TSimulationResult> => {
			simulated.push(project);
			return simulator.simulate(project);
		},
		settle: async (request: TSettleRequest) => {
			asked.push(request);
			const { answer, memo: next } = answerSettle(settleSimulator, request, memo);
			memo = next;
			return answer;
		},
		dispose: () => undefined
	};
	const $history = createState<TProjectHistory | null>(createHistory(loadFixture('zigzag')));
	const apply = (commands: TProjectCommand[], isAmend: boolean): boolean => {
		const history = $history.get();
		if (history == null) return false;
		const [isOk, , edited] = applyProjectCommands(history.present, commands);
		if (!isOk) return false;
		$history.set(isAmend ? amendHistory(history, edited) : pushHistory(history, edited));
		return true;
	};
	const studio = {
		$history,
		assist: { isBuilding: false, isFixing: false },
		get project() {
			return $history.get()?.present ?? null;
		},
		execute: (commands: TProjectCommand[], options: { amend?: boolean } = {}) => apply(commands, options.amend === true),
		notify: vi.fn(),
		notifyEdit: vi.fn()
	} as unknown as StudioCx;
	const cx = new SimulationCx(studio);
	cx.mount();
	const flush = async (): Promise<void> => {
		for (let i = 0; i < 40; i++) await new Promise((resolve) => setTimeout(resolve, 5));
	};
	await flush();
	const execute = (commands: TProjectCommand[]): void => {
		apply(commands, false);
	};
	return { cx, studio, simulated, asked, execute, flush };
}

function turn(project: TProject, id: string, by: number): TProjectCommand[] {
	const piece = project.track.pieces.find((item) => item.id === id);
	const link = tieOf(piece);
	if (piece == null || link == null) throw new Error('Missing platform');
	return [{ type: 'updatePiece', pieceId: id, patch: { angle: piece.angle + by } }];
}

function leavesOf(project: TProject, id: string): unknown {
	const place = project.track.pieces.find((piece) => piece.id === id)?.place;
	return place?.kind === 'plays' ? place.leaves : undefined;
}

describe('SimulationCx class', () => {
	beforeEach(() => {
		client.current = null;
	});

	describe('an edit', () => {
		it('should fold what the next platforms take up into its one undo step, its run waiting for them', async () => {
			// Prepare
			const { cx, studio, simulated, asked, execute, flush } = await setup();
			const project = studio.project as TProject;
			simulated.length = 0;

			// Act
			execute(turn(project, 'piece-1-5', 0.02));
			expect(cx.isSettling).toBe(true);
			await flush();

			// Assert
			const history = (studio as unknown as { $history: { get: () => TProjectHistory } }).$history.get();
			expect(history.past).toHaveLength(1);
			expect(asked).toHaveLength(1);
			expect(cx.isSettling).toBe(false);
			expect(simulated.every((item) => leavesOf(item, 'piece-1-7') != null)).toBe(true);
			expect(cx.$result.get()?.hits.every((hit) => hit.status === 'onTime')).toBe(true);
		});

		it('should leave an undo alone', async () => {
			// Prepare
			const { cx, studio, asked, execute, flush } = await setup();
			const $history = (studio as unknown as { $history: { get: () => TProjectHistory; set: (value: TProjectHistory) => void } }).$history;
			execute(turn(studio.project as TProject, 'piece-1-5', 0.02));
			await flush();
			asked.length = 0;

			// Act
			$history.set(undoHistory($history.get()));
			await flush();

			// Assert
			expect(asked).toHaveLength(0);
			expect(cx.isSettling).toBe(false);
			expect(cx.$result.get()?.revision).toBe(studio.project?.revision);
		});
	});

	describe('a preview', () => {
		it('should show what the edit will do, with the next platforms taking it up', async () => {
			// Prepare
			const { cx, studio, simulated, flush } = await setup();
			const project = studio.project as TProject;
			const [isOk, , moved] = applyProjectCommands(project, turn(project, 'piece-1-5', 0.02));
			if (!isOk) throw new Error('Could not turn');
			simulated.length = 0;

			// Act
			cx.startPreview(moved);
			await flush();

			// Assert
			expect(leavesOf(simulated.at(-1) as TProject, 'piece-1-7')).toBeDefined();
			expect(studio.project).toBe(project);
		});
	});
});
