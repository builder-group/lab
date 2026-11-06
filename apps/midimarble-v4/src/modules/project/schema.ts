import { defineSchema, type TSchemaValue } from 'versjon';
import { z } from 'zod';
import catalog from '../../../blender/mm_worker/skin_catalog.json';

// Wall-plane coordinates in meters: x points right, y points up, the wall surface is z = 0
const SVec2 = z.strictObject({ x: z.number(), y: z.number() });

const SId = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);

// A note of the song. `duration` is the length of an imported MIDI note; Backing plays it, a marble strikes it. `songId` ties
// a hit imported from a song to it. A hit's time is absolute, so physics and audio never need to know about songs to place it.
export const SHit = z.strictObject({
	id: SId,
	time: z.number().nonnegative(),
	pitch: z.number().int().min(0).max(127).optional(),
	velocity: z.number().min(0).max(1).optional(),
	duration: z.number().nonnegative().optional(),
	songId: SId.optional()
});

// Musical meter of a song, known from an imported MIDI file
export const STempo = z.strictObject({
	bpm: z.number().positive(),
	beatsPerBar: z.number().int().positive()
});

export const SSong = z.strictObject({
	id: SId,
	name: z.string(),
	kind: z.enum(['midi', 'audio']),
	// Package-relative path, such as `audio/song.wav`. Absent is a song without a file: the notes no marble plays, kept after
	// the file went
	path: z.string().optional(),
	// Timeline time at which the file starts playing
	start: z.number(),
	tempo: STempo.optional(),
	// Every note no marble plays, heard in the film without a piece
	backing: z.array(SHit),
	// General MIDI program of Backing: the song's first MIDI program when the bank has it; absent means piano
	backingSound: z.number().int().min(0).max(127).optional()
});

// Where and when a marble is released. `spin` is radians per second around the wall normal: Fix's release carries on a run
// that was already rolling
const SMarbleStart = z.strictObject({
	position: SVec2,
	time: z.number(),
	velocity: SVec2.optional(),
	spin: z.number().optional()
});

// Where a piece waits while an edit it could not take up keeps the marble from it: it stays where the marble was at its
// moment before that edit, and how the marble left it then is kept, so a fix can bring the marble back
const SHeld = z.strictObject({
	dot: SVec2,
	velocity: SVec2.nullable(),
	leaves: z.strictObject({ velocity: SVec2, spin: z.number() }).nullable()
});

const SContactAt = z.number().min(0).max(1);

const SFree = z.strictObject({ kind: z.literal('free'), position: SVec2 });

// A piece that sounds a hit. Reflow moves it along the run and keeps its angle.
const SPlays = z.strictObject({
	kind: z.literal('plays'),
	marbleId: SId,
	hitId: SId,
	// Where along the contact surface the marble lands, from 0 to 1
	contactAt: SContactAt,
	held: SHeld.optional(),
	// How the marble leaves this platform, kept so everything after it stays as it was: the velocity and spin a few physics
	// steps after the hit. It counts only for this angle and bounce, while the bounce comes out near it.
	leaves: z.strictObject({ velocity: SVec2, spin: z.number(), angle: z.number(), bounce: z.number() }).optional()
});

// A piece that follows a marble's run at the hit's time plus its `entryDelay` param and never sounds the hit
const SFollows = z.strictObject({
	kind: z.literal('follows'),
	marbleId: SId,
	hitId: SId,
	// Where the marble enters along the piece; absent is its middle
	contactAt: SContactAt.optional(),
	// Pose origin relative to the marble at that moment; without it the piece is placed touching the marble
	offset: SVec2.optional(),
	held: SHeld.optional()
});

export const SPlace = z.discriminatedUnion('kind', [SFree, SPlays, SFollows]);

// Bézier anchor of a rail drawn with the path tool; handles are offsets from the point
const SPathNode = z.strictObject({
	point: SVec2,
	in: SVec2.optional(),
	out: SVec2.optional()
});

