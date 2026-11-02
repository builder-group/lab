import { UnauthorizedError } from '@modelcontextprotocol/sdk/client/auth.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { isTauri } from '@tauri-apps/api/core';
import {
	cancelIdealoAuth,
	clearIdealoCredentials,
	readIdealoCredentials,
	requestIdealo,
	saveIdealoCredentials,
	startIdealoAuth,
	waitIdealoAuth,
	type TIdealoAuthFlow
} from '../../../environment/desktop/idealo';
import { createIdealoFetch, interruptible } from './native-fetch';
import { IdealoCredentialStore, IdealoOAuthProvider, IdealoRegistrationRenewal } from './oauth';
import {
	parseSearchResult,
	parseToolPayload,
	validateDetails,
	validateHistory,
	validateOffers
} from './payload';
import {
	IdealoError,
	type TIdealoCountry,
	type TIdealoDependencies,
	type TIdealoItemType,
	type TIdealoProductOptions,
	type TIdealoProviderOptions,
	type TIdealoSearchResult,
	type TIdealoStatus
} from './types';

/** Official Idealo MCP client. Creating/restoring it never opens an authorization page. */
export class IdealoProvider {
	private readonly dependencies: TIdealoDependencies;
	private readonly credentials: IdealoCredentialStore;
	private status: TIdealoStatus = {
		state: 'disconnected',
		message: 'Connect Idealo to look up current offers.',
		callsRemaining: 500
	};
	private connection: TConnection | undefined;
	private connecting: Promise<void> | undefined;
	private connectController: AbortController | undefined;
	private activeFlow: TIdealoAuthFlow | undefined;
	private activeRequest: AbortSignal | undefined;
	private queue: Promise<unknown> = Promise.resolve();
	private nextRequestAt = 0;
	private references = new Map<string, { country: TIdealoCountry; type: TIdealoItemType }>();
	private generation = 0;

	constructor(private readonly options: TIdealoProviderOptions = {}) {
		this.dependencies = options.dependencies ?? nativeDependencies;
		this.credentials = new IdealoCredentialStore(this.dependencies);
	}

	getStatus(): TIdealoStatus {
		return { ...this.status, callsRemaining: this.remainingCalls() };
	}
	isConnected(): boolean {
		return this.connection != null && this.status.state === 'connected';
	}

	/** Load keychain data only; the first search reconnects silently if possible. */
	async restore(): Promise<TIdealoStatus> {
		this.requireDesktop();
		const generation = this.generation;
		try {
			await this.credentials.load();
			if (generation === this.generation && !this.connection && !this.connecting)
				this.setStatus(
					this.credentials.bundle.tokens ? 'ready' : 'disconnected',
					this.credentials.bundle.tokens
						? 'Saved Idealo sign-in. Connects when you search.'
						: 'Connect Idealo to look up current offers.'
				);
		} catch (error) {
			const failure = safeError(error);
			if (generation === this.generation) this.setStatus('error', failure.message);
			throw failure;
		}
		return this.getStatus();
	}

	/** Call from an explicit user action after showing the service's eligibility/terms. */
	connect(): Promise<void> {
		this.requireDesktop();
		if (this.isConnected()) return Promise.resolve();
		if (this.connecting != null) return this.connecting;
		return this.startConnection(true);
	}

	async cancelConnect(): Promise<void> {
		if (this.connectController == null) return;
		this.connectController?.abort();
		const flow = this.activeFlow;
		if (flow != null) await this.dependencies.cancelAuth(flow.flowId).catch(() => undefined);
		this.setStatus(
			this.credentials.bundle.tokens ? 'ready' : 'disconnected',
			'Idealo connection cancelled.'
		);
	}

	/** Release transport/listener resources without removing the saved account. */
	async dispose(): Promise<void> {
		const generation = ++this.generation;
		this.connectController?.abort();
		const connection = this.connection;
		connection?.controller.abort();
		this.connection = undefined;
		this.references.clear();
		const flow = this.activeFlow;
		if (flow != null) await this.dependencies.cancelAuth(flow.flowId).catch(() => undefined);
		await this.connecting?.catch(() => undefined);
		await connection?.client.close().catch(() => undefined);
		if (generation === this.generation)
			this.setStatus(
				this.credentials.bundle.tokens ? 'ready' : 'disconnected',
				'Idealo connection closed on this screen. Saved sign-in is retained.'
			);
	}

