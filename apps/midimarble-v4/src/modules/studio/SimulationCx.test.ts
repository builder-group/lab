import { createState } from 'feature-state';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { amendHistory, applyProjectCommands, createHistory, pushHistory, redoHistory, undoHistory, type TProject, type TProjectCommand, type TProjectHistory, tieOf } from '@/modules/project';
import { loadFixture } from '@/modules/project/test-helpers';
import { answerSettle, answerWorkerRequest, createSimulator, createWorkerMemory, type TSettleBase, type TSettleRequest, type TSimulationResult, type TWorkerMessage } from '@/modules/simulation';
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

/** Runs the real client's messages through the real answers, only when the gate opens, one worker per instance */
function workerStub(): { Worker: unknown; hold: () => () => void; simulated: TProject[] } {
	let gate: Promise<void> = Promise.resolve();
	const simulated: TProject[] = [];
	class FakeWorker {
		private readonly simulator = createSimulator();
		private readonly memory = createWorkerMemory();
		private listener: ((event: { data: unknown }) => void) | null = null;
		addEventListener(type: string, listener: (event: { data: unknown }) => void): void {
			if (type === 'message') this.listener = listener;
		}
		postMessage(request: TWorkerMessage & { id: number }): void {
			if (request.kind === 'simulate') simulated.push(request.project);
			void gate.then(async () => {
				const value = answerWorkerRequest(await this.simulator, request, this.memory);
				this.listener?.({ data: { id: request.id, ok: true, value } });
			});
		}
		terminate(): void {
			this.listener = null;
		}
	}
	const hold = (): (() => void) => {
		let open: () => void = () => undefined;
		gate = new Promise((resolve) => (open = resolve));
		return open;
	};
	return { Worker: FakeWorker, hold, simulated };
}

