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

/**
 * A skin's properties, the same names on every skin. Absent fields come from the theme (while the piece shows the
 * theme's skin), else from the skin. `colour`: `skin` its own, `marble` its marble's, `note` the note it plays. `onHit`
 * is the reaction, `glowColor` what a glow shines in, `variant` an id from the skin's variants.
 */
const skinPropertyShape = {
	colour: z.enum(['skin', 'marble', 'note']).optional(),
	onHit: z.enum(['none', 'press', 'wobble', 'glow']).optional(),
	glowColor: z
		.string()
		.regex(/^#[0-9a-fA-F]{6}$/)
		.optional(),
	variant: z.string().optional()
};

const SSkinComponent = z.strictObject({
	// A built-in skin such as `platform:copper`, or a library item's ID. Absent shows the theme's skin with the overrides
	// below; old IDs such as `brass:copper` still read (`canonicalSkinId`)
	assetId: z.string().optional(),
	link: z.enum(['linked', 'unlinked']),
	...skinPropertyShape,
	// Values of the extra properties a library skin's manifest declares, by their names
	properties: z.record(z.string(), z.union([z.number(), z.string()])).optional()
});

/** What a theme dresses one element type with: a skin and property defaults; absent fields keep the base's */
const SThemePart = z.strictObject({ skin: z.string().optional(), ...skinPropertyShape });

/** A project theme's parts per element type, on top of its base's */
const SThemeParts = z.strictObject({
	platform: SThemePart.optional(),
	rail: SThemePart.optional(),
	tunnel: SThemePart.optional(),
	switchback: SThemePart.optional(),
	windmill: SThemePart.optional(),
	finish: SThemePart.optional(),
	marble: SThemePart.optional()
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
	// Absent reads in the colour that stands apart from the wall (`defaultTitleColor`)
	color: z.string().optional(),
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

const SHexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/);

/**
 * The few colours a project theme changes on top of its built-in base, in display sRGB. Absent fields keep the
 * base's look. `glowColor` replaces the marble-coloured glowing edges of a theme that has them (Neon).
 */
const SThemeOverrides = z.strictObject({
	wallColor: SHexColor.optional(),
	lightColor: SHexColor.optional(),
	glowColor: SHexColor.optional(),
	backgroundColor: SHexColor.optional()
});

/** The wall's look in Film: `grid` is the Neon wall's lit grid, `tinsel` knitted tree-green tinsel */
const SWallKind = z.enum(['plaster', 'pegboard', 'grid', 'tinsel']);
/** Where a Tinsel wall shows its tinsel: all over, or as a band along one side of the frame */
const SWallBand = z.enum(['full', 'left', 'right']);

/**
 * How a light stands and how strong it is. `side` runs from the far left (-1) to the far right (1) of the wall and
 * `height` from below (-1) to above (1); both are shares of a quarter turn from straight in front of the wall.
 */
const lightPoseShape = {
	strength: z.number().nonnegative(),
	side: z.number().min(-1).max(1),
	height: z.number().min(-1).max(1)
};

/** What a project theme changes on the Key Light besides its colour; absent fields keep the base's */
const SKeyLightPose = z.strictObject({
	strength: lightPoseShape.strength.optional(),
	side: lightPoseShape.side.optional(),
	height: lightPoseShape.height.optional(),
	// How soft its shadows are: a share of the widest sun, 0 hard and 1 very soft
	softness: z.number().min(0).max(1).optional(),
	// The whole film's brightness in stops on top of the base theme, and how much what glows spills light. Here because a
	// film has one Key Light, and it travels with the theme the same way. Added later; files without them stay valid
	exposure: z.number().min(-3).max(3).optional(),
	bloom: z.number().min(0).max(1).optional()
});

/** A light added with Add Light, a layer in Film; a sun like the Key Light */
const SLight = z.strictObject({ id: SId, name: z.string(), color: SHexColor, ...lightPoseShape });

/** A project theme's Wall skin, Key Light and added lights: what Save as Theme and Duplicate Theme store */
const projectThemeSceneShape = {
	wallKind: SWallKind.optional(),
	wallBand: SWallBand.optional(),
	keyLight: SKeyLightPose.optional(),
	lights: z.array(SLight).optional()
};

/** A theme the project made from a built-in one: Duplicate Theme, or New Theme with Agent */
const SProjectTheme = z.strictObject({
	id: SId,
	name: z.string(),
	// Built-in theme id the look starts from: `pegboard`, `brass` or `neon`
	base: z.string(),
	overrides: SThemeOverrides,
	// `agent` when a New Theme with Agent Result made it; absent for a duplicate
	origin: z.enum(['agent']).optional(),
	// Decor sources Scatter Decor starts with; absent takes the base theme's. Added later; files without it stay valid
	decorSet: z.array(z.string()).optional(),
	...projectThemeSceneShape,
	parts: SThemeParts.optional()
});

/**
 * A decoration of the film, one layer in the Decor group. Decor has no hitbox: the simulation never reads this list, so
 * it can't change a hit. `source` is a built-in item (`decor:bauble-red`) or a package asset (`assets/<id>/asset.blend`).
 */
const SDecor = z.strictObject({
	id: SId,
	name: z.string(),
	source: z.string().min(1),
	// Wall point in metres the item is centred on
	position: SVec2,
	// A share of the item's own size
	scale: z.number().positive(),
	// Radians, counter-clockwise as seen from the front
	rotation: z.number(),
	// Metres in front of the wall
	depth: z.number().nonnegative(),
	// What a text item reads: the Handle's "@yourchannel"
	text: z.string().optional(),
	// A Snowfall's settings: how many flakes (0..1), their size and fall speed as shares of the usual, and their colour
	snowfall: z.strictObject({ density: z.number().min(0).max(1), size: z.number().positive(), speed: z.number().nonnegative(), color: SHexColor }).optional(),
	// A Garland's settings: the frame edges it runs along and the distance between sprigs, as a share of the frame's height
	garland: z.strictObject({ side: z.enum(['left', 'right', 'both']), spacing: z.number().positive() }).optional(),
	// Half width and half height of an asset at scale 1, from its manifest; built-in items know their own
	footprint: z.strictObject({ x: z.number().positive(), y: z.number().positive() }).optional(),
	// Film time in seconds it shows, like a title; absent means the start and the end of the film
	in: z.number().nonnegative().optional(),
	out: z.number().nonnegative().optional(),
	hidden: z.boolean().optional(),
	// Placed by Scatter Decor, which replaces only these when it runs again
	scattered: z.boolean().optional()
});

/** What the project sets on an object added directly in Blender, by its Blender name. The app never moves or deletes it. */
const SMadeInBlender = z.strictObject({
	name: z.string().min(1),
	in: z.number().nonnegative().optional(),
	out: z.number().nonnegative().optional(),
	hidden: z.boolean().optional()
});

const SDesign = z.strictObject({
	// A built-in theme id or the id of one of `themes`
	theme: z.string(),
	// Themes made in this project. Added later; files without it stay valid
	themes: z.array(SProjectTheme).optional(),
	// This project's changes to the Wall layer on top of the theme, like a piece's skin. Added later; files without it stay valid
	wall: z
		.strictObject({
			color: SHexColor.optional(),
			backgroundColor: SHexColor.optional(),
			kind: SWallKind.optional(),
			band: SWallBand.optional()
		})
		.optional(),
	// This project's changes to the Key Light on top of the theme, and its added lights. Added later; files without it stay valid
	lights: z
		.strictObject({
			key: SKeyLightPose.extend({ color: SHexColor.optional() }).optional(),
			added: z.array(SLight).optional()
		})
		.optional(),
	// The Decor layers. Added later; files without them stay valid
	decor: z.array(SDecor).optional(),
	madeInBlender: z.array(SMadeInBlender).optional(),
	// `draft` was added later; files without it stay valid
	renderPreset: z.enum(['draft', 'fast', 'balanced', 'best']),
	loop: z.boolean(),
	// Older projects only: `parseProject` moves Colour by Note into the theme (`migrateSkins`)
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
export type TProjectTheme = z.infer<typeof SProjectTheme>;
export type TSkinComponent = z.infer<typeof SSkinComponent>;
export type TThemePart = z.infer<typeof SThemePart>;
export type TThemeParts = z.infer<typeof SThemeParts>;
export type TThemeOverrides = z.infer<typeof SThemeOverrides>;
export type TWallKind = z.infer<typeof SWallKind>;
export type TWallBand = z.infer<typeof SWallBand>;
export type TLight = z.infer<typeof SLight>;
export type TDecor = z.infer<typeof SDecor>;
export type TSnowfall = NonNullable<TDecor['snowfall']>;
export type TGarland = NonNullable<TDecor['garland']>;
export type TMadeInBlender = z.infer<typeof SMadeInBlender>;
export type TKeyLightPose = z.infer<typeof SKeyLightPose>;
export type TShot = z.infer<typeof SShot>;
export type TTempo = z.infer<typeof STempo>;
export type TPhysics = z.infer<typeof SPhysics>;
export type TPathNode = z.infer<typeof SPathNode>;
