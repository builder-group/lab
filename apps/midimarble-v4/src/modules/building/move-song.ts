import { DEFAULT_PROJECT_END, isAutoEnd, projectSongEnd } from '@/modules/music';
import { applyProjectCommands, type TProject, type TProjectCommand } from '@/modules/project';
import { changedPieces, type TSimulationResult, withRides } from '@/modules/simulation';

/**
 * The edit that moves a song to a new start, as one undo step. The rides are kept first, as at any edit: a rail turns the
 * last bits a later start changes into centimeters on the pieces after it, so without them a built track breaks however
 * little it moves. A length that follows the song follows it here too; a length the person set stays, and the untouched
 * default only ever grows.
 */
export function moveSongCommands(project: TProject, result: TSimulationResult | null, songId: string, start: number): TProjectCommand[] {
	const ridden = result?.revision === project.revision ? withRides(project, result) : project;
	const rides: TProjectCommand[] = changedPieces(project, ridden).map((piece) => ({ type: 'updatePiece', pieceId: piece.id, patch: { ride: piece.ride } }));
	const moved: TProjectCommand = { type: 'moveSong', songId, start };
	if (!isAutoEnd(project)) return [...rides, moved];
	const [isMoved, , after] = applyProjectCommands(project, [moved]);
	const end = isMoved ? projectSongEnd(after) : null;
	if (end == null || Math.abs(end - project.length) < 1e-6) return [...rides, moved];
	const isDefault = Math.abs(project.length - DEFAULT_PROJECT_END) < 1e-6;
	return isDefault && end < project.length ? [...rides, moved] : [...rides, moved, { type: 'updateProject', patch: { length: end } }];
}
