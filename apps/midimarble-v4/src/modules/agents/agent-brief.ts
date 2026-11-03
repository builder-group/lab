import type { TAssetRole } from '@/modules/library';
import type { TProject, TVec2 } from '@/modules/project';
import {
	getPieceDefinition,
	resolvePieceParams,
	type TSimulationResult
} from '@/modules/simulation';

/** Brief written to `BRIEF.md` and `brief.json`. Mirrors `AgentBrief` in the Rust agents module. */
export interface TAgentBrief {
	request: string;
	target: {
		kind: TAgentTargetKind;
		entityId?: string;
		name?: string;
		role: TAssetRole;
		pieceType?: string;
		pieceLabel?: string;
		pieceCount?: number;
	};
	params: { name: string; label: string; value: number; unit: string }[];
	contact?: { description: string; normal?: TVec2; point?: TVec2 };
	hitTimes: number[];
	reactionSlots: { name: TReactionSlot; description: string }[];
	scale: { marbleRadius: number; notes?: string };
	wallPoint?: TVec2;
}

export type TAgentTargetKind = 'piece' | 'scene' | 'wall';
export type TReactionSlot = 'press' | 'wobble' | 'glow';

export type TAgentTarget =
	| { kind: 'piece'; entityId: string }
	| { kind: 'scene' }
	| { kind: 'wall'; point: TVec2; role?: 'decoration' | 'text' };

const DEFAULT_MARBLE_RADIUS = 0.008;

/** Builds the brief for a target from the project and its latest simulation result */
export function buildAgentBrief(options: {
	project: TProject;
	result: TSimulationResult | null;
	target: TAgentTarget;
	request: string;
}): TAgentBrief {
	const { project, result, target } = options;
	const request = options.request.trim();
	const marbleRadius =
		project.entities.find((entity) => entity.components.marble != null)?.components.marble
			?.radius ?? DEFAULT_MARBLE_RADIUS;
	const scale = {
		marbleRadius,
		notes: `The film frame is ${round(project.frame.width)} m wide and ${round(project.frame.height)} m tall on the wall`
	};

	if (target.kind === 'scene') {
		return {
			request,
			target: { kind: 'scene', role: 'decoration' },
			params: [],
			hitTimes: [],
			reactionSlots: [
				{ name: 'glow', description: 'Optional lights that flash on every hit of the run' }
			],
			scale
		};
	}

	if (target.kind === 'wall') {
		const role = target.role ?? 'decoration';
		return {
			request,
			target: { kind: 'wall', role },
			params: [],
			contact: {
				description:
					'The back of the element sits flat on the wall. Its origin is the centre of that back face and +Z points out of the wall toward the camera.'
			},
			hitTimes: [],
			reactionSlots: [],
			scale,
			wallPoint: { x: round(target.point.x), y: round(target.point.y) }
		};
	}

	const entity = project.entities.find((item) => item.id === target.entityId);
	const piece = entity?.components.piece;
	if (entity == null || piece == null) {
		return {
			request,
			target: { kind: 'piece', entityId: target.entityId, role: 'skin' },
			params: [],
			hitTimes: [],
			reactionSlots: [],
			scale
		};
	}
	const definition = getPieceDefinition(piece.type);
	const resolved = resolvePieceParams(piece.type, piece.params);
	const params = Object.entries(resolved).map(([name, value]) => ({
		name,
		label: definition?.params[name]?.label ?? name,
		value: round(value),
		unit: definition?.params[name]?.unit ?? ''
	}));
	const pose = result?.pieces.find((item) => item.entityId === entity.id) ?? null;
	const hitTimes = (result?.hits ?? [])
		.filter((hit) => hit.pieceEntityId === entity.id)
		.map((hit) => round(hit.actualTime ?? hit.targetTime))
		.sort((a, b) => a - b);
	const pieceCount = project.entities.filter(
		(item) => item.components.piece?.type === piece.type
	).length;

	return {
		request,
		target: {
			kind: 'piece',
			entityId: entity.id,
			name: entity.name,
			role: 'skin',
			pieceType: piece.type,
			pieceLabel: definition?.label ?? piece.type,
			pieceCount
		},
		params,
		contact: {
			description: describeContact(piece.type, resolved, definition?.layout),
			normal: pose?.contactNormal != null ? roundVec(pose.contactNormal) : undefined,
			point: pose?.contactPoint != null ? roundVec(pose.contactPoint) : undefined
		},
		hitTimes,
		reactionSlots: reactionSlots(definition?.layout),
		scale
	};
}

function describeContact(
	type: string,
	params: Record<string, number>,
	layout: 'box' | 'path' | 'tube' | 'rotor' | undefined
): string {
	const value = (name: string): string => `${round(params[name] ?? 0)} m`;
	switch (layout ?? 'box') {
		case 'box':
			return [
				`The marble bounces off the top face of a ${type} bar: ${value('length')} long, ${value('thickness')} thick and ${value('depth')} deep from the wall.`,
				'Keep that face flat and at the same size: it is the physics collider. X runs along the length, Y along the depth and the face lies at z = 0 with the body below it.'
			].join(' ');
		case 'path':
			return `The marble rolls along the top of a wire rail of radius ${value('radius')}. The worker bends the rail along its path; model a straight 0.1 m section along X with its top line at z = 0.`;
		case 'tube':
			return `The marble rolls through a tunnel with a wall radius of ${value('radius')}, ${value('bore')} of clearance around the marble and a ${value('mouth')} mouth. Model a straight 0.1 m section along X whose inner floor lies at z = 0; keep the inside clear.`;
		case 'rotor':
			return `The marble is struck by the blades of a windmill turning around its hub. Blades are ${value('bladeLength')} long. Put the origin at the hub centre with +Z toward the camera; the worker spins the model.`;
	}
}

function reactionSlots(
	layout: 'box' | 'path' | 'tube' | 'rotor' | undefined
): TAgentBrief['reactionSlots'] {
	switch (layout ?? 'box') {
		case 'box':
			return [
				{
					name: 'press',
					description: 'The struck part dips a few millimetres and springs back, like a key'
				},
				{ name: 'glow', description: 'An emissive part flashes on each hit' }
			];
		case 'rotor':
			return [
				{ name: 'wobble', description: 'A loose part wobbles after each strike' },
				{ name: 'glow', description: 'An emissive part flashes on each hit' }
			];
		case 'path':
		case 'tube':
			return [{ name: 'glow', description: 'An emissive part flashes while the marble passes' }];
	}
}

function round(value: number): number {
	return Math.round(value * 1e5) / 1e5;
}

function roundVec(value: TVec2): TVec2 {
	return { x: round(value.x), y: round(value.y) };
}
