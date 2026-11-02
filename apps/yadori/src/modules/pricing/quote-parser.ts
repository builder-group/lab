import type { TMarketProductMatch, TMarketQuote, TProductPriceHistory } from './market-types';
import { parseGermanPrice, roundPrice } from './price';
import { getIdealoProductId } from './product-id';

/** Converts a get_product_offers payload into one explicitly scoped, reported offer. */
export function parseIdealoQuote(
	componentId: string,
	match: TMarketProductMatch,
	response: Record<string, unknown>,
	observedAt: string
): TMarketQuote {
	const productUrl = validateSource(match, response, observedAt);
	if (!componentId.trim()) throw new Error('A component identity is required for an Idealo quote.');
	if (!Array.isArray(response['offers']))
		throw new Error('Idealo did not return a usable offers list.');
	if (response['offers'].length === 0)
		throw new Error(
			'Idealo returned no offers for this product. Its API may omit offers shown on the public product page. No price observation was created.'
		);
	const candidates = response['offers'].flatMap((value, index): TCandidate[] => {
		const offer = record(value);
		if (offer == null) return [];
		if (offer['currency'] != null && offer['currency'] !== 'EUR') return [];
		if (
			typeof offer['price'] === 'number' &&
			offer['currency'] !== 'EUR' &&
			response['currency'] !== 'EUR'
		)
			return [];
		const unitPrice = publishedPrice(offer['price']);
		if (unitPrice == null) return [];
		const condition = parseCondition(offer);
		const availability = parseAvailability(offer);
		const taxBasis = parseTaxBasis(offer);
		if (taxBasis === 'net') return [];
		if (condition === 'used' || condition === 'refurbished' || availability === 'out-of-stock')
			return [];
		const publishedShipping = publishedPrice(offer['minShippingCost']);
		const shippingPrice = publishedShipping ?? (offer['hasAlwaysFreeShipping'] === true ? 0 : null);
		return [
			{
				offer,
				index,
				unitPrice,
				shippingPrice,
				condition,
				availability,
				taxBasis,
				cheapestTotal: offer['cheapestTotalPriceOffer'] === true
			}
		];
	});
	if (!candidates.length)
		throw new Error(
			'Idealo returned no parseable, non-used, available EUR offer for this product.'
		);
	const flagged = candidates.filter((candidate) => candidate.cheapestTotal).sort(compareCandidates);
	const knownTotals = candidates
		.filter((candidate) => candidate.shippingPrice != null)
		.sort(compareCandidates);
	let selected = flagged[0] ?? knownTotals[0] ?? [...candidates].sort(compareCandidates)[0];
	if (selected == null) throw new Error('Idealo returned no usable offer.');
	let conflictingFlag = false;
	const cheapestKnown = knownTotals[0];
	if (
		cheapestKnown != null &&
		totalPrice(cheapestKnown) <
			(selected.shippingPrice == null ? selected.unitPrice : totalPrice(selected))
	) {
		selected = cheapestKnown;
		conflictingFlag = true;
	}
	const shop = record(selected.offer['shop']);
	const notes = [
		selected.cheapestTotal
			? 'Idealo marked this as a cheapest-total-price offer.'
			: 'Selected from the eligible returned offers.',
		conflictingFlag
			? 'A returned offer had a lower published delivered total than the provider cheapest-offer flag.'
			: '',
		selected.shippingPrice == null
			? 'Shipping was not reported; no delivered total is asserted.'
			: 'Shipping is the published offer charge; quantity and basket shipping may differ.',
		!selected.cheapestTotal && candidates.some((candidate) => candidate.shippingPrice == null)
			? 'Offers with unknown shipping cannot be fully ranked against delivered totals.'
			: '',
		typeof response['nextOffset'] === 'number' && response['nextOffset'] > 0
			? 'More offers are available; this quote covers only returned offers.'
			: '',
		typeof response['message'] === 'string' && /trial|limit|cap/i.test(response['message'])
			? 'The provider reported a result limit.'
			: '',
		'Merchant conditions and tax eligibility have not been independently verified.',
		selected.condition === 'unknown' ? 'Item condition was not reported.' : '',
		selected.taxBasis === 'unknown'
			? 'VAT basis was not reported; eligibility for special tax rates has not been checked.'
			: '',
		selected.availability === 'unknown' ? 'Stock availability was not explicitly reported.' : ''
	]
		.filter(Boolean)
		.join(' ');
	return {
		id: `idealo:${componentId}:${match.productId}:${observedAt}:${selected.index}`,
		componentId,
		provider: 'idealo',
		country: 'DE',
		productId: match.productId,
		productUrl,
		productName: match.productName,
		observedAt,
		unitPrice: selected.unitPrice,
		shippingPrice: selected.shippingPrice,
		currency: 'EUR',
		seller: text(shop?.['name']) ?? text(shop?.['merchantName']),
		offerUrl: safeOfferUrl(selected.offer['relocatorUrl']),
		condition: selected.condition,
		taxBasis: selected.taxBasis,
		availability: selected.availability,
		notes,
		...(typeof selected.offer['price'] === 'string'
			? { rawPriceText: selected.offer['price'] }
			: {})
	};
}

