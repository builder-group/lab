import type { TCommand, TPart, TProject, TQuote, TSource } from '../project/model';
import type { TMarketQuote } from './market-types';
import { roundPrice } from './price';
import { getIdealoProductId } from './product-id';

/** Converts one explicitly selected product offer into ordinary immutable project records. */
export function createQuoteObservation(
	project: TProject,
	part: TPart,
	offer: TMarketQuote,
	packQuantity: number
): { commands: TCommand[]; quote: TQuote } {
	if (!project.parts.some((entry) => entry.id === part.id))
		throw new Error('This part is no longer in the project.');
	if (
		offer.componentId !== part.id ||
		offer.unitPrice == null ||
		!Number.isFinite(offer.unitPrice) ||
		offer.unitPrice < 0
	)
		throw new Error('A valid offer for this part is required.');
	if (
		!Number.isFinite(packQuantity) ||
		packQuantity <= 0 ||
		(part.unit === 'each' && !Number.isInteger(packQuantity))
	)
		throw new Error('Enter the number of items or metres included in this offer.');
	if (
		getIdealoProductId(offer.productUrl) !== offer.productId ||
		offer.currency !== 'EUR' ||
		!Number.isFinite(Date.parse(offer.observedAt))
	)
		throw new Error('Offer identity, currency or observation date is invalid.');
	if (
		offer.taxBasis === 'net' ||
		offer.condition === 'used' ||
		offer.condition === 'refurbished' ||
		offer.availability === 'out-of-stock'
	)
		throw new Error('This offer is not a comparable consumer purchase.');
	const existing = project.sources.find(
		(source) =>
			source.partId === part.id &&
			source.provider === 'idealo' &&
			source.productId === offer.productId
	);
	const source: TSource = existing ?? {
		id: crypto.randomUUID(),
		partId: part.id,
		kind: 'product',
		title: offer.productName,
		url: offer.productUrl,
		provider: 'idealo',
		productId: offer.productId,
		notes: 'Exact variant and pack size selected by the user.'
	};
	const notes = [
		offer.notes,
		offer.offerUrl ? `Reported seller offer: ${offer.offerUrl}` : '',
		`Offer includes ${packQuantity} ${part.unit === 'm' ? 'm' : 'item(s)'}. Shipping is recorded separately; VAT ${offer.taxBasis}.`
	]
		.filter(Boolean)
		.join('\n');
	const quote: TQuote = {
		id: crypto.randomUUID(),
		partId: part.id,
		sourceId: source.id,
		observedAt: offer.observedAt,
		currency: 'EUR',
		price: offer.unitPrice,
		packQuantity,
		unit: part.unit,
		seller: offer.seller,
		shipping: offer.shippingPrice,
		tax: offer.taxBasis,
		condition: offer.condition === 'new' ? 'new' : 'unknown',
		notes
	};
	return {
		commands: [
			...(existing ? [] : [{ type: 'source.add' as const, source }]),
			{ type: 'quote.add', quote }
		],
		quote
	};
}
export function adoptQuoteEstimate(
	part: TPart,
	quote: TQuote,
	options: { usePackSize?: boolean } = {}
): TCommand {
	if (
		quote.partId !== part.id ||
		quote.unit !== part.unit ||
		quote.packQuantity <= 0 ||
		!Number.isFinite(quote.price) ||
		quote.tax === 'net' ||
		quote.condition === 'used'
	)
		throw new Error('This quote cannot be adopted for this part.');
	return {
		type: 'part.update',
		id: part.id,
		patch: {
			estimatedUnitPrice: roundPrice(quote.price / quote.packQuantity),
			...(options.usePackSize ? { purchasePackQuantity: quote.packQuantity } : {})
		}
	};
}