	async disconnect(): Promise<void> {
		this.requireDesktop();
		await this.dispose();
		await this.credentials.clear();
		this.setStatus(
			'disconnected',
			'Idealo disconnected. Saved credentials were removed from this device.'
		);
	}

	async searchProducts(
		query: string,
		country: TIdealoCountry = 'DE',
		signal?: AbortSignal
	): Promise<TIdealoSearchResult> {
		const search = query.trim();
		if (!search || search.length > 500)
			throw new IdealoError(
				'invalid_response',
				'Enter a product name or model, up to 500 characters.'
			);
		assertCountry(country);
		const payload = await this.call('search_products', { query: search, country }, signal);
		const result = parseSearchResult(payload, search);
		this.references.clear();
		for (const product of result.results)
			this.references.set(product.productRef, { country, type: product.type });
		return result;
	}

	async getProductDetails(
		productRef: string,
		options: TIdealoProductOptions = {}
	): Promise<Record<string, unknown>> {
		return validateDetails(
			await this.call(
				'get_product_details',
				this.productArguments(productRef, options),
				options.signal
			)
		);
	}

	/** One server page. Pass nextOffset explicitly; never auto-consume the whole trial quota. */
	async getProductOffers(
		productRef: string,
		options: TIdealoProductOptions = {}
	): Promise<Record<string, unknown>> {
		const offset = options.offset ?? 0;
		if (!Number.isSafeInteger(offset) || offset < 0)
			throw new IdealoError('invalid_response', 'Offer offset must be a non-negative integer.');
		return validateOffers(
			await this.call(
				'get_product_offers',
				{ ...this.productArguments(productRef, options), offset },
				options.signal
			)
		);
	}

	async getProductPriceHistory(
		productRef: string,
		options: TIdealoProductOptions = {}
	): Promise<Record<string, unknown>> {
		return validateHistory(
			await this.call(
				'get_product_price_history',
				this.productArguments(productRef, options),
				options.signal
			)
		);
	}

	private productArguments(
		productRef: string,
		options: TIdealoProductOptions
	): Record<string, unknown> {
		const reference = this.references.get(productRef);
		if (reference == null)
			throw new IdealoError(
				'invalid_response',
				'Search Idealo again to obtain a fresh product reference. Saved references are not reusable.'
			);
		const country = options.country ?? reference.country;
		assertCountry(country);
		if (country !== reference.country)
			throw new IdealoError(
				'invalid_response',
				'Search again in the selected country before opening this product.'
			);
		return { productRef, country, type: options.type ?? reference.type };
	}

	private startConnection(interactive: boolean): Promise<void> {
		const task = this.openConnection(interactive, ++this.generation);
		this.connecting = task;
		void task
			.finally(() => {
				if (this.connecting === task) this.connecting = undefined;
			})
			.catch(() => undefined);
		return task;
	}