const SPath = z.strictObject({
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

const SSkin = z.strictObject({
	// A built-in skin such as `platform:copper`, or a library item's ID. Absent shows the theme's skin with the overrides
	// below
	assetId: z.string().optional(),
	...skinPropertyShape,
	// A marble's own film color, what Color: Marble shows on it and on the pieces it plays. Never the marble's label color
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
const SThemeParts = z.strictObject(
	Object.fromEntries(Object.keys(catalog.elements).map((element) => [element, SThemePart.optional()])) as Record<keyof typeof catalog.elements, ReturnType<typeof SThemePart.optional>>
);

const STitle = z.strictObject({
	id: SId,
	name: z.string().optional(),
	// Organizes Layers; the film never reads it
	labelColor: z
		.string()
		.regex(/^#[0-9a-fA-F]{6}$/)
		.optional(),
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
	plate: z.boolean().optional(),
	position: SVec2,
	angle: z.number()
});

/**
 * The ride a marble took along a rail, relative to where it entered: the frames are x, y (micrometers)
 * and rolled angle (1e-4 rad) per physics step after the entry. `key` says which shape of the piece it was made on.
 */
const SRide = z.strictObject({
	key: z.string(),
	entry: SVec2,
	exit: z.strictObject({ position: SVec2, velocity: SVec2, angle: z.number(), spin: z.number() }),
	// Pieces the marble touched on this ride besides this one; anything else in the way ends the ride
	touches: z.array(z.string()),
	frames: z.array(z.number())
});

// One marble: a name and color that organize it, what it sounds like, its body, where it starts, and the hits it plays
export const SMarble = z.strictObject({
	id: SId,
	name: z.string(),
	// Organizes Layers and colors its pieces in Track; in the film only the skin None wears it
	labelColor: z.string(),
	// General MIDI program used for MIDI playback and the rendered soundtrack
	sound: z.number().int().min(0).max(127),
	radius: z.number().positive(),
	start: SMarbleStart,
	skin: SSkin.optional(),
	hits: z.array(SHit)
});

export const SPiece = z.strictObject({
	id: SId,
	name: z.string().optional(),
	// Organizes Layers and colors the piece in Track; in the film only the skin None wears it
	labelColor: z
		.string()
		.regex(/^#[0-9a-fA-F]{6}$/)
		.optional(),
	type: z.string(),
	// How a Rail gets its paths; absent is one it holds itself, drawn or tapped in `path`
	layout: z.enum(['path', 'curve', 'c', 'chain', 'switchback']).optional(),
	params: z.record(z.string(), z.number()),
	// Absolute surface angle in radians
	angle: z.number(),
	// Exactly one of free, plays, follows
	place: SPlace,
	path: SPath.optional(),
	skin: SSkin.optional(),
	ride: SRide.optional()
});

const SShot = z.strictObject({
	id: SId,
	time: z.number(),
	distance: z.number().positive(),
	// Seconds the shot holds before the camera eases back to the rig; absent or 0 holds until the next shot
	hold: z.number().nonnegative().optional()
});

const SHexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/);

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

/** What a film changes on the Key Light besides its color; absent fields keep the base theme's */
const SKeyLightPose = z.strictObject({
	strength: lightPoseShape.strength.optional(),
	side: lightPoseShape.side.optional(),
	height: lightPoseShape.height.optional(),
	// How soft its shadows are: a share of the widest sun, 0 hard and 1 very soft
	softness: z.number().min(0).max(1).optional(),
	// The whole film's brightness in stops on top of the base theme, and how much what glows spills light. Here because a
	// film has one Key Light
	exposure: z.number().min(-3).max(3).optional(),
	bloom: z.number().min(0).max(1).optional()
});

/** A light added with Add Light, a layer in Film; a sun like the Key Light */
const SLight = z.strictObject({ id: SId, name: z.string(), color: SHexColor, ...lightPoseShape });

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

/** Where the theme a film wears came from: the Pack, and the theme's own ID and name in it */
const SThemePack = SPackOrigin.extend({ themeId: SId, themeName: z.string() });

/** The one theme a film wears: a built-in base and what changes its skins. Colors and light are on `wall` and `lights`. */
const SFilmTheme = z.strictObject({
	// Built-in theme the look starts from: `pegboard`, `brass` or `neon`
	base: z.string(),
	parts: SThemeParts.optional(),
	// Replaces the marble-colored glowing edges of a theme that has them (Neon)
	glowColor: SHexColor.optional(),
	pack: SThemePack.optional()
});

/** A film's Wall: what it changes on its theme. Absent fields keep the base theme's. */
const wallLookShape = {
	color: SHexColor.optional(),
	backgroundColor: SHexColor.optional()
};

const SLights = z.strictObject({
	key: SKeyLightPose.extend({ color: SHexColor.optional() }).optional(),
	added: z.array(SLight)
});

/** A theme as a Pack stores it: applying it writes its look into the film's `theme`, `wall` and `lights` */
export const SPackTheme = z.strictObject({
	id: SId,
	name: z.string(),
	base: z.string(),
	parts: SThemeParts.optional(),
	glowColor: SHexColor.optional(),
	wall: z.strictObject({ ...wallLookShape, kind: SWallKind.optional() }).optional(),
	lights: SLights.optional()
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

export const SFilm = z.strictObject({
	// The one theme the film wears
	theme: SFilmTheme,
	// The Wall layer's values on top of the base theme, like a piece's skin
	wall: z.strictObject({
		...wallLookShape,
		kind: z.union([SWallKind, z.literal('none')]).optional(),
		// The plain Pegboard wall's color in Track, and in Film under the skin None; like a piece's label color
		labelColor: SHexColor.optional()
	}),
	// The Key Light's values on top of the base theme, and the added lights
	lights: SLights,
	// The Decor layers
	decor: z.array(SDecor),
	madeInBlender: z.array(SMadeInBlender),
	// The titles, in Layers order
	titles: z.array(STitle),
	quality: z.enum(['draft', 'final']),
	camera: z.strictObject({
		// Follow Marbles: on, the app moves the camera; off, it's moved in Blender
		auto: z.boolean(),
		distance: z.number().positive(),
		// Downward angle in radians
		tilt: z.number(),
		// The camera's side angle around what it follows in radians, 0 to 2π; absent is 90°
		turn: z.number().min(0).max(2 * Math.PI).optional(),
		// How much the view turns and rolls on its own, 0 to 1
		sway: z.number().min(0).max(1),
		shots: z.array(SShot),
		// Marble the camera keeps when several marbles do not fit a readable frame; absent means the first marble
		focusMarbleId: SId.optional()
	})
});

/**
 * Marble ID that addresses Backing in hit commands and hit selection keys. Marble IDs are created with a prefix
 * and a random part, so no marble has this ID.
 */
export const BACKING_ID = 'backing';

/**
 * What a Pattern made: an ordinary list of ordinary pieces, one Undo step, named after the Pattern. `hitIds` are
 * the hits it plays, in time order; a Long Rail's are the notes around its silence, or the one note it opens the track for.
 * Its settings let it run again; hand edits to its pieces stay until it does.
 */
const SPattern = z.strictObject({
	// A name from `PATTERNS`, which only the app's building layer knows
	kind: z.string(),
	hitIds: z.array(SId),
	width: z.number().positive(),
	bounce: z.number().min(0).max(1),
	// The steepest a bar may tilt, in degrees, when asked for; absent is the usual limit
	maxTilt: z.number().positive().optional()
});

// Pieces kept together. `marbleId` while they are one marble's. Without a Pattern it's a plain Group, by hand or left by a
// Flatten.
export const SGroup = z.strictObject({
	id: SId,
	name: z.string(),
	marbleId: SId.optional(),
	pieceIds: z.array(SId),
	pattern: SPattern.optional()
});

export const SProject = z.strictObject({
	$schema: z.literal('marble-project@6'),
	id: SId,
	title: z.string(),
	revision: z.number().int().nonnegative(),
	format: z.strictObject({ width: z.number().positive(), height: z.number().positive() }),
	// The film's length in seconds; the user decides where the run ends
	length: z.number().positive(),
	// Multiplies Earth's 9.81 m/s² for every marble, so a run plays slower and hops lower at the same rhythm; hits stay on
	// time because pieces are placed where the marble is
	gravity: z.number().min(0.05).max(2),
	songs: z.array(SSong),
	marbles: z.array(SMarble),
	track: z.strictObject({ pieces: z.array(SPiece), groups: z.array(SGroup) }),
	// Nothing in here can change how a marble runs
	film: SFilm
});

export const projectDefinition = defineSchema({
	family: 'marble-project',
	version: 6,
	schema: SProject
});

export type TProject = TSchemaValue<typeof projectDefinition>;
export type TVec2 = z.infer<typeof SVec2>;
export type THit = z.infer<typeof SHit>;
export type TSong = z.infer<typeof SSong>;
export type TMarble = z.infer<typeof SMarble>;
export type TPiece = z.infer<typeof SPiece>;
export type TPlace = z.infer<typeof SPlace>;
export type TPlays = z.infer<typeof SPlays>;
export type TFollows = z.infer<typeof SFollows>;
export type TRide = z.infer<typeof SRide>;
export type TTitle = z.infer<typeof STitle>;
export type TFilm = z.infer<typeof SFilm>;
export type TFilmTheme = z.infer<typeof SFilmTheme>;
export type TPackTheme = z.infer<typeof SPackTheme>;
export type TPackOrigin = z.infer<typeof SPackOrigin>;
export type TSkin = z.infer<typeof SSkin>;
export type TThemePart = z.infer<typeof SThemePart>;
export type TThemeParts = z.infer<typeof SThemeParts>;
export type TWallKind = z.infer<typeof SWallKind>;
/** What the Wall layer can wear: a wall kind, or None, the plain Pegboard wall in the layer's color */
export type TWallSkin = TWallKind | 'none';
export type TLight = z.infer<typeof SLight>;
export type TDecor = z.infer<typeof SDecor>;
export type TSnowfall = NonNullable<TDecor['snowfall']>;
export type TMadeInBlender = z.infer<typeof SMadeInBlender>;
export type TKeyLightPose = z.infer<typeof SKeyLightPose>;
export type TShot = z.infer<typeof SShot>;
export type TGroup = z.infer<typeof SGroup>;
export type TPatternGroup = TGroup & { marbleId: string; pattern: z.infer<typeof SPattern> };
export type TTempo = z.infer<typeof STempo>;
export type TPathNode = z.infer<typeof SPathNode>;

export function isPatternGroup(group: TGroup): group is TPatternGroup {
	return group.pattern != null;
}

/** The hit a piece plays or follows, or null when it's free */
export function tieOf(piece: Pick<TPiece, 'place'> | null | undefined): TPlays | TFollows | null {
	return piece == null || piece.place.kind === 'free' ? null : piece.place;
}

/** Where a free piece stands; a tied piece's place comes from the run */
export function freePosition(piece: Pick<TPiece, 'place'> | null | undefined): TVec2 | undefined {
	return piece?.place.kind === 'free' ? piece.place.position : undefined;
}
