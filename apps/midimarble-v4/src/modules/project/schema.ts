import { defineMigration, defineSchema, type TSchemaValue } from 'versjon';
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

// Musical meter of the project, known from an imported MIDI file; loops snap their length to whole bars with it
const STempo = z.strictObject({
	bpm: z.number().positive(),
	beatsPerBar: z.number().int().positive()
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
	pinnedPosition: SVec2.optional(),
	// An anchored piece follows the trajectory at the hit time plus its `entryDelay` and never sounds the hit.
	// Scenery pieces are always anchored.
	anchored: z.boolean().optional(),
	// Pose origin relative to the marble at the anchor moment; without it the piece is placed touching the marble
	offset: SVec2.optional()
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
	// `draft` was added later; files without it stay valid
	renderPreset: z.enum(['draft', 'fast', 'balanced', 'best']),
	loop: z.boolean(),
	camera: z.strictObject({
		mode: z.enum(['rig', 'manual']),
		distance: z.number().positive(),
		pitch: z.number(),
		lead: z.number().nonnegative(),
		smoothing: z.number().min(0).max(1),
		shots: z.array(SShot),
		// Marble the camera keeps when several marbles do not fit a readable frame; absent means the first marble
		focusMarbleId: SId.optional()
	})
});

/**
 * Project physics. `gravityScale` multiplies Earth's 9.81 m/s² for every marble, so a run plays slower and
 * hops lower at the same rhythm; hits stay on time because pieces are placed where the marble is.
 */
const SPhysics = z.strictObject({ gravityScale: z.number().min(0.05).max(2) });

const projectShape = {
	id: SId,
	title: z.string(),
	revision: z.number().int().nonnegative(),
	frame: z.strictObject({ width: z.number().positive(), height: z.number().positive() }),
	// Timeline end in seconds; the user decides where the run ends
	end: z.number().positive(),
	music: z.strictObject({
		sources: z.array(SSource),
		lanes: z.array(SLane),
		tempo: STempo.optional()
	}),
	entities: z.array(SEntity),
	design: SDesign
};

const SProjectV1 = z.strictObject({ $schema: z.literal('marble-project@1'), ...projectShape });

// Version 2 makes physical piece parameters explicit, so a later change of a default cannot alter saved runs
const SProjectV2 = z.strictObject({ $schema: z.literal('marble-project@2'), ...projectShape });

// Version 3 makes windmills, rails, tunnels and switchbacks scenery: they never sound a hit, and their hit
// link only anchors them to the trajectory at the hit time plus their `entryDelay`. It adds project physics.
export const SProject = z.strictObject({
	$schema: z.literal('marble-project@3'),
	...projectShape,
	physics: SPhysics
});

/** Bounce values of version 1, before bounce became a piece parameter */
const legacyBounce: Record<string, number> = { platform: 0.55, windmill: 0.5 };

/** Piece types that became scenery in version 3 */
const sceneryTypes = new Set(['windmill', 'rail', 'tunnel', 'switchback']);
/** Longest entry delay a scenery piece allows */
const MAX_ENTRY_DELAY = 2;

/**
 * A scenery piece that sounded its hit in version 2 (no entry delay) is anchored to the lane's previous hit
 * with the delay that keeps it at the same moment, so the run plays as before and the hit is left open for a
 * platform. Without an earlier hit within the longest delay it stays anchored at its own hit's time.
 */
function asScenery(entity: TEntity, lanes: TLane[]): TEntity {
	const { piece, hitLink } = entity.components;
	if (piece == null || !sceneryTypes.has(piece.type)) return entity;
	const delay = piece.params['entryDelay'] ?? 0;
	let params = { ...piece.params, entryDelay: delay };
	let link = hitLink;
	if (hitLink != null && delay <= 0) {
		const hits = lanes.find((lane) => lane.id === hitLink.laneId)?.hits ?? [];
		const index = hits.findIndex((hit) => hit.id === hitLink.hitId);
		const hit = hits[index];
		const previous = hits[index - 1];
		const gap = hit != null && previous != null ? hit.time - previous.time : Infinity;
		if (previous != null && gap <= MAX_ENTRY_DELAY) {
			link = { ...hitLink, hitId: previous.id };
			params = { ...params, entryDelay: Math.round(gap * 1e6) / 1e6 };
		}
	}
	const components = { ...entity.components, piece: { ...piece, params } };
	if (link != null) components.hitLink = link;
	return { ...entity, components };
}

export const projectDefinition = defineSchema({
	family: 'marble-project',
	version: 3,
	schema: SProject,
	migrations: {
		2: defineMigration({
			schema: SProjectV2,
			migrate(value) {
				return {
					...value,
					$schema: 'marble-project@3' as const,
					entities: value.entities.map((entity) => asScenery(entity, value.music.lanes)),
					// Earth gravity, so saved runs play exactly as before
					physics: { gravityScale: 1 }
				};
			}
		}),
		1: defineMigration({
			schema: SProjectV1,
			migrate(value) {
				return {
					...value,
					$schema: 'marble-project@2' as const,
					entities: value.entities.map((entity) => {
						const piece = entity.components.piece;
						const bounce = piece == null ? undefined : legacyBounce[piece.type];
						if (piece == null || bounce == null || piece.params['bounce'] != null) return entity;
						return {
							...entity,
							components: { ...entity.components, piece: { ...piece, params: { ...piece.params, bounce } } }
						};
					})
				};
			}
		})
	}
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
export type TTempo = z.infer<typeof STempo>;
export type TPhysics = z.infer<typeof SPhysics>;
