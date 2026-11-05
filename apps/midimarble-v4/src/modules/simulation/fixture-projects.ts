import { createLane, DEFAULT_GRAVITY, DEFAULT_MARBLE_RADIUS, type TEntity, type TProject, type TVec2 } from '@/modules/project';
import { KIT_SCALE } from './pieces';
import { createLinkedPiece } from './placement';

// Deterministic example projects for fixtures and tests. Pieces are linked to hits, so their positions
// come from the simulation and the documents stay stable.

export function createStaircaseProject(): TProject {
	const project = createRunProject({
		id: 'staircase',
		title: 'Staircase',
		end: 4.5,
		marbles: [
			// The marble falls 1.8 m to the first hit; a low bounce keeps the following hits on its way down. The
			// hand-set angles were made for the Marble Race Kit, so the staircase keeps its 1× sizes.
			{
				x: 0,
				y: 0.6,
				releaseTime: 0,
				hitTimes: evenTimes(0.6, 0.4, 8),
				angles: () => -0.05,
				bounce: 0.55,
				radius: 0.008,
				platform: { length: 0.06, thickness: 0.008, depth: 0.03 }
			}
		]
	});
	project.film.camera.distance = 1.166;
	project.gravity = 1;
	return project;
}

/** Four marbles over 60 seconds with a platform every 0.6 seconds each, for performance checks */
export function createPerfProject(): TProject {
	// The hand-set ±0.2 rad zigzag is tuned for full gravity
	return createRunProject({
		id: 'perf-60s-4marbles',
		title: 'Performance 60 s, 4 marbles',
		end: 60,
		gravity: 1,
		marbles: [0, 1, 2, 3].map((index) => ({
			x: index * 0.3,
			y: 0.6,
			releaseTime: index * 0.1,
			hitTimes: evenTimes(0.6 + index * 0.1, 0.6, 99),
			angles: (hitIndex: number) => (hitIndex % 2 === 0 ? -0.2 : 0.2)
		}))
	});
}

interface TRunMarble {
	x: number;
	y: number;
	releaseTime: number;
	hitTimes: number[];
	angles: (hitIndex: number) => number;
	/** Bounce of every platform, the definition default when unset */
	bounce?: number;
	/** Marble radius and platform sizes, the default kit when unset */
	radius?: number;
	platform?: Record<string, number>;
}

interface TBareRunMarble {
	x: number;
	y: number;
	releaseTime: number;
	velocity?: TVec2;
	hitTimes: number[];
}

function createRunProject(options: {
	id: string;
	title: string;
	end: number;
	marbles: TRunMarble[];
	gravity?: number;
}): TProject {
	const project = createBareRunProject(options);
	const { entities } = project;
	options.marbles.forEach((item, index) => {
		const marble = project.music.marbles[index];
		if (marble == null) return;
		marble.hits.forEach((hit, hitIndex) => {
			const piece = createLinkedPiece('platform', marble.id, hit.id, item.angles(hitIndex), {
				entities,
				id: `piece-${index + 1}-${hitIndex + 1}`
			});
			if (item.bounce != null && piece.components.piece != null)
				piece.components.piece.params['bounce'] = item.bounce;
			if (item.platform != null && piece.components.piece != null)
				Object.assign(piece.components.piece.params, item.platform);
			entities.push(piece);
		});
		const component = entities.find((entity) => entity.components.marble?.marbleId === marble.id)?.components.marble;
		if (item.radius != null && component != null) component.radius = item.radius;
	});
	return project;
}

/** Marbles `lane-N` with hits `hit-N-M` and marbles `marble-N`, without pieces */
export function createBareRunProject(options: {
	id: string;
	title: string;
	end: number;
	marbles: TBareRunMarble[];
	/** Share of Earth gravity, the default of new projects when unset */
	gravity?: number;
}): TProject {
	const marbles = options.marbles.map((item, index) => {
		const marble = createLane(index, `lane-${index + 1}`);
		marble.hits = item.hitTimes.map((time, hitIndex) => ({
			id: `hit-${index + 1}-${hitIndex + 1}`,
			time
		}));
		return marble;
	});
	const entities: TEntity[] = [];
	options.marbles.forEach((item, index) => {
		const marble = marbles[index];
		if (marble == null) return;
		const release: NonNullable<TEntity['components']['release']> = {
			position: { x: item.x, y: item.y },
			time: item.releaseTime
		};
		if (item.velocity != null) release.velocity = item.velocity;
		entities.push({
			id: `marble-${index + 1}`,
			name: marble.name,
			components: {
				marble: { marbleId: marble.id, radius: DEFAULT_MARBLE_RADIUS },
				release
			}
		});
	});
	return {
		$schema: 'marble-project@5',
		id: options.id,
		title: options.title,
		revision: 0,
		format: { width: 9, height: 16 },
		length: options.end,
		music: { sources: [], marbles, backing: [] },
		entities,
		gravity: options.gravity ?? DEFAULT_GRAVITY,
		film: {
			theme: 'pegboard',
			themes: [],
			wall: {},
			lights: { added: [] },
			decor: [],
			madeInBlender: [],
			quality: 'final',
			// 1.166 m frames the Marble Race Kit through the 85 mm lens; the default kit is KIT_SCALE times larger
			camera: { auto: true, distance: 1.166 * KIT_SCALE, tilt: 0.7, sway: 1, shots: [] }
		}
	};
}

export function evenTimes(start: number, gap: number, count: number): number[] {
	// Rounded to the millisecond so the stored JSON stays readable
	return Array.from({ length: count }, (_, i) => Math.round((start + gap * i) * 1000) / 1000);
}
