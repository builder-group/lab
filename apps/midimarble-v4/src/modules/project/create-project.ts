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
/**
 * Follow camera of new projects. At 0.7 m a single marble spans about 9 % of the frame width and the next four pieces
 * are in frame with bars at about a fifth of the width, close to the reference shorts; the steep pitch looks along
 * the wall like the reference, so a column shows several stacked bars. Groups of marbles pull back only as far as
 * they need (`camera.py`, readable distance). Measured in `references.md`, Close camera.
 */
export const DEFAULT_CAMERA_DISTANCE = 0.7;
export const DEFAULT_CAMERA_PITCH = 1.15;
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
		$schema: 'marble-project@4',
		id,
		title,
		revision: 0,
		frame: { width: 9, height: 16 },
		end: 12,
		music: { sources: [], lanes: [lane], backing: [] },
		entities: [createMarble(lane, { x: 0, y: 0.6 })],
		physics: { gravityScale: DEFAULT_GRAVITY_SCALE },
		design: {
			theme: 'pegboard',
			renderPreset: 'balanced',
			loop: false,
			camera: {
				mode: 'rig',
				distance: DEFAULT_CAMERA_DISTANCE,
				pitch: DEFAULT_CAMERA_PITCH,
				lead: 0.15,
				smoothing: 0.6,
				shots: []
			}
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
