import { pasteDecorCommands } from '@/modules/scene';
import { createId, type TDecor, type TEntity, type TProject, type TProjectCommand } from '@/modules/project';
import { DUPLICATE_OFFSET } from './duplicate';

/** What ⌘C kept: free pieces from Track, titles and Decor from Film */
export interface TClipboard {
	pieces: TEntity[];
	titles: TEntity[];
	decor: TDecor[];
}

/** Commands of one Paste in Film, and the copies, for selecting them and for the next Paste to step on from */
export function pasteFilmCommands(project: TProject, kept: Pick<TClipboard, 'titles' | 'decor'>): { commands: TProjectCommand[]; titles: TEntity[]; decor: TDecor[] } {
	const decor = pasteDecorCommands(project, kept.decor);
	const titles = kept.titles.map((title) => {
		const transform = title.components.transform;
		return {
			...title,
			id: createId('text'),
			components: { ...title.components, ...(transform != null ? { transform: { ...transform, position: { x: transform.position.x + DUPLICATE_OFFSET.x, y: transform.position.y + DUPLICATE_OFFSET.y } } } : {}) }
		};
	});
	const pasted = decor.commands.flatMap((command) => (command.type === 'updateFilm' ? (command.film.decor ?? []) : [])).filter((item) => decor.decorIds.includes(item.id));
	return { commands: [...decor.commands, ...titles.map((entity): TProjectCommand => ({ type: 'upsertEntity', entity }))], titles, decor: pasted };
}
