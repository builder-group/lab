import { Check, FileText, Minus, Pencil, Plus, Scissors } from 'lucide-react';
import React from 'react';
import { Button, Field, IconButton, Modal } from '../../../components/ui';
import * as desktop from '../../../environment/desktop';
import { money, quantity } from '../../../lib/format';
import {
	getMaterialRequirements,
	getParts,
	getRunLengthM,
	getStockAvailable,
	getStockRemaining,
	isRunInBuild,
	roundQuantity,
	type TCommand,
	type TPart,
	type TProject,
	type TPurchase,
	type TStockPiece
} from '../../project/model';
import type { PartsCx } from '../PartsCx';
import { PurchaseEditDialog } from './PurchaseEditDialog';
import './stock.css';

export const StockSection: React.FC<TStockSectionProps> = ({ part, project, cx }) => {
	const [stockDialog, setStockDialog] = React.useState<{
		stock?: TStockPiece;
		purchase?: TPurchase;
	} | null>(null);
	const [editPurchase, setEditPurchase] = React.useState<TPurchase | null>(null);
	const [receiptBusy, setReceiptBusy] = React.useState<string | null>(null);
	const [cutDialog, setCutDialog] = React.useState(false);
	const [allocationDialog, setAllocationDialog] = React.useState(false);
	const purchases = project.purchases.filter((purchase) => purchase.partId === part.id);
	const pieces = project.stockPieces.filter((piece) => piece.partId === part.id);
	const row = getParts(project).find((entry) => entry.part.id === part.id);
	const unknownLengths =
		getMaterialRequirements(project).find((entry) => entry.partId === part.id)?.unknownRunIds
			.length ?? 0;
	const cuts = project.cuts.filter((cut) => pieces.some((piece) => piece.id === cut.stockPieceId));
	const allocations = project.allocations.filter((allocation) =>
		pieces.some((piece) => piece.id === allocation.stockPieceId)
	);
	function receive(purchase: TPurchase): void {
		if (part.unit === 'm') setStockDialog({ purchase });
		else
			cx.session.execute(
				[{ type: 'purchase.update', id: purchase.id, patch: { status: 'received' } }],
				'Mark received'
			);
	}
	async function openReceipt(purchase: TPurchase): Promise<void> {
		const asset = project.assets.find((entry) => entry.id === purchase.receiptAssetId);
		if (!asset || !desktop.isDesktop()) return;
		setReceiptBusy(purchase.id);
		try {
			await cx.session.flush();
			if (cx.session.$project.get()?.id !== project.id) return;
			if (cx.session.$save.get().state === 'error')
				throw new Error('Save this project before opening its receipt.');
			await desktop.openProjectAsset(project.id, asset.relativePath);
		} catch (error) {
			cx.session.notify(error instanceof Error ? error.message : String(error));
		} finally {
			setReceiptBusy(null);
		}
	}
	return (
		<div className="stock-section">
			{row && (
				<div className="stock-summary">
					<span>
						Needed{' '}
						<strong>
							{quantity(row.requiredQuantity, part.unit)}
							{unknownLengths > 0 &&
								` + ${unknownLengths} unknown ${unknownLengths === 1 ? 'run' : 'runs'}`}
						</strong>
					</span>
					{(part.plannedQuantity != null || row.plannedQuantity > row.requiredQuantity) && (
						<span>
							Planned <strong>{quantity(row.plannedQuantity, part.unit)}</strong>
						</span>
					)}
					<span>
						Bought <strong>{quantity(row.boughtQuantity, part.unit)}</strong>
					</span>
					{part.unit === 'm' && (
						<span>
							Unused <strong>{quantity(row.usableStockQuantity, 'm')}</strong>
						</span>
					)}
				</div>
			)}
			{purchases.length > 0 ? (
				<div className="stock-records">
					{purchases.map((purchase) => (
						<div className="stock-record" key={purchase.id}>
							<div>
								<strong>
									{quantity(purchase.quantity, purchase.unit)}
									{purchase.unit === 'each' ? ' units' : ''} · {money(purchase.totalPrice)}
								</strong>
								<small>
									{dateLabel(purchase.orderedAt)} · {purchase.status}
									{purchase.shipping != null && purchase.shipping > 0
										? ` · ${money(purchase.shipping)} shipping`
										: ''}
								</small>
								{purchase.notes && <small>{purchase.notes}</small>}
							</div>
							<div className="stock-record-actions">
								{purchase.receiptAssetId && (
									<Button
										variant="ghost"
										disabled={!desktop.isDesktop() || receiptBusy != null}
										icon={<FileText size={12} />}
										onClick={() => void openReceipt(purchase)}
									>
										Receipt
									</Button>
								)}
								<IconButton label="Edit purchase" onClick={() => setEditPurchase(purchase)}>
									<Pencil size={12} />
								</IconButton>
								{purchase.status === 'received' &&
									part.unit === 'm' &&
									purchase.quantity -
										pieces
											.filter((piece) => piece.purchaseId === purchase.id)
											.reduce((sum, piece) => sum + piece.lengthM, 0) >
										0.000001 && (
										<Button variant="ghost" onClick={() => setStockDialog({ purchase })}>
											Record lengths
										</Button>
									)}
								{purchase.status === 'ordered' && (
									<Button
										variant="ghost"
										onClick={() => receive(purchase)}
										icon={<Check size={12} />}
									>
										Received
									</Button>
								)}
							</div>
						</div>
					))}
				</div>
			) : (
				<p className="section-empty">No purchases recorded.</p>
			)}
			{part.unit === 'm' && (
				<>
					<div className="stock-subheading">
						<span>Lengths on hand</span>
						<Button variant="ghost" icon={<Plus size={12} />} onClick={() => setStockDialog({})}>
							Existing stock
						</Button>
					</div>
					{pieces.length > 0 ? (
						<div className="stock-records">
							{pieces.map((piece) => {
								const remaining = getStockRemaining(project, piece);
								const available = getStockAvailable(project, piece);
								return (
									<div className="stock-piece" key={piece.id}>
										<div className="stock-record">
											<div>
												<strong>{piece.label || 'Cable length'}</strong>
												<small>
													{quantity(remaining, 'm')} unused of {quantity(piece.lengthM, 'm')} ·{' '}
													{piece.continuity === 'continuous' ? 'Continuous' : 'Continuity unknown'}
													{piece.purchaseId == null ? ' · Existing stock' : ''}
												</small>
												{available < remaining && (
													<small>
														{quantity(remaining - available, 'm')} reserved ·{' '}
														{quantity(available, 'm')} unreserved
													</small>
												)}
											</div>
											<IconButton
												label={`Edit ${piece.label || 'stock length'}`}
												onClick={() => setStockDialog({ stock: piece })}
											>
												<Pencil size={12} />
											</IconButton>
										</div>
										{allocations
											.filter((allocation) => allocation.stockPieceId === piece.id)
											.map((allocation) => (
												<div className="stock-allocation" key={allocation.id}>
													<span>
														{quantity(allocation.lengthM, 'm')} reserved for{' '}
														{project.runs.find((run) => run.id === allocation.runId)?.name ||
															'Cable run'}
													</span>
													<IconButton
														label="Release reservation"
														onClick={() =>
															cx.session.execute(
																[{ type: 'allocation.remove', id: allocation.id }],
																'Release reservation'
															)
														}
													>
														<Minus size={11} />
													</IconButton>
												</div>
											))}
									</div>
								);
							})}
						</div>
					) : (
						<p className="section-empty">
							Record a received purchase or add a length you already own.
						</p>
					)}
					{pieces.length > 0 && (
						<div className="stock-actions">
							<Button icon={<Scissors size={12} />} onClick={() => setCutDialog(true)}>
								Record cut
							</Button>
							<Button
								onClick={() => setAllocationDialog(true)}
								disabled={
									!project.runs.some(
										(run) => run.materialPartId === part.id && isRunInBuild(project, run)
									)
								}
							>
								Reserve for run
							</Button>
						</div>
					)}
					{cuts.length > 0 && (
						<>
							<div className="stock-subheading">
								<span>Recorded cuts</span>
							</div>
							<div className="stock-records">
								{cuts.map((cut) => (
									<div className="stock-record" key={cut.id}>
										<div>
											<strong>
												{quantity(cut.lengthM, 'm')} ·{' '}
												{cut.runId
													? project.runs.find((run) => run.id === cut.runId)?.name || 'Cable run'
													: 'Unassigned cut'}
											</strong>
											<small>
												{cut.installed ? 'Installed' : 'Cut, not installed'}
												{cut.wasteM > 0 ? ` · ${quantity(cut.wasteM, 'm')} waste` : ''} ·{' '}
												{dateLabel(cut.recordedAt)}
											</small>
										</div>
										{!cut.installed && (
											<Button
												variant="ghost"
												onClick={() =>
													cx.session.execute(
														[{ type: 'cut.update', id: cut.id, patch: { installed: true } }],
														'Mark installed'
													)
												}
											>
												Installed
											</Button>
										)}
									</div>
								))}
							</div>
						</>
					)}
				</>
			)}
			{editPurchase && (
				<PurchaseEditDialog
					part={part}
					project={project}
					purchase={editPurchase}
					cx={cx}
					onClose={() => setEditPurchase(null)}
				/>
			)}
			{stockDialog && (
				<StockDialog
					part={part}
					project={project}
					cx={cx}
					{...stockDialog}
					onClose={() => setStockDialog(null)}
				/>
			)}
			{cutDialog && (
				<MaterialActionDialog
					kind="cut"
					part={part}
					project={project}
					cx={cx}
					onClose={() => setCutDialog(false)}
				/>
			)}
			{allocationDialog && (
				<MaterialActionDialog
					kind="allocation"
					part={part}
					project={project}
					cx={cx}
					onClose={() => setAllocationDialog(false)}
				/>
			)}
		</div>
	);
};
interface TStockSectionProps {
	part: TPart;
	project: TProject;
	cx: PartsCx;
}

