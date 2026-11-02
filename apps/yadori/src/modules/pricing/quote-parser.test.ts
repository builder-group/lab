import { describe, expect, it } from 'vitest';
import type { TMarketProductMatch } from './market-types';
import { parseIdealoHistory, parseIdealoQuote } from './quote-parser';

const match: TMarketProductMatch = {
	provider: 'idealo',
	country: 'DE',
	productId: '12345',
	url: 'https://www.idealo.de/preisvergleich/OffersOfProduct/12345.html',
	productName: 'Freshwater pump · 12V',
	matchedAt: '2026-11-01T12:00:00.000Z',
	variantConfirmed: true
};
const observedAt = '2026-11-02T12:00:00.000Z';

function quote(response: Record<string, unknown>) {
	return parseIdealoQuote('pump', match, response, observedAt);
}

describe('parseIdealoQuote function', () => {
	it('should parse the documented offer structure without inferring condition, VAT or stock', () => {
		const result = quote({
			productRef: 'pr.v1.synthetic-ephemeral-value',
			nextOffset: 5,
			offers: [
				{
					key: 'offer-1',
					relocatorUrl: 'https://shop.example/pump',
					price: '349,00 €',
					basePrice: '999,00 €',
					shop: { name: 'Example Marine', merchantName: 'Example Marine GmbH' },
					delivery: { deliveryText: '1–2 Werktage', deliveryStatus: 'SHORT' },
					cheapestTotalPriceOffer: true,
					minShippingCost: '6,90 €'
				}
			]
		});

		expect(result).toMatchObject({
			componentId: 'pump',
			productId: '12345',
			productName: match.productName,
			unitPrice: 349,
			shippingPrice: 6.9,
			seller: 'Example Marine',
			offerUrl: 'https://shop.example/pump',
			currency: 'EUR',
			condition: 'unknown',
			taxBasis: 'unknown',
			availability: 'unknown',
			observedAt
		});
		expect(result.notes).toContain('More offers');
		expect(JSON.stringify(result)).not.toContain('pr.v1');
	});

	it('should compare published delivered totals while retaining unit price and shipping separately', () => {
		const result = quote({
			offers: [
				{ price: '100,00 €', minShippingCost: '20,00 €', shop: { name: 'Lower unit price' } },
				{ price: '110,00 €', minShippingCost: '5,00 €', shop: { name: 'Lower delivered total' } }
			]
		});

		expect(result).toMatchObject({
			unitPrice: 110,
			shippingPrice: 5,
			seller: 'Lower delivered total'
		});
	});

	it('should keep missing shipping unknown and avoid silently ranking it as free', () => {
		const result = quote({
			offers: [
				{ price: '90,00 €', shop: { name: 'Unknown delivery' } },
				{ price: '100,00 €', minShippingCost: '0,00 €', shop: { name: 'Known delivery' } }
			]
		});
		expect(result.seller).toBe('Known delivery');
		expect(result.notes).toContain('unknown shipping');
		const unknown = quote({ offers: [{ price: '90,00 €' }] });
		expect(unknown.shippingPrice).toBeNull();
		expect(unknown.notes).toContain('no delivered total');
	});

	it('should prefer the provider cheapest-total flag without overriding a provably cheaper published total', () => {
		const flagged = quote({
			offers: [
				{ price: '90,00 €', cheapestTotalPriceOffer: true, shop: { name: 'Provider choice' } },
				{ price: '100,00 €', minShippingCost: '0,00 €' }
			]
		});
		expect(flagged).toMatchObject({ seller: 'Provider choice', shippingPrice: null });
		const conflicting = quote({
			offers: [
				{ price: '100,00 €', minShippingCost: '30,00 €', cheapestTotalPriceOffer: true },
				{ price: '110,00 €', minShippingCost: '0,00 €' }
			]
		});
		expect(conflicting.unitPrice).toBe(110);
		expect(conflicting.notes).toContain('lower published delivered total');
	});

	it('should exclude explicitly used, refurbished and unavailable offers', () => {
		const result = quote({
			offers: [
				{ price: '10,00 €', condition: 'used', cheapestTotalPriceOffer: true },
				{ price: '20,00 €', condition: 'refurbished' },
				{ price: '30,00 €', inStock: false },
				{
					price: '40,00 €',
					condition: 'NEW',
					taxBasis: 'gross',
					availability: 'IN_STOCK',
					minShippingCost: 'gratis'
				}
			]
		});
		expect(result).toMatchObject({
			unitPrice: 40,
			shippingPrice: 0,
			condition: 'new',
			taxBasis: 'gross',
			availability: 'in-stock'
		});
		expect(() => quote({ offers: [{ price: '10,00 €', isUsed: true }] })).toThrow('no parseable');
	});

	it('should exclude net prices and retain explicit free-shipping claims without converting VAT', () => {
		const result = quote({
			offers: [
				{ price: '50,00 €', includesVat: false, hasAlwaysFreeShipping: true },
				{ price: '60,00 €', hasAlwaysFreeShipping: true }
			]
		});
		expect(result).toMatchObject({
			unitPrice: 60,
			shippingPrice: 0,
			taxBasis: 'unknown',
			condition: 'unknown'
		});
		expect(() => quote({ offers: [{ price: '50,00 €', taxBasis: 'net' }] })).toThrow(
			'no parseable'
		);
	});

	it('should reject absent, malformed and provider-error prices instead of manufacturing a zero quote', () => {
		for (const response of [
			{},
			{ offers: [] },
			{ offers: [{ price: null }] },
			{ offers: [{ price: '' }] },
			{ offers: [{ basePrice: '5,00 €' }] },
			{ error: 'unavailable', offers: [{ price: '5,00 €' }] },
			{ isError: true }
		]) {
			expect(() => quote(response)).toThrow();
		}
		expect(quote({ offers: [{ price: '0,00 €', minShippingCost: '0,00 €' }] }).unitPrice).toBe(0);
	});

	it('should reject currency or identity mismatches and ambiguous numeric units', () => {
		expect(() => quote({ currency: 'GBP', offers: [{ price: '50,00 €' }] })).toThrow('EUR');
		expect(() => quote({ productId: '99999', offers: [{ price: '50,00 €' }] })).toThrow(
			'different product'
		);
		expect(() => quote({ country: 'GB', offers: [{ price: '50,00 €' }] })).toThrow('German');
		expect(() => quote({ offers: [{ price: 5000 }] })).toThrow('no parseable');
		expect(quote({ currency: 'EUR', offers: [{ price: 50 }] }).unitPrice).toBe(50);
	});

	it('should not persist unsafe offer links or ephemeral product-reference query data', () => {
		const result = parseIdealoQuote(
			'pump',
			{ ...match, url: match.url + '?productRef=pr.v1.synthetic' },
			{
				offers: [{ price: '20,00 €', relocatorUrl: 'javascript:alert(1)' }]
			},
			observedAt
		);
		expect(result.offerUrl).toBeNull();
		expect(result.productUrl).toBe(match.url);
		expect(JSON.stringify(result)).not.toContain('pr.v1');
	});
});

