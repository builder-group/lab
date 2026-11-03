import type { TLibraryItem } from '@/modules/library';
import { createId, type TDesign, type TEntity, type TProject, type TProjectCommand, type TVec2 } from '@/modules/project';
import { frameBand, gravityOf, trajectoryAt, type TSimulationResult } from '@/modules/simulation';

// Project edits made from the Design workspace. Each function returns the commands of one undoable edit.

export interface TThemePreset {
	id: string;
	label: string;
	description: string;
}

/** Themes the Blender worker ships; unknown themes fall back to Pegboard there */
export const themePresets: readonly TThemePreset[] = [
	{ id: 'pegboard', label: 'Pegboard', description: 'Birch pegboard and toy colours, like Compose' },
	{ id: 'brass', label: 'Brass', description: 'Plaster wall, brass bars and warm studio light' }
];

export type TReactionPreset = 'none' | 'press' | 'wobble' | 'glow';
/** `theme` removes the piece's own reaction so the theme's default applies */
export type TReactionChoice = TReactionPreset | 'theme';

export const reactionChoices: readonly { value: TReactionChoice; label: string }[] = [
	{ value: 'theme', label: 'Theme Default' },
	{ value: 'none', label: 'None' },
	{ value: 'press', label: 'Press' },
	{ value: 'wobble', label: 'Wobble' },
	{ value: 'glow', label: 'Glow' }
];

export type TSkinTarget = { kind: 'entities'; entityIds: string[] } | { kind: 'pieceType'; pieceType: string };

export function themeCommands(project: TProject, themeId: string): TProjectCommand[] {
	if (project.design.theme === themeId) return [];
	return [{ type: 'setDesign', design: { theme: themeId } }];
}

export function cameraCommands(project: TProject, patch: Partial<TDesign['camera']>): TProjectCommand[] {
	return [{ type: 'setDesign', design: { camera: { ...project.design.camera, ...patch } } }];
}

/** Pieces a skin target covers: the given piece entities, or every piece of a type */
export function skinTargetIds(project: TProject, target: TSkinTarget): string[] {
	return project.entities
		.filter((entity) => {
			const piece = entity.components.piece;
			if (piece == null) return false;
			return target.kind === 'entities' ? target.entityIds.includes(entity.id) : piece.type === target.pieceType;
		})
		.map((entity) => entity.id);
}

/** Sets a linked skin on every targeted piece */
export function skinCommands(project: TProject, target: TSkinTarget, assetId: string): TProjectCommand[] {
	return skinTargetIds(project, target).map((entityId) => ({
		type: 'setComponent' as const,
		entityId,
		component: { name: 'skin' as const, value: { assetId, link: 'linked' as const } }
	}));
}

/** Removes the pieces' own skin so the theme's default skin applies again */
export function clearSkinCommands(project: TProject, entityIds: string[]): TProjectCommand[] {
	return project.entities
		.filter((entity) => entityIds.includes(entity.id) && entity.components.skin != null)
		.map((entity) => ({ type: 'removeComponent' as const, entityId: entity.id, name: 'skin' as const }));
}

export function reactionCommands(project: TProject, entityIds: string[], choice: TReactionChoice): TProjectCommand[] {
	const pieces = project.entities.filter((entity) => entityIds.includes(entity.id) && entity.components.piece != null);
	if (choice === 'theme') {
		return pieces
			.filter((entity) => entity.components.reaction != null)
			.map((entity) => ({ type: 'removeComponent' as const, entityId: entity.id, name: 'reaction' as const }));
	}
	return pieces.map((entity) => ({
		type: 'setComponent' as const,
		entityId: entity.id,
		component: { name: 'reaction' as const, value: { preset: choice, params: entity.components.reaction?.params ?? {} } }
	}));
}

export function reactionChoiceOf(entity: TEntity): TReactionChoice {
	const preset = entity.components.reaction?.preset;
	return preset === 'none' || preset === 'press' || preset === 'wobble' || preset === 'glow' ? preset : 'theme';
}

/** Whether a library item can skin a piece type: a skin made for that type, or for any type */
export function itemFitsPieceType(item: TLibraryItem, pieceType: string | null): boolean {
	const manifest = item.manifest;
	if (manifest == null || manifest.role !== 'skin') return false;
	return manifest.pieceType == null || pieceType == null || manifest.pieceType === pieceType;
}

// MARK: - Wall text

export const DEFAULT_WALL_TEXT = { text: 'Title', font: 'Bfont Regular', size: 0.03, depth: 0.002, color: '#1d1d1f' };

export function addWallTextCommands(point: TVec2, text = DEFAULT_WALL_TEXT.text): { commands: TProjectCommand[]; entityId: string } {
	const entity: TEntity = {
		id: createId('text'),
		name: text,
		components: {
			wallText: { ...DEFAULT_WALL_TEXT, text },
			transform: { position: { x: round(point.x), y: round(point.y) }, angle: 0 }
		}
	};
	return { commands: [{ type: 'upsertEntity', entity }], entityId: entity.id };
}

/**
 * Wall point under a click on the preview, in 0..1 image coordinates. Approximates the film camera as a
 * front view of the frame band centred on the marble at the playhead; the inspector refines the position.
 */
export function previewPointToWall(
	project: TProject,
	result: TSimulationResult | null,
	time: number,
	u: number,
	v: number
): TVec2 {
	const band = frameBand(project);
	const marble = project.entities.find((entity) => entity.components.marble != null);
	const track = result?.marbles.find((item) => item.entityId === marble?.id);
	const focus = (track == null ? null : trajectoryAt(track.samples, time, gravityOf(project))?.position) ?? marble?.components.release?.position ?? { x: band.centerX, y: 0 };
	const width = band.halfWidth * 2;
	const height = width * (project.frame.height / project.frame.width);
	return { x: band.centerX + (u - 0.5) * width, y: focus.y - (v - 0.5) * height };
}

function round(value: number): number {
	return Math.round(value * 10000) / 10000;
}
