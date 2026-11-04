import { isTauri } from '@tauri-apps/api/core';
import { createState } from 'feature-state';
import { host, specta } from '@/environment';
import type { StudioCx } from '@/modules/studio/StudioCx';
import { runTool, type TToolReply } from './mcp-tools';

/**
 * The app's end of `midimarble mcp`. The host forwards tool calls from its socket as events; they run one at a time
 * against the open project, as the person's own commands do, and the reply goes back to the host.
 */
export class McpCx {
	/** Enable MCP in the Help menu */
	readonly $isEnabled = createState(false);
	/** A pointer is down in the window: the person is mid-gesture, so an edit waits */
	isPointerDown = false;

	private queue: Promise<void> = Promise.resolve();

	constructor(private readonly studio: StudioCx) {}

	mount(): () => void {
		if (!isTauri()) return () => undefined;
		let isMounted = true;
		let stopEvent: (() => void) | null = null;
		void specta.commands.mcpStatus().then((status) => this.$isEnabled.set(status.isEnabled));
		void specta.events.mcpRequestEvent
			.listen((event) => this.enqueue(event.payload))
			.then((stop) => {
				if (isMounted) stopEvent = stop;
				else stop();
				void specta.commands.mcpFrontEndReady();
			});
		const press = (): void => {
			this.isPointerDown = true;
		};
		const release = (): void => {
			this.isPointerDown = false;
		};
		window.addEventListener('pointerdown', press, true);
		window.addEventListener('pointerup', release, true);
		window.addEventListener('pointercancel', release, true);
		return () => {
			isMounted = false;
			stopEvent?.();
			window.removeEventListener('pointerdown', press, true);
			window.removeEventListener('pointerup', release, true);
			window.removeEventListener('pointercancel', release, true);
		};
	}

	async setEnabled(isEnabled: boolean): Promise<void> {
		const result = await specta.commands.mcpSetEnabled(isEnabled);
		if (result.status === 'error') {
			this.studio.notify(`MCP couldn't ${isEnabled ? 'start' : 'stop'}: ${result.error}`, 'error');
			return;
		}
		this.$isEnabled.set(result.data.isEnabled);
		this.studio.notify(isEnabled ? 'MCP is on: AI apps on this Mac can use MidiMarble while it is open' : 'MCP is off');
	}

	/** Show AI Workspace: writes the folder for this app and shows it in Finder */
	async showWorkspace(): Promise<void> {
		const result = await specta.commands.mcpWriteWorkspace();
		if (result.status === 'error') {
			this.studio.notify(`The AI Workspace couldn't be written: ${result.error}`, 'error');
			return;
		}
		const [isShownOk, shownErr] = await host.revealInFinder(result.data);
		if (!isShownOk) this.studio.notify(shownErr.message, 'error');
	}

	private enqueue(request: specta.McpRequestEvent): void {
		const respond = async (): Promise<void> => {
			const reply = await this.answer(request);
			const sent = await specta.commands.mcpRespond(request.requestId, JSON.stringify(reply));
			if (sent.status === 'error' && import.meta.env.DEV) console.warn('[mcp]', sent.error);
		};
		// Reading the state and stopping a build answer while a long call, such as Build Track, is still running
		if (answersAtOnce(request)) void respond();
		else this.queue = this.queue.then(respond);
	}

	private async answer(request: specta.McpRequestEvent): Promise<TToolReply> {
		let args: unknown;
		try {
			args = JSON.parse(request.argumentsJson);
		} catch {
			args = {};
		}
		return runTool(this.studio, request.tool, args);
	}
}

function answersAtOnce(request: specta.McpRequestEvent): boolean {
	if (request.tool === 'get_state') return true;
	return request.tool === 'run_command' && /"id"\s*:\s*"build\.stop"/.test(request.argumentsJson);
}
