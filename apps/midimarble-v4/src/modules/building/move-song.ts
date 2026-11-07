import { playsOnlySong, type TProject, type TProjectCommand } from '@/modules/project';
import { PHYSICS_HZ, type TSimulationResult } from '@/modules/simulation';
import { withRides } from './bake-ride';
import { changedPieces } from './edit-rule';

/**
 * The edit that moves a song to a new start, as one undo step. The rides are kept first, as at any edit: a rail turns the
 * last bits a later start changes into centimeters on the pieces after it, so without them a built track breaks however
 * little it moves. The length stays, as with every edit: Fit to Song is offered when the song no longer matches it.
 */
export function moveSongCommands(project: TProject, result: TSimulationResult | null, songId: string, start: number): TProjectCommand[] {
	const ridden = result?.revision === project.revision ? withRides(project, result) : project;
	const rides: TProjectCommand[] = changedPieces(project, ridden).map((piece) => ({ type: 'updatePiece', pieceId: piece.id, patch: { ride: piece.ride } }));
	const steps = (start - (project.songs.find((song) => song.id === songId)?.start ?? start)) * PHYSICS_HZ;
	const isWholeSteps = Math.abs(steps - Math.round(steps)) < 1e-6;
	// A marble that plays only this song runs the same, later: its hand-overs go along. Between steps a run from the release is what's left
	const chains: TProjectCommand[] = project.marbles.flatMap((marble) => {
		if (marble.handOvers == null || !playsOnlySong(marble, songId)) return [];
		return [{ type: 'updateMarble', marbleId: marble.id, patch: { handOvers: isWholeSteps ? marble.handOvers.map((handOver) => ({ ...handOver, step: handOver.step + Math.round(steps) })) : null } }];
	});
	return [...rides, { type: 'moveSong', songId, start }, ...chains];
}
