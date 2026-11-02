import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
	TIdealoAuthResult,
	TIdealoNativeRequest,
	TIdealoNativeResponse
} from '../../../environment/desktop/idealo';
import { IdealoProvider } from './provider';
import type { TIdealoDependencies } from './types';

describe('IdealoProvider', () => {
	const providers: IdealoProvider[] = [];
	afterEach(async () => {
		for (const provider of providers.splice(0)) await provider.disconnect().catch(() => undefined);
	});

	it('should complete the real SDK 401 discovery, public PKCE flow and store tokens only through the native boundary', async () => {
		const fixture = createFixture();
		const provider = make(fixture);
		const first = provider.connect();
		const second = provider.connect();
		expect(first).toBe(second);
		await first;
		const result = await provider.searchProducts('fixture pump');

		expect(fixture.events.indexOf('listener')).toBeLessThan(fixture.events.indexOf('register'));
		expect(fixture.events.indexOf('listener')).toBeLessThan(fixture.events.indexOf('browser'));
		expect(fixture.dependencies.startAuth).toHaveBeenCalledTimes(1);
		expect(fixture.dependencies.openAuthorization).toHaveBeenCalledTimes(1);
		const authorization = new URL(
			must(vi.mocked(fixture.dependencies.openAuthorization).mock.calls[0])[0]
		);
		expect(authorization.searchParams.get('state')).toBe('test-native-state');
		expect(authorization.searchParams.get('redirect_uri')).toBe('http://localhost:6274/callback');
		expect(authorization.searchParams.get('code_challenge_method')).toBe('S256');
		expect(authorization.searchParams.get('code_challenge')).toBeTruthy();
		expect(fixture.registration?.['token_endpoint_auth_method']).toBe('none');
		expect(fixture.tokenRequests[0]?.get('code_verifier')?.length).toBeGreaterThanOrEqual(43);
		expect(result.results[0]).toMatchObject({
			productRef: 'opaque-fixture-reference',
			name: 'Fixture Pump 12V',
			type: 'PRODUCT',
			price: '149,00 €'
		});
		expect(provider.isConnected()).toBe(true);
		expect(JSON.parse(must(fixture.stored())).tokens).toMatchObject({
			access_token: 'fixture-access',
			issuer: 'https://mcp.idealo.com'
		});
		expect(JSON.parse(must(fixture.stored())).codeVerifier).toBeUndefined();
	});

	it('should restore and refresh saved tokens lazily without a listener, new registration or external browser', async () => {
		const fixture = createFixture({ stored: savedCredentials('expired-access') });
		const provider = make(fixture);
		expect((await provider.restore()).state).toBe('ready');
		expect(fixture.dependencies.request).not.toHaveBeenCalled();
		await provider.searchProducts('fixture pump');
		expect(fixture.dependencies.startAuth).not.toHaveBeenCalled();
		expect(fixture.dependencies.openAuthorization).not.toHaveBeenCalled();
		expect(fixture.events).not.toContain('register');
		expect(fixture.tokenRequests[0]?.get('grant_type')).toBe('refresh_token');
		expect(JSON.parse(must(fixture.stored())).tokens).toMatchObject({
			access_token: 'fixture-access',
			refresh_token: 'rotated-fixture-refresh',
			issuer: 'https://mcp.idealo.com'
		});
	});

	it('should return an authorization-required error without opening a browser when a saved session cannot refresh', async () => {
		const fixture = createFixture({ stored: savedCredentials('expired-access', false) });
		const provider = make(fixture);
		await provider.restore();
		await expect(provider.searchProducts('fixture pump')).rejects.toMatchObject({
			code: 'auth_required'
		});
		expect(fixture.dependencies.openAuthorization).not.toHaveBeenCalled();
		expect(fixture.dependencies.startAuth).not.toHaveBeenCalled();
		expect(provider.isConnected()).toBe(false);
	});

	it('should parse JSON text tools and finite SSE protocol responses without changing currency units', async () => {
		const fixture = createFixture({ stored: savedCredentials(), sse: true, textPayload: true });
		const provider = make(fixture);
		const result = await provider.searchProducts('fixture pump');
		const ref = must(result.results[0]).productRef;
		const details = await provider.getProductDetails(ref);
		const offers = await provider.getProductOffers(ref, { offset: 5 });
		const history = await provider.getProductPriceHistory(ref);
		expect(details['name']).toBe('Fixture Pump 12V');
		expect(offers['offers']).toMatchObject([{ price: '149,00 €', minShippingCost: '5,90 €' }]);
		expect(history['priceTrend']).toMatchObject({
			history: [{ price: '159,00 €' }],
			periodDays: 30
		});
		expect(
			fixture.toolCalls.find((call) => call.name === 'get_product_offers')?.arguments
		).toMatchObject({ offset: 5, country: 'DE', type: 'PRODUCT' });
		await expect(provider.getProductDetails('saved-stale-reference')).rejects.toMatchObject({
			code: 'invalid_response'
		});
		await expect(provider.getProductDetails(ref, { country: 'GB' })).rejects.toMatchObject({
			code: 'invalid_response'
		});
	});

	it('should reject explicit remote tool errors and malformed results without exposing remote bodies', async () => {
		const fixture = createFixture({ stored: savedCredentials() });
		const provider = make(fixture);
		fixture.responseMode = 'tool-error';
		await expect(provider.searchProducts('fixture pump')).rejects.toMatchObject({
			code: 'remote_error'
		});
		fixture.responseMode = 'invalid';
		await expect(provider.searchProducts('fixture pump')).rejects.toMatchObject({
			code: 'invalid_response'
		});
		expect(provider.getStatus().message).not.toContain('private remote body');
	});

	it('should clear authorization status on cancellation and close the native listener', async () => {
		const fixture = createFixture({ holdAuthorization: true });
		const provider = make(fixture);
		const connection = provider.connect();
		const rejection = expect(connection).rejects.toMatchObject({ code: 'cancelled' });
		await vi.waitFor(() => expect(provider.getStatus().state).toBe('authorizing'));
		await provider.cancelConnect();
		await rejection;
		expect(provider.getStatus().state).toBe('disconnected');
		expect(fixture.dependencies.cancelAuth).toHaveBeenCalledWith('fixture-flow');
	});

	it('should time out blocked requests and remain disconnected', async () => {
		const fixture = createFixture({ stored: savedCredentials() });
		fixture.dependencies.requestTimeoutMs = 20;
		fixture.dependencies.request = vi.fn(() => new Promise<TIdealoNativeResponse>(() => undefined));
		const provider = make(fixture);
		await expect(provider.searchProducts('fixture pump')).rejects.toMatchObject({
			code: 'timeout'
		});
		expect(provider.getStatus().state).toBe('error');
		expect(provider.isConnected()).toBe(false);
	});

	it('should pace tools below three calls per second and enforce a restored 24-hour allowance', async () => {
		const fixture = createFixture({ stored: savedCredentials() });
		fixture.dependencies.requestIntervalMs = 334;
		const provider = make(fixture);
		await Promise.all([
			provider.searchProducts('pump one'),
			provider.searchProducts('pump two'),
			provider.searchProducts('pump three')
		]);
		expect(must(fixture.toolTimes[1]) - must(fixture.toolTimes[0])).toBeGreaterThanOrEqual(320);
		expect(must(fixture.toolTimes[2]) - must(fixture.toolTimes[1])).toBeGreaterThanOrEqual(320);
		const exhausted = createFixture({
			stored: savedCredentials('fixture-access', true, Array(500).fill(Date.now()))
		});
		const other = make(exhausted);
		await expect(other.searchProducts('fixture pump')).rejects.toMatchObject({
			code: 'rate_limit'
		});
		expect(exhausted.toolCalls).toHaveLength(0);
		expect(other.getStatus().callsRemaining).toBe(0);
	});

	it('should reject browser preview without touching the credential store or network', async () => {
		const fixture = createFixture();
		fixture.dependencies.isDesktop = () => false;
		const provider = make(fixture);
		await expect(provider.restore()).rejects.toMatchObject({ code: 'desktop_required' });
		expect(() => provider.connect()).toThrow('desktop app');
		expect(fixture.dependencies.readCredentials).not.toHaveBeenCalled();
		expect(fixture.dependencies.request).not.toHaveBeenCalled();
	});

	it('should remove saved credentials on disconnect and discard session references', async () => {
		const fixture = createFixture({ stored: savedCredentials() });
		const provider = make(fixture);
		const search = await provider.searchProducts('fixture pump');
		await provider.disconnect();
		expect(fixture.stored()).toBeNull();
		expect(provider.getStatus().state).toBe('disconnected');
		await expect(
			provider.getProductOffers(must(search.results[0]).productRef)
		).rejects.toMatchObject({
			code: 'invalid_response'
		});
	});

	it('should dispose transports while retaining saved sign-in and rejecting old session references', async () => {
		const fixture = createFixture({ stored: savedCredentials() });
		const provider = make(fixture);
		const search = await provider.searchProducts('fixture pump');
		await provider.dispose();
		expect(provider.isConnected()).toBe(false);
		expect(provider.getStatus().state).toBe('ready');
		expect(fixture.stored()).not.toBeNull();
		expect(fixture.dependencies.clearCredentials).not.toHaveBeenCalled();
		await expect(
			provider.getProductOffers(must(search.results[0]).productRef)
		).rejects.toMatchObject({ code: 'invalid_response' });
		await provider.searchProducts('fixture pump');
		expect(provider.isConnected()).toBe(true);
		expect(fixture.dependencies.openAuthorization).not.toHaveBeenCalled();
	});

	it('should time out unfinished authorization and close the callback listener', async () => {
		const fixture = createFixture({ holdAuthorization: true });
		fixture.dependencies.authTimeoutMs = 15;
		const provider = make(fixture);
		await expect(provider.connect()).rejects.toMatchObject({ code: 'timeout' });
		expect(provider.getStatus().state).toBe('error');
		expect(fixture.dependencies.cancelAuth).toHaveBeenCalledWith('fixture-flow');
	});

	it('should treat denied authorization as cancellation without requesting a token', async () => {
		const fixture = createFixture();
		fixture.dependencies.waitAuth = vi.fn(async () => ({ error: 'access_denied' }));
		const provider = make(fixture);
		await expect(provider.connect()).rejects.toMatchObject({ code: 'cancelled' });
		expect(fixture.tokenRequests).toHaveLength(0);
		expect(provider.getStatus().state).toBe('disconnected');
	});

	it('should explain a busy known callback port without echoing arbitrary native error details', async () => {
		const fixture = createFixture();
		fixture.dependencies.startAuth = vi.fn(async () => {
			throw 'Idealo callback port 6274 is unavailable. Close the application using that port and try again.';
		});
		const provider = make(fixture);
		await expect(provider.connect()).rejects.toMatchObject({
			code: 'remote_error',
			message:
				'Idealo needs local callback port 6274. Close the other app using that port, then connect again.'
		});
		expect(fixture.dependencies.request).not.toHaveBeenCalled();
	});

	function make(fixture: ReturnType<typeof createFixture>): IdealoProvider {
		const provider = new IdealoProvider({ dependencies: fixture.dependencies });
		providers.push(provider);
		return provider;
	}
});