describe('parseIdealoHistory function', () => {
	it('should preserve the provider dates and EUR points separately from build-basket history', () => {
		const result = parseIdealoHistory(
			match,
			{
				priceTrend: {
					history: [
						{ dateTimeISO: '2026-10-31T12:00:00.000Z', price: '1.059,00 €' },
						{ dateTime: Date.parse('2026-11-01T12:00:00.000Z'), price: '999,00 €' }
					]
				}
			},
			observedAt
		);
		expect(result).toMatchObject({
			source: 'provider-history',
			productId: match.productId,
			importedAt: observedAt,
			points: [
				{ date: '2026-10-31T12:00:00.000Z', unitPrice: 1059 },
				{ date: '2026-11-01T12:00:00.000Z', unitPrice: 999 }
			]
		});
		expect(result.notes).toContain('not historical totals for this build');
	});

	it('should preserve gaps and avoid guessing undocumented cents or inventing dates', () => {
		const result = parseIdealoHistory(
			match,
			{
				priceTrend: {
					history: [
						{ dateTimeISO: '2026-10-30T12:00:00.000Z', price: null },
						{ dateTimeISO: '2026-10-31T12:00:00.000Z', price: 99900 },
						{ dateTimeISO: '2026-11-01T12:00:00.000Z', price: '0,00 €' },
						{ dateTimeISO: '2026-02-30', price: '20,00 €' },
						{ price: '20,00 €' }
					]
				}
			},
			observedAt
		);
		expect(result.points).toHaveLength(3);
		expect(result.points.map((point) => point.unitPrice)).toEqual([null, null, 0]);
		expect(result.notes).toContain('numeric cents were not guessed');
	});

	it('should retain unavailable history as empty instead of a zero point and reject wrong response shapes', () => {
		expect(parseIdealoHistory(match, { priceTrend: null }, observedAt).points).toEqual([]);
		expect(() => parseIdealoHistory(match, {}, observedAt)).toThrow('usable product price history');
		expect(() => parseIdealoHistory(match, { error: 'unavailable' }, observedAt)).toThrow(
			'provider error'
		);
	});

	it('should sort reported timestamps and leave conflicting duplicates unknown', () => {
		const result = parseIdealoHistory(
			match,
			{
				priceTrend: {
					history: [
						{ dateTimeISO: '2026-11-01T12:00:00.000Z', price: '20,00 €' },
						{ dateTimeISO: '2026-10-31T12:00:00.000Z', price: '30,00 €' },
						{ dateTimeISO: '2026-11-01T12:00:00.000Z', price: '25,00 €' }
					]
				}
			},
			observedAt
		);
		expect(result.points).toEqual([
			{ date: '2026-10-31T12:00:00.000Z', unitPrice: 30 },
			{ date: '2026-11-01T12:00:00.000Z', unitPrice: null }
		]);
	});
});
