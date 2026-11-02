import { invoke, isTauri } from '@tauri-apps/api/core';

/** Restricted native fetch for Idealo's official MCP and OAuth endpoints. */
export async function requestIdealo(request: TIdealoNativeRequest): Promise<TIdealoNativeResponse> {
	requireDesktop();
	return invoke<TIdealoNativeResponse>('request_idealo', { request });
}

/** The returned JSON is an OAuth bundle stored in the operating system credential store. */
export async function readIdealoCredentials(): Promise<string | null> {
	requireDesktop();
	return invoke<string | null>('read_idealo_credentials');
}

export async function saveIdealoCredentials(content: string): Promise<void> {
	requireDesktop();
	await invoke('save_idealo_credentials', { content });
}

export async function clearIdealoCredentials(): Promise<void> {
	requireDesktop();
	await invoke('clear_idealo_credentials');
}

/** Starts Idealo’s permitted localhost:6274 callback before the caller opens authorization. */
export async function startIdealoAuth(): Promise<TIdealoAuthFlow> {
	requireDesktop();
	return invoke<TIdealoAuthFlow>('start_idealo_auth');
}

export async function waitIdealoAuth(flowId: string): Promise<TIdealoAuthResult> {
	requireDesktop();
	return invoke<TIdealoAuthResult>('wait_idealo_auth', { flowId });
}

export async function cancelIdealoAuth(flowId: string): Promise<void> {
	requireDesktop();
	await invoke('cancel_idealo_auth', { flowId });
}

export interface TIdealoNativeRequest {
	url: string;
	method: 'GET' | 'POST' | 'DELETE';
	headers: Record<string, string>;
	body?: string;
}

export interface TIdealoNativeResponse {
	status: number;
	statusText: string;
	headers: Record<string, string>;
	body: string;
}

export interface TIdealoAuthFlow {
	flowId: string;
	redirectUrl: string;
	state: string;
}

export type TIdealoAuthResult = { code: string } | { error: string };

function requireDesktop(): void {
	if (!isTauri()) throw new Error('Idealo connections are available in the Yadori desktop app.');
}
