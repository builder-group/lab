import { CallToolResultSchema } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { IdealoError, type TIdealoProduct, type TIdealoSearchResult } from './types';

export function parseToolPayload(input: unknown): Record<string, unknown> {
	const parsed = CallToolResultSchema.safeParse(input);
	if (!parsed.success) throw invalidFormat('tool response', parsed.error);
	const result = parsed.data;
	if (result.isError) {
		throw new IdealoError(
			'remote_error',
			'Idealo could not complete this lookup. Try searching the exact model again.'
		);
	}
	if (result.structuredContent != null) return record(result.structuredContent);
	const text = result.content
		.filter((item) => item.type === 'text')
		.map((item) => item.text)
		.join('\n');
	try {
		return record(JSON.parse(text));
	} catch {
		throw new IdealoError(
			'invalid_response',
			'Idealo returned a result format this version cannot read.'
		);
	}
}

export function parseSearchResult(
	payload: Record<string, unknown>,
	query: string
): TIdealoSearchResult {
	const parsed = SSearch.safeParse(payload);
	if (!parsed.success) throw invalidFormat('product-search result', parsed.error);
	return {
		query: parsed.data.query ?? query,
		results: parsed.data.results.map((item): TIdealoProduct => ({
			productRef: item.productRef,
			name: item.name,
			url: item.url,
			type: item.itemType,
			...(item.price == null ? {} : { price: item.price }),
			...(item.imageUrl == null ? {} : { imageUrl: item.imageUrl })
		})),
		...(parsed.data.searchResultsUrl == null
			? {}
			: { searchResultsUrl: parsed.data.searchResultsUrl }),
		raw: payload
	};
}

export function validateDetails(payload: Record<string, unknown>): Record<string, unknown> {
	if (
		typeof payload['name'] !== 'string' ||
		!webUrl(payload['url'] ?? payload['productDetailsUrl'])
	) {
		throw new IdealoError('invalid_response', 'Idealo returned incomplete product details.');
	}
	return payload;
}

export function validateOffers(payload: Record<string, unknown>): Record<string, unknown> {
	const parsed = SOffers.safeParse(payload);
	if (!parsed.success) throw invalidFormat('offers result', parsed.error);
	return payload;
}

export function validateHistory(payload: Record<string, unknown>): Record<string, unknown> {
	if (payload['priceTrend'] === null) return payload;
	const trend = payload['priceTrend'];
	if (
		trend == null ||
		typeof trend !== 'object' ||
		!Array.isArray((trend as Record<string, unknown>)['history'])
	) {
		throw new IdealoError('invalid_response', 'Idealo returned an invalid price-history result.');
	}
	return payload;
}

const SWebUrl = z.string().refine(webUrl);
const SSearch = z.object({
	query: z.string().optional(),
	results: z.array(
		z.object({
			productRef: z.string().min(1).max(16_384),
			name: z.string().min(1),
			url: SWebUrl,
			price: z.string().nullable().optional(),
			imageUrl: SWebUrl.nullable().optional(),
			itemType: z.enum(['PRODUCT', 'CLUSTER', 'SINGLE_OFFER'])
		})
	),
	searchResultsUrl: SWebUrl.optional()
});
const SOffers = z.object({
	// This client consumes one page only. Unused pagination metadata does not gate offer prices.
	offers: z.array(
		z.object({
			price: z.string(),
			shop: z.object({ name: z.string() }),
			relocatorUrl: SWebUrl.optional(),
			minShippingCost: z.string().nullable().optional()
		})
	)
});

function record(value: unknown): Record<string, unknown> {
	if (value == null || typeof value !== 'object' || Array.isArray(value)) {
		throw new IdealoError('invalid_response', 'Idealo returned a non-object result.');
	}
	return value as Record<string, unknown>;
}

function webUrl(value: unknown): boolean {
	if (typeof value !== 'string') return false;
	try {
		return ['https:', 'http:'].includes(new URL(value).protocol);
	} catch {
		return false;
	}
}

/** Report only schema-owned field names and issue codes, never raw values or issue messages. */
function invalidFormat(label: string, error: z.ZodError): IdealoError {
	const knownFields = new Set([
		'nextOffset',
		'offers',
		'price',
		'shop',
		'name',
		'relocatorUrl',
		'minShippingCost',
		'freshness',
		'query',
		'results',
		'productRef',
		'url',
		'itemType',
		'imageUrl',
		'searchResultsUrl',
		'content',
		'type',
		'text',
		'isError',
		'structuredContent'
	]);
	const diagnostics = [
		...new Set(
			error.issues.map((issue) => {
				const path =
					issue.path
						.map((segment) =>
							typeof segment === 'number' &&
							Number.isSafeInteger(segment) &&
							segment >= 0 &&
							segment <= 1000
								? `[${segment}]`
								: typeof segment === 'string' && knownFields.has(segment)
									? segment
									: 'field'
						)
						.join('.')
						.replace(/\.\[/g, '[') || 'response';
				return `${path} (${issue.code})`;
			})
		)
	]
		.slice(0, 4)
		.join(', ');
	return new IdealoError(
		'invalid_response',
		`Idealo returned an invalid ${label}. Fields: ${diagnostics}.`
	);
}
