import { describe, expect, it } from 'vitest';
import type { TMarketProductMatch } from '../market-types';
import { parseIdealoQuote } from '../quote-parser';
import { parseToolPayload, validateOffers } from './payload';

const offer = { price: '292,88 €', minShippingCost: null, shop: { name: 'Fixture merchant' } };
const match: TMarketProductMatch = {
	provider: 'idealo',
	country: 'DE',
	productId: '200596935',
	url: 'https://www.idealo.de/preisvergleich/OffersOfProduct/200596935.html',
	productName: 'Victron Cerbo GX',
	matchedAt: '2026-11-02T12:00:00Z',
	variantConfirmed: true
};
describe('validateOffers function', () => {
	it('should accept missing or null pagination metadata without fabricating it or paging', () => {
		for (const response of [
			{ offers: [offer] },
			{ nextOffset: null, offers: [offer] },
			{ nextOffset: 0, offers: [offer] },
			{ nextOffset: 5, offers: [offer] }
		]) {
			expect(validateOffers(response)).toBe(response);
			const quote = parseIdealoQuote('cerbo', match, response, '2026-11-02T12:00:00Z');
			expect(quote.unitPrice).toBe(292.88);
			expect(quote.shippingPrice).toBeNull();
			expect(quote.taxBasis).toBe('unknown');
			expect(quote.condition).toBe('unknown');
		}
	});
	it('should accept an actual empty offers page while preventing any quote observation', () => {
		for (const response of [
			{ offers: [] },
			{ nextOffset: null, offers: [] },
			{ nextOffset: 0, offers: [] }
		]) {
			expect(validateOffers(response)).toBe(response);
			expect(() => parseIdealoQuote('cerbo', match, response, '2026-11-02T12:00:00Z')).toThrow(
				'returned no offers'
			);
		}
	});
	it('should keep actual offers and price fields strict with sanitized format diagnostics', () => {
		for (const response of [
			{ offers: null },
			{ nextOffset: 0 },
			{ offers: [{ ...offer, price: null }] },
			{ offers: [{ price: '292,88 €', shop: null }] }
		]) {
			expect(() => validateOffers(response)).toThrow(
				/Fields: offers(?:\[0\]\.(?:price|shop))? \(invalid_type\)/
			);
		}
	});
	it('should report schema-owned field paths without echoing response secrets or values', () => {
		const secret = 'fixture-sensitive-product-reference-do-not-display';
		const response = {
			nextOffset: secret,
			offers: [{ price: { private: secret }, shop: { name: secret }, relocatorUrl: secret }],
			productRef: secret
		};
		let message = '';
		try {
			validateOffers(response);
		} catch (error) {
			message = error instanceof Error ? error.message : String(error);
		}
		expect(message).toContain('offers[0].price (invalid_type)');
		expect(message).toContain('offers[0].relocatorUrl (custom)');
		expect(message).not.toContain(secret);
		expect(message).not.toContain('productRef');
	});
	it('should ignore unused pagination metadata without guessing offsets or requesting more pages', () => {
		for (const nextOffset of [-1, 1.5, 'fixture-private-offset', {}, false]) {
			const response = { offers: [{ ...offer, freshness: { unusedMetadata: true } }], nextOffset };
			expect(validateOffers(response)).toBe(response);
			expect(parseIdealoQuote('cerbo', match, response, '2026-11-02T12:00:00Z').unitPrice).toBe(
				292.88
			);
		}
	});
});
describe('parseToolPayload function', () => {
	it('should keep SDK format diagnostics free of payload values and remote text', () => {
		const secret = 'fixture-private-response-body';
		let message = '';
		try {
			parseToolPayload({ content: [{ type: secret, text: secret }] });
		} catch (error) {
			message = error instanceof Error ? error.message : String(error);
		}
		expect(message).toContain('invalid tool response');
		expect(message).toContain('Fields: content[0]');
		expect(message).not.toContain(secret);
	});
});
