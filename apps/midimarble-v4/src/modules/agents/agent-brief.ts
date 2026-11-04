import { BUILT_IN_THEMES, resolveTheme, THEME_OVERRIDE_FIELDS, themeDefaultColor } from '@/modules/design/project-themes';
import type { TAssetRole } from '@/modules/library';
import { DEFAULT_MARBLE_RADIUS, type TProject, type TVec2 } from '@/modules/project';
import {
	getPieceDefinition,
	isMusicalPiece,
	resolvePieceParams,
	type TPieceLayoutKind,
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
	/** Set for a New Theme request: the agent also proposes the theme's colours in its manifest */
	theme?: TAgentBriefTheme;
}

/** What a New Theme run may propose: a name, a built-in base and the colours a project theme changes */
export interface TAgentBriefTheme {
	/** Built-in theme the project shows now, the default base */
	base: string;
	/** Built-in themes a proposal may start from */
	bases: string[];
	fields: { name: string; label: string; description: string; value?: string }[];
}

export type TAgentTargetKind = 'piece' | 'scene' | 'wall';
export type TReactionSlot = 'press' | 'wobble' | 'glow';

export type TAgentTarget =
	| { kind: 'piece'; entityId: string }
	| { kind: 'scene' }
	| { kind: 'wall'; point: TVec2; role?: 'decoration' | 'text' };

const TIMING_PARAMS = new Set(['entryDelay']);

/** Builds the brief for a target from the project and its latest simulation result */
export function buildAgentBrief(options: {
	project: TProject;
	result: TSimulationResult | null;
	target: TAgentTarget;
	request: string;
}): TAgentBrief {
	const brief = buildTargetBrief(options);
	return isNewThemeRequest(brief.request) ? { ...brief, theme: themeBrief(options.project) } : brief;
}

/** Prompt the library's New Theme with Agent… action starts the composer with */
export const NEW_THEME_PROMPT = 'New theme: ';

export function isNewThemeRequest(request: string): boolean {
	// The request starts with the mentions, such as `@[Platform 1] @[Rail 1] New theme: …`
	return /^(@\[[^\]]*\]\s*)*new theme:/i.test(request.trim());
}

/** The theme section of a New Theme brief: the current theme's base and its colours as the starting point */
function themeBrief(project: TProject): TAgentBriefTheme {
	const theme = resolveTheme(project.design);
	return {
		base: theme.base,
		bases: BUILT_IN_THEMES.map((item) => item.id),
		fields: THEME_OVERRIDE_FIELDS.map((field) => {
			const value = theme.overrides[field.name] ?? themeDefaultColor(theme.base, field.name);
			return { name: field.name, label: field.label, description: field.help, ...(value != null ? { value } : {}) };
		})
	};
}

function buildTargetBrief(options: { project: TProject; result: TSimulationResult | null; target: TAgentTarget; request: string }): TAgentBrief {
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
	// Timing parameters say when a piece enters the run, not what it looks like
	const params = Object.entries(resolved)
		.filter(([name]) => !TIMING_PARAMS.has(name))
		.map(([name, value]) => ({
			name,
			label: definition?.params[name]?.label ?? name,
			value: round(value),
			unit: definition?.params[name]?.unit ?? ''
		}));
	const pose = result?.pieces.find((item) => item.entityId === entity.id) ?? null;
	// Scenery sounds no hit, so its strikes are the contacts that start on it
	const hitTimes = (
		isMusicalPiece(piece.type)
			? (result?.hits ?? [])
					.filter((hit) => hit.pieceEntityId === entity.id)
					.map((hit) => hit.actualTime ?? hit.targetTime)
			: (result?.contacts ?? [])
					.filter((contact) => contact.otherEntityId === entity.id)
					.map((contact) => contact.time)
	)
		.map(round)
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
	layout: TPieceLayoutKind | undefined
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
		case 'holder':
			return `The marble zigzags down a switchback of sloped wire legs between two walls, ${value('width')} wide, with wires of radius ${value('radius')}. Model a straight 0.1 m wire section along X with its top line at z = 0; the worker places one per leg and wall.`;
	}
}

function reactionSlots(layout: TPieceLayoutKind | undefined): TAgentBrief['reactionSlots'] {
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
		case 'holder':
			return [{ name: 'glow', description: 'An emissive part flashes while the marble passes' }];
	}
}

function round(value: number): number {
	return Math.round(value * 1e5) / 1e5;
}

function roundVec(value: TVec2): TVec2 {
	return { x: round(value.x), y: round(value.y) };
}
