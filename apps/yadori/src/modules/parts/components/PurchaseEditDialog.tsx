import { FileText, Paperclip, X } from 'lucide-react';
import React from 'react';
import { Button, Field, IconButton, Modal } from '../../../components/ui';
import * as desktop from '../../../environment/desktop';
import { quantity } from '../../../lib/format';
import type { TAsset, TPart, TProject, TPurchase } from '../../project/model';
import type { PartsCx } from '../PartsCx';
import { buildPurchaseEditCommands } from './purchase-edits';

export const PurchaseEditDialog: React.FC<TPurchaseEditDialogProps> = ({
	part,
	project,
	purchase,
	cx,
	onClose
}) => {
	const [amount, setAmount] = React.useState(String(purchase.quantity));
	const [price, setPrice] = React.useState(
		purchase.totalPrice == null ? '' : String(purchase.totalPrice)
	);
	const [shipping, setShipping] = React.useState(
		purchase.shipping == null ? '' : String(purchase.shipping)
	);
	const [status, setStatus] = React.useState(purchase.status);
	const [date, setDate] = React.useState(purchase.orderedAt.slice(0, 10));
	const [sourceId, setSourceId] = React.useState(purchase.sourceId ?? '');
	const [notes, setNotes] = React.useState(purchase.notes);
	const [receipt, setReceipt] = React.useState<TAsset | null>(
		project.assets.find((asset) => asset.id === purchase.receiptAssetId) ?? null
	);
	const [busy, setBusy] = React.useState(false);
	const [error, setError] = React.useState<string | null>(null);
	const stock = project.stockPieces.filter((piece) => piece.purchaseId === purchase.id);
	async function attach(): Promise<void> {
		setBusy(true);
		setError(null);
		try {
			const asset = await desktop.addProjectAsset(project.id);
			if (cx.session.$project.get()?.id !== project.id) return;
			if (asset) {
				if (!['application/pdf', 'image/png', 'image/jpeg', 'image/webp'].includes(asset.mediaType))
					throw new Error('Choose a PDF, PNG, JPEG or WebP receipt.');
				setReceipt({ ...asset, sourceUrl: null, attribution: null });
			}
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : String(cause));
		} finally {
			setBusy(false);
		}
	}
	function submit(event: React.FormEvent): void {
		event.preventDefault();
		setError(null);
		try {
			const current = cx.session.$project.get();
			if (!current || current.id !== project.id)
				throw new Error('The active project changed. Reopen this purchase to edit it.');
			const parsedQuantity = number(amount);
			const totalPrice = price.trim() ? number(price) : null;
			const shippingPrice = shipping.trim() ? number(shipping) : null;
			if (
				parsedQuantity == null ||
				parsedQuantity <= 0 ||
				(totalPrice != null && totalPrice < 0) ||
				(shippingPrice != null && shippingPrice < 0) ||
				(price.trim() && totalPrice == null) ||
				(shipping.trim() && shippingPrice == null)
			)
				throw new Error(
					'Enter a positive quantity and non-negative prices, or leave a price blank.'
				);
			if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(`${date}T12:00:00Z`)))
				throw new Error('Choose a valid order date.');
			const commands = buildPurchaseEditCommands(
				current,
				purchase.id,
				{
					quantity: parsedQuantity,
					totalPrice,
					shipping: shippingPrice,
					status,
					orderedAt:
						date === purchase.orderedAt.slice(0, 10) ? purchase.orderedAt : `${date}T12:00:00.000Z`,
					sourceId: sourceId || null,
					notes,
					receiptAssetId: receipt?.id ?? null
				},
				receipt
			);
			if (cx.session.execute(commands, 'Edit purchase')) onClose();
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : String(cause));
		}
	}
	return (
		<Modal title="Edit purchase" onClose={onClose}>
			<form onSubmit={submit}>
				<p className="purchase-part-name">{part.name}</p>
				<div className="form-columns">
					<Field label={`Quantity (${part.unit === 'm' ? 'metres' : 'units'})`}>
						<input
							autoFocus
							required
							type="number"
							min="0.001"
							step="any"
							value={amount}
							onChange={(event) => setAmount(event.target.value)}
						/>
					</Field>
					<Field label="Status">
						<select
							value={status}
							onChange={(event) => setStatus(event.target.value as TPurchase['status'])}
						>
							<option value="ordered">Ordered</option>
							<option value="received">Received</option>
							<option value="returned">Returned / refunded</option>
						</select>
					</Field>
					<Field label="Total price (€)">
						<input
							type="number"
							min="0"
							step="any"
							value={price}
							onChange={(event) => setPrice(event.target.value)}
							placeholder="Not recorded"
						/>
					</Field>
					<Field label="Shipping (€)">
						<input
							type="number"
							min="0"
							step="any"
							value={shipping}
							onChange={(event) => setShipping(event.target.value)}
							placeholder="Not recorded"
						/>
					</Field>
					<Field label="Order date">
						<input
							required
							type="date"
							value={date}
							onChange={(event) => setDate(event.target.value)}
						/>
					</Field>
					<Field label="Seller link">
						<select value={sourceId} onChange={(event) => setSourceId(event.target.value)}>
							<option value="">None</option>
							{project.sources
								.filter((source) => source.partId === part.id)
								.map((source) => (
									<option key={source.id} value={source.id}>
										{source.title}
									</option>
								))}
						</select>
					</Field>
				</div>
				{stock.length > 0 && (
					<p className="help-text">
						{quantity(
							stock.reduce((sum, piece) => sum + piece.lengthM, 0),
							'm'
						)}{' '}
						recorded as physical stock.{' '}
						{status === 'returned'
							? 'Returning removes uncut, unreserved stock from this order. Cut or reserved stock must be reconciled first.'
							: 'Correct stock lengths separately if the original piece breakdown was wrong.'}
					</p>
				)}
				<Field label="Receipt">
					<div className="purchase-receipt-field">
						{receipt && (
							<>
								<FileText size={14} />
								<span>{receipt.name}</span>
								<IconButton label="Remove receipt attachment" onClick={() => setReceipt(null)}>
									<X size={12} />
								</IconButton>
							</>
						)}
						<Button
							disabled={busy || !desktop.isDesktop()}
							onClick={() => void attach()}
							icon={<Paperclip size={12} />}
						>
							{busy ? 'Choosing…' : receipt ? 'Replace' : 'Attach file'}
						</Button>
					</div>
					{!desktop.isDesktop() && (
						<small className="help-text">File attachments are available in the desktop app.</small>
					)}
				</Field>
				<Field label="Notes">
					<textarea
						value={notes}
						onChange={(event) => setNotes(event.target.value)}
						placeholder="Seller, order number…"
					/>
				</Field>
				{error && (
					<p className="field-error" role="alert">
						{error}
					</p>
				)}
				<div className="modal-actions">
					<Button onClick={onClose}>Cancel</Button>
					<Button type="submit" variant="primary" disabled={busy}>
						Save purchase
					</Button>
				</div>
			</form>
		</Modal>
	);
};
interface TPurchaseEditDialogProps {
	part: TPart;
	project: TProject;
	purchase: TPurchase;
	cx: PartsCx;
	onClose(): void;
}
function number(value: string): number | null {
	const parsed = Number(value.trim().replace(',', '.'));
	return value.trim() && Number.isFinite(parsed) ? parsed : null;
}