async function setup(makeClient?: () => unknown): Promise<{ cx: SimulationCx; studio: StudioCx; simulated: TProject[]; asked: TSettleRequest[]; execute: (commands: TProjectCommand[]) => void; flush: () => Promise<void> }> {
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
	if (makeClient != null) client.current = makeClient();
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

		it('should show the run an undo goes back to before the worker answers, and still ask for it', async () => {
			// Prepare
			const { cx, studio, execute, flush } = await setup();
			const $history = (studio as unknown as { $history: { get: () => TProjectHistory; set: (value: TProjectHistory) => void } }).$history;
			const before = cx.$result.get();
			execute(turn(studio.project as TProject, 'piece-1-5', 0.02));
			await flush();
			const asked: TProject[] = [];
			(client.current as { simulate: unknown }).simulate = (project: TProject) => {
				asked.push(project);
				return new Promise(() => undefined);
			};

			// Act
			$history.set(undoHistory($history.get()));
			await flush();

			// Assert
			expect(asked).toHaveLength(1);
			expect(cx.isCurrent).toBe(true);
			expect(cx.$computing.get()).toBe(false);
			expect(cx.$result.get()?.hits).toBe(before?.hits);
		});
	});

	describe('an edit after another that left the pieces alone', () => {
		const moveHit = (project: TProject, by: number): TProjectCommand[] => {
			const hit = project.marbles[0]?.hits[5];
			if (hit == null) throw new Error('Missing hit');
			return [{ type: 'upsertHits', marbleId: 'marble-1', hits: [{ ...hit, time: hit.time + by }] }];
		};
		const onTime = (cx: SimulationCx): number => cx.$result.get()?.hits.filter((hit) => hit.status === 'onTime').length ?? 0;

		it('should settle a moved hit after a title edit, like the same move alone', async () => {
			// Prepare
			const { cx, studio, asked, execute, flush } = await setup();
			execute([{ type: 'updateProject', patch: { title: 'Another title' } }]);
			await flush();

			// Act
			execute(moveHit(studio.project as TProject, 0.06));
			await flush();

			// Assert
			expect(asked).toHaveLength(1);
			expect(onTime(cx)).toBe(cx.$result.get()?.hits.length);
		});

		it('should settle a moved release after a title edit', async () => {
			// Prepare
			const { studio, asked, execute, flush } = await setup();
			execute([{ type: 'updateProject', patch: { title: 'Another title' } }]);
			await flush();
			const marble = (studio.project as TProject).marbles[0];
			if (marble == null) throw new Error('Missing marble');

			// Act
			execute([{ type: 'updateMarble', marbleId: marble.id, patch: { start: { ...marble.start, position: { x: marble.start.position.x + 0.002, y: marble.start.position.y } } } }]);
			await flush();

			// Assert
			expect(asked).toHaveLength(1);
		});

		it('should leave a redo alone and settle an edit made after an undo', async () => {
			// Prepare
			const { studio, asked, execute, flush } = await setup();
			const $history = (studio as unknown as { $history: { get: () => TProjectHistory; set: (value: TProjectHistory) => void } }).$history;
			execute(moveHit(studio.project as TProject, 0.06));
			await flush();
			asked.length = 0;

			// Act
			$history.set(undoHistory($history.get()));
			await flush();
			$history.set(redoHistory($history.get()));
			await flush();
			const afterSteps = asked.length;
			$history.set(undoHistory($history.get()));
			await flush();
			execute(moveHit(studio.project as TProject, 0.04));
			await flush();

			// Assert
			expect(afterSteps).toBe(0);
			expect(asked).toHaveLength(1);
		});
	});

	describe('a film edit', () => {
		const film = (project: TProject, distance: number): TProjectCommand[] => [{ type: 'updateFilm', film: { camera: { ...project.film.camera, distance } } }];

		it('should keep the run and move it to the new revision', async () => {
			// Prepare
			const { cx, studio, simulated, execute, flush } = await setup();
			const before = cx.$result.get();
			simulated.length = 0;

			// Act
			execute(film(studio.project as TProject, 3));
			await flush();

			// Assert
			expect(simulated).toHaveLength(0);
			expect(cx.isCurrent).toBe(true);
			expect(cx.$result.get()?.hits).toBe(before?.hits);
		});

		it('should keep the run through its undo', async () => {
			// Prepare
			const { cx, studio, simulated, execute, flush } = await setup();
			const $history = (studio as unknown as { $history: { get: () => TProjectHistory; set: (value: TProjectHistory) => void } }).$history;
			execute(film(studio.project as TProject, 3));
			await flush();
			simulated.length = 0;

			// Act
			$history.set(undoHistory($history.get()));
			await flush();

			// Assert
			expect(simulated).toHaveLength(0);
			expect(cx.isCurrent).toBe(true);
		});

		it('should be current when it lands while the run of a track edit is on its way', async () => {
			// Prepare
			const { cx, studio, simulated, execute, flush } = await setup();
			execute(turn(studio.project as TProject, 'piece-1-16', 0.01));
			await flush();
			simulated.length = 0;
			const present = studio.project as TProject;
			const gravity: TProjectCommand[] = [{ type: 'updateProject', patch: { gravity: (present.gravity ?? 1) * 0.999 } }];

			// Act
			execute(gravity);
			for (let i = 0; i < 3 && !cx.$computing.get(); i++) await new Promise((resolve) => setTimeout(resolve, 0));
			execute(film(studio.project as TProject, 3));
			await flush();

			// Assert
			expect(simulated).toHaveLength(1);
			expect(cx.isCurrent).toBe(true);
			expect(cx.$computing.get()).toBe(false);
		});

		it('should be current after an Undo back to a recent run while another run is still on its way', async () => {
			// Prepare
			const { cx, studio, execute, flush } = await setup();
			const $history = (studio as unknown as { $history: { get: () => TProjectHistory; set: (value: TProjectHistory) => void } }).$history;
			const working = client.current as { simulate: (project: TProject) => Promise<TSimulationResult> };
			const simulate = working.simulate;
			const waiting: (() => void)[] = [];
			working.simulate = (project) => new Promise((resolve, reject) => waiting.push(() => void simulate(project).then(resolve, reject)));
			execute([{ type: 'updateProject', patch: { gravity: ((studio.project as TProject).gravity ?? 1) * 0.999 } }]);
			for (let i = 0; i < 10 && !cx.$computing.get(); i++) await new Promise((resolve) => setTimeout(resolve, 5));
			expect(cx.$computing.get()).toBe(true);

			// Act
			$history.set(undoHistory($history.get()));
			await flush();
			execute(film(studio.project as TProject, 3));
			await flush();
			for (const land of waiting.splice(0)) land();
			await flush();

			// Assert
			expect(cx.$computing.get()).toBe(false);
			expect(cx.isCurrent).toBe(true);
		});

		it('should run again after a failed run, even with the same input', async () => {
			// Prepare
			const { cx, studio, simulated, execute, flush } = await setup();
			const working = client.current as { simulate: (project: TProject) => Promise<TSimulationResult> };
			const simulate = working.simulate;
			working.simulate = () => Promise.reject(new Error('worker lost'));
			execute([{ type: 'updateProject', patch: { length: (studio.project as TProject).length + 1 } }]);
			await flush();
			working.simulate = simulate;
			simulated.length = 0;

			// Act
			execute(film(studio.project as TProject, 3));
			await flush();

			// Assert
			expect(simulated).toHaveLength(1);
			expect(cx.isCurrent).toBe(true);
		});
	});

	describe('a paused preview while an edit waits for its settle', () => {
		afterEach(() => {
			vi.unstubAllGlobals();
		});

		it('should not take the edit\'s place, so the present runs when the preview ends', async () => {
			// Prepare
			const workers = workerStub();
			vi.stubGlobal('Worker', workers.Worker);
			const { createSimulationClient } = await vi.importActual<typeof import('@/modules/simulation/index')>('@/modules/simulation');
			const { cx, studio, execute, flush } = await setup(createSimulationClient);
			const open = workers.hold();
			const present = (): TProject => studio.project as TProject;
			const moved = (by: number): TProject => {
				const [isOk, , next] = applyProjectCommands(present(), turn(present(), 'piece-1-12', by));
				if (!isOk) throw new Error('Could not turn');
				return next;
			};

			// Act
			execute(turn(present(), 'piece-1-5', 0.02));
			execute(turn(present(), 'piece-1-9', 0.02));
			cx.startPreview(moved(0.01));
			await flush();
			cx.startPreview(moved(0.02));
			await new Promise((resolve) => setTimeout(resolve, 200));
			cx.endPreview();
			open();
			await vi.waitFor(() => expect(cx.isSettling).toBe(false), { timeout: 5000 });
			await flush();

			// Assert
			expect(cx.isCurrent).toBe(true);
			expect(workers.simulated.at(-1)?.track.pieces).toEqual(present().track.pieces);
		}, 15000);
	});

	describe('a preview', () => {
		it('should never read as the current run, whatever revision it carries', async () => {
			// Prepare
			const { cx, studio, flush } = await setup();
			const project = studio.project as TProject;
			const [isOk, , moved] = applyProjectCommands(project, turn(project, 'piece-1-5', 0.02));
			if (!isOk) throw new Error('Could not turn');
			expect(cx.isCurrent).toBe(true);

			// Act
			cx.startPreview({ ...moved, revision: project.revision });
			await flush();

			// Assert
			expect(cx.$result.get()?.hits).toBeDefined();
			expect(cx.isCurrent).toBe(false);
			cx.endPreview();
			await flush();
			expect(cx.isCurrent).toBe(true);
		});

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
