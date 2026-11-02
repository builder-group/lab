import { describe, expect, it } from 'vitest';
import { createPart, createProject, executeCommands } from '../project/model';
import type { TMarketQuote } from './market-types';
import { adoptQuoteEstimate, createQuoteObservation } from './observations';

function fixture() {
	const part = createPart('Cable', { unit: 'm' });
	const project = executeCommands(createProject(), [{ type: 'part.add', part }]);
	const offer: TMarketQuote = {
		id: 'offer',
		componentId: part.id,
		provider: 'idealo',
		country: 'DE',
		productId: '12345',
		productUrl: 'https://www.idealo.de/preisvergleich/OffersOfProduct/12345.html',
		productName: 'Cable 10 m roll',
		observedAt: '2026-11-02T12:00:00Z',
		unitPrice: 39.9,
		shippingPrice: null,
		currency: 'EUR',
		seller: 'Fixture shop',
		offerUrl: 'https://shop.example/cable',
		condition: 'unknown',
		taxBasis: 'unknown',
		availability: 'unknown',
		notes: 'Published offer, exact variant checked.'
	};
	return { part, project, offer };
}
describe('createQuoteObservation function', () => {
	it('should save a pack price and shipping uncertainty without adopting estimates or purchases', () => {
		const { part, project, offer } = fixture();
		const { commands, quote } = createQuoteObservation(project, part, offer, 10);
		const next = executeCommands(project, commands);
		expect(quote.price).toBe(39.9);
		expect(quote.packQuantity).toBe(10);
		expect(quote.shipping).toBeNull();
		expect(quote.tax).toBe('unknown');
		expect(next.quotes).toHaveLength(1);
		expect(next.sources).toHaveLength(1);
		expect(next.purchases).toHaveLength(0);
		expect(next.parts[0]?.estimatedUnitPrice).toBeNull();
		expect(JSON.stringify(next)).not.toContain('productRef');
	});
	it('should reuse an explicit product source and append immutable observations', () => {
		const { part, project, offer } = fixture();
		const first = createQuoteObservation(project, part, offer, 10);
		const next = executeCommands(project, first.commands);
		const second = createQuoteObservation(next, part, { ...offer, unitPrice: 35 }, 10);
		expect(second.commands).toHaveLength(1);
		expect(second.quote.sourceId).toBe(first.quote.sourceId);
		expect(executeCommands(next, second.commands).quotes).toHaveLength(2);
	});
	it('should reject invalid packs, identity mismatch, used and net offers', () => {
		const { part, project, offer } = fixture();
		for (const quantity of [0, -1, Infinity, NaN])
			expect(() => createQuoteObservation(project, part, offer, quantity)).toThrow();
		for (const bad of [
			{ ...offer, componentId: 'other' },
			{ ...offer, taxBasis: 'net' as const },
			{ ...offer, condition: 'used' as const },
			{ ...offer, unitPrice: null }
		])
			expect(() => createQuoteObservation(project, part, bad, 10)).toThrow();
	});
	it('should adopt the explicitly selected price per metre independently from shipping', () => {
		const { part, project, offer } = fixture();
		const { quote } = createQuoteObservation(project, part, offer, 10);
		expect(adoptQuoteEstimate(part, quote)).toEqual({
			type: 'part.update',
			id: part.id,
			patch: { estimatedUnitPrice: 3.99 }
		});
		expect(part.estimatedUnitPrice).toBeNull();
	});
	it('should adopt pack size only through the explicit price-and-pack option', () => {
		const { part, project, offer } = fixture();
		const { quote } = createQuoteObservation(project, part, offer, 10);
		expect(adoptQuoteEstimate(part, quote, { usePackSize: true })).toEqual({
			type: 'part.update',
			id: part.id,
			patch: { estimatedUnitPrice: 3.99, purchasePackQuantity: 10 }
		});
		const withCustomPack = { ...part, purchasePackQuantity: 25 };
		expect(adoptQuoteEstimate(withCustomPack, quote)).toEqual({
			type: 'part.update',
			id: part.id,
			patch: { estimatedUnitPrice: 3.99 }
		});
		expect(withCustomPack.purchasePackQuantity).toBe(25);
	});
});
