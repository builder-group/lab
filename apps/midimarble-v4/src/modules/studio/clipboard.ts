import { pasteDecorCommands } from '@/modules/scene';
import { createId, type TDecor, type TPiece, type TProject, type TProjectCommand, type TTitle } from '@/modules/project';
import { DUPLICATE_OFFSET } from './duplicate';

/** What ⌘C kept: free pieces from Track, titles and Decor from Film */
export interface TClipboard {
	pieces: TPiece[];
	titles: TTitle[];
	decor: TDecor[];
}

/** Commands of one Paste in Film, and the copies, for selecting them and for the next Paste to step on from */
export function pasteFilmCommands(project: TProject, kept: Pick<TClipboard, 'titles' | 'decor'>): { commands: TProjectCommand[]; titles: TTitle[]; decor: TDecor[] } {
	const decor = pasteDecorCommands(project, kept.decor);
	const titles = kept.titles.map((title) => ({
		...title,
		id: createId('text'),
		position: { x: title.position.x + DUPLICATE_OFFSET.x, y: title.position.y + DUPLICATE_OFFSET.y }
	}));
	const pasted = decor.commands.flatMap((command) => (command.type === 'updateFilm' ? (command.film.decor ?? []) : [])).filter((item) => decor.decorIds.includes(item.id));
	const addTitles: TProjectCommand[] = titles.length > 0 ? [{ type: 'updateFilm', film: { titles: [...project.film.titles, ...titles] } }] : [];
	return { commands: [...decor.commands, ...addTitles], titles, decor: pasted };
}
