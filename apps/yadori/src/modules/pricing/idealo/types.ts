import type {
	TIdealoAuthFlow,
	TIdealoAuthResult,
	TIdealoNativeRequest,
	TIdealoNativeResponse
} from '../../../environment/desktop/idealo';

export type TIdealoCountry = 'DE' | 'AT' | 'GB' | 'FR' | 'IT' | 'ES';
export type TIdealoItemType = 'PRODUCT' | 'CLUSTER' | 'SINGLE_OFFER';

export interface TIdealoProduct {
	/** Short-lived reference, kept only in memory and passed back unchanged. */
	productRef: string;
	name: string;
	url: string;
	price?: string;
	imageUrl?: string;
	type: TIdealoItemType;
}

export interface TIdealoSearchResult {
	query: string;
	results: TIdealoProduct[];
	searchResultsUrl?: string;
	raw: Record<string, unknown>;
}

export interface TIdealoProductOptions {
	country?: TIdealoCountry;
	type?: TIdealoItemType;
	offset?: number;
	signal?: AbortSignal;
}

export interface TIdealoStatus {
	state: 'disconnected' | 'ready' | 'connecting' | 'authorizing' | 'connected' | 'error';
	message: string;
	/** Conservative local allowance; the service's account-wide quota is authoritative. */
	callsRemaining: number;
}

export interface TIdealoProviderOptions {
	onStatusChange?: (status: TIdealoStatus) => void;
	/** Injectable boundary for deterministic tests. Production uses the native bridge. */
	dependencies?: TIdealoDependencies;
}

export interface TIdealoDependencies {
	isDesktop(): boolean;
	request(request: TIdealoNativeRequest): Promise<TIdealoNativeResponse>;
	readCredentials(): Promise<string | null>;
	saveCredentials(content: string): Promise<void>;
	clearCredentials(): Promise<void>;
	startAuth(): Promise<TIdealoAuthFlow>;
	waitAuth(flowId: string): Promise<TIdealoAuthResult>;
	cancelAuth(flowId: string): Promise<void>;
	openAuthorization(url: string): Promise<void>;
	now?: () => number;
	requestIntervalMs?: number;
	requestTimeoutMs?: number;
	authTimeoutMs?: number;
}

export type TIdealoErrorCode =
	| 'desktop_required'
	| 'auth_required'
	| 'cancelled'
	| 'timeout'
	| 'rate_limit'
	| 'remote_error'
	| 'invalid_response'
	| 'storage_error';

export class IdealoError extends Error {
	constructor(
		public readonly code: TIdealoErrorCode,
		message: string
	) {
		super(message);
		this.name = 'IdealoError';
	}
}
