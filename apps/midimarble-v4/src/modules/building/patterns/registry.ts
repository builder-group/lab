import type { TPatternDefinition } from './contract';
import { longRail } from './long-rail';
import { staircase } from './staircase';
import { switchback } from './switchback';
import { zigzag } from './zigzag';

/** Every Pattern. A new one is its file and a line here */
export const PATTERNS = { zigzag, staircase, longRail, switchback } satisfies Record<string, TPatternDefinition>;

export type TPatternKind = keyof typeof PATTERNS;

export const PATTERN_KINDS = Object.keys(PATTERNS) as TPatternKind[];

/** A stored kind's Pattern, or null for one this version doesn't have */
export function patternOfKind(kind: string): TPatternDefinition | null {
	return isPatternKind(kind) ? PATTERNS[kind] : null;
}

export function isPatternKind(kind: string): kind is TPatternKind {
	return Object.hasOwn(PATTERNS, kind);
}

/** The Patterns a range offers: those playing its notes, or those filling its silence */
export function patternKinds(takes: TPatternDefinition['takes']): TPatternKind[] {
	return PATTERN_KINDS.filter((kind) => PATTERNS[kind].takes === takes);
}

/** A Pattern's name, or the word for one this version doesn't have */
export function patternLabel(kind: string): string {
	return patternOfKind(kind)?.label ?? 'Pattern';
}

/**
 * What the inspector's Bounce asks for. The same restitution on every bar missed hits on real rhythm (54 of 58 on the
 * reference, 38 of 58 at 0.75), so each bar's bounce is solved, and a livelier Bounce asks for less fall per hit.
 */
export function dropForBounce(kind: string, bounce: number): number {
	return (patternOfKind(kind)?.drop ?? 0.08) * (1 + (0.5 - bounce) * 2.5);
}
