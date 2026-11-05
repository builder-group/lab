import type { TMarble, TProject } from './schema';

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
	return {
		$schema: 'marble-project@6',
		id,
		title,
		revision: 0,
		format: { width: 9, height: 16 },
		length: 12,
		gravity: DEFAULT_GRAVITY,
		songs: [],
		marbles: [createMarble(0, { x: 0, y: 0.6 })],
		track: { pieces: [], groups: [] },
		film: {
			theme: 'pegboard',
			themes: [],
			wall: {},
			lights: { added: [] },
			decor: [],
			madeInBlender: [],
			titles: [],
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
 * reads the marble's `labelColor`, which is only for organizing.
 */
export function marbleFilmColor(project: Pick<TProject, 'marbles'>, marbleId: string): string {
	const own = project.marbles.find((marble) => marble.id === marbleId)?.skin?.color;
	if (own != null) return own;
	const index = Math.max(0, project.marbles.findIndex((marble) => marble.id === marbleId));
	return marbleColors[index % marbleColors.length] ?? '#3478f6';
}

export function createMarble(index: number, position: { x: number; y: number }, id = createId('marble')): TMarble {
	return {
		id,
		name: `Marble ${index + 1}`,
		labelColor: marbleColors[index % marbleColors.length] ?? '#3478f6',
		// General MIDI 9 is Glockenspiel, a clear default for marble strikes
		sound: 9,
		radius: DEFAULT_MARBLE_RADIUS,
		start: { position, time: 0 },
		hits: []
	};
}
