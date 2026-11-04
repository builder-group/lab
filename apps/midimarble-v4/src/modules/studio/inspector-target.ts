import { addedLights } from '@/modules/design/scene-layers';
import type { TProject } from '@/modules/project';
import { CAMERA_KEY, KEY_LIGHT_ID, parseDecorKey, parseHitKey, parseLightKey, parseMadeInBlenderKey, parseShotKey, SONG_KEY, WALL_KEY } from './selection';
import { hasSongLayer } from './song-layer';
import type { TWorkspace } from './StudioCx';

/**
 * What the inspector shows for a selection. Each layer owns its settings, like a layer in After Effects: the
 * Song its file and Backing, the Camera its framing, a shot or a title its own, a marble its colour and release,
 * the Wall its skin and colours, a light its colour, strength and direction.
 * Nothing selected is the Scene. The same selection shows the same inspector whether it was made in Layers or in the
 * timeline, and in either workspace, except that Compose has no Wall, Lights or Decor: a selection left over from Film
 * shows the Scene there.
 */
export function inspectorTarget(project: TProject, selection: readonly string[], workspace: TWorkspace = 'design'): TInspectorTarget {
	const target = selectedTarget(project, selection);
	return workspace === 'compose' && FILM_ONLY_TARGETS.includes(target.kind) ? { kind: 'scene' } : target;
}

const FILM_ONLY_TARGETS: readonly TInspectorTarget['kind'][] = ['wall', 'light', 'decor', 'madeInBlender'];

/**
 * What stays selected when Film opens. The piece or hit Compose's work last left selected would hide the theme, so
 * those go and the Scene shows (ux-benchmark item 3); a marble, the Song and Film's own layers stay.
 */
export function selectionEnteringFilm(project: TProject, selection: readonly string[]): string[] {
	const pieces = new Set(project.entities.filter((entity) => entity.components.piece != null).map((entity) => entity.id));
	return selection.filter((key) => !pieces.has(key) && parseHitKey(key) == null);
}

function selectedTarget(project: TProject, selection: readonly string[]): TInspectorTarget {
	const selected = new Set(selection);
	const entities = project.entities.filter((entity) => selected.has(entity.id));

	const pieceIds = entities.filter((entity) => entity.components.piece != null).map((entity) => entity.id);
	if (pieceIds.length > 0) return { kind: 'pieces', ids: pieceIds };

	const hitKeys = selection.filter((key) => parseHitKey(key) != null);
	if (hitKeys.length > 0) return { kind: 'hits', keys: hitKeys };

	const titleIds = entities.filter((entity) => entity.components.wallText != null).map((entity) => entity.id);
	if (titleIds.length === 1) return { kind: 'title', id: titleIds[0] as string };

	const shot = project.design.camera.shots.find((item) => selection.some((key) => parseShotKey(key) === item.id));
	if (shot != null) return { kind: 'shot', id: shot.id };

	const marble = project.entities.find((entity) => entity.id === selection[0] && entity.components.marble != null);
	const laneId = marble?.components.marble?.laneId;
	if (marble != null && laneId != null && project.music.lanes.some((lane) => lane.id === laneId)) return { kind: 'marble', entityId: marble.id, laneId };

	const lightIds = selection.flatMap((key) => parseLightKey(key) ?? []);
	if (lightIds.length > 0) {
		const added = addedLights(project.design);
		const known = lightIds.filter((id) => id === KEY_LIGHT_ID || added.some((light) => light.id === id));
		if (known.length === 1) return { kind: 'light', id: known[0] as string };
	}

	const decorIds = selection.flatMap((key) => parseDecorKey(key) ?? []).filter((id) => project.design.decor.some((item) => item.id === id) === true);
	if (decorIds.length === 1) return { kind: 'decor', id: decorIds[0] as string };

	const blenderName = selection.flatMap((key) => parseMadeInBlenderKey(key) ?? [])[0];
	if (blenderName != null) return { kind: 'madeInBlender', name: blenderName };

	if (selected.has(WALL_KEY)) return { kind: 'wall' };
	if (selected.has(SONG_KEY) && hasSongLayer(project)) return { kind: 'song' };
	if (selected.has(CAMERA_KEY)) return { kind: 'camera' };
	return { kind: 'scene' };
}

export type TInspectorTarget =
	| { kind: 'pieces'; ids: string[] }
	| { kind: 'hits'; keys: string[] }
	| { kind: 'title'; id: string }
	| { kind: 'shot'; id: string }
	| { kind: 'marble'; entityId: string; laneId: string }
	| { kind: 'light'; id: string }
	| { kind: 'decor'; id: string }
	| { kind: 'madeInBlender'; name: string }
	| { kind: 'wall' }
	| { kind: 'song' }
	| { kind: 'camera' }
	| { kind: 'scene' };
