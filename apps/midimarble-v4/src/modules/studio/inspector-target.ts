import type { TProject } from '@/modules/project';
import { CAMERA_KEY, parseHitKey, parseShotKey, SONG_KEY } from './selection';
import { hasSongLayer } from './song-layer';

/**
 * What the inspector shows for a selection. Each layer owns its settings, like a layer in After Effects: the
 * Song its file and Backing, the Camera its framing, a shot or a title its own, a marble its colour and release.
 * Nothing selected shows the Project. The same selection shows the same inspector whether it was made in Layers
 * or in the timeline, and in either workspace.
 */
export function inspectorTarget(project: TProject, selection: readonly string[]): TInspectorTarget {
	const selected = new Set(selection);
	const entities = project.entities.filter((entity) => selected.has(entity.id));

	const pieceIds = entities.filter((entity) => entity.components.piece != null).map((entity) => entity.id);
	if (pieceIds.length > 0) return { kind: 'pieces', ids: pieceIds };

	const hitKeys = selection.filter((key) => parseHitKey(key) != null);
	if (hitKeys.length > 0) return { kind: 'hits', keys: hitKeys };

	const titleIds = entities.filter((entity) => entity.components.wallText != null).map((entity) => entity.id);
	if (titleIds.length === 1) return { kind: 'title', id: titleIds[0] as string };
	if (titleIds.length > 1) return { kind: 'titles', ids: titleIds };

	const shot = project.design.camera.shots.find((item) => selection.some((key) => parseShotKey(key) === item.id));
	if (shot != null) return { kind: 'shot', id: shot.id };

	const marble = project.entities.find((entity) => entity.id === selection[0] && entity.components.marble != null);
	const laneId = marble?.components.marble?.laneId;
	if (marble != null && laneId != null && project.music.lanes.some((lane) => lane.id === laneId)) return { kind: 'marble', entityId: marble.id, laneId };

	if (selected.has(SONG_KEY) && hasSongLayer(project)) return { kind: 'song' };
	if (selected.has(CAMERA_KEY)) return { kind: 'camera' };
	return { kind: 'project' };
}

export type TInspectorTarget =
	| { kind: 'pieces'; ids: string[] }
	| { kind: 'hits'; keys: string[] }
	| { kind: 'title'; id: string }
	| { kind: 'titles'; ids: string[] }
	| { kind: 'shot'; id: string }
	| { kind: 'marble'; entityId: string; laneId: string }
	| { kind: 'song' }
	| { kind: 'camera' }
	| { kind: 'project' };
