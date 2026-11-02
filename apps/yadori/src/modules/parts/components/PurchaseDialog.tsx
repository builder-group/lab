import React from 'react';
import { Button, Field, Modal } from '../../../components/ui';
import { type TPart, type TPurchase, type TStockPiece } from '../../project/model';
import type { PartsCx } from '../PartsCx';

export const PurchaseDialog: React.FC<{
	part: TPart;
	cx: PartsCx;
	onClose(): void;
	onRecorded?(): void;
}> = ({ part, cx, onClose, onRecorded }) => {
	const [amount, setAmount] = React.useState(part.unit === 'm' ? '10' : '1');
	const [price, setPrice] = React.useState('');
	const [shipping, setShipping] = React.useState('');
	const [status, setStatus] = React.useState<'ordered' | 'received'>('received');
	const [notes, setNotes] = React.useState('');
	const [pieceLengths, setPieceLengths] = React.useState('');
	const [continuous, setContinuous] = React.useState(false);
	const [error, setError] = React.useState<string | null>(null);
	function submit(event: React.FormEvent): void {
		event.preventDefault();
		const quantity = Number(amount);
		const totalPrice = price.trim() ? Number(price) : null;
		const shippingPrice = shipping.trim() ? Number(shipping) : null;
		if (
			!Number.isFinite(quantity) ||
			quantity <= 0 ||
			(totalPrice != null && (!Number.isFinite(totalPrice) || totalPrice < 0)) ||
			(shippingPrice != null && (!Number.isFinite(shippingPrice) || shippingPrice < 0))
		)
			return;
		const purchase: TPurchase = {
			id: crypto.randomUUID(),
			partId: part.id,
			sourceId: null,
			orderedAt: new Date().toISOString(),
			quantity,
			unit: part.unit,
			totalPrice,
			shipping: shippingPrice,
			status,
			receiptAssetId: null,
			notes
		};
		const commands: Parameters<typeof cx.session.execute>[0] = [
			{ type: 'purchase.add', purchase },
			{
				type: 'part.update',
				id: part.id,
				patch: { sections: [...new Set([...part.sections, 'purchasing'])] }
			}
		];
		if (part.unit === 'm' && status === 'received' && pieceLengths.trim()) {
			const lengths = pieceLengths
				.split(/[;,\s]+/)
				.filter(Boolean)
				.map(Number);
			if (
				!lengths.length ||
				lengths.some((length) => !Number.isFinite(length) || length <= 0) ||
				Math.abs(lengths.reduce((sum, length) => sum + length, 0) - quantity) > 0.001
			) {
				setError('Piece lengths must add up to the received quantity.');
				return;
			}
			lengths.forEach((length, index) => {
				const stock: TStockPiece = {
					id: crypto.randomUUID(),
					partId: part.id,
					purchaseId: purchase.id,
					label: lengths.length === 1 ? 'Received length' : `Piece ${index + 1}`,
					lengthM: length,
					continuity: continuous ? 'continuous' : 'unknown',
					notes: ''
				};
				commands.push({ type: 'stock.add', stock });
			});
		}

		if (cx.session.execute(commands, 'Record purchase')) {
			onRecorded?.();
			onClose();
		}
	}
	return (
		<Modal title="Record purchase" onClose={onClose}>
			<form onSubmit={submit}>
				<p className="purchase-part-name">{part.name}</p>
				<div className="form-columns">
					<Field label={`Quantity (${part.unit === 'each' ? 'units' : 'metres'})`}>
						<input
							autoFocus
							type="number"
							min="0.001"
							step="any"
							required
							value={amount}
							onChange={(event) => setAmount(event.target.value)}
						/>
					</Field>
					<Field label="Status">
						<select
							value={status}
							onChange={(event) => setStatus(event.target.value as typeof status)}
						>
							<option value="received">Received</option>
							<option value="ordered">Ordered</option>
						</select>
					</Field>
					<Field label="Total price (€)">
						<input
							type="number"
							min="0"
							step="any"
							placeholder="Not recorded"
							value={price}
							onChange={(event) => setPrice(event.target.value)}
						/>
					</Field>
					<Field label="Shipping (€)">
						<input
							type="number"
							min="0"
							step="any"
							placeholder="Not recorded"
							value={shipping}
							onChange={(event) => setShipping(event.target.value)}
						/>
					</Field>
				</div>
				{part.unit === 'm' && status === 'received' && (
					<>
						<Field
							label="Piece lengths (m)"
							help="Optional. Enter each physical length, such as 10 or 5, 5. A total quantity alone does not establish a continuous length."
						>
							<input
								value={pieceLengths}
								onChange={(e) => setPieceLengths(e.target.value)}
								placeholder="e.g. 5, 5"
							/>
						</Field>
						{pieceLengths.trim() && (
							<label className="checkbox-field">
								<input
									type="checkbox"
									checked={continuous}
									onChange={(e) => setContinuous(e.target.checked)}
								/>
								Each piece is one continuous length
							</label>
						)}
					</>
				)}
				{error && (
					<p className="error" role="alert">
						{error}
					</p>
				)}

				<Field label="Notes">
					<textarea
						value={notes}
						onChange={(event) => setNotes(event.target.value)}
						placeholder="Seller, order number…"
					/>
				</Field>
				<div className="modal-actions">
					<Button onClick={onClose}>Cancel</Button>
					<Button variant="primary" type="submit">
						Record purchase
					</Button>
				</div>
			</form>
		</Modal>
	);
};
