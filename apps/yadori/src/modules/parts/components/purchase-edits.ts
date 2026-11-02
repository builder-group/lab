import type { TAsset, TCommand, TProject, TPurchase } from '../../project/model';

/** Coordinates purchase corrections with physical stock; domain validation remains authoritative. */
export function buildPurchaseEditCommands(
	project: TProject,
	purchaseId: string,
	patch: Partial<Omit<TPurchase, 'id' | 'partId' | 'unit'>>,
	attachment: TAsset | null = null
): TCommand[] {
	const purchase = project.purchases.find((entry) => entry.id === purchaseId);
	if (!purchase) throw new Error('This purchase is no longer in the project.');
	const stock = project.stockPieces.filter((piece) => piece.purchaseId === purchase.id);
	const stockLength = stock.reduce((sum, piece) => sum + piece.lengthM, 0);
	if (patch.quantity != null && patch.quantity + 0.000001 < stockLength)
		throw new Error(
			'Quantity cannot be smaller than the stock lengths recorded for this purchase. Correct those lengths first.'
		);
	if (patch.status === 'ordered' && stock.length > 0)
		throw new Error(
			'This order already has received stock. Keep it received, or correct its stock records first.'
		);
	const commands: TCommand[] = [];
	if (patch.status === 'returned' && stock.length > 0) {
		const ids = new Set(stock.map((piece) => piece.id));
		if (
			project.cuts.some((cut) => ids.has(cut.stockPieceId)) ||
			project.allocations.some((allocation) => ids.has(allocation.stockPieceId))
		)
			throw new Error(
				'This purchase has cut or reserved stock. Reconcile those records before returning the order.'
			);
		commands.push(...stock.map((piece): TCommand => ({ type: 'stock.remove', id: piece.id })));
	}
	if (attachment && !project.assets.some((asset) => asset.id === attachment.id))
		commands.push({ type: 'asset.add', asset: attachment });
	commands.push({ type: 'purchase.update', id: purchase.id, patch });
	return commands;
}
