import { addedLights } from '@/modules/scene';
import { isPatternGroup, type TProject, CAMERA_KEY, KEY_LIGHT_ID, parseDecorKey, parseGroupKey, parseHitKey, parseLightKey, parseMadeInBlenderKey, parseRangeKey, parseShotKey, SONG_KEY, WALL_KEY } from '@/modules/project';
import { hasSongLayer } from './song-layer';
import type { TWorkspace } from './StudioCx';

/**
 * What the inspector shows for a selection. Each layer owns its settings: the
 * Song its file and Backing, the Camera its framing, a shot or a title its own, a marble its color and release,
 * the Wall its skin and colors, a light its color, strength and direction.
 * Nothing selected is the Scene. The same selection shows the same inspector whether it was made in Layers or in the
 * timeline, and in either workspace, except that Track has no Lights or Decor: a selection left over from Film
 * shows the Scene there.
 */
export function inspectorTarget(project: TProject, selection: readonly string[], workspace: TWorkspace = 'film'): TInspectorTarget {
	// Patterns are Track's: in Film a Group's selection is its pieces. In Track a live Pattern's piece shows its Group
	if (workspace === 'track') {
		const group = project.groups?.filter(isPatternGroup).find((item) => selection.some((key) => parseGroupKey(key) === item.id || item.pieceIds.includes(key)));
		if (group != null) return { kind: 'group', id: group.id };
		const range = selection.flatMap((key) => parseRangeKey(key) ?? [])[0];
		if (range != null) return { kind: 'patternRange', ...range };
	}
	const target = selectedTarget(project, selection);
	return workspace === 'track' && FILM_ONLY_TARGETS.includes(target.kind) ? { kind: 'scene' } : target;
}

const FILM_ONLY_TARGETS: readonly TInspectorTarget['kind'][] = ['light', 'decor', 'decorItems', 'madeInBlender'];

/**
 * What stays selected when Film opens. The piece or hit Track's work last left selected would hide the theme, so
 * those go and the Scene shows (ux-benchmark item 3); a marble, the Song and Film's own layers stay.
 */
export function selectionEnteringFilm(project: TProject, selection: readonly string[]): string[] {
	const pieces = new Set(project.entities.filter((entity) => entity.components.piece != null).map((entity) => entity.id));
	return selection.filter((key) => !pieces.has(key) && parseHitKey(key) == null && parseGroupKey(key) == null && parseRangeKey(key) == null);
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
	if (titleIds.length > 1) return { kind: 'titles', ids: titleIds };

	const shot = project.film.camera.shots.find((item) => selection.some((key) => parseShotKey(key) === item.id));
	if (shot != null) return { kind: 'shot', id: shot.id };

	const marble = project.entities.find((entity) => entity.id === selection[0] && entity.components.marble != null);
	const marbleId = marble?.components.marble?.marbleId;
	if (marble != null && marbleId != null && project.music.lanes.some((lane) => lane.id === marbleId)) return { kind: 'marble', entityId: marble.id, marbleId };

	const lightIds = selection.flatMap((key) => parseLightKey(key) ?? []);
	if (lightIds.length > 0) {
		const added = addedLights(project.film);
		const known = lightIds.filter((id) => id === KEY_LIGHT_ID || added.some((light) => light.id === id));
		if (known.length === 1) return { kind: 'light', id: known[0] as string };
	}

	const decorIds = selection.flatMap((key) => parseDecorKey(key) ?? []).filter((id) => project.film.decor.some((item) => item.id === id) === true);
	if (decorIds.length === 1) return { kind: 'decor', id: decorIds[0] as string };
	if (decorIds.length > 1) return { kind: 'decorItems', ids: decorIds };

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
	| { kind: 'group'; id: string }
	| { kind: 'patternRange'; marbleId: string; from: number; to: number }
	| { kind: 'title'; id: string }
	| { kind: 'titles'; ids: string[] }
	| { kind: 'shot'; id: string }
	| { kind: 'marble'; entityId: string; marbleId: string }
	| { kind: 'light'; id: string }
	| { kind: 'decor'; id: string }
	| { kind: 'decorItems'; ids: string[] }
	| { kind: 'madeInBlender'; name: string }
	| { kind: 'wall' }
	| { kind: 'song' }
	| { kind: 'camera' }
	| { kind: 'scene' };
