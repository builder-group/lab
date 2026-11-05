import type { TProject } from '@/modules/project';
import { formatTime, KEY_LIGHT_KEY, SONG_KEY, CAMERA_KEY, toDecorKey, toLightKey, toShotKey, WALL_KEY } from '@/modules/project';

// The words and the edit diff behind an agent's presence in the window: who is connected, what it is doing, what it
// just touched.

/** What AI apps call themselves in MCP's `initialize` */
const CLIENT_NAMES: Record<string, string> = {
	'claude-code': 'Claude Code',
	'claude-ai': 'Claude',
	'claude-desktop': 'Claude',
	codex: 'Codex',
	'codex-mcp-client': 'Codex',
	chatgpt: 'ChatGPT'
};

/** A client's name for a person: its product name when known, otherwise as it calls itself */
export function agentClientName(client: string): string {
	return CLIENT_NAMES[client.trim().toLowerCase()] ?? (client.trim() || 'An agent');
}

/** Who is connected: a live session, or a tool set up through Connect, whose next session will list this app. MCP off connects nobody. */
export function connectedAgents(isEnabled: boolean, clients: readonly string[], connections: Readonly<Record<'claude' | 'codex', boolean>>): string[] {
	if (!isEnabled) return [];
	return [...new Set([...clients.map(agentClientName), ...(connections.claude ? ['Claude Code'] : []), ...(connections.codex ? ['Codex'] : [])])];
}

/** The Agent menu's status line */
export function agentStatusLine(isEnabled: boolean, names: readonly string[]): string {
	if (!isEnabled) return 'MCP is off';
	if (!names.length) return 'No agent connected';
	const last = names[names.length - 1];
	return `${names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${last}` : last} connected`;
}

/** First words of command titles and Undo names, as what an agent is doing now */
const VERBS: Record<string, string> = {
	Add: 'Adding',
	Apply: 'Applying',
	Build: 'Building',
	Change: 'Changing',
	Clear: 'Clearing',
	Delete: 'Deleting',
	Detach: 'Detaching',
	Discard: 'Discarding',
	Duplicate: 'Duplicating',
	Export: 'Exporting',
	Fix: 'Fixing',
	Import: 'Importing',
	Mirror: 'Mirroring',
	Move: 'Moving',
	Open: 'Opening',
	Place: 'Placing',
	Rebuild: 'Rebuilding',
	Redo: 'Redoing',
	Remove: 'Removing',
	Rename: 'Renaming',
	Repeat: 'Repeating',
	Reset: 'Resetting',
	Restart: 'Restarting',
	Rotate: 'Rotating',
	Save: 'Saving',
	Scatter: 'Scattering',
	Set: 'Setting',
	Tilt: 'Tilting',
	Turn: 'Turning',
	Undo: 'Undoing'
};

/** "Place Platform 12" as "Placing Platform 12"; a title that doesn't start with a known verb stays as it is */
export function doingWords(title: string): string {
	const words = title.replace(/…$/, '').trim();
	const space = words.indexOf(' ');
	const first = space < 0 ? words : words.slice(0, space);
	const verb = VERBS[first];
	return verb != null ? `${verb}${space < 0 ? '' : words.slice(space)}` : words;
}

/**
 * What the pill says for a tool call about to run, null for a call that only reads: those are too short to show, and
 * an agent makes many. `titleOf` finds a registered command's title.
 */
export function presenceLabel(tool: string, args: unknown, titleOf: (id: string) => string | null): string | null {
	const given = (args ?? {}) as Record<string, unknown>;
	switch (tool) {
		case 'run_command': {
			const id = given['id'];
			if (typeof id !== 'string' || id === 'build.stop' || id === 'edit.select') return null;
			if (id === 'project.execute') {
				const label = (given['args'] as Record<string, unknown> | undefined)?.['label'];
				return typeof label === 'string' && label.trim() !== '' ? doingWords(label) : 'Editing';
			}
			const title = titleOf(id);
			return title != null ? doingWords(title) : null;
		}
		case 'add_song':
			return 'Adding Song';
		case 'set_references':
			return 'Setting References';
		case 'preview_frame':
			return typeof given['time'] === 'number' ? `Looking at ${formatTime(given['time'])}` : 'Looking at a frame';
		case 'play_range':
			return 'Playing';
		case 'export_film':
			// Without a quality it only asks how a running export is doing
			return given['quality'] != null ? 'Exporting Film' : null;
		case 'add_asset':
			return typeof given['name'] === 'string' ? `Adding ${given['name']}` : 'Adding an Asset';
		default:
			return null;
	}
}

/** What a `project.execute` is doing once its commands are known: "Placing Platform 12" when it made one named piece */
export function editPresenceLabel(label: string | undefined, summary: string | null, createdName: string | null): string {
	if (label != null && label.trim() !== '') return doingWords(label);
	if (summary == null) return 'Editing';
	return doingWords(createdName != null && summary.startsWith('Place ') ? `Place ${createdName}` : summary);
}

function isSame(a: unknown, b: unknown): boolean {
	return a === b || JSON.stringify(a) === JSON.stringify(b);
}

/** The selection keys of what changed from `before` to `after`, so the window can mark them. A removed layer has no row or outline left to mark. */
export function touchedKeys(before: TProject, after: TProject): string[] {
	const keys: string[] = [];
	const entities = new Map(before.entities.map((entity) => [entity.id, entity]));
	for (const entity of after.entities) {
		const previous = entities.get(entity.id);
		if (previous !== entity && (previous == null || !isSame(previous, entity))) keys.push(entity.id);
	}
	const was = before.film;
	const is = after.film;
	if (!isSame(was.wall, is.wall)) keys.push(WALL_KEY);
	if (!isSame(was.lights.key, is.lights.key)) keys.push(KEY_LIGHT_KEY);
	const lights = new Map((was.lights.added).map((light) => [light.id, light]));
	for (const light of is.lights.added) {
		if (!isSame(lights.get(light.id), light)) keys.push(toLightKey(light.id));
	}
	const decor = new Map((was.decor).map((item) => [item.id, item]));
	for (const item of is.decor) {
		if (!isSame(decor.get(item.id), item)) keys.push(toDecorKey(item.id));
	}
	const wasCamera = was.camera;
	const isCamera = is.camera;
	const shots = new Map(wasCamera.shots.map((shot) => [shot.id, shot]));
	const changedShots = isCamera.shots.filter((shot) => !isSame(shots.get(shot.id), shot));
	for (const shot of changedShots) keys.push(toShotKey(shot.id));
	if (!changedShots.length && !isSame(wasCamera, isCamera)) keys.push(CAMERA_KEY);
	if (!isSame(before.music.sources, after.music.sources)) keys.push(SONG_KEY);
	return keys;
}