function createFixture(
	options: {
		stored?: string;
		sse?: boolean;
		textPayload?: boolean;
		holdAuthorization?: boolean;
	} = {}
) {
	let stored = options.stored ?? null;
	const events: string[] = [];
	const tokenRequests: URLSearchParams[] = [];
	const toolCalls: Array<{ name: string; arguments: Record<string, unknown> }> = [];
	const toolTimes: number[] = [];
	const fixture = {
		events,
		tokenRequests,
		toolCalls,
		toolTimes,
		registration: undefined as Record<string, unknown> | undefined,
		responseMode: 'valid' as 'valid' | 'tool-error' | 'invalid',
		stored: () => stored,
		dependencies: {} as TIdealoDependencies
	};
	fixture.dependencies = {
		isDesktop: () => true,
		readCredentials: vi.fn(async () => stored),
		saveCredentials: vi.fn(async (value) => {
			stored = value;
		}),
		clearCredentials: vi.fn(async () => {
			stored = null;
		}),
		startAuth: vi.fn(async () => {
			events.push('listener');
			return {
				flowId: 'fixture-flow',
				redirectUrl: 'http://localhost:6274/callback',
				state: 'test-native-state'
			};
		}),
		waitAuth: vi.fn(() =>
			options.holdAuthorization
				? new Promise<TIdealoAuthResult>(() => undefined)
				: Promise.resolve({ code: 'fixture-code' })
		),
		cancelAuth: vi.fn(async () => undefined),
		openAuthorization: vi.fn(async () => {
			events.push('browser');
		}),
		requestIntervalMs: 0,
		request: vi.fn(async (request: TIdealoNativeRequest) => {
			const path = new URL(request.url).pathname;
			if (path === '/.well-known/oauth-protected-resource')
				return json({
					resource: 'https://mcp.idealo.com/mcp',
					authorization_servers: ['https://mcp.idealo.com'],
					scopes_supported: ['test-scope']
				});
			if (
				path === '/.well-known/oauth-authorization-server' ||
				path === '/.well-known/openid-configuration'
			)
				return json({
					issuer: 'https://mcp.idealo.com',
					authorization_endpoint: 'https://mcp.idealo.com/oauth2/authorize',
					token_endpoint: 'https://mcp.idealo.com/oauth2/token',
					registration_endpoint: 'https://mcp.idealo.com/oauth2/register',
					response_types_supported: ['code'],
					token_endpoint_auth_methods_supported: ['none'],
					code_challenge_methods_supported: ['S256']
				});
			if (path === '/oauth2/register') {
				events.push('register');
				fixture.registration = JSON.parse(must(request.body));
				return json({ ...fixture.registration, client_id: 'fixture-client' }, 201);
			}
			if (path === '/oauth2/token') {
				tokenRequests.push(new URLSearchParams(request.body));
				return json({
					access_token: 'fixture-access',
					token_type: 'Bearer',
					refresh_token: 'rotated-fixture-refresh',
					expires_in: 3600
				});
			}
			if (path !== '/mcp') throw new Error('Unexpected fixture endpoint');
			if (request.headers['authorization'] !== 'Bearer fixture-access')
				return {
					status: 401,
					statusText: 'Unauthorized',
					headers: {
						'www-authenticate':
							'Bearer resource_metadata="https://mcp.idealo.com/.well-known/oauth-protected-resource"'
					},
					body: ''
				};
			const message = JSON.parse(must(request.body)) as {
				id?: number;
				method: string;
				params?: Record<string, unknown>;
			};
			if (
				message.method === 'notifications/initialized' ||
				message.method === 'notifications/cancelled'
			)
				return { status: 202, statusText: 'Accepted', headers: {}, body: '' };
			let result: unknown;
			if (message.method === 'initialize')
				result = {
					protocolVersion: message.params?.['protocolVersion'],
					capabilities: { tools: {} },
					serverInfo: { name: 'fixture-idealo', version: '1.0.0' }
				};
			else if (message.method === 'tools/call') {
				const call = message.params as { name: string; arguments: Record<string, unknown> };
				toolCalls.push(call);
				toolTimes.push(Date.now());
				const payload = toolPayload(call.name);
				result =
					fixture.responseMode === 'tool-error'
						? { isError: true, content: [{ type: 'text', text: 'private remote body' }] }
						: {
								content: [
									{
										type: 'text',
										text: JSON.stringify(
											fixture.responseMode === 'invalid' ? { results: 'invalid' } : payload
										)
									}
								],
								...(options.textPayload
									? {}
									: {
											structuredContent:
												fixture.responseMode === 'invalid' ? { results: 'invalid' } : payload
										})
							};
			} else if (message.method === 'tools/list') result = { tools: [] };
			else throw new Error('Unexpected fixture method');
			const response = { jsonrpc: '2.0', id: message.id, result };
			return options.sse
				? {
						status: 200,
						statusText: 'OK',
						headers: { 'content-type': 'text/event-stream' },
						body: `event: message\ndata: ${JSON.stringify(response)}\n\n`
					}
				: json(response);
		})
	};
	return fixture;
}

