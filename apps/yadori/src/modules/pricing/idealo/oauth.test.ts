import { describe, expect, it, vi } from 'vitest';
import { IdealoCredentialStore } from './oauth';
import type { TIdealoDependencies } from './types';

describe('IdealoCredentialStore', () => {
	it('should ignore a stale keychain read that finishes after credentials were cleared', async () => {
		let finishRead: ((value: string) => void) | undefined;
		const read = new Promise<string>((resolve) => {
			finishRead = resolve;
		});
		const dependencies: TIdealoDependencies = {
			isDesktop: () => true,
			request: async () => ({ status: 200, statusText: 'OK', headers: {}, body: '' }),
			readCredentials: vi.fn(() => read),
			saveCredentials: vi.fn(async () => undefined),
			clearCredentials: vi.fn(async () => undefined),
			startAuth: async () => ({
				flowId: 'unused',
				redirectUrl: 'http://127.0.0.1/callback',
				state: 'unused'
			}),
			waitAuth: async () => ({ error: 'unused' }),
			cancelAuth: async () => undefined,
			openAuthorization: async () => undefined
		};
		const store = new IdealoCredentialStore(dependencies);
		const loading = store.load();
		await store.clear();
		if (finishRead == null) throw new Error('Read fixture did not initialize');
		finishRead(
			JSON.stringify({
				version: 1,
				tokens: {
					access_token: 'old-fixture-token',
					token_type: 'Bearer',
					issuer: 'https://mcp.idealo.com'
				},
				calls: []
			})
		);
		await loading;
		expect(store.bundle.tokens).toBeUndefined();
		expect(dependencies.clearCredentials).toHaveBeenCalledOnce();
		expect(dependencies.saveCredentials).not.toHaveBeenCalled();
	});
});
