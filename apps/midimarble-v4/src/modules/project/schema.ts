import { defineSchema, type TSchemaValue } from 'versjon';
import { z } from 'zod';

// Wall-plane coordinates in metres: x points right, y points up, the wall surface is z = 0
const SVec2 = z.strictObject({ x: z.number(), y: z.number() });

const SId = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);

const SHit = z.strictObject({
	id: SId,
	time: z.number().nonnegative(),
	pitch: z.number().int().min(0).max(127).optional(),
	velocity: z.number().min(0).max(1).optional()
});

const SLane = z.strictObject({
	id: SId,
	name: z.string(),
	color: z.string(),
	// General MIDI program used for MIDI playback and the rendered soundtrack
	instrument: z.number().int().min(0).max(127),
	hits: z.array(SHit)
});

const SSource = z.strictObject({
	id: SId,
	kind: z.enum(['midi', 'audio']),
	// Package-relative path, such as `audio/song.wav`
	path: z.string(),
	name: z.string(),
	// Timeline time at which the source starts playing
	offset: z.number()
});

const SMarbleComponent = z.strictObject({
	laneId: SId,
	radius: z.number().positive(),
	color: z.string()
});

const SReleaseComponent = z.strictObject({
	position: SVec2,
	time: z.number(),
	velocity: SVec2.optional()
});

const SPieceComponent = z.strictObject({
	type: z.string(),
	params: z.record(z.string(), z.number())
});

const STransformComponent = z.strictObject({
	position: SVec2,
	angle: z.number()
});

const SHitLinkComponent = z.strictObject({
	laneId: SId,
	hitId: SId,
	// Absolute surface angle in radians. Reflow moves the piece along the trajectory and keeps this angle.
	angle: z.number(),
	// Where along the contact surface the marble lands, from 0 to 1
	contactAt: z.number().min(0).max(1),
	pinned: z.boolean(),
	// Position kept while pinned
	pinnedPosition: SVec2.optional()
});

const SPathComponent = z.strictObject({
	points: z.array(SVec2).min(2)
});

const SSkinComponent = z.strictObject({
	assetId: z.string(),
	link: z.enum(['linked', 'unlinked'])
});

const SReactionComponent = z.strictObject({
	preset: z.string(),
	params: z.record(z.string(), z.number())
});

const SWallTextComponent = z.strictObject({
	text: z.string(),
	font: z.string(),
	size: z.number().positive(),
	depth: z.number().nonnegative(),
	color: z.string()
});

export const SComponents = z.strictObject({
	marble: SMarbleComponent.optional(),
	release: SReleaseComponent.optional(),
	piece: SPieceComponent.optional(),
	transform: STransformComponent.optional(),
	hitLink: SHitLinkComponent.optional(),
	path: SPathComponent.optional(),
	skin: SSkinComponent.optional(),
	reaction: SReactionComponent.optional(),
	wallText: SWallTextComponent.optional()
});

const SEntity = z.strictObject({
	id: SId,
	name: z.string().optional(),
	components: SComponents
});

const SShot = z.strictObject({
	id: SId,
	time: z.number(),
	kind: z.enum(['wide', 'follow', 'pushIn', 'closeUp']),
	roll: z.number(),
	distance: z.number().positive()
});

const SDesign = z.strictObject({
	theme: z.string(),
	renderPreset: z.enum(['fast', 'balanced', 'best']),
	loop: z.boolean(),
	camera: z.strictObject({
		mode: z.enum(['rig', 'manual']),
		distance: z.number().positive(),
		pitch: z.number(),
		lead: z.number().nonnegative(),
		smoothing: z.number().min(0).max(1),
		shots: z.array(SShot)
	})
});

export const SProject = z.strictObject({
	$schema: z.literal('marble-project@1'),
	id: SId,
	title: z.string(),
	revision: z.number().int().nonnegative(),
	frame: z.strictObject({ width: z.number().positive(), height: z.number().positive() }),
	// Timeline end in seconds; the user decides where the run ends
	end: z.number().positive(),
	music: z.strictObject({
		sources: z.array(SSource),
		lanes: z.array(SLane)
	}),
	entities: z.array(SEntity),
	design: SDesign
});

export const projectDefinition = defineSchema({
	family: 'marble-project',
	version: 1,
	schema: SProject
});

export type TProject = TSchemaValue<typeof projectDefinition>;
export type TVec2 = z.infer<typeof SVec2>;
export type THit = z.infer<typeof SHit>;
export type TLane = z.infer<typeof SLane>;
export type TSource = z.infer<typeof SSource>;
export type TEntity = z.infer<typeof SEntity>;
export type TComponents = z.infer<typeof SComponents>;
export type TComponentName = keyof TComponents;
export type TDesign = z.infer<typeof SDesign>;
export type TShot = z.infer<typeof SShot>;
