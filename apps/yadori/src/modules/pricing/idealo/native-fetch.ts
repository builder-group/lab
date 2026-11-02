import type { FetchLike } from '@modelcontextprotocol/sdk/shared/transport.js';
import { IdealoError, type TIdealoDependencies } from './types';

/** The SDK receives ordinary Fetch responses, including finite POST SSE bodies. */
export function createIdealoFetch(
	dependencies: TIdealoDependencies,
	currentSignal: () => AbortSignal | undefined,
	allowRegistration: () => boolean
): FetchLike {
	return async (input, init) => {
		const request = new Request(input, init);
		const url = new URL(request.url);
		if (url.origin !== 'https://mcp.idealo.com') {
			throw new IdealoError('remote_error', 'Idealo returned an unsupported service endpoint.');
		}
		// Native IPC buffers responses. Optional server-push GET streams are unsupported;
		// tool POST responses still support the SDK's JSON and finite SSE formats.
		if (request.method === 'GET' && url.pathname === '/mcp') {
			return new Response(null, { status: 405, statusText: 'Server-push stream not used' });
		}
		if (url.pathname === '/oauth2/register' && !allowRegistration()) {
			throw new IdealoError(
				'auth_required',
				'Choose Connect Idealo to authorize this desktop app.'
			);
		}
		const method = request.method;
		if (method !== 'GET' && method !== 'POST' && method !== 'DELETE') {
			throw new IdealoError('remote_error', 'Unsupported Idealo request method.');
		}
		const headers: Record<string, string> = {};
		request.headers.forEach((value, key) => {
			headers[key] = value;
		});
		const body = method === 'POST' ? await request.text() : undefined;
		const signal = currentSignal();
		if (request.signal.aborted || signal?.aborted) {
			throw new IdealoError('cancelled', 'Idealo request cancelled.');
		}
		const response = await interruptible(
			dependencies.request({
				url: request.url,
				method,
				headers,
				...(body == null ? {} : { body })
			}),
			[request.signal, signal],
			dependencies.requestTimeoutMs ?? 30_000
		);
		if (response.status === 429) {
			throw new IdealoError('rate_limit', 'Idealo has reached a request limit. Try again later.');
		}
		const result = new Response([204, 205, 304].includes(response.status) ? null : response.body, {
			status: response.status,
			statusText: response.statusText,
			headers: response.headers
		});
		Object.defineProperty(result, 'url', { value: request.url });
		return result;
	};
}

/** Cancellation stops waiting and drops late native results; Rust has its own HTTP timeout. */
export async function interruptible<T>(
	promise: Promise<T>,
	signals: Array<AbortSignal | undefined>,
	timeoutMs: number
): Promise<T> {
	const activeSignals = signals.filter((signal): signal is AbortSignal => signal != null);
	if (activeSignals.some((signal) => signal.aborted)) {
		throw new IdealoError('cancelled', 'Idealo request cancelled.');
	}
	return new Promise<T>((resolve, reject) => {
		function abort(): void {
			finish();
			reject(new IdealoError('cancelled', 'Idealo request cancelled.'));
		}
		function finish(): void {
			clearTimeout(timer);
			for (const signal of activeSignals) signal.removeEventListener('abort', abort);
		}
		const timer = setTimeout(() => {
			finish();
			reject(new IdealoError('timeout', 'Idealo did not respond in time. Try again.'));
		}, timeoutMs);
		for (const signal of activeSignals) signal.addEventListener('abort', abort, { once: true });
		promise.then(
			(value) => {
				finish();
				resolve(value);
			},
			(error: unknown) => {
				finish();
				reject(error);
			}
		);
	});
}