function savedCredentials(access = 'fixture-access', refresh = true, calls: number[] = []): string {
	return JSON.stringify({
		version: 1,
		redirectUrl: 'http://localhost:6274/callback',
		clientInformation: {
			client_id: 'fixture-client',
			issuer: 'https://mcp.idealo.com',
			redirect_uris: ['http://localhost:6274/callback'],
			token_endpoint_auth_method: 'none'
		},
		tokens: {
			access_token: access,
			token_type: 'Bearer',
			...(refresh ? { refresh_token: 'fixture-refresh' } : {}),
			issuer: 'https://mcp.idealo.com'
		},
		calls
	});
}

function json(value: unknown, status = 200): TIdealoNativeResponse {
	return {
		status,
		statusText: status === 201 ? 'Created' : 'OK',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify(value)
	};
}

function toolPayload(name: string): Record<string, unknown> {
	if (name === 'search_products')
		return {
			query: 'fixture pump',
			results: [
				{
					productRef: 'opaque-fixture-reference',
					itemType: 'PRODUCT',
					name: 'Fixture Pump 12V',
					price: '149,00 €',
					url: 'https://www.idealo.de/preisvergleich/OffersOfProduct/123456.html',
					imageUrl: 'https://cdn.idealo.com/fixture.png'
				}
			]
		};
	if (name === 'get_product_details')
		return {
			name: 'Fixture Pump 12V',
			url: 'https://www.idealo.de/preisvergleich/OffersOfProduct/123456.html',
			offers: []
		};
	if (name === 'get_product_offers')
		return {
			nextOffset: 0,
			offers: [
				{
					relocatorUrl: 'https://example.com/fixture-pump',
					price: '149,00 €',
					minShippingCost: '5,90 €',
					shop: { name: 'Fixture Shop' },
					freshness: '1h'
				}
			]
		};
	return {
		priceTrend: {
			history: [{ dateTimeISO: '2026-10-30T00:00:00.000Z', price: '159,00 €' }],
			statistics: { minPrice: '149,00 €' },
			periodDays: 30
		}
	};
}

function must<T>(value: T | null | undefined): T {
	if (value == null) throw new Error('Fixture value was not produced');
	return value;
}
