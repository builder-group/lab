import type { TEntity, TLane, TProject } from './schema';

/**
 * Marble radius of new projects. The kit is 1.5 times the Marble Race Kit scale (16 mm marbles), which reads at
 * the reference film's size; piece defaults follow `KIT_SCALE` in the simulation's piece definitions.
 */
export const DEFAULT_MARBLE_RADIUS = 0.012;
/**
 * Gravity of new projects as a share of Earth's. Chosen by measurement so a default-kit zigzag hops about one
 * bar length per hit like the reference film; see `references.md`.
 */
export const DEFAULT_GRAVITY_SCALE = 0.5;
/**
 * Follow camera of new projects. Through the 85 mm lens 1.36 m frames as much as 0.8 m did through 50 mm: a single
 * marble spans about 7.4 % of the frame width, and far rows no longer shrink to a pile. The steep pitch looks along
 * the wall like the reference, so a column shows several stacked bars. Groups of marbles pull back only as far as
 * they need (`camera.py`, readable distance). Measured in `references.md`, Tuned film view.
 */
export const DEFAULT_CAMERA_DISTANCE = 1.36;
export const DEFAULT_CAMERA_PITCH = 1;
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
		$schema: 'marble-project@5',
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
			themes: [],
			wall: {},
			lights: { added: [] },
			decor: [],
			madeInBlender: [],
			renderPreset: 'final',
			camera: {
				mode: 'rig',
				distance: DEFAULT_CAMERA_DISTANCE,
				pitch: DEFAULT_CAMERA_PITCH,
				lead: 0.15,
				smoothing: 0.6,
				sway: 1,
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

/**
 * The colour a marble is in the film: its skin's own, otherwise the palette's by its place among the marbles. It never
 * reads the lane's `color`, which is only a label for organising.
 */
export function marbleFilmColor(project: Pick<TProject, 'music' | 'entities'>, laneId: string): string {
	const own = project.entities.find((entity) => entity.components.marble?.laneId === laneId)?.components.skin?.color;
	if (own != null) return own;
	const index = Math.max(0, project.music.lanes.findIndex((lane) => lane.id === laneId));
	return laneColors[index % laneColors.length] ?? '#3478f6';
}

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
			marble: { laneId: lane.id, radius: DEFAULT_MARBLE_RADIUS },
			release: { position, time: 0 }
		}
	};
}
