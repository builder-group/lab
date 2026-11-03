import type { TPieceDefinition } from './types';

/** Flat bar the marble bounces off. The collider is a box; its top face is the contact surface. */
export const platformDefinition: TPieceDefinition = {
	type: 'platform',
	label: 'Platform',
	params: {
		length: { default: 0.06, min: 0.02, max: 0.3, label: 'Length', unit: 'm' },
		thickness: { default: 0.008, min: 0.003, max: 0.03, label: 'Thickness', unit: 'm' },
		depth: { default: 0.03, min: 0.02, max: 0.08, label: 'Depth', unit: 'm' }
	},
	wallOffset: 0,
	restitution: 0.55,
	friction: 0.3
};

export const pieceDefinitions: Record<string, TPieceDefinition> = {
	[platformDefinition.type]: platformDefinition
};

export function getPieceDefinition(type: string): TPieceDefinition | undefined {
	return pieceDefinitions[type];
}

/** Parameters with defaults filled in and values clamped to their limits */
export function resolvePieceParams(
	type: string,
	params: Record<string, number>
): Record<string, number> {
	const definition = getPieceDefinition(type);
	if (definition == null) return { ...params };
	const resolved: Record<string, number> = {};
	for (const [name, spec] of Object.entries(definition.params)) {
		const value = params[name] ?? spec.default;
		resolved[name] = Math.min(spec.max, Math.max(spec.min, value));
	}
	return resolved;
}