/** Product-minimum history remains separate from observed build-basket snapshots. */
export function parseIdealoHistory(
	match: TMarketProductMatch,
	response: Record<string, unknown>,
	importedAt: string
): TProductPriceHistory {
	const productUrl = validateSource(match, response, importedAt);
	const trend = record(response['priceTrend']);
	if (response['priceTrend'] !== null && (trend == null || !Array.isArray(trend['history']))) {
		throw new Error('Idealo did not return a usable product price history.');
	}
	const points = new Map<string, number | null>();
	let invalidDates = 0;
	let unknownPrices = 0;
	let conflictingPoints = false;
	const history: unknown[] = Array.isArray(trend?.['history']) ? trend['history'] : [];
	for (const value of history) {
		const point = record(value);
		if (point == null) {
			invalidDates++;
			continue;
		}
		const date = historyDate(point);
		if (date == null) {
			invalidDates++;
			continue;
		}
		// This tool publishes formatted EUR strings. Numeric cents in get_product_details
		// have a different contract and must not silently become euro-valued history.
		const unitPrice = typeof point['price'] === 'string' ? publishedPrice(point['price']) : null;
		if (unitPrice == null) unknownPrices++;
		if (points.has(date) && points.get(date) !== unitPrice) {
			points.set(date, null);
			conflictingPoints = true;
		} else points.set(date, unitPrice);
	}
	return {
		provider: 'idealo',
		country: 'DE',
		productId: match.productId,
		productUrl,
		productName: match.productName,
		currency: 'EUR',
		importedAt,
		source: 'provider-history',
		points: [...points]
			.sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
			.map(([date, unitPrice]) => ({ date, unitPrice })),
		notes: [
			'Provider product-minimum history, not historical totals for this build. Offer condition, VAT and shipping may differ between dates.',
			!history.length ? 'No provider history was available.' : '',
			invalidDates ? 'History entries without a valid reported date were omitted.' : '',
			unknownPrices
				? 'Missing, malformed or unit-ambiguous prices remain unknown; numeric cents were not guessed.'
				: '',
			conflictingPoints ? 'Conflicting duplicate timestamps remain unknown.' : ''
		]
			.filter(Boolean)
			.join(' ')
	};
}

interface TCandidate {
	offer: Record<string, unknown>;
	index: number;
	unitPrice: number;
	shippingPrice: number | null;
	condition: TMarketQuote['condition'];
	availability: TMarketQuote['availability'];
	taxBasis: TMarketQuote['taxBasis'];
	cheapestTotal: boolean;
}

function validateSource(
	match: TMarketProductMatch,
	response: Record<string, unknown>,
	observedAt: string
): string {
	if (response['isError'] === true || response['error'] != null)
		throw new Error('Idealo reported a provider error; no price was recorded.');
	if (
		match.provider !== 'idealo' ||
		match.country !== 'DE' ||
		getIdealoProductId(match.url) !== match.productId
	)
		throw new Error('A matching German Idealo product identity is required.');
	if (!Number.isFinite(Date.parse(observedAt)))
		throw new Error('A valid price observation date is required.');
	if (
		(response['country'] != null && response['country'] !== 'DE') ||
		(response['siteId'] != null && String(response['siteId']) !== '1')
	)
		throw new Error('This response does not belong to the German marketplace.');
	if (response['currency'] != null && response['currency'] !== 'EUR')
		throw new Error('Only explicit EUR responses are supported.');
	if (response['productId'] != null && String(response['productId']) !== match.productId)
		throw new Error('The provider response belongs to a different product.');
	for (const value of [response['url'], response['productDetailsUrl']]) {
		const id = typeof value === 'string' ? getIdealoProductId(value) : null;
		if (id != null && id !== match.productId)
			throw new Error('The provider response belongs to a different product.');
	}
	const url = new URL(match.url);
	if (url.username || url.password) throw new Error('The product URL cannot contain credentials.');
	return `https://www.idealo.de${url.pathname}`;
}
function publishedPrice(value: unknown): number | null {
	const price = parseGermanPrice(value);
	return price != null && Number.isFinite(price) ? price : null;
}

