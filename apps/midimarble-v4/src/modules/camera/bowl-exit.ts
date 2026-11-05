import { endsOnBowl, BOWL_TAIL_MAX, lastPlayingMarbles, projectSongEnd } from '@/modules/music';
import type { TProject } from '@/modules/project';
import { BOWL_TYPE, bowlCatch, bowlOfMarble } from '@/modules/simulation';
import type { TSimulationResult } from '@/modules/simulation';
import { projectToFrame } from './framing';
import { followCameraTrack } from './project-track';

/** Frame rate of the track the exit is read on: the film's own, as `pnpm camera:check` holds it to Blender's */
const EXIT_FPS = 30;

/** Length of the what-if run `bowlExit` reads: the longest tail past the last note, plus a frame to see the marble go */
export function exitRunProject(project: TProject): TProject | null {
	const last = lastNote(project);
	return last == null ? null : { ...project, length: Math.max(project.length, last + BOWL_TAIL_MAX + 0.05) };
}

/**
 * Seconds after the last note until the last marble that plays last has left the film frame through its Bowl, its
 * center outside the frame in the follow camera of `run` (a run of `exitRunProject`); `Infinity` while one stays in
 * frame to the end of the run, as a Bowl's does. Null unless every marble that plays last has a Bowl that catches it.
 */
export function bowlExit(project: TProject, run: TSimulationResult): number | null {
	const last = lastNote(project);
	const marbles = lastPlayingMarbles(project);
	if (last == null || !marbles.length) return null;
	const track = followCameraTrack(project, run, EXIT_FPS);
	if (track == null) return null;
	let exit = Number.NEGATIVE_INFINITY;
	for (const marbleId of marbles) {
		const bowl = bowlOfMarble(project, marbleId);
		const marble = run.marbles.find((item) => item.marbleId === marbleId);
		if (bowl?.components.piece?.type !== BOWL_TYPE || marble == null) return null;
		const caught = bowlCatch(run, bowl.id);
		if (caught.status !== 'caught' || caught.enterTime == null) return null;
		exit = Math.max(exit, leavesFrame(track, marble, caught.enterTime) - last);
	}
	return exit;
}

/**
 * The length Fit to Song gives: the last note plus `filmTail`, measured on a what-if run when every marble that plays
 * last has a Bowl; null without notes
 */
export async function fittedSongEnd(project: TProject, simulate: (project: TProject) => Promise<TSimulationResult> | TSimulationResult): Promise<number | null> {
	const trial = exitRunProject(project);
	if (trial == null) return null;
	if (!endsOnBowl(project)) return projectSongEnd(project);
	return projectSongEnd(project, bowlExit(trial, await simulate(trial)));
}

/** Time the marble's center first leaves the frame after `after`; `Infinity` if it never does in the track */
function leavesFrame(track: NonNullable<ReturnType<typeof followCameraTrack>>, marble: TSimulationResult['marbles'][number], after: number): number {
	for (const sample of marble.samples) {
		if (sample.time < after) continue;
		const frame = Math.min(track.frameCount - 1, Math.round(sample.time * track.fps));
		const [u, v] = projectToFrame(track, frame, sample.position.x, sample.position.y);
		if (u < 0 || u > 1 || v < 0 || v > 1) return sample.time;
	}
	return Number.POSITIVE_INFINITY;
}

function lastNote(project: TProject): number | null {
	const times = project.music.marbles.flatMap((marble) => marble.hits.map((hit) => hit.time));
	return times.length ? Math.max(...times) : null;
}
