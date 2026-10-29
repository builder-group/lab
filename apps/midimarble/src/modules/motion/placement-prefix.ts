import type { TProject, TResolvedObject, TSceneObject, TVec3 } from '../project/types';
import type { TCompileOptions } from './motion-progress';

/** Reuses only the unchanged causal prefix of the sequential placement solver. */
export function getPlacementPrefix(
	project: TProject,
	ordered: TResolvedObject[],
	previous: TCompileOptions['previous']
): TVec3[] {
	if (previous == null || worldSignature(project) !== worldSignature(previous.project)) return [];
	const oldOrdered = previous.project.objects
		.filter((object) => !isWorldObject(object, previous.project))
		.sort(
			(left, right) =>
				placementTime(left, previous.project) - placementTime(right, previous.project) ||
				left.id.localeCompare(right.id)
		);
	const oldResolved = new Map(previous.performance.objects.map((object) => [object.id, object]));
	const result: TVec3[] = [];
	for (const [index, object] of ordered.entries()) {
		const old = oldOrdered[index];
		const resolved = oldResolved.get(object.id);
		if (
			old == null ||
			resolved == null ||
			physicalSignature(object, project) !== physicalSignature(old, previous.project)
		)
			break;
		result.push(resolved.position);
	}
	return result;
}

function worldSignature(project: TProject): string {
	return JSON.stringify([
		project.duration,
		project.launch,
		(project.marbles ?? []).map(({ id, launch, startTime }) => [id, launch, startTime ?? 0]),
		project.gravity,
		project.restitution,
		project.objects
			.filter((object) => isWorldObject(object, project))
			.map((object) => physicalSignature(object, project))
	]);
}

function isWorldObject(object: TSceneObject, project: TProject): boolean {
	return (
		object.disabled === true ||
		(object.trajectoryAnchor == null &&
			(object.binding == null || !project.notes.some((note) => note.id === object.binding?.noteId)))
	);
}

function placementTime(object: TSceneObject, project: TProject): number {
	return (
		object.trajectoryAnchor?.time ??
		project.notes.find((note) => note.id === object.binding?.noteId)?.time ??
		0
	);
}

function physicalSignature(object: TSceneObject, project: TProject): string {
	return JSON.stringify([
		object.id,
		object.kind,
		object.marbleId ?? 'main',
		object.binding,
		object.trajectoryAnchor ?? null,
		isWorldObject(object, project) ? object.position : null,
		placementTime(object, project),
		object.rotation,
		object.size,
		object.restitution,
		object.path ?? null,
		object.disabled ?? false,
		...(object.friction == null ? [] : [object.friction]),
		...(object.kind === 'bar' && object.mountStyle === 'folded-front' ? ['folded-front'] : [])
	]);
}
