import { defineSchema, type TSchemaValue } from 'versjon';
import { z } from 'zod';

// Wall-plane coordinates in meters: x points right, y points up, the wall surface is z = 0
const SVec2 = z.strictObject({ x: z.number(), y: z.number() });

const SId = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);

// A note of the song. `duration` is the length of an imported MIDI note; Backing plays it, a marble strikes it.
export const SHit = z.strictObject({
	id: SId,
	time: z.number().nonnegative(),
	pitch: z.number().int().min(0).max(127).optional(),
	velocity: z.number().min(0).max(1).optional(),
	duration: z.number().nonnegative().optional()
});

export const SLane = z.strictObject({
	id: SId,
	name: z.string(),
	color: z.string(),
	// General MIDI program used for MIDI playback and the rendered soundtrack
	instrument: z.number().int().min(0).max(127),
	hits: z.array(SHit)
});

export const SSource = z.strictObject({
	id: SId,
	kind: z.enum(['midi', 'audio']),
	// Package-relative path, such as `audio/song.wav`
	path: z.string(),
	name: z.string(),
	// Timeline time at which the source starts playing
	offset: z.number()
});

// Musical meter of the project, known from an imported MIDI file
export const STempo = z.strictObject({
	bpm: z.number().positive(),
	beatsPerBar: z.number().int().positive()
});

const SMarbleComponent = z.strictObject({
	laneId: SId,
	radius: z.number().positive()
});

const SReleaseComponent = z.strictObject({
	position: SVec2,
	time: z.number(),
	velocity: SVec2.optional(),
	// Radians per second around the wall normal: Fix's release carries on a run that was already rolling
	spin: z.number().optional()
});

const SPieceComponent = z.strictObject({
	type: z.string(),
	// How a Rail gets its paths; absent is one it holds itself, drawn or tapped in `path`
	layout: z.enum(['path', 'curve', 'c', 'chain', 'switchback']).optional(),
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
	// Where the piece waits while an edit it could not take up keeps the marble from it: it stays where the marble was at
	// its moment before that edit, and how the marble left it then is kept, so a fix can bring the marble back
	held: z
		.strictObject({
			dot: SVec2,
			velocity: SVec2.nullable(),
			leaves: z.strictObject({ velocity: SVec2, spin: z.number() }).nullable()
		})
		.optional(),
	// An anchored piece follows the trajectory at the hit time plus its `entryDelay` and never sounds the hit.
	// Scenery pieces are always anchored.
	anchored: z.boolean().optional(),
	// Pose origin relative to the marble at the anchor moment; without it the piece is placed touching the marble
	offset: SVec2.optional(),
	// How the marble leaves this platform, kept so everything after it stays as it was: the velocity and spin a few physics
	// steps after the hit. It counts only for this angle and bounce, while the bounce comes out near it.
	leaves: z.strictObject({ velocity: SVec2, spin: z.number(), angle: z.number(), bounce: z.number() }).optional()
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
	nodes: z.array(SPathNode).min(2).optional(),
	// A Rail's further paths in the same local coordinates, with gaps between them
	paths: z.array(z.array(SVec2).min(2)).optional()
});

/**
 * A skin's properties, the same names on every skin. Absent fields come from the theme (while the piece shows the
 * theme's skin), else from the skin. `colorSource`: `skin` its own, `marble` its marble's film color, `note` the note it plays. `onHit`
 * is the reaction, `glowColor` what a glow shines in, `variant` an id from the skin's variants.
 */
