import { describe, expect, it } from 'vitest';
import { createHistory, createMarble, createProject, type TProject } from '@/modules/project';
import type { TResolvedPiece, TSimulationResult } from '@/modules/simulation';
import { StudioCx } from '@/modules/studio';
import { createFreePiece, displayPiece } from '@/modules/building';
import { TrackCx } from './TrackCx';

function shown(): { cx: StudioCx; trackCx: TrackCx; project: TProject; result: TSimulationResult; piece: TResolvedPiece } {
	const created = createProject({ title: 'Song' });
	const marble = createMarble(0, { x: 0, y: 0 });
	const pose = { position: { x: 0.2, y: -0.2 }, angle: 0 };
	const entity = createFreePiece('platform', pose, []);
	const piece = displayPiece(entity, { pose });
	const project: TProject = { ...created, marbles: [marble], track: { ...created.track, pieces: [entity] } };
	const result = { revision: project.revision, duration: project.length, marbles: [], pieces: [piece], contacts: [], hits: [], stats: { computeMs: 0, reusedUntil: 0, steps: 0 } } as unknown as TSimulationResult;
	const cx = new StudioCx();
	cx.$history.set(createHistory(project));
	cx.simulation.$result.set(result);
	return { cx, trackCx: new TrackCx(cx), project, result, piece };
}

describe('pickScene method', () => {
	it('should keep the scene through pointer moves and playback', () => {
		// Prepare
		const { cx, trackCx } = shown();
		const first = trackCx.pickScene();

		// Act
		cx.$playhead.set(3);

		// Assert
		expect(trackCx.pickScene()).toBe(first);
	});

	it('should rebuild for what a pick depends on', () => {
		// Prepare
		const { cx, trackCx, piece, result } = shown();
		const pieceIds = (): string[] => trackCx.pickScene().pieces.map((item) => item.entityId);
		const isSelected = (): boolean | undefined => trackCx.pickScene().pieces[0]?.isSelected;
		const outline = (): unknown => trackCx.pickScene().pieces[0]?.corners;
		expect(pieceIds()).toEqual([piece.entityId]);
		expect(isSelected()).toBe(false);

		// Act, Assert: selection
		cx.$selection.set([piece.entityId]);
		expect(isSelected()).toBe(true);
		cx.$selection.set([]);

		// Act, Assert: hidden and locked
		cx.$hidden.set([piece.entityId]);
		expect(pieceIds()).toEqual([]);
		cx.$hidden.set([]);
		cx.$locked.set([piece.entityId]);
		expect(pieceIds()).toEqual([]);
		cx.$locked.set([]);

		// Act, Assert: the dragged piece
		const before = outline();
		trackCx.$override.set({ ...piece, angle: 1 });
		expect(outline()).not.toEqual(before);
		trackCx.$override.set(null);
		expect(outline()).toEqual(before);

		// Act, Assert: a new run
		cx.simulation.$result.set({ ...result, pieces: [] });
		expect(pieceIds()).toEqual([]);
	});

	it('should rebuild for the tool, which decides whether placed dots pick', () => {
		// Prepare
		const { cx, trackCx, piece, result, project } = shown();
		const hit = { marbleId: project.marbles[0]?.id, hitId: 'a', targetTime: 1, dot: { x: 0, y: 0 }, pieceEntityId: piece.entityId, status: 'onTime' };
		cx.simulation.$result.set({ ...result, hits: [hit] } as unknown as TSimulationResult);
		expect(trackCx.pickScene().dots).toHaveLength(1);

		// Act
		trackCx.$tool.set('hand');

		// Assert
		expect(trackCx.pickScene().dots).toHaveLength(0);
	});
});

describe('displayPieces method', () => {
	it('should give the same array while nothing it reads changed', () => {
		// Prepare
		const { cx, trackCx } = shown();
		const first = trackCx.displayPieces();

		// Act
		cx.$playhead.set(3);
		cx.$selection.set(['anything']);

		// Assert
		expect(trackCx.displayPieces()).toBe(first);
	});

	it('should show the dragged piece and let it go again', () => {
		// Prepare
		const { trackCx, piece } = shown();
		const dragged = { ...piece, angle: 1 };

		// Act
		trackCx.$override.set(dragged);
		const during = trackCx.displayPieces();
		trackCx.$override.set(null);

		// Assert
		expect(during).toEqual([dragged]);
		expect(trackCx.displayPieces()).toEqual([piece]);
	});

	it('should show a placing piece and drop a hidden one', () => {
		// Prepare
		const { cx, trackCx, piece } = shown();
		const placing = { ...piece, entityId: 'placing' };

		// Act
		trackCx.$placing.set(placing);
		const during = trackCx.displayPieces();
		trackCx.$placing.set(null);
		cx.$hidden.set([piece.entityId]);

		// Assert
		expect(during).toEqual([piece, placing]);
		expect(trackCx.displayPieces()).toEqual([]);
	});

	it('should follow a new run and a new project state', () => {
		// Prepare
		const { cx, trackCx, project, result, piece } = shown();
		const moved = { ...piece, angle: 2 };
		const first = trackCx.displayPieces();

		// Act
		cx.simulation.$result.set({ ...result, pieces: [moved] });
		const afterRun = trackCx.displayPieces();
		cx.$history.set(createHistory({ ...project }));

		// Assert
		expect(afterRun).toEqual([moved]);
		expect(trackCx.displayPieces()).not.toBe(first);
		expect(trackCx.displayPieces()).not.toBe(afterRun);
	});
});
