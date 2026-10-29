/** Discards a piano group when an external selection leaves it, preserving primary changes within it. */
export function reconcilePianoSelection(
	selection: TPianoSelection,
	primaryId: string | null
): TPianoSelection {
	if (selection.primaryId === primaryId) return selection;
	if (primaryId != null && selection.ids.has(primaryId)) return { ...selection, primaryId };
	return { primaryId, ids: new Set(primaryId == null ? [] : [primaryId]) };
}

export interface TPianoSelection {
	primaryId: string | null;
	ids: ReadonlySet<string>;
}
