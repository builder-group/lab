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
export const DEFAULT_GRAVITY = 0.5;
/**
 * Follow camera of new projects. Through the 85 mm lens 1.36 m frames as much as 0.8 m did through 50 mm: a single
 * marble spans about 7.4 % of the frame width, and far rows no longer shrink to a pile. The steep tilt looks along
 * the wall like the reference, so a column shows several stacked bars. Groups of marbles pull back only as far as
 * they need (`camera.py`, readable distance). Measured in `references.md`, Tuned film view.
 */
export const DEFAULT_CAMERA_DISTANCE = 1.36;
export const DEFAULT_CAMERA_TILT = 1;
/** Distance between the releases of neighboring marbles, and between their marbles' bands in the frame */
export const MARBLE_SPACING = 0.26;

export function createId(prefix: string): string {
	const random = Math.random().toString(36).slice(2, 10);
	return `${prefix}-${Date.now().toString(36)}${random}`;
}

export function createProject(options: TCreateProjectOptions = {}): TProject {
	const { title = 'Untitled', id = createId('project') } = options;
	const marble = createLane(0);
	return {
		$schema: 'marble-project@5',
		id,
		title,
		revision: 0,
		format: { width: 9, height: 16 },
		length: 12,
		gravity: DEFAULT_GRAVITY,
		music: { sources: [], marbles: [marble], backing: [] },
		entities: [createMarble(marble, { x: 0, y: 0.6 })],
		film: {
			theme: 'pegboard',
			themes: [],
			wall: {},
			lights: { added: [] },
			decor: [],
			madeInBlender: [],
			quality: 'final',
			camera: {
				auto: true,
				distance: DEFAULT_CAMERA_DISTANCE,
				tilt: DEFAULT_CAMERA_TILT,
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

export const marbleColors = ['#3478f6', '#ff9f0a', '#30d158', '#bf5af2', '#ff375f', '#64d2ff'];

/**
 * The color a marble is in the film: its skin's own, otherwise the palette's by its place among the marbles. It never
 * reads the marble's `color`, which is only a label for organizing.
 */
export function marbleFilmColor(project: Pick<TProject, 'music' | 'entities'>, marbleId: string): string {
	const own = project.entities.find((entity) => entity.components.marble?.marbleId === marbleId)?.components.skin?.color;
	if (own != null) return own;
	const index = Math.max(0, project.music.marbles.findIndex((marble) => marble.id === marbleId));
	return marbleColors[index % marbleColors.length] ?? '#3478f6';
}

export function createLane(index: number, id = createId('lane')): TLane {
	return {
		id,
		name: `Marble ${index + 1}`,
		color: marbleColors[index % marbleColors.length] ?? '#3478f6',
		// General MIDI 9 is Glockenspiel, a clear default for marble strikes
		instrument: 9,
		hits: []
	};
}

export function createMarble(marble: TLane, position: { x: number; y: number }): TEntity {
	return {
		id: createId('marble'),
		name: marble.name,
		components: {
			marble: { marbleId: marble.id, radius: DEFAULT_MARBLE_RADIUS },
			release: { position, time: 0 }
		}
	};
}
