import type { TObjectKind, TObjectModelId, TSceneObject, TVec3 } from './types';

/** A model chooses its appearance; kind remains the small, explicit collision behavior. */
export const objectCatalog: TObjectAsset[] = [
	{
		id: 'key-bar',
		label: 'Metal key',
		description: 'Thin steel key with two small mounting pins',
		category: 'Keys',
		kind: 'bar',
		size: [0.35, 0.065, 1.5],
		rotation: [0, 0, 0.18]
	},
	{
		id: 'key-block',
		label: 'Resonator key',
		description: 'A solid metal key with a dark endcap and pin mounts',
		category: 'Keys',
		kind: 'bar',
		size: [0.35, 0.12, 1.5],
		rotation: [0, 0, 0.18]
	},
	{
		id: 'key-panel',
		label: 'Wide key',
		description: 'A broad, flat percussion panel',
		category: 'Keys',
		kind: 'bar',
		size: [0.65, 0.055, 1.6],
		rotation: [0, 0, 0.12]
	},
	{
		id: 'key-strip',
		label: 'Folded spring key',
		description: 'A thin metal strip with a raised front flange and a flat striking face',
		category: 'Keys',
		kind: 'bar',
		size: [0.35, 0.045, 1.5],
		rotation: [0, 0, -0.18]
	},
	{
		id: 'key-spoon',
		label: 'Spoon key',
		description: 'A narrow curved metal tongue with a rounded striking tip',
		category: 'Keys',
		kind: 'bar',
		size: [0.45, 0.045, 1.5],
		rotation: [0, 0, 0.18]
	},
	{
		id: 'rail-curve',
		label: 'Curved twin rail',
		description: 'A quiet rolling transition between notes',
		category: 'Rails',
		kind: 'rail',
		size: [3.2, 0.03, 0.34],
		rotation: [0, 0, 0]
	},
	{
		id: 'rail-wave',
		label: 'Continuous wave rail',
		description: 'Two rolling dips joined by a smooth raised crest',
		category: 'Rails',
		kind: 'rail',
		size: [6.4, 0.03, 0.34],
		rotation: [0, 0, 0]
	},
	{
		id: 'rail-straight',
		label: 'Straight twin rail',
		description: 'A shallow metal guide for longer runs',
		category: 'Rails',
		kind: 'rail',
		size: [3.2, 0.03, 0.34],
		rotation: [0, 0, -0.12]
	},
	{
		id: 'steel-pan',
		label: 'Steel pan',
		description: 'A round resonant striking surface',
		category: 'Percussion',
		kind: 'drum',
		size: [1.2, 0.18, 1.2],
		rotation: [0, 0, 0]
	},
	{
		id: 'bowl',
		label: 'Resonator bowl',
		description: 'A curved catch and release',
		category: 'Percussion',
		kind: 'bowl',
		size: [1.4, 0.4, 1.4],
		rotation: [0, 0, 0]
	},
	{
		id: 'bumper',
		label: 'Rubber bumper',
		description: 'A soft, springy change of direction',
		category: 'Percussion',
		kind: 'bumper',
		size: [0.6, 0.6, 0.6],
		rotation: [0, 0, 0]
	}
];

export function createCatalogObject(
	modelId: TObjectModelId,
	position: TVec3 = [0, 0, 0]
): TSceneObject {
	const model = objectCatalog.find((asset) => asset.id === modelId);
	if (!model) throw new Error('Unknown object model.');
	const object: TSceneObject = {
		id: crypto.randomUUID(),
		name: model.label,
		modelId,
		kind: model.kind,
		binding: null,
		position: [...position],
		rotation: [...model.rotation],
		size: [...model.size],
		material: model.kind === 'bumper' ? 'rubber' : 'metal',
		restitution: model.kind === 'rail' ? 0 : model.kind === 'bumper' ? 0.9 : 0.35,
		color: model.kind === 'bar' ? '#24262f' : model.kind === 'bumper' ? '#cc9567' : '#777c85',
		glowColor: '#79e5ee',
		emission: model.kind === 'bar' ? 1.5 : 0,
		flex: 0.6
	};
	if (modelId === 'key-spoon') {
		object.roundedNose = true;
		object.mountStyle = 'none';
		object.materialFinish = 'bare';
		object.color = '#9393a6';
	}
	if (modelId === 'key-block') object.color = '#a79e8e';
	if (modelId === 'key-strip') {
		object.mountStyle = 'folded-front';
		object.materialFinish = 'bare';
		object.color = '#a79e8e';
	}
	if (model.kind === 'rail') object.path = createCatalogRailPath(modelId, model.size[0]);
	return object;
}
export interface TObjectAsset {
	id: TObjectModelId;
	label: string;
	description: string;
	category: 'Keys' | 'Rails' | 'Percussion';
	kind: TObjectKind;
	size: TVec3;
	rotation: TVec3;
}

/** Returns independent local points at the requested width, preserving the preset proportions. */
export function createCatalogRailPath(modelId: TObjectModelId, width: number): TVec3[] | undefined {
	if (modelId === 'rail-straight')
		return [
			[-width / 2, 0, 0],
			[width / 2, 0, 0]
		];
	if (modelId === 'rail-curve')
		return Array.from({ length: 25 }, (_, index): TVec3 => {
			const x = (index / 24 - 0.5) * 3.2;
			return [(x * width) / 3.2, ((0.3 * x * x - 0.5) * width) / 3.2, 0];
		});
	if (modelId !== 'rail-wave') return undefined;
	const knots: [number, number][] = [
		[0, 0],
		[0.22, -0.3],
		[0.52, -0.08],
		[0.8, -0.4],
		[1, -0.25]
	];
	return Array.from({ length: 65 }, (_, index): TVec3 => {
		const progress = index / 64;
		const segment = Math.min(
			knots.findIndex((point) => point[0] >= progress),
			knots.length - 1
		);
		const [startX, startY] = knots[Math.max(0, segment - 1)] ?? [0, 0];
		const [endX, endY] = knots[Math.max(1, segment)] ?? [1, 0];
		const t = (progress - startX) / (endX - startX);
		const smooth = t * t * (3 - 2 * t);
		return [(progress - 0.5) * width, ((startY + (endY - startY) * smooth) * width) / 6.4, 0];
	});
}
