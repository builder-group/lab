import type { TProject, TProjectCommand } from '@/modules/project';
import { changedPieces, type TSimulationResult, withRides } from '@/modules/simulation';

/**
 * The edit that moves a song to a new start, as one undo step. The rides are kept first, as at any edit: a rail turns the
 * last bits a later start changes into centimeters on the pieces after it, so without them a built track breaks however
 * little it moves. The length stays, as with every edit: Fit to Song is offered when the song no longer matches it.
 */
export function moveSongCommands(project: TProject, result: TSimulationResult | null, songId: string, start: number): TProjectCommand[] {
	const ridden = result?.revision === project.revision ? withRides(project, result) : project;
	const rides: TProjectCommand[] = changedPieces(project, ridden).map((piece) => ({ type: 'updatePiece', pieceId: piece.id, patch: { ride: piece.ride } }));
	return [...rides, { type: 'moveSong', songId, start }];
}
