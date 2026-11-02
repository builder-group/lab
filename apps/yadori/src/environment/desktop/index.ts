import { invoke, isTauri } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';

export interface TProjectRecord {
	recoveryError?: string;
	id: string;
	name: string;
	revision: number;
	updatedAt: string;
}
export interface TProjectFile extends TProjectRecord {
	content: string;
	path: string;
}
export interface TNativeAsset {
	id: string;
	name: string;
	mediaType: string;
	relativePath: string;
}
export interface TAgentProposal {
	id: string;
	projectId: string;
	baseRevision: number;
	summary: string;
	commands: unknown[];
	createdAt: string;
}
export interface TAgentJob {
	id: string;
	projectId: string;
	state: 'running' | 'completed' | 'failed' | 'cancelled';
	detail: string;
	proposalId: string | null;
}
export interface TAgentEvent {
	jobId: string;
	kind: 'status' | 'progress';
	message: string;
	job?: TAgentJob;
}
export interface TAgentCapabilities {
	codexPath: string | null;
	executable: string;
	dataRoot: string;
	mcpArgs: string[];
}
export function isDesktop(): boolean {
	return isTauri();
}
export async function listProjects(): Promise<TProjectRecord[]> {
	return invoke('list_projects');
}
export async function createProject(content: string): Promise<TProjectFile> {
	return invoke('create_project', { content });
}
export async function openProject(projectId: string): Promise<TProjectFile> {
	return invoke('open_project', { projectId });
}
export async function saveProject(
	projectId: string,
	content: string,
	expectedRevision: number
): Promise<TProjectFile> {
	return invoke('save_project', { projectId, content, expectedRevision });
}
export async function exportProject(projectId: string, content?: string): Promise<string | null> {
	return invoke('export_project', { projectId, content });
}
/** Imports as a separate managed project. Native validates the envelope; callers validate the full domain before use. */
export async function importProject(): Promise<TProjectFile | null> {
	return invoke('import_project');
}
export async function addProjectAsset(projectId: string): Promise<TNativeAsset | null> {
	return invoke('add_project_asset', { projectId });
}
export async function readProjectAsset(projectId: string, relativePath: string): Promise<string> {
	return invoke('read_project_asset', { projectId, relativePath });
}
export async function listAgentProposals(projectId: string): Promise<TAgentProposal[]> {
	return invoke('list_agent_proposals', { projectId });
}
export async function dismissAgentProposal(projectId: string, proposalId: string): Promise<void> {
	return invoke('dismiss_agent_proposal', { projectId, proposalId });
}
export async function agentCapabilities(): Promise<TAgentCapabilities> {
	return invoke('agent_capabilities');
}
export async function startAgentJob(
	projectId: string,
	baseRevision: number,
	prompt: string
): Promise<TAgentJob> {
	return invoke('start_agent_job', { projectId, baseRevision, prompt });
}
export async function getAgentJob(jobId: string): Promise<TAgentJob> {
	return invoke('get_agent_job', { jobId });
}
export async function cancelAgentJob(jobId: string): Promise<void> {
	return invoke('cancel_agent_job', { jobId });
}
export async function subscribeAgentEvents(
	onEvent: (event: TAgentEvent) => void
): Promise<() => void> {
	return listen<TAgentEvent>('agent-event', (event) => onEvent(event.payload));
}
export async function registerDesktopCloseGuard(
	flush: () => Promise<boolean>
): Promise<() => void> {
	const window = getCurrentWindow();
	const guardId = crypto.randomUUID();
	let busy = false;
	let disposed = false;
	let quitting = false;
	async function request(quit: boolean): Promise<void> {
		quitting ||= quit;
		if (busy || disposed) return;
		busy = true;
		try {
			if (typeof document !== 'undefined' && document.activeElement instanceof HTMLElement)
				document.activeElement.blur();
			const safe = await flush();
			if (safe && !disposed) {
				if (quitting) await invoke('approve_desktop_exit');
				else await window.destroy();
			} else if (quitting) await invoke('reject_desktop_exit');
		} catch {
			if (quitting) await invoke('reject_desktop_exit').catch(() => undefined);
		} finally {
			busy = false;
			quitting = false;
		}
	}
	const unlistenClose = await window.onCloseRequested((event) => {
		event.preventDefault();
		void request(false);
	});
	let unlistenQuit: (() => void) | null = null;
	try {
		unlistenQuit = await listen('desktop-quit-requested', () => {
			void request(true);
		});
		await invoke('register_desktop_quit_guard', { guardId });
	} catch (error) {
		unlistenClose();
		unlistenQuit?.();
		throw error;
	}
	return () => {
		disposed = true;
		unlistenClose();
		unlistenQuit?.();
		void invoke('unregister_desktop_quit_guard', { guardId }).catch(() => undefined);
	};
}

export async function writeProjectAsset(
	projectId: string,
	asset: { id?: string; name: string; mediaType: string; dataBase64: string }
): Promise<TNativeAsset> {
	return invoke('write_project_asset', { projectId, asset });
}

export async function openProjectAsset(projectId: string, relativePath: string): Promise<void> {
	await invoke('open_project_asset', { projectId, relativePath });
}
