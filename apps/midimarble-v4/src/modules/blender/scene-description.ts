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
	theme: string;
	marbles: TSceneMarble[];
	pieces: TScenePiece[];
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
	skin: { assetId: string; link: 'linked' | 'unlinked' } | null;
	color: string;
}
