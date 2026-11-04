import { defineMigration, defineSchema, type TSchemaValue } from 'versjon';
import { z } from 'zod';

// Wall-plane coordinates in metres: x points right, y points up, the wall surface is z = 0
const SVec2 = z.strictObject({ x: z.number(), y: z.number() });

const SId = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);

const SHitV3 = z.strictObject({
	id: SId,
	time: z.number().nonnegative(),
	pitch: z.number().int().min(0).max(127).optional(),
	velocity: z.number().min(0).max(1).optional()
});

// A note of the song. Version 4 keeps the length of imported MIDI notes; Backing plays it, a marble strikes it.
const SHit = SHitV3.extend({ duration: z.number().nonnegative().optional() });

const laneShape = {
	id: SId,
	name: z.string(),
	color: z.string(),
	// General MIDI program used for MIDI playback and the rendered soundtrack
	instrument: z.number().int().min(0).max(127)
};

const SLaneV3 = z.strictObject({ ...laneShape, hits: z.array(SHitV3) });

const SLane = z.strictObject({ ...laneShape, hits: z.array(SHit) });

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

// Bézier anchor of a rail drawn with the path tool; handles are offsets from the point
const SPathNode = z.strictObject({
	point: SVec2,
	in: SVec2.optional(),
	out: SVec2.optional()
});

const SPathComponent = z.strictObject({
	points: z.array(SVec2).min(2),
	// The editable curve the points were sampled from, set for rails drawn with the path tool. The engine
	// only reads `points`; files without nodes stay valid.
	nodes: z.array(SPathNode).min(2).optional()
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
	color: z.string(),
	// Film time in seconds when the title appears and disappears; absent means the start and the end of the film
	in: z.number().nonnegative().optional(),
	out: z.number().nonnegative().optional(),
	// `wall` (absent) sits on the wall; `caption`, `songName` and `endCard` sit in the frame, where `size` is the
	// letter height as a fraction of the frame height
	style: z.enum(['wall', 'caption', 'songName', 'endCard']).optional()
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
	distance: z.number().positive(),
	// Seconds the shot holds before the camera eases back to the rig, 0 until the next shot; absent uses the kind's
	// default (2 s for Push In and Close-Up, until the next shot for Wide and Follow). Added later; files without it
	// stay valid
	length: z.number().nonnegative().optional()
});

const SDesign = z.strictObject({
	theme: z.string(),
	// `draft` was added later; files without it stay valid
	renderPreset: z.enum(['draft', 'fast', 'balanced', 'best']),
	loop: z.boolean(),
	// Choices on top of the theme; absent fields keep the theme's defaults, so files without them stay valid
	themeOptions: z
		.strictObject({
			// Platforms take a colour from the pitch they play
			colorByNote: z.boolean().optional()
		})
		.optional(),
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
		lanes: z.array(SLaneV3),
		tempo: STempo.optional()
	}),
	entities: z.array(SEntity),
	design: SDesign
};

/**
 * Lane ID that addresses Backing in hit commands and hit selection keys. Lane IDs are created with a prefix
 * and a random part, so no lane has this ID.
 */
export const BACKING_ID = 'backing';

const SProjectV1 = z.strictObject({ $schema: z.literal('marble-project@1'), ...projectShape });

// Version 2 makes physical piece parameters explicit, so a later change of a default cannot alter saved runs
const SProjectV2 = z.strictObject({ $schema: z.literal('marble-project@2'), ...projectShape });

// Version 3 makes windmills, rails, tunnels and switchbacks scenery: they never sound a hit, and their hit
// link only anchors them to the trajectory at the hit time plus their `entryDelay`. It adds project physics.
const SProjectV3 = z.strictObject({
	$schema: z.literal('marble-project@3'),
	...projectShape,
	physics: SPhysics
});

// Version 4 keeps every note of the song: `backing` holds the notes no marble plays, heard in the film without a
// piece. Notes keep their MIDI length in `duration`.
export const SProject = z.strictObject({
	$schema: z.literal('marble-project@4'),
	...projectShape,
	music: z.strictObject({
		sources: z.array(SSource),
		lanes: z.array(SLane),
		backing: z.array(SHit),
		// General MIDI program of Backing: the song's first MIDI program when the bank has it; absent means piano
		backingInstrument: z.number().int().min(0).max(127).optional(),
		tempo: STempo.optional()
	}),
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
	version: 4,
	schema: SProject,
	migrations: {
		// Older projects dropped the notes no marble played, so their Backing starts empty
		3: defineMigration({
			schema: SProjectV3,
			migrate(value) {
				return { ...value, $schema: 'marble-project@4' as const, music: { ...value.music, backing: [] } };
			}
		}),
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
export type TPathNode = z.infer<typeof SPathNode>;