const skinPropertyShape = {
	colorSource: z.enum(['skin', 'marble', 'note']).optional(),
	onHit: z.enum(['none', 'press', 'wobble', 'glow']).optional(),
	glowColor: z
		.string()
		.regex(/^#[0-9a-fA-F]{6}$/)
		.optional(),
	variant: z.string().optional()
};

const SSkinComponent = z.strictObject({
	// A built-in skin such as `platform:copper`, or a library item's ID. Absent shows the theme's skin with the overrides
	// below
	assetId: z.string().optional(),
	...skinPropertyShape,
	// A marble's own film color, what Color: Marble shows on it and on the pieces it plays. Never the lane's label color
	color: z
		.string()
		.regex(/^#[0-9a-fA-F]{6}$/)
		.optional(),
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
	windmill: SThemePart.optional(),
	bowl: SThemePart.optional(),
	marble: SThemePart.optional()
});

const SWallTextComponent = z.strictObject({
	text: z.string(),
	font: z.string(),
	size: z.number().positive(),
	// Absent reads in the color that stands apart from the wall (`defaultTitleColor`)
	color: z.string().optional(),
	// Film time in seconds when the title appears and disappears; absent means the start and the end of the film
	in: z.number().nonnegative().optional(),
	out: z.number().nonnegative().optional(),
	// `wall` (absent) sits on the wall; `caption`, `songName` and `endCard` sit in the frame, where `size` is the
	// letter height as a fraction of the frame height
	style: z.enum(['wall', 'caption', 'songName', 'endCard']).optional(),
	// A screen title's soft dark plate and shadow behind plain text; absent is plain text
	plate: z.boolean().optional()
});

/**
 * The ride a marble took along a rail, relative to where it entered: the frames are x, y (micrometers)
 * and rolled angle (1e-4 rad) per physics step after the entry. `key` says which shape of the piece it was made on.
 */
const STransitComponent = z.strictObject({
	key: z.string(),
	entry: SVec2,
	exit: z.strictObject({ position: SVec2, velocity: SVec2, angle: z.number(), spin: z.number() }),
	// Pieces the marble touched on this ride besides this one; anything else in the way ends the ride
	touches: z.array(z.string()),
	frames: z.array(z.number())
});

export const SComponents = z.strictObject({
	marble: SMarbleComponent.optional(),
	release: SReleaseComponent.optional(),
	piece: SPieceComponent.optional(),
	transform: STransformComponent.optional(),
	hitLink: SHitLinkComponent.optional(),
	path: SPathComponent.optional(),
	skin: SSkinComponent.optional(),
	wallText: SWallTextComponent.optional(),
	transit: STransitComponent.optional()
});

export const SEntity = z.strictObject({
	id: SId,
	name: z.string().optional(),
	// Organizes Layers, like Blender's collection color tags; the film never reads it. A marble's is its lane's `color`
	labelColor: z
		.string()
		.regex(/^#[0-9a-fA-F]{6}$/)
		.optional(),
	components: SComponents
});

const SShot = z.strictObject({
	id: SId,
	time: z.number(),
	kind: z.enum(['wide', 'follow', 'pushIn', 'closeUp']),
	distance: z.number().positive(),
	// Seconds the shot holds before the camera eases back to the rig, 0 until the next shot; absent uses the kind's
	// default (2 s for Push In and Close-Up, until the next shot for Wide and Follow)
	length: z.number().nonnegative().optional()
});

const SHexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/);

/**
 * The few colors a project theme changes on top of its built-in base, in display sRGB. Absent fields keep the
 * base's look. `glowColor` replaces the marble-colored glowing edges of a theme that has them (Neon).
 */
const SThemeOverrides = z.strictObject({
	wallColor: SHexColor.optional(),
	lightColor: SHexColor.optional(),
	glowColor: SHexColor.optional(),
	backgroundColor: SHexColor.optional()
});

/** The wall's skin in Film: `plain` is one smooth color with no pattern at all, `grid` the Neon wall's lit grid */
const SWallKind = z.enum(['plain', 'plaster', 'pegboard', 'grid']);

/**
 * How a light stands and how strong it is. `side` runs from the far left (-1) to the far right (1) of the wall and
 * `height` from below (-1) to above (1); both are shares of a quarter turn from straight in front of the wall.
 */
const lightPoseShape = {
	strength: z.number().nonnegative(),
	side: z.number().min(-1).max(1),
	height: z.number().min(-1).max(1)
};

/** What a project theme changes on the Key Light besides its color; absent fields keep the base's */
const SKeyLightPose = z.strictObject({
	strength: lightPoseShape.strength.optional(),
	side: lightPoseShape.side.optional(),
	height: lightPoseShape.height.optional(),
	// How soft its shadows are: a share of the widest sun, 0 hard and 1 very soft
	softness: z.number().min(0).max(1).optional(),
	// The whole film's brightness in stops on top of the base theme, and how much what glows spills light. Here because a
	// film has one Key Light, and it travels with the theme the same way
	exposure: z.number().min(-3).max(3).optional(),
	bloom: z.number().min(0).max(1).optional()
});

/** A light added with Add Light, a layer in Film; a sun like the Key Light */
const SLight = z.strictObject({ id: SId, name: z.string(), color: SHexColor, ...lightPoseShape });

/** A project theme's Wall skin, Key Light and added lights: what a kept look stores */
const projectThemeSceneShape = {
	wallKind: SWallKind.optional(),
	keyLight: SKeyLightPose.optional(),
	lights: z.array(SLight).optional()
};

/**
 * Where something copied from a Pack came from, so a project moved to another Mac still names the Pack. `version` changes
 * nothing yet.
 */
export const SPackOrigin = z.strictObject({
	packId: z.string().min(1),
	packName: z.string().min(1),
	version: z.string(),
	author: z.string().optional(),
	link: z.string().optional()
});

/** A theme the project made from a built-in one: from a Pack, or New Theme with Agent */
export const SProjectTheme = z.strictObject({
	id: SId,
	name: z.string(),
	// Built-in theme id the look starts from: `pegboard`, `brass` or `neon`
	base: z.string(),
	overrides: SThemeOverrides,
	// `agent` when a New Theme with Agent Result made it; absent otherwise
	origin: z.enum(['agent']).optional(),
	// The Pack it came from
	pack: SPackOrigin.optional(),
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
	// Organizes Layers; the film never reads it
	labelColor: SHexColor.optional(),
	source: z.string().min(1),
	// Wall point in meters the item is centered on
	position: SVec2,
	// A share of the item's own size
	scale: z.number().positive(),
	// Radians, counter-clockwise as seen from the front
	rotation: z.number(),
	// A Snowfall's settings: how many flakes (0..1), their size and fall speed as shares of the usual, and their color
	snowfall: z.strictObject({ density: z.number().min(0).max(1), size: z.number().positive(), speed: z.number().nonnegative(), color: SHexColor }).optional(),
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

export const SDesign = z.strictObject({
	// A built-in theme id or the id of one of `themes`
	theme: z.string(),
	// Themes made in this project
	themes: z.array(SProjectTheme),
	// This project's changes to the Wall layer on top of the theme, like a piece's skin
	wall: z.strictObject({
		color: SHexColor.optional(),
		backgroundColor: SHexColor.optional(),
		kind: SWallKind.optional()
	}),
	// This project's changes to the Key Light on top of the theme, and its added lights
	lights: z.strictObject({
		key: SKeyLightPose.extend({ color: SHexColor.optional() }).optional(),
		added: z.array(SLight)
	}),
	// The Decor layers
	decor: z.array(SDecor),
	madeInBlender: z.array(SMadeInBlender),
	renderPreset: z.enum(['draft', 'final']),
	camera: z.strictObject({
		mode: z.enum(['rig', 'manual']),
		distance: z.number().positive(),
		pitch: z.number(),
		lead: z.number().nonnegative(),
		smoothing: z.number().min(0).max(1),
		// Turn: the camera's side angle around what it follows in radians, 0 to 2π; absent is 95°
		side: z.number().min(0).max(2 * Math.PI).optional(),
		// How much the view turns and rolls on its own, 0 to 1
		sway: z.number().min(0).max(1),
		shots: z.array(SShot),
		// Marble the camera keeps when several marbles do not fit a readable frame; absent means the first marble
		focusMarbleId: SId.optional()
	})
});

/**
 * Project physics. `gravityScale` multiplies Earth's 9.81 m/s² for every marble, so a run plays slower and
 * hops lower at the same rhythm; hits stay on time because pieces are placed where the marble is.
 */
export const SPhysics = z.strictObject({ gravityScale: z.number().min(0.05).max(2) });

/**
 * Lane ID that addresses Backing in hit commands and hit selection keys. Lane IDs are created with a prefix
 * and a random part, so no lane has this ID.
 */
export const BACKING_ID = 'backing';

/**
 * What a Pattern made (prototype): an ordinary list of ordinary pieces, one Undo step, named after the Pattern. The
 * range and settings let it run again; hand edits to its pieces stay until it does. `from` and `to` are song seconds.
 */
const SPatternGroup = z.strictObject({
	id: SId,
	name: z.string(),
	laneId: SId,
	from: z.number(),
	to: z.number(),
	kind: z.enum(['zigzag', 'staircase', 'longRail']),
	width: z.number().positive(),
	bounce: z.number().min(0).max(1),
	pieceIds: z.array(SId),
	// The steepest a bar may tilt, in degrees, when asked for; absent is the usual limit
	maxTilt: z.number().positive().optional(),
	// What the last run couldn't do, shown beside the tiles
	problems: z.array(z.strictObject({ hitId: z.string(), words: z.string() })).optional()
});

// A Group with no Pattern, made by hand or left by a Flatten. `laneId` while its pieces are one marble's
const SPlainGroup = z.strictObject({
	id: SId,
	name: z.string(),
	laneId: SId.optional(),
	pieceIds: z.array(SId)
});

export const SGroup = z.union([SPatternGroup, SPlainGroup]);

export const SProject = z.strictObject({
	$schema: z.literal('marble-project@5'),
	id: SId,
	title: z.string(),
	revision: z.number().int().nonnegative(),
	frame: z.strictObject({ width: z.number().positive(), height: z.number().positive() }),
	// Timeline end in seconds; the user decides where the run ends
	end: z.number().positive(),
	music: z.strictObject({
		sources: z.array(SSource),
		lanes: z.array(SLane),
		// Every note no marble plays, heard in the film without a piece
		backing: z.array(SHit),
		// General MIDI program of Backing: the song's first MIDI program when the bank has it; absent means piano
		backingInstrument: z.number().int().min(0).max(127).optional(),
		tempo: STempo.optional()
	}),
	entities: z.array(SEntity),
	// Absent until a Pattern makes one
	groups: z.array(SGroup).optional(),
	physics: SPhysics,
	design: SDesign
});

export const projectDefinition = defineSchema({
	family: 'marble-project',
	version: 5,
	schema: SProject
});

export type TProject = TSchemaValue<typeof projectDefinition>;
export type TVec2 = z.infer<typeof SVec2>;
export type THit = z.infer<typeof SHit>;
export type TLane = z.infer<typeof SLane>;
export type TSource = z.infer<typeof SSource>;
export type TEntity = z.infer<typeof SEntity>;
export type TComponents = z.infer<typeof SComponents>;
export type TTransit = z.infer<typeof STransitComponent>;
export type TComponentName = keyof TComponents;
export type TDesign = z.infer<typeof SDesign>;
export type TProjectTheme = z.infer<typeof SProjectTheme>;
export type TPackOrigin = z.infer<typeof SPackOrigin>;
export type TSkinComponent = z.infer<typeof SSkinComponent>;
export type TThemePart = z.infer<typeof SThemePart>;
export type TThemeParts = z.infer<typeof SThemeParts>;
export type TThemeOverrides = z.infer<typeof SThemeOverrides>;
export type TWallKind = z.infer<typeof SWallKind>;
export type TLight = z.infer<typeof SLight>;
export type TDecor = z.infer<typeof SDecor>;
export type TSnowfall = NonNullable<TDecor['snowfall']>;
export type TMadeInBlender = z.infer<typeof SMadeInBlender>;
export type TKeyLightPose = z.infer<typeof SKeyLightPose>;
export type TShot = z.infer<typeof SShot>;
export type TGroup = z.infer<typeof SGroup>;
export type TPatternGroup = z.infer<typeof SPatternGroup>;
export type TPlainGroup = z.infer<typeof SPlainGroup>;

export function isPatternGroup(group: TGroup): group is TPatternGroup {
	return 'kind' in group;
}
export type TTempo = z.infer<typeof STempo>;
export type TPhysics = z.infer<typeof SPhysics>;
export type TPathNode = z.infer<typeof SPathNode>;
