import { isTauri } from '@tauri-apps/api/core';
import { createState } from 'feature-state';
import { specta } from '@/environment';
import { commands as registry } from '@/modules/studio/commands';
import type { StudioCx } from '@/modules/studio/StudioCx';
import { COMMAND_COPIED_NOTICE, connectedNotice, disconnectedNotice, SERVER_COMMAND_COPIED_NOTICE, type TAgentTool } from './agent-connect';
import { presenceLabel, touchedKeys } from './agent-presence';
import { AgentPresenceCx } from './AgentPresenceCx';
import { runTool, type TToolReply } from './mcp-tools';

const STOPPED_WORDS = 'The person pressed Stop. What was done stays in the project. Tell them where things stand and wait for them before going on.';

/**
 * The app's end of `midimarble mcp`. The host forwards tool calls from its socket as events; they run one at a time
 * against the open project, as the person's own commands do, and the reply goes back to the host.
 */
export class McpCx {
	/** Enable MCP in the Help menu */
	readonly $isEnabled = createState(false);
	/** What each connected agent calls itself, from MCP's `initialize` */
	readonly $clients = createState<readonly string[]>([]);
	/** Whether each agent tool's config lists this app, for the Connect rows */
	readonly $connections = createState<specta.McpConnectionsDto>({ claude: false, codex: false });
	/** The tool whose own command is running; the rows wait for it */
	readonly $connecting = createState<TAgentTool | null>(null);
	/** The agent at work, for the canvas's pill and the Agent button */
	readonly presence = new AgentPresenceCx();
	/** A pointer is down in the window: the person is mid-gesture, so an edit waits */
	isPointerDown = false;

	private queue: Promise<void> = Promise.resolve();
	private runningTools: string[] = [];

	constructor(private readonly studio: StudioCx) {}

