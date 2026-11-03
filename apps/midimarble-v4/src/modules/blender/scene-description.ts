// Contract between the app and the bundled Blender worker. The app sends a scene description with
// `apply_scene`; the worker creates or updates app-owned objects and keyframes from it.
// Units: metres, seconds, radians. Wall-plane x right, y up; Blender uses x right, z up, y into the wall,
// so a wall point (x, y) at distance d from the wall becomes Blender (x, -d, y). A wall angle a (counter-clockwise
// seen from the front) becomes a rotation of -a around Blender +Y. Frame f shows time f / fps; scenes start at frame 0.

export const SCENE_DESCRIPTION_VERSION = 1;

export interface TSceneDescription {
	version: typeof SCENE_DESCRIPTION_VERSION;
	projectId: string;
	revision: number;
	/** Render frame rate keyframes are written at */
	fps: number;
	duration: number;
	frame: { width: number; height: number };
	/** `pegboard` or `brass`; unknown themes fall back to `pegboard` */
	theme: string;
	marbles: TSceneMarble[];
	pieces: TScenePiece[];
	/**
	 * Follow-camera rig settings from the project's `design.camera`. Without them the worker frames the run with
	 * a static front camera.
	 */
	camera?: TSceneCamera;
	/** Overrides of the theme's hit reactions */
	reactions?: TSceneReactions;
	/** Wall text placed in Design. Optional and additive; workers that do not know it ignore it. */
	wallTexts?: TSceneWallText[];
	/**
	 * Seamless loop: films render [start, end), the camera blends its last `blend` seconds into its poses from before
	 * `start`, and ghost marbles (`ghostOf`) enter for the next round. `duration` equals `end`.
	 */
	loop?: TSceneLoop | null;
}

export interface TSceneLoop {
	start: number;
	end: number;
	blend: number;
}

export interface TSceneCamera {
	/** `manual` leaves the camera to Blender */
	mode: 'rig' | 'manual';
	/** Camera distance from the followed point in metres */
	distance: number;
	/** Downward angle from the wall normal in radians; larger looks more steeply along the wall */
	pitch: number;
	/** Seconds the target leads the marble */
	lead: number;
	/** 0 to 1; larger follows more calmly */
	smoothing: number;
	shots: TSceneShot[];
	/**
	 * Marble the camera keeps when several marbles no longer fit a readable frame; the others may leave it. Absent
	 * picks the first marble, which carries the melody lane. Optional and additive.
	 */
	focusMarbleId?: string | null;
	/**
	 * Shared descent pace y*(t) of the lanes from the simulation, in wall metres. The camera frames a group of
	 * marbles at this height instead of their bouncing centre. Optional and additive.
	 */
	descent?: TSceneDescentPoint[] | null;
}

export interface TSceneDescentPoint {
	time: number;
	y: number;
}

export interface TSceneShot {
	time: number;
	kind: string;
	/** Extra roll around the followed point in radians */
	roll: number;
	distance: number;
}

export interface TSceneReactions {
	/** Bar tilt at a hit in degrees */
	dip?: number;
	/** Bar press along its normal at a hit in metres */
	press?: number;
	/** Emission strength of the hit flash; 0 turns it off */
	flash?: number;
}

export interface TSceneMarble {
	/** Stable entity ID; becomes the holder object's `mm_id` */
	id: string;
	name: string;
	radius: number;
	color: string;
	/** Package-relative path of a little-endian Float32 file with records [time, x, y, angle] */
	motionPath: string;
	sampleCount: number;
	/**
	 * Set on the loop ghost of a marble: a second instance that replays the marble's entry so the loop end shows
	 * the first frame again. The camera does not follow ghosts.
	 */
	ghostOf?: string;
}

export interface TScenePiece {
	id: string;
	name: string;
	type: string;
	params: Record<string, number>;
	position: { x: number; y: number };
	angle: number;
	/** Distance of the piece from the wall surface */
	wallOffset: number;
	/** Hit times on this piece. The worker animates the custom property `mm_hit` from them. */
	hitTimes: number[];
	/** Optional package-relative Float32 file with records [time, angle] for moving pieces such as windmills */
	motionPath: string | null;
	sampleCount: number;
	/**
	 * Support line of rails and tunnels in wall coordinates: the resolved, smoothed polyline the simulation
	 * collides with (derived from the entity's `path` component). The marble centre rides `radius + wire radius`
	 * above it.
	 */
	path?: { x: number; y: number }[] | null;
	/**
	 * Wire segments of a switchback in wall coordinates: its two walls, then its legs from the top. Each wire is a
	 * capsule of the piece's `radius` param around its polyline. Optional and additive.
	 */
	paths?: { x: number; y: number }[][] | null;
	skin: { assetId: string; link: 'linked' | 'unlinked' } | null;
	/**
	 * Package-relative `.blend` of a library skin, such as `assets/piano-key/asset.blend`. Set when `skin.assetId`
	 * names a project library item; built-in skins such as `brass:<finish>` have none. Optional and additive.
	 */
	assetPath?: string | null;
	/** Hit reaction chosen in Design (`none`, `press`, `wobble` or `glow`); absent keeps the theme default */
	reaction?: { preset: string; params: Record<string, number> } | null;
	color: string;
}

/** Native Blender text object on the wall, from an entity's `wallText` and `transform` components */
export interface TSceneWallText {
	id: string;
	text: string;
	font: string;
	/** Letter height in metres */
	size: number;
	/** Extrusion in metres */
	depth: number;
	color: string;
	position: { x: number; y: number };
	angle: number;
}
