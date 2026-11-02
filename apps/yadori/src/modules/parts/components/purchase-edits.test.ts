import { describe, expect, it } from 'vitest';
import {
	createPart,
	createProject,
	executeCommands,
	getBudget,
	type TAsset,
	type TProject
} from '../../project/model';
import { buildPurchaseEditCommands } from './purchase-edits';

function fixture(): TProject {
	const part = createPart('Cable', {
		id: 'cable',
		unit: 'm',
		quantity: 6,
		buildState: 'in-build',
		estimatedUnitPrice: 2
	});
	return executeCommands(createProject('Build'), [
		{ type: 'part.add', part },
		{
			type: 'purchase.add',
			purchase: {
				id: 'purchase',
				partId: part.id,
				sourceId: null,
				orderedAt: '2026-11-01T12:00:00Z',
				quantity: 10,
				unit: 'm',
				totalPrice: 20,
				shipping: 2,
				status: 'received',
				receiptAssetId: null,
				notes: 'Original order'
			}
		},
		{
			type: 'stock.add',
			stock: {
				id: 'roll',
				partId: part.id,
				purchaseId: 'purchase',
				label: 'Roll',
				lengthM: 10,
				continuity: 'continuous',
				notes: ''
			}
		}
	]);
}
describe('purchase corrections', () => {
	it('should correct actual spending and attach a receipt without rewriting physical stock', () => {
		const project = fixture();
		const receipt: TAsset = {
			id: 'receipt',
			name: 'Invoice.pdf',
			relativePath: 'assets/receipt.pdf',
			mediaType: 'application/pdf',
			sourceUrl: null,
			attribution: null
		};
		const commands = buildPurchaseEditCommands(
			project,
			'purchase',
			{ totalPrice: 25, shipping: 3, receiptAssetId: receipt.id, notes: 'Corrected invoice' },
			receipt
		);
		const next = executeCommands(project, commands);
		expect(getBudget(next).recordedSpending).toBe(28);
		expect(next.stockPieces).toEqual(project.stockPieces);
		expect(next.purchases[0]?.id).toBe('purchase');
		expect(next.purchases[0]?.receiptAssetId).toBe('receipt');
		expect(next.assets).toEqual([receipt]);
		expect(project.assets).toEqual([]);
		expect(getBudget(project).recordedSpending).toBe(22);
	});
	it('should refuse quantity or status corrections that contradict already received physical lengths', () => {
		const project = fixture();
		expect(() => buildPurchaseEditCommands(project, 'purchase', { quantity: 9 })).toThrow(
			/stock lengths/
		);
		expect(() => buildPurchaseEditCommands(project, 'purchase', { status: 'ordered' })).toThrow(
			/received stock/
		);
		expect(() =>
			executeCommands(project, buildPurchaseEditCommands(project, 'purchase', { quantity: 12 }))
		).not.toThrow();
	});
	it('should return unconsumed stock atomically while keeping the order and receipt history', () => {
		const project = fixture();
		const next = executeCommands(
			project,
			buildPurchaseEditCommands(project, 'purchase', { status: 'returned' })
		);
		expect(next.stockPieces).toEqual([]);
		expect(next.purchases[0]?.status).toBe('returned');
		expect(next.purchases[0]?.totalPrice).toBe(20);
		expect(getBudget(next).recordedSpending).toBe(0);
		expect(project.stockPieces).toHaveLength(1);
	});
	it('should preserve cut stock and reject a whole-order return that would discard consumption', () => {
		const project = executeCommands(fixture(), [
			{
				type: 'cut.add',
				cut: {
					id: 'cut',
					stockPieceId: 'roll',
					runId: null,
					lengthM: 2,
					wasteM: 0.1,
					recordedAt: '2026-11-02T12:00:00Z',
					installed: false,
					notes: ''
				}
			}
		]);
		expect(() => buildPurchaseEditCommands(project, 'purchase', { status: 'returned' })).toThrow(
			/cut or reserved/
		);
		expect(project.cuts[0]?.lengthM).toBe(2);
		expect(() => buildPurchaseEditCommands(project, 'missing', { notes: 'stale dialog' })).toThrow(
			/no longer/
		);
	});
});
