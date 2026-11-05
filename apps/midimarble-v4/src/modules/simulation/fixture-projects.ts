import {
	createLane,
	DEFAULT_GRAVITY_SCALE,
	DEFAULT_MARBLE_RADIUS,
	type TEntity,
	type TProject,
	type TVec2
} from '@/modules/project';
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
	project.design.camera.distance = 1.166;
	project.physics.gravityScale = 1;
	return project;
}

/** Four marbles over 60 seconds with a platform every 0.6 seconds each, for performance checks */
export function createPerfProject(): TProject {
	// The hand-set ±0.2 rad zigzag is tuned for full gravity
	return createRunProject({
		id: 'perf-60s-4marbles',
		title: 'Performance 60 s, 4 marbles',
		end: 60,
		gravityScale: 1,
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
	gravityScale?: number;
}): TProject {
	const project = createBareRunProject(options);
	const { entities } = project;
	options.marbles.forEach((marble, index) => {
		const lane = project.music.lanes[index];
		if (lane == null) return;
		lane.hits.forEach((hit, hitIndex) => {
			const piece = createLinkedPiece('platform', lane.id, hit.id, marble.angles(hitIndex), {
				entities,
				id: `piece-${index + 1}-${hitIndex + 1}`
			});
			if (marble.bounce != null && piece.components.piece != null)
				piece.components.piece.params['bounce'] = marble.bounce;
			if (marble.platform != null && piece.components.piece != null)
				Object.assign(piece.components.piece.params, marble.platform);
			entities.push(piece);
		});
		const component = entities.find((entity) => entity.components.marble?.laneId === lane.id)?.components.marble;
		if (marble.radius != null && component != null) component.radius = marble.radius;
	});
	return project;
}

/** Lanes `lane-N` with hits `hit-N-M` and marbles `marble-N`, without pieces */
export function createBareRunProject(options: {
	id: string;
	title: string;
	end: number;
	marbles: TBareRunMarble[];
	/** Share of Earth gravity, the default of new projects when unset */
	gravityScale?: number;
}): TProject {
	const lanes = options.marbles.map((marble, index) => {
		const lane = createLane(index, `lane-${index + 1}`);
		lane.hits = marble.hitTimes.map((time, hitIndex) => ({
			id: `hit-${index + 1}-${hitIndex + 1}`,
			time
		}));
		return lane;
	});
	const entities: TEntity[] = [];
	options.marbles.forEach((marble, index) => {
		const lane = lanes[index];
		if (lane == null) return;
		const release: NonNullable<TEntity['components']['release']> = {
			position: { x: marble.x, y: marble.y },
			time: marble.releaseTime
		};
		if (marble.velocity != null) release.velocity = marble.velocity;
		entities.push({
			id: `marble-${index + 1}`,
			name: lane.name,
			components: {
				marble: { laneId: lane.id, radius: DEFAULT_MARBLE_RADIUS, color: lane.color },
				release
			}
		});
	});
	return {
		$schema: 'marble-project@5',
		id: options.id,
		title: options.title,
		revision: 0,
		frame: { width: 9, height: 16 },
		end: options.end,
		music: { sources: [], lanes, backing: [] },
		entities,
		physics: { gravityScale: options.gravityScale ?? DEFAULT_GRAVITY_SCALE },
		design: {
			theme: 'pegboard',
			themes: [],
			wall: {},
			lights: { added: [] },
			decor: [],
			madeInBlender: [],
			renderPreset: 'balanced',
			// 1.166 m frames the Marble Race Kit through the 85 mm lens; the default kit is KIT_SCALE times larger
			camera: { mode: 'rig', distance: 1.166 * KIT_SCALE, pitch: 0.7, lead: 0.15, smoothing: 0.6, sway: 1, shots: [] }
		}
	};
}

export function evenTimes(start: number, gap: number, count: number): number[] {
	// Rounded to the millisecond so the stored JSON stays readable
	return Array.from({ length: count }, (_, i) => Math.round((start + gap * i) * 1000) / 1000);
}
