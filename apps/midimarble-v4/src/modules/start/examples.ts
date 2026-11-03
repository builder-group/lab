import { Err, Ok, type TResult } from 'tuple-result';
import { createId, parseProject, type TProject } from '@/modules/project';

// The sandbox fixtures double as examples; they load on demand so the start screen stays light
const fixtures = import.meta.glob<unknown>('../../../fixtures/*.marble.json', { import: 'default' });

/** Example projects in the order they teach the app, from one bounce to a full song */
export const examples: TExample[] = [
	{ id: 'staircase', title: 'Staircase', detail: 'One marble, eight evenly spaced hits' },
	{ id: 'zigzag', title: 'Zigzag', detail: 'Mirror and Continue build two columns' },
	{ id: 'long-gap', title: 'Long Gap', detail: 'A rail and a tunnel carry long notes' },
	{ id: 'windmill', title: 'Windmill', detail: 'A spinning piece between platforms' },
	{ id: 'two-marbles', title: 'Two Marbles', detail: 'Two lanes in one world' },
	{ id: 'loop', title: 'Seamless Loop', detail: 'Ends where it starts, for shorts' },
	{ id: 'reference-20', title: 'Brass Sections', detail: '20 s, two sections in the brass look' },
	{ id: 'jingle-bells', title: 'Jingle Bells', detail: 'Melody and bass, built from MIDI' }
].filter((example) => fixtures[fixturePath(example.id)] != null);

export interface TExample {
	id: string;
	title: string;
	detail: string;
}

/** A fresh, independent copy of an example, ready to save as a new project */
export async function loadExample(example: TExample): Promise<TResult<TProject, Error>> {
	const load = fixtures[fixturePath(example.id)];
	if (load == null) return Err(new Error(`${example.title} is not available`));
	const [isProjectOk, projectErr, project] = parseProject(JSON.stringify(await load()));
	if (!isProjectOk) return Err(projectErr);
	return Ok({ ...project, id: createId('project'), title: example.title, revision: 0 });
}

function fixturePath(id: string): string {
	return `../../../fixtures/${id}.marble.json`;
}