const StockDialog: React.FC<TStockDialogProps> = ({
	part,
	project,
	cx,
	stock,
	purchase,
	onClose
}) => {
	const unrecordedLength = purchase
		? Math.max(
				0,
				purchase.quantity -
					project.stockPieces
						.filter((piece) => piece.purchaseId === purchase.id)
						.reduce((sum, piece) => sum + piece.lengthM, 0)
			)
		: 0;
	const [label, setLabel] = React.useState(stock?.label ?? '');
	const [lengths, setLengths] = React.useState(
		stock ? String(stock.lengthM) : purchase ? String(unrecordedLength) : ''
	);
	const [continuous, setContinuous] = React.useState(stock?.continuity === 'continuous');
	const [notes, setNotes] = React.useState(stock?.notes ?? '');
	const [error, setError] = React.useState<string | null>(null);
	function submit(event: React.FormEvent): void {
		event.preventDefault();
		setError(null);
		const parsed = lengths
			.split(/\n+/)
			.map((value) => value.trim())
			.filter(Boolean)
			.map(parseNumber);
		if (!parsed.length || parsed.some((value) => value == null || value <= 0)) {
			setError('Enter a positive length for each piece.');
			return;
		}
		const values = parsed as number[];
		const total = values.reduce((sum, value) => sum + value, 0);
		if (stock && values.length !== 1) {
			setError('Edit one stock piece at a time.');
			return;
		}
		if (purchase && Math.abs(total - unrecordedLength) > 0.0001) {
			setError(
				`Piece lengths must total the unrecorded ${quantity(unrecordedLength, 'm')} from this order.`
			);
			return;
		}
		const commands: TCommand[] = [];
		if (purchase)
			commands.push({ type: 'purchase.update', id: purchase.id, patch: { status: 'received' } });
		if (stock)
			commands.push({
				type: 'stock.update',
				id: stock.id,
				patch: {
					label: label.trim() || stock.label,
					lengthM: values[0] ?? 0,
					continuity: continuous ? 'continuous' : 'unknown',
					notes
				}
			});
		else
			values.forEach((lengthM, index) =>
				commands.push({
					type: 'stock.add',
					stock: {
						id: crypto.randomUUID(),
						partId: part.id,
						purchaseId: purchase?.id ?? null,
						label: label.trim()
							? values.length > 1
								? `${label.trim()} ${index + 1}`
								: label.trim()
							: values.length > 1
								? `Piece ${index + 1}`
								: 'Stock length',
						lengthM,
						continuity: continuous ? 'continuous' : 'unknown',
						notes
					}
				})
			);
		if (
			cx.session.execute(
				commands,
				stock ? 'Edit stock' : purchase ? 'Receive order' : 'Add existing stock'
			)
		)
			onClose();
	}
	const committed = stock
		? stock.lengthM -
			getStockRemaining(project, stock) +
			project.allocations
				.filter((allocation) => allocation.stockPieceId === stock.id)
				.reduce((sum, allocation) => sum + allocation.lengthM, 0)
		: 0;
	return (
		<Modal
			title={stock ? 'Edit stock length' : purchase ? 'Receive cable order' : 'Add existing stock'}
			onClose={onClose}
		>
			<form onSubmit={submit}>
				<p className="purchase-part-name">{part.name}</p>
				<Field label="Label">
					<input
						autoFocus
						value={label}
						onChange={(event) => setLabel(event.target.value)}
						placeholder="Red reel, garage offcut…"
					/>
				</Field>
				<Field
					label={stock ? 'Original length (m)' : 'Piece lengths (m), one per line'}
					help={
						stock
							? `${quantity(committed, 'm')} already cut or reserved. Recorded cuts are deducted from the original length.`
							: purchase
								? `Record the remaining ${quantity(unrecordedLength, 'm')} from this order. Separate lines keep independent pieces distinct.`
								: 'These lengths were already owned. Adding stock does not invent a purchase or cost.'
					}
				>
					{stock ? (
						<input
							required
							type="number"
							step="any"
							min="0.0001"
							value={lengths}
							onChange={(event) => setLengths(event.target.value)}
						/>
					) : (
						<textarea
							required
							value={lengths}
							onChange={(event) => setLengths(event.target.value)}
							placeholder={'10\n2.5'}
						/>
					)}
				</Field>
				<label className="checkbox-field">
					<input
						type="checkbox"
						checked={continuous}
						onChange={(event) => setContinuous(event.target.checked)}
					/>
					Each entry is one known continuous piece
				</label>
				<Field label="Notes">
					<textarea value={notes} onChange={(event) => setNotes(event.target.value)} />
				</Field>
				{error && (
					<p className="field-error" role="alert">
						{error}
					</p>
				)}
				<div className="modal-actions">
					<Button onClick={onClose}>Cancel</Button>
					<Button variant="primary" type="submit">
						{stock ? 'Save length' : purchase ? 'Mark received' : 'Add stock'}
					</Button>
				</div>
			</form>
		</Modal>
	);
};
interface TStockDialogProps extends TStockSectionProps {
	stock?: TStockPiece;
	purchase?: TPurchase;
	onClose(): void;
}

