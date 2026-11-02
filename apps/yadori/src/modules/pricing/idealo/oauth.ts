import type {
	OAuthClientProvider,
	OAuthDiscoveryState
} from '@modelcontextprotocol/sdk/client/auth.js';
import {
	OAuthClientInformationFullSchema,
	OAuthClientInformationSchema,
	OAuthTokensSchema,
	type OAuthClientInformationMixed,
	type OAuthClientMetadata,
	type OAuthTokens
} from '@modelcontextprotocol/sdk/shared/auth.js';
import type { TIdealoAuthFlow } from '../../../environment/desktop/idealo';
import { IdealoError, type TIdealoDependencies } from './types';

export class IdealoCredentialStore {
	private value: TIdealoCredentialBundle = { version: 1, calls: [] };
	private writes: Promise<void> = Promise.resolve();
	private loaded = false;
	private loading: Promise<void> | undefined;
	private generation = 0;

	constructor(private readonly dependencies: TIdealoDependencies) {}

	async load(): Promise<void> {
		if (this.loaded) return;
		if (this.loading != null) return this.loading;
		const task = this.loadValue();
		this.loading = task;
		try {
			await task;
		} finally {
			if (this.loading === task) this.loading = undefined;
		}
	}

	private async loadValue(): Promise<void> {
		const generation = this.generation;
		try {
			const content = await this.dependencies.readCredentials();
			if (generation !== this.generation) return;
			if (content != null) this.value = parseCredentialBundle(content);
			this.loaded = true;
		} catch {
			if (generation !== this.generation) return;
			throw new IdealoError(
				'storage_error',
				'The operating system could not read the saved Idealo connection. Disconnect and reconnect to reset it.'
			);
		}
	}

	get bundle(): TIdealoCredentialBundle {
		return this.value;
	}

	async update(change: Partial<TIdealoCredentialBundle>): Promise<void> {
		this.value = { ...this.value, ...change };
		const content = JSON.stringify(this.value);
		this.writes = this.writes
			.catch(() => undefined)
			.then(() => this.dependencies.saveCredentials(content));
		try {
			await this.writes;
		} catch {
			throw new IdealoError(
				'storage_error',
				'The operating system could not save the Idealo connection.'
			);
		}
	}

	async clear(): Promise<void> {
		this.generation++;
		this.value = { version: 1, calls: this.value.calls };
		this.loaded = true;
		this.writes = this.writes
			.catch(() => undefined)
			.then(() => this.dependencies.clearCredentials());
		try {
			await this.writes;
		} catch {
			throw new IdealoError(
				'storage_error',
				'The operating system could not remove the Idealo connection.'
			);
		}
	}
}

/** One OAuth session. Browser authorization is permitted only during explicit Connect. */
export class IdealoOAuthProvider implements OAuthClientProvider {
	private verifier: string | undefined;
	private flow: TIdealoAuthFlow | undefined;
	private interactive = false;
	redirected = false;

	constructor(
		private readonly store: IdealoCredentialStore,
		private readonly dependencies: TIdealoDependencies,
		private readonly signal: AbortSignal,
		private readonly onAuthorizing: () => void
	) {}

