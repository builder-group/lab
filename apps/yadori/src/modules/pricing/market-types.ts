export interface TMarketProductMatch {
	provider: 'idealo';
	country: 'DE';
	productId: string;
	url: string;
	productName: string;
	matchedAt: string;
	/** Search similarity alone is insufficient; a person must confirm the exact variant. */
	variantConfirmed: boolean;
}

export interface TMarketQuote {
	id: string;
	componentId: string;
	provider: 'idealo';
	country: 'DE';
	productId: string;
	productUrl: string;
	productName: string;
	observedAt: string;
	/** As reported by the provider. Never infer VAT or convert a net price into gross. */
	unitPrice: number | null;
	/** Published shipping for the offer; basket consolidation and quantity shipping are unknown. */
	shippingPrice: number | null;
	currency: 'EUR';
	seller: string | null;
	offerUrl: string | null;
	condition: 'new' | 'used' | 'refurbished' | 'unknown';
	taxBasis: 'gross' | 'net' | 'unknown';
	availability: 'in-stock' | 'out-of-stock' | 'unknown';
	notes: string;
	rawPriceText?: string;
}

export interface TProductPriceHistory {
	provider: 'idealo';
	country: 'DE';
	productId: string;
	productUrl: string;
	productName: string;
	currency: 'EUR';
	importedAt: string;
	source: 'provider-history';
	/** Provider product-minimum history, never a reconstructed historical build total. */
	points: Array<{ date: string; unitPrice: number | null }>;
	notes: string;
}