	private async openConnection(interactive: boolean, generation: number): Promise<void> {
		const controller = new AbortController();
		this.connectController = controller;
		this.setStatus('connecting', 'Connecting to Idealo…');
		let candidate: TConnection | undefined;
		let flow: TIdealoAuthFlow | undefined;
		const oauth = new IdealoOAuthProvider(
			this.credentials,
			this.dependencies,
			controller.signal,
			() => this.setStatus('authorizing', 'Finish Idealo sign-in and consent in your browser.')
		);
		try {
			await this.credentials.load();
			if (!interactive && !this.credentials.bundle.tokens)
				throw new IdealoError('auth_required', 'Choose Connect Idealo to sign in.');
			if (interactive) {
				// Start the loopback listener before the SDK can discover/register/redirect.
				flow = await this.dependencies.startAuth();
				this.activeFlow = flow;
				if (controller.signal.aborted)
					throw new IdealoError('cancelled', 'Idealo connection cancelled.');
				oauth.begin(flow);
			}
			const fetch = createIdealoFetch(
				this.dependencies,
				() => this.activeRequest ?? controller.signal,
				() => oauth.allowsRegistration
			);
			for (let attempt = 0; attempt < 2; attempt++) {
				candidate = makeConnection(oauth, fetch, controller);
				try {
					await candidate.client.connect(candidate.transport, {
						timeout: this.dependencies.requestTimeoutMs ?? 30_000
					});
					break;
				} catch (error) {
					if (error instanceof IdealoRegistrationRenewal && interactive && attempt === 0) {
						await candidate.client.close().catch(() => undefined);
						await oauth.invalidateCredentials('client');
						await oauth.invalidateCredentials('tokens');
						continue;
					}
					if (
						!(error instanceof UnauthorizedError) ||
						!interactive ||
						!oauth.redirected ||
						flow == null
					)
						throw error;
					const authResult = await interruptible(
						this.dependencies.waitAuth(flow.flowId),
						[controller.signal],
						this.dependencies.authTimeoutMs ?? 180_000
					);
					if ('error' in authResult) {
						throw new IdealoError(
							/timeout|timed\s+out/i.test(authResult.error) ? 'timeout' : 'cancelled',
							'Idealo authorization was not completed. Connect again when ready.'
						);
					}
					await candidate.transport.finishAuth(authResult.code);
					await candidate.client.close().catch(() => undefined);
					candidate = makeConnection(oauth, fetch, controller);
					await candidate.client.connect(candidate.transport, {
						timeout: this.dependencies.requestTimeoutMs ?? 30_000
					});
					break;
				}
			}
			if (controller.signal.aborted || generation !== this.generation || candidate == null)
				throw new IdealoError('cancelled', 'Idealo connection cancelled.');
			this.connection = candidate;
			this.references.clear();
			this.setStatus('connected', 'Connected to Idealo. Searches run only when requested.');
		} catch (error) {
			await candidate?.client.close().catch(() => undefined);
			const failure = safeError(error);
			if (generation === this.generation)
				this.setStatus(
					failure.code === 'cancelled' || failure.code === 'auth_required'
						? this.credentials.bundle.tokens
							? 'ready'
							: 'disconnected'
						: 'error',
					failure.message
				);
			throw failure;
		} finally {
			oauth.end();
			if (this.activeFlow === flow) this.activeFlow = undefined;
			if (flow != null) await this.dependencies.cancelAuth(flow.flowId).catch(() => undefined);
			if (this.connectController === controller) this.connectController = undefined;
		}
	}

	private call(
		name: string,
		args: Record<string, unknown>,
		signal?: AbortSignal
	): Promise<Record<string, unknown>> {
		this.requireDesktop();
		const operation = this.queue
			.catch(() => undefined)
			.then(async () => {
				if (signal?.aborted) throw new IdealoError('cancelled', 'Idealo request cancelled.');
				if (!this.isConnected()) {
					if (this.connecting != null) await this.connecting;
					else await this.startConnection(false);
				}
				const connection = this.connection;
				if (connection == null)
					throw new IdealoError('auth_required', 'Connect Idealo before searching.');
				const generation = this.generation;
				const wait = Math.max(0, this.nextRequestAt - this.now());
				if (wait > 0)
					await interruptible(
						new Promise<void>((resolve) => setTimeout(resolve, wait)),
						[signal, connection.controller.signal],
						wait + 1000
					);
				if (connection.controller.signal.aborted || generation !== this.generation)
					throw new IdealoError('cancelled', 'Idealo request cancelled.');
				const calls = this.recentCalls();
				if (calls.length >= 500)
					throw new IdealoError(
						'rate_limit',
						'The local Idealo allowance of 500 calls in 24 hours has been reached. Try again later.'
					);
				this.nextRequestAt = this.now() + (this.dependencies.requestIntervalMs ?? 334);
				await this.credentials.update({ calls: [...calls, this.now()] });
				this.activeRequest = signal;
				try {
					const result = await connection.client.callTool({ name, arguments: args }, undefined, {
						timeout: this.dependencies.requestTimeoutMs ?? 30_000,
						...(signal == null ? {} : { signal })
					});
					if (connection.controller.signal.aborted || generation !== this.generation)
						throw new IdealoError('cancelled', 'Idealo request cancelled.');
					this.setStatus('connected', 'Connected to Idealo.');
					return parseToolPayload(result);
				} catch (error) {
					const failure = safeError(error);
					if (failure.code === 'auth_required') {
						connection.controller.abort();
						await connection.client.close().catch(() => undefined);
						this.connection = undefined;
						this.references.clear();
						this.setStatus('ready', failure.message);
					}
					throw failure;
				} finally {
					this.activeRequest = undefined;
				}
			});
		this.queue = operation;
		return operation;
	}

