export type TVec3 = [number, number, number];
export type TAspectRatio = '9:16' | '16:9' | '1:1';
export type TObjectKind = 'bar' | 'rail' | 'bowl' | 'bumper' | 'drum';
export type TObjectModelId =
	| 'key-bar'
	| 'key-block'
	| 'key-panel'
	| 'key-strip'
	| 'key-spoon'
	| 'rail-curve'
	| 'rail-wave'
	| 'rail-straight'
	| 'steel-pan'
	| 'bowl'
	| 'bumper';
export type TMaterial = 'wood' | 'metal' | 'rubber' | 'glass';

export interface TProject {
	version: 1;
	id: string;
	name: string;
	bpm: number;
	tempos?: { time: number; bpm: number }[];
	duration: number;
	notes: TNote[];
	tracks: TTrack[];
	objects: TSceneObject[];
	launch: { position: TVec3; velocity: TVec3; radius: number };
	gravity: number;
	restitution: number;
	aspectRatio: TAspectRatio;
	cameraDistance?: number;
	marbleColor: string;
	marbleStyle?: 'ribbon' | 'glass' | 'chrome';
	marbleEffect?: 'none' | 'iridescent' | 'flow';
	marbleEffectSpeed?: number;
	audio?: TAudioSettings;
	marbles?: TMarbleDefinition[];
	scene?: TSceneStyle;
	camera?: TCameraSettings;
	titles?: TTitleClip[];
}
export interface TNote {
	id: string;
	trackId: string;
	time: number;
	duration: number;
	midi: number;
	velocity: number;
}
export interface TTrack {
	id: string;
	name: string;
	color: string;
	instrument: number;
	muted: boolean;
	solo?: boolean;
	percussion?: boolean;
	controls?: { number: number; time: number; value: number }[];
	pitchBends?: { time: number; value: number }[];
}
export interface TSceneObject {
	id: string;
	name: string;
	kind: TObjectKind;
	modelId?: TObjectModelId;
	mountStyle?: 'none' | 'pins' | 'folded' | 'folded-front' | 'rack';
	roundedNose?: boolean;
	glowMode?: 'impact' | 'contact';
	glowFade?: number;
	marbleId?: string;
	trajectoryAnchor?: { time: number; offset: TVec3 };
	binding: { noteId: string; offset: TVec3 } | null;
	position: TVec3;
	rotation: TVec3;
	size: TVec3;
	restitution: number;
	material: TMaterial;
	friction?: number;
	materialFinish?: 'bare' | 'painted';
	color?: string;
	emission?: number;
	glowColor?: string;
	glowEndColor?: string;
	glowBalance?: number;
	path?: TVec3[];
	flex?: number;
	disabled?: boolean;
	locked?: boolean;
}
export interface TResolvedObject extends TSceneObject {
	position: TVec3;
}
export interface TSample {
	time: number;
	position: TVec3;
	rotation: [number, number, number, number];
}
export interface TImpact {
	marbleId?: string;
	objectId: string;
	noteId: string | null;
	time: number;
	position: TVec3;
	strength: number;
}
export interface TNoteMarker {
	noteId: string;
	time: number;
	position: TVec3;
	objectId: string | null;
	error: number | null;
}
export interface TPerformance {
	/** Conservatively covers every marble sweep used by placement and playback. */
	influenceBounds?: { min: TVec3; max: TVec3 };
	duration: number;
	surfaceContacts?: TSurfaceContact[];
	additionalMarbles?: { id: string; samples: TSample[] }[];
	dt: number;
	samples: TSample[];
	objects: TResolvedObject[];
	impacts: TImpact[];
	noteMarkers: TNoteMarker[];
	warnings: string[];
	bounds: { min: TVec3; max: TVec3 };
}

export interface TSceneStyle {
	theme: 'studio' | 'wall';
	/** Fixes the wall in world space; older projects without this field fit it behind their objects. */
	wallPosition?: number;
	viewTransform?: 'filmic' | 'agx' | 'neutral';
	wallClearance?: number;
	background: string;
	keyColor: string;
	fillColor: string;
	exposure: number;
	bloom: number;
	keyPosition?: TVec3;
	keyIntensity?: number;
	fillIntensity?: number;
	environmentIntensity?: number;
	keyframes?: TLightingKeyframe[];
}
export interface TLightingState {
	background: string;
	keyColor: string;
	fillColor: string;
	exposure: number;
	keyPosition: TVec3;
	keyIntensity: number;
	fillIntensity: number;
	environmentIntensity: number;
}
export interface TLightingKeyframe extends Omit<
	TLightingState,
	'keyPosition' | 'keyIntensity' | 'fillIntensity' | 'environmentIntensity'
> {
	id: string;
	time: number;
	keyPosition?: TVec3;
	keyIntensity?: number;
	fillIntensity?: number;
	environmentIntensity?: number;
}
export interface TCameraSettings {
	keyframeSpace?: 'world' | 'follow';
	followMarbles?: boolean;
	fov: number;
	distance: number;
	azimuth: number;
	elevation: number;
	lead: number;
	keyframes: TCameraKeyframe[];
}
export interface TCameraKeyframe {
	id: string;
	time: number;
	position: TVec3;
	target: TVec3;
	fov: number;
}
export interface TTitleClip {
	id: string;
	time: number;
	duration: number;
	text: string;
}

export interface TSurfaceContact {
	marbleId?: string;
	objectId: string;
	start: number;
	end: number;
	speed: number;
}
export interface TAudioSettings {
	musicVolume: number;
	surfaceVolume: number;
	surfacesEnabled: boolean;
}

export interface TMarbleDefinition {
	id: string;
	name?: string;
	launch: TProject['launch'];
	color: string;
	style?: TProject['marbleStyle'];
	effect?: TProject['marbleEffect'];
	effectSpeed?: number;
	startTime?: number;
}