	begin(flow: TIdealoAuthFlow): void {
		this.flow = flow;
		this.interactive = true;
		this.redirected = false;
	}
	end(): void {
		this.flow = undefined;
		this.interactive = false;
		this.verifier = undefined;
	}
	get allowsRegistration(): boolean {
		return this.interactive && !this.signal.aborted;
	}
	get redirectUrl(): string {
		return (
			this.flow?.redirectUrl ?? this.store.bundle.redirectUrl ?? 'http://localhost:6274/callback'
		);
	}
	get clientMetadata(): OAuthClientMetadata {
		return {
			client_name: 'Yadori',
			redirect_uris: [this.redirectUrl],
			token_endpoint_auth_method: 'none',
			grant_types: ['authorization_code', 'refresh_token'],
			response_types: ['code']
		};
	}
	state(): string {
		this.assertInteractive();
		const flow = this.flow;
		if (flow == null) throw new IdealoError('auth_required', 'Restart Idealo authorization.');
		return flow.state;
	}
	clientInformation(): OAuthClientInformationMixed | undefined {
		const information = this.store.bundle.clientInformation;
		if (information == null && !this.interactive) this.assertInteractive();
		return information;
	}
	async saveClientInformation(clientInformation: OAuthClientInformationMixed): Promise<void> {
		this.assertActive();
		await this.store.update({ clientInformation, redirectUrl: this.redirectUrl });
	}
	tokens(): OAuthTokens | undefined {
		return this.store.bundle.tokens;
	}
	async saveTokens(tokens: OAuthTokens): Promise<void> {
		this.assertActive();
		await this.store.update({ tokens });
	}
	async redirectToAuthorization(url: URL): Promise<void> {
		this.assertInteractive();
		if (url.origin !== 'https://mcp.idealo.com' || url.pathname !== '/oauth2/authorize') {
			throw new IdealoError(
				'remote_error',
				'Idealo supplied an unsupported authorization address.'
			);
		}
		const information = this.store.bundle.clientInformation;
		if (
			information != null &&
			'redirect_uris' in information &&
			!information.redirect_uris.includes(this.redirectUrl)
		) {
			// A new native listener has a new loopback port. Re-register before opening
			// an authorization URL tied to an older exact redirect URI.
			throw new IdealoRegistrationRenewal();
		}
		this.redirected = true;
		this.onAuthorizing();
		await this.dependencies.openAuthorization(url.href);
	}
	saveCodeVerifier(verifier: string): void {
		this.assertInteractive();
		this.verifier = verifier;
	}
	codeVerifier(): string {
		this.assertActive();
		if (this.verifier == null)
			throw new IdealoError(
				'auth_required',
				'Restart the Idealo connection to continue authorization.'
			);
		return this.verifier;
	}
	async invalidateCredentials(
		scope: 'all' | 'client' | 'tokens' | 'verifier' | 'discovery'
	): Promise<void> {
		this.assertActive();
		if (scope === 'all' || scope === 'verifier') this.verifier = undefined;
		const change: Partial<TIdealoCredentialBundle> = {};
		if (scope === 'all' || scope === 'client') change.clientInformation = undefined;
		if (scope === 'all' || scope === 'tokens') change.tokens = undefined;
		if (scope === 'all' || scope === 'discovery') change.discovery = undefined;
		await this.store.update(change);
	}
	discoveryState(): OAuthDiscoveryState | undefined {
		return this.store.bundle.discovery;
	}
	async saveDiscoveryState(discovery: OAuthDiscoveryState): Promise<void> {
		this.assertActive();
		if (new URL(discovery.authorizationServerUrl).origin !== 'https://mcp.idealo.com') {
			throw new IdealoError(
				'remote_error',
				'Idealo authorization discovery returned an unsupported issuer.'
			);
		}
		await this.store.update({ discovery });
	}
	private assertActive(): void {
		if (this.signal.aborted) throw new IdealoError('cancelled', 'Idealo connection cancelled.');
	}
	private assertInteractive(): void {
		this.assertActive();
		if (!this.interactive || this.flow == null)
			throw new IdealoError('auth_required', 'Choose Connect Idealo to sign in again.');
	}
}

export class IdealoRegistrationRenewal extends Error {}

interface TIdealoCredentialBundle {
	version: 1;
	clientInformation?: OAuthClientInformationMixed | undefined;
	tokens?: OAuthTokens | undefined;
	discovery?: OAuthDiscoveryState | undefined;
	redirectUrl?: string | undefined;
	calls: number[];
}

function parseCredentialBundle(content: string): TIdealoCredentialBundle {
	const raw: unknown = JSON.parse(content);
	if (raw == null || typeof raw !== 'object' || Array.isArray(raw))
		throw new Error('Invalid credential bundle');
	const object = raw as Record<string, unknown>;
	if (object['version'] !== 1) throw new Error('Unsupported credential bundle');
	const value: TIdealoCredentialBundle = { version: 1, calls: [] };
	if (object['tokens'] != null) value.tokens = OAuthTokensSchema.parse(object['tokens']);
	if (object['clientInformation'] != null) {
		const full = OAuthClientInformationFullSchema.safeParse(object['clientInformation']);
		value.clientInformation = full.success
			? full.data
			: OAuthClientInformationSchema.parse(object['clientInformation']);
	}
	for (const issuer of [value.tokens?.issuer, value.clientInformation?.issuer]) {
		if (issuer != null && new URL(issuer).origin !== 'https://mcp.idealo.com')
			throw new Error('Unsupported credential issuer');
	}
	if (typeof object['redirectUrl'] === 'string') {
		const redirect = new URL(object['redirectUrl']);
		if (redirect.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(redirect.hostname))
			throw new Error('Invalid loopback redirect');
		value.redirectUrl = redirect.href;
	}
	// Discovery metadata is re-fetched after process restart rather than trusting saved endpoints.
	if (Array.isArray(object['calls'])) {
		value.calls = object['calls']
			.filter(
				(call): call is number => typeof call === 'number' && Number.isFinite(call) && call >= 0
			)
			.slice(-500);
	}
	return value;
}
