import { displayPiece } from '@/modules/compose/attach-edit';
import { newlyBroken } from '@/modules/compose/bowl-assist';
import { addedProblems, withCommands } from '@/modules/compose/fix-it';
import { createId, type TEntity, type TProject, type TProjectCommand, type TVec2 } from '@/modules/project';
import { layoutOf, nextPieceName, shapesBounds, shapesDistance, soundsHit, transformShape, unanchorPiece, unlinkPiece, type TPieceShape, type TSimulationResult } from '@/modules/simulation';
import { resolvedPieceShapes, shapesGap } from '@/modules/simulation/clearance';

/** How far a copy lands from its original, right and down on the wall in metres, like Finder's and Figma's Duplicate */
export const DUPLICATE_OFFSET = { x: 0.05, y: -0.05 };

// Clearance kept from every marble's path, beyond its radius, and from other pieces
const CLEAR_MARGIN = 0.004;
const PIECE_GAP = 0.002;
// The nearby search walks rings around the first spot, closest first
const RING_STEP = 0.02;
const RING_MAX = 0.4;
const RING_DIRECTIONS = 16;
// What-if runs a nearby spot may take; the next tries the marble-free side
const NEARBY_TRIES = 3;
// The marble-free side: past the paths at the copies' height, stepping outward when a piece is there
const SIDE_MARGIN = 0.03;
const SIDE_STEP = 0.05;
const SIDE_TRIES = 40;

/**
 * Duplicate (⌘D) for pieces: each copy is a free piece with the next default name, `offset` from where the original
 * is now. A note has one platform, so a copy never plays the note or follows the marble of its original. Pieces
 * without a pose in this run are skipped. One edit for the whole selection.
 */
export function duplicatePieces(project: TProject, result: TSimulationResult | null, entityIds: string[], offset: TVec2 = DUPLICATE_OFFSET): TDuplicate {
	const commands: TProjectCommand[] = [];
	const copies: TEntity[] = [];
	let entities = project.entities;
	for (const entityId of entityIds) {
		const entity = project.entities.find((item) => item.id === entityId);
		const type = entity?.components.piece?.type;
		if (entity == null || type == null) continue;
		const free = freeEntity(project, result, entity);
		const transform = free?.components.transform;
		if (free == null || transform == null) continue;
		const copy: TEntity = {
			...free,
			id: createId('piece'),
			name: nextPieceName(type, entities),
			components: {
				...free.components,
				transform: { ...transform, position: { x: transform.position.x + offset.x, y: transform.position.y + offset.y } }
			}
		};
		entities = [...entities, copy];
		copies.push(copy);
		commands.push({ type: 'upsertEntity', entity: copy });
	}
	return { commands, copies };
}

export interface TDuplicate {
	commands: TProjectCommand[];
	copies: TEntity[];
}

/** Where the copies landed, or that every spot would break hits */
export type TClearDuplicate = (TDuplicate & { spot: 'near the original' | 'beside the run' }) | { spot: 'refused'; breaks: number };

/**
 * Duplicate that never changes the run: the copies keep together and go to the nearest spot clear of every marble's
 * path and every piece, checked with a what-if run, or to the marble-free side at their height, which the notice
 * then says. When even that would break hits, nothing is copied. Without `simulate` the clearance alone decides.
 */
export async function duplicateClear(project: TProject, result: TSimulationResult | null, entityIds: string[], simulate: ((project: TProject) => Promise<TSimulationResult>) | null): Promise<TClearDuplicate> {
	const atOriginals = duplicatePieces(project, result, entityIds, { x: 0, y: 0 });
	// Without a run nothing moves a marble's path yet that a spot could be checked against
	if (result == null || !atOriginals.copies.length) return { ...duplicatePieces(project, result, entityIds), spot: 'near the original' };
	const field = clearField(result, atOriginals.copies);
	const base = result.revision === project.revision || simulate == null ? result : await simulate(project);
	const fails = async (offset: TVec2): Promise<number | null> => {
		if (simulate == null) return null;
		const { commands } = duplicatePieces(project, result, entityIds, offset);
		const next = withCommands(project, commands);
		const run = await simulate(next);
		const broken = newlyBroken(base.hits, run.hits).length;
		return broken > 0 ? broken : addedProblems(project, base, next, run).length > 0 ? 1 : null;
	};
	let breaks = 0;
	let tries = 0;
	for (const offset of nearbyOffsets()) {
		if (!field.isClear(offset)) continue;
		const failed = await fails(offset);
		if (failed == null) return { ...duplicatePieces(project, result, entityIds, offset), spot: 'near the original' };
		breaks = Math.max(breaks, failed);
		if (++tries >= NEARBY_TRIES) break;
	}
	const side = field.sideOffset();
	if (side != null) {
		const failed = await fails(side);
		if (failed == null) return { ...duplicatePieces(project, result, entityIds, side), spot: 'beside the run' };
		breaks = Math.max(breaks, failed);
	}
	return { spot: 'refused', breaks: Math.max(1, breaks) };
}

