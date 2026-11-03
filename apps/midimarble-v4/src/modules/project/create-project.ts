import type { TEntity, TLane, TProject } from './schema';

export function createId(prefix: string): string {
	const random = Math.random().toString(36).slice(2, 10);
	return `${prefix}-${Date.now().toString(36)}${random}`;
}

export function createProject(options: TCreateProjectOptions = {}): TProject {
	const { title = 'Untitled', id = createId('project') } = options;
	const lane = createLane(0);
	return {
		$schema: 'marble-project@1',
		id,
		title,
		revision: 0,
		frame: { width: 9, height: 16 },
		end: 12,
		music: { sources: [], lanes: [lane] },
		entities: [createMarble(lane, { x: 0, y: 0.6 })],
		design: {
			theme: 'pegboard',
			renderPreset: 'balanced',
			loop: false,
			camera: { mode: 'rig', distance: 0.6, pitch: 0.7, lead: 0.15, smoothing: 0.6, shots: [] }
		}
	};
}

interface TCreateProjectOptions {
	title?: string;
	id?: string;
}

export const laneColors = ['#3478f6', '#ff9f0a', '#30d158', '#bf5af2', '#ff375f', '#64d2ff'];

export function createLane(index: number, id = createId('lane')): TLane {
	return {
		id,
		name: `Marble ${index + 1}`,
		color: laneColors[index % laneColors.length] ?? '#3478f6',
		// General MIDI 9 is Glockenspiel, a clear default for marble strikes
		instrument: 9,
		hits: []
	};
}

export function createMarble(lane: TLane, position: { x: number; y: number }): TEntity {
	return {
		id: createId('marble'),
		name: lane.name,
		components: {
			marble: { laneId: lane.id, radius: 0.008, color: lane.color },
			release: { position, time: 0 }
		}
	};
}
