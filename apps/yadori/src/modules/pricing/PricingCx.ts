import { createState } from 'feature-state';
import { IdealoProvider, type TIdealoProduct, type TIdealoStatus } from './idealo';
import type { TMarketQuote } from './market-types';
import { getIdealoProductId } from './product-id';
import { parseIdealoQuote } from './quote-parser';

export class PricingCx {
	readonly $status = createState<TIdealoStatus>({
		state: 'disconnected',
		message: 'Connect Idealo to search current offers.',
		callsRemaining: 500
	});
	readonly $results = createState<TIdealoProduct[]>([]);
	readonly $busy = createState(false);
	readonly $error = createState<string | null>(null);
	private readonly provider: IdealoProvider;
	private controller: AbortController | null = null;
	constructor(provider?: IdealoProvider) {
		this.provider =
			provider ?? new IdealoProvider({ onStatusChange: (status) => this.$status.set(status) });
	}
	async connect(): Promise<void> {
		this.$error.set(null);
		try {
			await this.provider.connect();
			this.$status.set(this.provider.getStatus());
		} catch (error) {
			this.fail(error);
		}
	}
	async disconnect(): Promise<void> {
		this.controller?.abort();
		try {
			await this.provider.disconnect();
			this.$status.set(this.provider.getStatus());
			this.$results.set([]);
		} catch (error) {
			this.fail(error);
		}
	}
	async cancel(): Promise<void> {
		this.controller?.abort();
		try {
			await this.provider.cancelConnect();
		} catch (error) {
			this.fail(error);
		}
	}
	async search(query: string): Promise<void> {
		if (this.$busy.get()) return;
		this.$results.set([]);
		this.$busy.set(true);
		this.$error.set(null);
		const controller = new AbortController();
		this.controller = controller;
		try {
			const result = await this.provider.searchProducts(query, 'DE', controller.signal);
			if (!controller.signal.aborted) this.$results.set(result.results);
		} catch (error) {
			if (!controller.signal.aborted) this.fail(error);
		} finally {
			if (this.controller === controller) this.controller = null;
			this.$busy.set(false);
		}
	}
	async offers(partId: string, product: TIdealoProduct): Promise<TMarketQuote | null> {
		if (this.$busy.get()) return null;
		this.$busy.set(true);
		this.$error.set(null);
		const controller = new AbortController();
		this.controller = controller;
		try {
			const productId = getIdealoProductId(product.url);
			if (!productId) throw new Error('Choose a German Idealo product page.');
			const raw = await this.provider.getProductOffers(product.productRef, {
				country: 'DE',
				type: product.type,
				signal: controller.signal
			});
			if (controller.signal.aborted) return null;
			return parseIdealoQuote(
				partId,
				{
					provider: 'idealo',
					country: 'DE',
					productId,
					url: product.url,
					productName: product.name,
					matchedAt: new Date().toISOString(),
					variantConfirmed: true
				},
				raw,
				new Date().toISOString()
			);
		} catch (error) {
			if (!controller.signal.aborted) this.fail(error);
			return null;
		} finally {
			if (this.controller === controller) this.controller = null;
			this.$busy.set(false);
		}
	}
	async dispose(): Promise<void> {
		this.controller?.abort();
		await this.provider.dispose();
	}
	private fail(error: unknown): void {
		this.$error.set(error instanceof Error ? error.message : String(error));
		this.$status.set(this.provider.getStatus());
	}
}
export const pricingCx = new PricingCx();
