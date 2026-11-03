import { createLane, type TEntity, type TProject, type TVec2 } from '@/modules/project';
import { createLinkedPiece } from './placement';

// Deterministic example projects for fixtures and tests. Pieces are linked to hits, so their positions
// come from the simulation and the documents stay stable.

export function createStaircaseProject(): TProject {
	return createRunProject({
		id: 'staircase',
		title: 'Staircase',
		end: 4.5,
		marbles: [
			{ x: 0, y: 0.6, releaseTime: 0, hitTimes: evenTimes(0.6, 0.4, 8), angles: () => -0.05 }
		]
	});
}

/** Four marbles over 60 seconds with a platform every 0.6 seconds each, for performance checks */
export function createPerfProject(): TProject {
	return createRunProject({
		id: 'perf-60s-4marbles',
		title: 'Performance 60 s, 4 marbles',
		end: 60,
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
}): TProject {
	const project = createBareRunProject(options);
	const { entities } = project;
	options.marbles.forEach((marble, index) => {
		const lane = project.music.lanes[index];
		if (lane == null) return;
		lane.hits.forEach((hit, hitIndex) => {
			entities.push(
				createLinkedPiece('platform', lane.id, hit.id, marble.angles(hitIndex), {
					entities,
					id: `piece-${index + 1}-${hitIndex + 1}`
				})
			);
		});
	});
	return project;
}

/** Lanes `lane-N` with hits `hit-N-M` and marbles `marble-N`, without pieces */
export function createBareRunProject(options: {
	id: string;
	title: string;
	end: number;
	marbles: TBareRunMarble[];
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
				marble: { laneId: lane.id, radius: 0.008, color: lane.color },
				release
			}
		});
	});
	return {
		$schema: 'marble-project@1',
		id: options.id,
		title: options.title,
		revision: 0,
		frame: { width: 9, height: 16 },
		end: options.end,
		music: { sources: [], lanes },
		entities,
		design: {
			theme: 'pegboard',
			renderPreset: 'balanced',
			loop: false,
			camera: { mode: 'rig', distance: 0.6, pitch: 0.7, lead: 0.15, smoothing: 0.6, shots: [] }
		}
	};
}

function evenTimes(start: number, gap: number, count: number): number[] {
	// Rounded to the millisecond so the stored JSON stays readable
	return Array.from({ length: count }, (_, i) => Math.round((start + gap * i) * 1000) / 1000);
}
