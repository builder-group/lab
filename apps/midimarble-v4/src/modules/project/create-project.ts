import type { TEntity, TLane, TProject } from './schema';

/**
 * Marble radius of new projects. The kit is 1.5 times the Marble Race Kit scale (16 mm marbles), which reads at
 * the reference film's size; piece defaults follow `KIT_SCALE` in the simulation's piece definitions.
 */
export const DEFAULT_MARBLE_RADIUS = 0.012;
/**
 * Gravity of new projects as a share of Earth's. Chosen by measurement so a default-kit zigzag hops about one
 * bar length per hit like the reference film; see `progress.md`.
 */
export const DEFAULT_GRAVITY_SCALE = 0.5;
/** Distance between the releases of neighbouring marbles, and between their lanes' bands in the frame */
export const LANE_SPACING = 0.26;

export function createId(prefix: string): string {
	const random = Math.random().toString(36).slice(2, 10);
	return `${prefix}-${Date.now().toString(36)}${random}`;
}

export function createProject(options: TCreateProjectOptions = {}): TProject {
	const { title = 'Untitled', id = createId('project') } = options;
	const lane = createLane(0);
	return {
		$schema: 'marble-project@3',
		id,
		title,
		revision: 0,
		frame: { width: 9, height: 16 },
		end: 12,
		music: { sources: [], lanes: [lane] },
		entities: [createMarble(lane, { x: 0, y: 0.6 })],
		physics: { gravityScale: DEFAULT_GRAVITY_SCALE },
		design: {
			theme: 'pegboard',
			renderPreset: 'balanced',
			loop: false,
			// Far enough for the 1.5× kit to read like the reference film: a bar spans about a quarter of the frame.
			// The steep pitch looks along the wall like the reference, so a column shows six to eight stacked bars
			camera: { mode: 'rig', distance: 0.85, pitch: 1.15, lead: 0.15, smoothing: 0.6, shots: [] }
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
			marble: { laneId: lane.id, radius: DEFAULT_MARBLE_RADIUS, color: lane.color },
			release: { position, time: 0 }
		}
	};
}
