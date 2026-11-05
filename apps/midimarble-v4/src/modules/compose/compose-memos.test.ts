import { describe, expect, it } from 'vitest';
import { createHistory, createLane, createMarble, createProject, type TProject } from '@/modules/project';
import type { TResolvedPiece, TSimulationResult } from '@/modules/simulation';
import { StudioCx } from '@/modules/studio/StudioCx';
import { createFreePiece, displayPiece } from './attach-edit';
import { ComposeCx } from './ComposeCx';

function shown(): { cx: StudioCx; compose: ComposeCx; project: TProject; result: TSimulationResult; piece: TResolvedPiece } {
	const created = createProject({ title: 'Song' });
	const lane = createLane(0);
	const marble = createMarble(lane, { x: 0, y: 0 });
	const pose = { position: { x: 0.2, y: -0.2 }, angle: 0 };
	const entity = createFreePiece('platform', pose, [marble]);
	const piece = displayPiece(entity, { pose });
	const project: TProject = { ...created, music: { ...created.music, lanes: [lane] }, entities: [marble, entity] };
	const result = { revision: project.revision, duration: project.end, marbles: [], pieces: [piece], contacts: [], hits: [], stats: { computeMs: 0, reusedUntil: 0, steps: 0 } } as unknown as TSimulationResult;
	const cx = new StudioCx();
	cx.$history.set(createHistory(project));
	cx.simulation.$result.set(result);
	return { cx, compose: new ComposeCx(cx), project, result, piece };
}

describe('displayPieces method', () => {
	it('should give the same array while nothing it reads changed', () => {
		// Prepare
		const { cx, compose } = shown();
		const first = compose.displayPieces();

		// Act
		cx.$playhead.set(3);
		cx.$selection.set(['anything']);

		// Assert
		expect(compose.displayPieces()).toBe(first);
	});

	it('should show the dragged piece and let it go again', () => {
		// Prepare
		const { compose, piece } = shown();
		const dragged = { ...piece, angle: 1 };

		// Act
		compose.$override.set(dragged);
		const during = compose.displayPieces();
		compose.$override.set(null);

		// Assert
		expect(during).toEqual([dragged]);
		expect(compose.displayPieces()).toEqual([piece]);
	});

	it('should show a placing piece and drop a hidden one', () => {
		// Prepare
		const { cx, compose, piece } = shown();
		const placing = { ...piece, entityId: 'placing' };

		// Act
		compose.$placing.set(placing);
		const during = compose.displayPieces();
		compose.$placing.set(null);
		cx.$hidden.set([piece.entityId]);

		// Assert
		expect(during).toEqual([piece, placing]);
		expect(compose.displayPieces()).toEqual([]);
	});

	it('should follow a new run and a new project state', () => {
		// Prepare
		const { cx, compose, project, result, piece } = shown();
		const moved = { ...piece, angle: 2 };
		const first = compose.displayPieces();

		// Act
		cx.simulation.$result.set({ ...result, pieces: [moved] });
		const afterRun = compose.displayPieces();
		cx.$history.set(createHistory({ ...project }));

		// Assert
		expect(afterRun).toEqual([moved]);
		expect(compose.displayPieces()).not.toBe(first);
		expect(compose.displayPieces()).not.toBe(afterRun);
	});
});