const MaterialActionDialog: React.FC<TMaterialActionDialogProps> = ({
	kind,
	part,
	project,
	cx,
	onClose
}) => {
	const pieces = project.stockPieces.filter((piece) => piece.partId === part.id);
	const runs = project.runs.filter(
		(run) => run.materialPartId === part.id && isRunInBuild(project, run)
	);
	const [stockId, setStockId] = React.useState(pieces[0]?.id ?? '');
	const [runId, setRunId] = React.useState(runs[0]?.id ?? '');
	const [length, setLength] = React.useState(() =>
		runs[0] ? String(getRunLengthM(project, runs[0]) ?? '') : ''
	);
	const [waste, setWaste] = React.useState('0');
	const [installed, setInstalled] = React.useState(false);
	const [error, setError] = React.useState<string | null>(null);
	const stock = pieces.find((piece) => piece.id === stockId);
	function changeRun(value: string): void {
		setRunId(value);
		const run = runs.find((entry) => entry.id === value);
		if (run) setLength(String(getRunLengthM(project, run) ?? ''));
	}
	function submit(event: React.FormEvent): void {
		event.preventDefault();
		setError(null);
		const amount = parseNumber(length);
		const wasteM = parseNumber(waste);
		if (
			!stock ||
			amount == null ||
			amount <= 0 ||
			wasteM == null ||
			wasteM < 0 ||
			(kind === 'allocation' && !runId)
		) {
			setError('Choose a length and enter a positive quantity.');
			return;
		}
		const command: TCommand =
			kind === 'allocation'
				? {
						type: 'allocation.add',
						allocation: { id: crypto.randomUUID(), stockPieceId: stock.id, runId, lengthM: amount }
					}
				: {
						type: 'cut.add',
						cut: {
							id: crypto.randomUUID(),
							stockPieceId: stock.id,
							runId: runId || null,
							lengthM: amount,
							wasteM,
							recordedAt: new Date().toISOString(),
							installed,
							notes: ''
						}
					};
		if (cx.session.execute([command], kind === 'allocation' ? 'Reserve material' : 'Record cut'))
			onClose();
	}
	return (
		<Modal title={kind === 'allocation' ? 'Reserve a length' : 'Record a cut'} onClose={onClose}>
			<form onSubmit={submit}>
				<Field label="Stock piece">
					<select value={stockId} onChange={(event) => setStockId(event.target.value)}>
						{pieces.map((piece) => (
							<option key={piece.id} value={piece.id}>
								{piece.label} ·{' '}
								{quantity(
									kind === 'allocation'
										? getStockAvailable(project, piece)
										: getStockRemaining(project, piece),
									'm'
								)}{' '}
								{kind === 'allocation' ? 'unreserved' : 'uncut'}
							</option>
						))}
					</select>
				</Field>
				<Field label="Cable run">
					<select value={runId} onChange={(event) => changeRun(event.target.value)}>
						{kind === 'cut' && <option value="">Unassigned cut</option>}
						{runs.map((run) => (
							<option key={run.id} value={run.id}>
								{run.name || 'Cable run'} ·{' '}
								{getRunLengthM(project, run) == null
									? 'Length unknown'
									: quantity(getRunLengthM(project, run) ?? 0, 'm')}
							</option>
						))}
					</select>
				</Field>
				<div className="form-columns">
					<Field label="Length (m)">
						<input
							autoFocus
							required
							type="number"
							min="0.0001"
							step="any"
							value={length}
							onChange={(event) => setLength(event.target.value)}
						/>
					</Field>
					{kind === 'cut' && (
						<Field
							label="Waste (m)"
							help="Cutting loss or unusable trimming in addition to the useful cut."
						>
							<input
								required
								type="number"
								min="0"
								step="any"
								value={waste}
								onChange={(event) => setWaste(event.target.value)}
							/>
						</Field>
					)}
				</div>
				{kind === 'cut' && (
					<label className="checkbox-field">
						<input
							type="checkbox"
							checked={installed}
							onChange={(event) => setInstalled(event.target.checked)}
						/>
						Already installed
					</label>
				)}
				{stock && (
					<p className="help-text">
						{quantity(roundQuantity(getStockRemaining(project, stock)), 'm')} uncut.{' '}
						{stock.continuity === 'unknown'
							? 'The continuity of this stock has not been confirmed.'
							: 'This is recorded as one continuous piece.'}
					</p>
				)}
				{error && (
					<p className="field-error" role="alert">
						{error}
					</p>
				)}
				<div className="modal-actions">
					<Button onClick={onClose}>Cancel</Button>
					<Button variant="primary" type="submit">
						{kind === 'allocation' ? 'Reserve length' : 'Record cut'}
					</Button>
				</div>
			</form>
		</Modal>
	);
};
interface TMaterialActionDialogProps extends TStockSectionProps {
	kind: 'cut' | 'allocation';
	onClose(): void;
}
function parseNumber(value: string): number | null {
	const number = Number(value.trim().replace(',', '.'));
	return value.trim() && Number.isFinite(number) ? number : null;
}
function dateLabel(value: string): string {
	return new Date(value).toLocaleDateString('de-DE', {
		day: '2-digit',
		month: 'short',
		year: 'numeric'
	});
}