function record(value: unknown): Record<string, unknown> | null {
	return value != null && typeof value === 'object' && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;
}
function text(value: unknown): string | null {
	return typeof value === 'string' && value.trim() ? value.trim() : null;
}
function normalized(value: unknown): string {
	return typeof value === 'string'
		? value
				.trim()
				.toLowerCase()
				.replace(/[_\s]+/g, '-')
		: '';
}
function totalPrice(candidate: TCandidate): number {
	return roundPrice(candidate.unitPrice + (candidate.shippingPrice ?? 0));
}
function compareCandidates(left: TCandidate, right: TCandidate): number {
	if (left.shippingPrice != null && right.shippingPrice == null) return -1;
	if (left.shippingPrice == null && right.shippingPrice != null) return 1;
	return totalPrice(left) - totalPrice(right) || left.index - right.index;
}
function parseCondition(offer: Record<string, unknown>): TMarketQuote['condition'] {
	if (offer['isUsed'] === true || offer['used'] === true) return 'used';
	if (offer['isRefurbished'] === true || offer['refurbished'] === true) return 'refurbished';
	const value = normalized(offer['condition'] ?? offer['itemCondition']);
	if (
		['used', 'gebraucht', 'second-hand', 'like-new', 'wie-neu'].includes(value) ||
		value.endsWith('/usedcondition')
	)
		return 'used';
	if (
		['refurbished', 'renewed', 'generalüberholt'].includes(value) ||
		value.endsWith('/refurbishedcondition')
	)
		return 'refurbished';
	if (['new', 'neu', 'neuware'].includes(value) || value.endsWith('/newcondition')) return 'new';
	return 'unknown';
}
function parseTaxBasis(offer: Record<string, unknown>): TMarketQuote['taxBasis'] {
	const value = normalized(offer['taxBasis']);
	if (['gross', 'brutto', 'vat-included'].includes(value)) return 'gross';
	if (['net', 'netto', 'vat-excluded'].includes(value)) return 'net';
	for (const key of ['includesVat', 'includesVAT', 'vatIncluded', 'priceIncludesVat']) {
		if (typeof offer[key] === 'boolean') return offer[key] ? 'gross' : 'net';
	}
	return 'unknown';
}
function parseAvailability(offer: Record<string, unknown>): TMarketQuote['availability'] {
	for (const key of ['inStock', 'isInStock']) {
		if (typeof offer[key] === 'boolean') return offer[key] ? 'in-stock' : 'out-of-stock';
	}
	const delivery = record(offer['delivery']);
	const value = normalized(offer['availability'] ?? delivery?.['deliveryStatus']);
	if (
		['in-stock', 'instock', 'auf-lager', 'lagernd', 'sofort-lieferbar'].includes(value) ||
		value.endsWith('/instock')
	)
		return 'in-stock';
	if (
		[
			'out-of-stock',
			'outofstock',
			'unavailable',
			'sold-out',
			'not-available',
			'ausverkauft',
			'nicht-lieferbar',
			'backorder',
			'preorder'
		].includes(value) ||
		value.endsWith('/outofstock')
	)
		return 'out-of-stock';
	return 'unknown';
}
function safeOfferUrl(value: unknown): string | null {
	if (typeof value !== 'string') return null;
	try {
		const url = new URL(value);
		if (
			!['http:', 'https:'].includes(url.protocol) ||
			url.username ||
			url.password ||
			/pr\.v\d+\./.test(decodeURIComponent(value))
		)
			return null;
		return url.href;
	} catch {
		return null;
	}
}
function historyDate(point: Record<string, unknown>): string | null {
	const iso = point['dateTimeISO'];
	if (typeof iso === 'string' && /^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(iso)) {
		const date = new Date(iso);
		const [year, month, day] = iso.slice(0, 10).split('-').map(Number);
		const validCalendarDate =
			year != null &&
			month != null &&
			day != null &&
			month >= 1 &&
			month <= 12 &&
			day >= 1 &&
			day <= new Date(Date.UTC(year, month, 0)).getUTCDate();
		if (validCalendarDate && Number.isFinite(date.getTime())) return date.toISOString();
	}
	const epoch = point['dateTime'];
	if (typeof epoch !== 'number' || !Number.isFinite(epoch)) return null;
	const date = new Date(epoch);
	return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}
