import { describe, expect, it, vi } from 'vitest';
import { createIdealoFetch } from './native-fetch';
import type { TIdealoDependencies } from './types';

describe('createIdealoFetch function', () => {
	it('should reject cross-origin endpoints and silent dynamic registration before native dispatch', async () => {
		const dependencies = fixtureDependencies();
		const fetch = createIdealoFetch(
			dependencies,
			() => undefined,
			() => false
		);
		await expect(fetch('https://other.example/oauth/token')).rejects.toMatchObject({
			code: 'remote_error'
		});
		await expect(
			fetch('https://mcp.idealo.com/oauth2/register', { method: 'POST', body: '{}' })
		).rejects.toMatchObject({ code: 'auth_required' });
		expect(dependencies.request).not.toHaveBeenCalled();
	});

	it('should not dispatch a request that is already cancelled', async () => {
		const dependencies = fixtureDependencies();
		const controller = new AbortController();
		controller.abort();
		const fetch = createIdealoFetch(
			dependencies,
			() => controller.signal,
			() => true
		);
		await expect(
			fetch('https://mcp.idealo.com/mcp', { method: 'POST', body: '{}' })
		).rejects.toMatchObject({ code: 'cancelled' });
		expect(dependencies.request).not.toHaveBeenCalled();
	});

	it('should decline optional long-lived GET SSE and redact rate-limit response bodies', async () => {
		const dependencies = fixtureDependencies();
		const fetch = createIdealoFetch(
			dependencies,
			() => undefined,
			() => true
		);
		expect((await fetch('https://mcp.idealo.com/mcp')).status).toBe(405);
		expect(dependencies.request).not.toHaveBeenCalled();
		dependencies.request = vi.fn(async () => ({
			status: 429,
			statusText: 'Too many requests',
			headers: {},
			body: 'private response body'
		}));
		await expect(
			fetch('https://mcp.idealo.com/mcp', { method: 'POST', body: '{}' })
		).rejects.toMatchObject({
			code: 'rate_limit',
			message: 'Idealo has reached a request limit. Try again later.'
		});
	});
});

function fixtureDependencies(): TIdealoDependencies {
	return {
		isDesktop: () => true,
		request: vi.fn(async () => ({ status: 200, statusText: 'OK', headers: {}, body: '{}' })),
		readCredentials: async () => null,
		saveCredentials: async () => undefined,
		clearCredentials: async () => undefined,
		startAuth: async () => ({
			flowId: 'unused',
			redirectUrl: 'http://127.0.0.1:12345/callback',
			state: 'fixture'
		}),
		waitAuth: async () => ({ error: 'not-started' }),
		cancelAuth: async () => undefined,
		openAuthorization: async () => undefined
	};
}