	private recentCalls(): number[] {
		return this.credentials.bundle.calls.filter((time) => time > this.now() - 24 * 60 * 60 * 1000);
	}
	private remainingCalls(): number {
		return Math.max(0, 500 - this.recentCalls().length);
	}
	private now(): number {
		return this.dependencies.now?.() ?? Date.now();
	}
	private setStatus(state: TIdealoStatus['state'], message: string): void {
		this.status = { state, message, callsRemaining: this.remainingCalls() };
		this.options.onStatusChange?.(this.getStatus());
	}
	private requireDesktop(): void {
		if (!this.dependencies.isDesktop())
			throw new IdealoError(
				'desktop_required',
				'Live Idealo lookups are available in the Yadori desktop app. Browser preview supports external search links.'
			);
	}
}

interface TConnection {
	client: Client;
	transport: StreamableHTTPClientTransport;
	controller: AbortController;
}

function makeConnection(
	oauth: IdealoOAuthProvider,
	fetch: ReturnType<typeof createIdealoFetch>,
	controller: AbortController
): TConnection {
	const client = new Client({ name: 'Yadori', version: '0.1.0' });
	// Request failures are surfaced to their caller without logging HTTP bodies or tokens.
	client.onerror = () => undefined;
	const transport = new StreamableHTTPClientTransport(new URL('https://mcp.idealo.com/mcp'), {
		authProvider: oauth,
		fetch,
		reconnectionOptions: {
			initialReconnectionDelay: 1000,
			maxReconnectionDelay: 1000,
			reconnectionDelayGrowFactor: 1,
			maxRetries: 0
		}
	});
	return { client, transport, controller };
}

function assertCountry(country: string): void {
	if (!['DE', 'AT', 'GB', 'FR', 'IT', 'ES'].includes(country))
		throw new IdealoError('invalid_response', 'Choose a supported Idealo marketplace.');
}

function safeError(error: unknown): IdealoError {
	if (error instanceof IdealoError) return error;
	const message = typeof error === 'string' ? error : error instanceof Error ? error.message : '';
	if (/^Idealo callback port 6274 is unavailable(?: on IPv6)?\./.test(message)) {
		return new IdealoError(
			'remote_error',
			'Idealo needs local callback port 6274. Close the other app using that port, then connect again.'
		);
	}
	if (error instanceof UnauthorizedError)
		return new IdealoError(
			'auth_required',
			'Idealo needs authorization. Choose Connect Idealo to sign in.'
		);
	if (error instanceof Error && error.name === 'AbortError')
		return new IdealoError('cancelled', 'Idealo request cancelled.');
	if (error != null && typeof error === 'object' && 'code' in error && error.code === -32001)
		return new IdealoError('timeout', 'Idealo did not respond in time. Try again.');
	return new IdealoError(
		'remote_error',
		'The Idealo connection could not complete this request. Check your connection and try again.'
	);
}

const nativeDependencies: TIdealoDependencies = {
	isDesktop: isTauri,
	request: requestIdealo,
	readCredentials: readIdealoCredentials,
	saveCredentials: saveIdealoCredentials,
	clearCredentials: clearIdealoCredentials,
	startAuth: startIdealoAuth,
	waitAuth: waitIdealoAuth,
	cancelAuth: cancelIdealoAuth,
	openAuthorization: async (url) => {
		const { openUrl } = await import('@tauri-apps/plugin-opener');
		await openUrl(url);
	}
};