/** The usual spot first, then rings around it, closest first */
function* nearbyOffsets(): Generator<TVec2> {
	yield DUPLICATE_OFFSET;
	for (let radius = RING_STEP; radius <= RING_MAX + 1e-9; radius += RING_STEP) {
		for (let index = 0; index < RING_DIRECTIONS; index++) {
			const angle = (index / RING_DIRECTIONS) * 2 * Math.PI;
			yield { x: DUPLICATE_OFFSET.x + radius * Math.cos(angle), y: DUPLICATE_OFFSET.y + radius * Math.sin(angle) };
		}
	}
}

/** Tells for an offset of the copies whether they keep clear of every marble's path and every piece */
function clearField(result: TSimulationResult, copies: TEntity[]): { isClear: (offset: TVec2) => boolean; sideOffset: () => TVec2 | null } {
	const radius = result.marbles.reduce((most, track) => Math.max(most, track.radius), 0);
	const items = copies.map((copy) => {
		const type = copy.components.piece?.type ?? 'platform';
		const position = copy.components.transform?.position ?? { x: 0, y: 0 };
		const shapes = resolvedPieceShapes(displayPiece(copy, { pose: { position, angle: copy.components.transform?.angle ?? 0 } }, radius || undefined));
		const bounds = shapesBounds(shapes);
		// A windmill sweeps its whole circle once a marble turns it
		const isRotor = layoutOf(type) === 'rotor';
		const reach = isRotor ? Math.max(Math.hypot(bounds.minX - position.x, bounds.minY - position.y), Math.hypot(bounds.maxX - position.x, bounds.maxY - position.y)) : 0;
		return { shapes, bounds, position, isRotor, reach };
	});
	const pieces = result.pieces.filter((piece) => piece.status !== 'blocked' && piece.status !== 'unreached').map(resolvedPieceShapes);
	const samples = result.marbles.flatMap((track) => track.samples.map((sample) => ({ x: sample.position.x, y: sample.position.y, clear: track.radius + CLEAR_MARGIN })));
	const copyBounds = {
		minX: Math.min(...items.map((item) => item.bounds.minX)),
		maxX: Math.max(...items.map((item) => item.bounds.maxX)),
		minY: Math.min(...items.map((item) => item.bounds.minY)),
		maxY: Math.max(...items.map((item) => item.bounds.maxY))
	};

	const clearOfPaths = (offset: TVec2): boolean => {
		for (const item of items) {
			for (const sample of samples) {
				const x = sample.x - offset.x;
				const y = sample.y - offset.y;
				// Far samples need no exact distance
				if (x < item.bounds.minX - sample.clear - item.reach || x > item.bounds.maxX + sample.clear + item.reach || y < item.bounds.minY - sample.clear - item.reach || y > item.bounds.maxY + sample.clear + item.reach) continue;
				const distance = item.isRotor ? Math.hypot(x - item.position.x, y - item.position.y) - item.reach : shapesDistance(item.shapes, x, y);
				if (distance < sample.clear) return false;
			}
		}
		return true;
	};
	const clearOfPieces = (offset: TVec2): boolean => {
		for (const item of items) {
			const moved: TPieceShape[] = item.shapes.map((shape) => transformShape(shape, offset, 0));
			if (pieces.some((other) => shapesGap(moved, other, 0.01) < PIECE_GAP)) return false;
		}
		return true;
	};
	const isClear = (offset: TVec2): boolean => clearOfPaths(offset) && clearOfPieces(offset);

	return {
		isClear,
		sideOffset() {
			// Past the paths at the copies' height, on the nearer side
			const height = samples.filter((sample) => sample.y >= copyBounds.minY - 0.1 && sample.y <= copyBounds.maxY + 0.1);
			const pathsMaxX = Math.max(copyBounds.maxX, ...height.map((sample) => sample.x + sample.clear));
			const pathsMinX = Math.min(copyBounds.minX, ...height.map((sample) => sample.x - sample.clear));
			const right = pathsMaxX + SIDE_MARGIN - copyBounds.minX;
			const left = pathsMinX - SIDE_MARGIN - copyBounds.maxX;
			const first = Math.abs(right) <= Math.abs(left) ? 1 : -1;
			for (let step = 0; step < SIDE_TRIES; step++) {
				for (const side of [first, -first]) {
					const offset = { x: (side > 0 ? right : left) + side * step * SIDE_STEP, y: 0 };
					if (isClear(offset)) return offset;
				}
			}
			return null;
		}
	};
}

/** The piece as a free piece where it is now, or null when it is tied and has no pose in this run */
function freeEntity(project: TProject, result: TSimulationResult | null, entity: TEntity): TEntity | null {
	const link = entity.components.hitLink;
	if (link == null) return entity;
	if (result == null) return null;
	const [isOk, , value] = soundsHit(entity.components.piece?.type ?? '', link) ? unlinkPiece(project, result, entity.id) : unanchorPiece(project, result, entity.id);
	return isOk ? value.entity : null;
}