	mount(): () => void {
		if (!isTauri()) return () => undefined;
		let isMounted = true;
		let stopEvent: (() => void) | null = null;
		let stopClients: (() => void) | null = null;
		const stopWatching = this.watchEdits();
		void this.refreshConnections();
		void specta.events.mcpClientsEvent
			.listen((event) => this.$clients.set(event.payload.clients))
			.then((stop) => {
				if (isMounted) stopClients = stop;
				else stop();
				// Asked once listening, so no client joining meanwhile is missed
				return specta.commands.mcpStatus();
			})
			.then((status) => {
				this.$isEnabled.set(status.isEnabled);
				this.$clients.set(status.clients);
			});
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
			stopClients?.();
			stopWatching();
			this.presence.dispose();
			window.removeEventListener('pointerdown', press, true);
			window.removeEventListener('pointerup', release, true);
			window.removeEventListener('pointercancel', release, true);
		};
	}

	async setEnabled(isEnabled: boolean): Promise<void> {
		if (await this.applyEnabled(isEnabled)) this.studio.notify(isEnabled ? 'MCP is on: AI apps on this Mac can use MidiMarble while it is open' : 'MCP is off');
	}

	private async applyEnabled(isEnabled: boolean): Promise<boolean> {
		const result = await specta.commands.mcpSetEnabled(isEnabled);
		if (result.status === 'error') {
			this.studio.notify(`MCP couldn't ${isEnabled ? 'start' : 'stop'}: ${result.error}`, 'error');
			return false;
		}
		this.$isEnabled.set(result.data.isEnabled);
		this.$clients.set(result.data.clients);
		return true;
	}

	/** Reads who lists this app; never waits on an agent tool, since it only reads their config files */
	async refreshConnections(): Promise<void> {
		if (!isTauri()) return;
		const result = await specta.commands.mcpConnections();
		if (result.status === 'ok') this.$connections.set(result.data);
	}

	/** Connect or Disconnect, whichever the row reads. A stale path reads as not connected, so Connect fixes it. */
	async toggleConnection(tool: TAgentTool): Promise<void> {
		if (this.$connecting.get() != null) return;
		const isConnected = this.$connections.get()[tool];
		this.$connecting.set(tool);
		try {
			if (isConnected) await this.disconnect(tool);
			else await this.connect(tool);
		} finally {
			this.$connecting.set(null);
			await this.refreshConnections();
		}
	}

	/** Copy Command for Other Apps */
	async copyServerCommand(): Promise<void> {
		const result = await specta.commands.mcpCopyServerCommand();
		if (result.status === 'error') this.studio.notify(result.error, 'error');
		else this.studio.notify(SERVER_COMMAND_COPIED_NOTICE);
	}

	private async connect(tool: TAgentTool): Promise<void> {
		const result = await specta.commands.mcpConnect(tool);
		if (result.status === 'error') {
			this.studio.notify(result.error, 'error');
			return;
		}
		// A command someone pastes needs MCP on just the same. The one notice says what's next, so turning it on stays quiet.
		if (!(await this.applyEnabled(true))) return;
		this.studio.notify(result.data === 'copied' ? COMMAND_COPIED_NOTICE : connectedNotice(tool));
	}

	private async disconnect(tool: TAgentTool): Promise<void> {
		const result = await specta.commands.mcpDisconnect(tool);
		if (result.status === 'error') this.studio.notify(result.error, 'error');
		else this.studio.notify(result.data === 'copied' ? COMMAND_COPIED_NOTICE : disconnectedNotice(tool));
	}

	/**
	 * Stop on the pill: ends what the agent's running call can end and keeps what's done. A Build Track or Fix stops
	 * between its steps and an export is cancelled; a frame already rendering finishes. The call's reply says the person
	 * stopped it, and calls waiting behind it are turned away. A person's own Build Track is theirs to stop.
	 */
	stop(): void {
		this.presence.requestStop();
		if (this.studio.isInAgentStep) {
			this.studio.$compose.get()?.assist.stopBuild();
			this.studio.$compose.get()?.patterns.stop();
		}
		if (this.runningTools.includes('export_film')) this.studio.film.cancel();
	}

	/** Marks what an agent's call changes, edit by edit, so a Build Track's pieces light up as they land */
	watchEdits(): () => void {
		let before = this.studio.project;
		return this.studio.$history.listen(({ value }) => {
			const present = value?.present ?? null;
			if (present != null && before != null && present !== before && present.id === before.id && this.studio.isInAgentStep) this.presence.touch(touchedKeys(before, present));
			before = present;
		});
	}

	private enqueue(request: specta.McpRequestEvent): void {
		const arrival = { epoch: this.presence.stopEpoch, isStopHeld: this.presence.isStopHeld };
		const respond = async (): Promise<void> => {
			const reply = await this.answer(request, arrival);
			const sent = await specta.commands.mcpRespond(request.requestId, JSON.stringify(reply));
			if (sent.status === 'error' && import.meta.env.DEV) console.warn('[mcp]', sent.error);
		};
		// Reading the state and stopping a build answer while a long call, such as Build Track, is still running
		if (answersAtOnce(request)) void respond();
		else this.queue = this.queue.then(respond);
	}

	/** Runs one call with the pill up, unless Stop came after it arrived. `arrival` is how things stood when it came in. */
	async answer(request: Pick<specta.McpRequestEvent, 'tool' | 'argumentsJson'>, arrival: { epoch: number; isStopHeld: boolean }): Promise<TToolReply> {
		let args: unknown;
		try {
			args = JSON.parse(request.argumentsJson);
		} catch {
			args = {};
		}
		const label = presenceLabel(request.tool, args, (id) => registry.find((command) => command.id === id)?.title ?? null);
		if (label == null) return runTool(this.studio, request.tool, args);
		const packagePath = this.studio.$path.get();
		if (arrival.isStopHeld || arrival.epoch !== this.presence.stopEpoch) return { content: [{ type: 'text', text: STOPPED_WORDS }], isError: true, packagePath };

		const epoch = this.presence.stopEpoch;
		const end = this.presence.begin(label);
		this.runningTools.push(request.tool);
		try {
			const reply = await runTool(this.studio, request.tool, args);
			return this.presence.stopEpoch === epoch ? reply : { ...reply, content: [...reply.content, { type: 'text', text: STOPPED_WORDS }] };
		} finally {
			this.runningTools.splice(this.runningTools.indexOf(request.tool), 1);
			end();
		}
	}
}

function answersAtOnce(request: specta.McpRequestEvent): boolean {
	if (request.tool === 'get_state') return true;
	return request.tool === 'run_command' && /"id"\s*:\s*"build\.stop"/.test(request.argumentsJson);
}
