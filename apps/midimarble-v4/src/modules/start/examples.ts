import { Err, Ok, type TResult } from 'tuple-result';
import { host } from '@/environment';
import { createId, parseProject, type TProject } from '@/modules/project';

// The sandbox fixtures double as examples; they load on demand so the start screen stays light
const fixtures = import.meta.glob<unknown>('../../../fixtures/*.marble.json', { import: 'default' });
// Song files an example ships next to its JSON, named like the file name in the source's package path
const companions = import.meta.glob<string>(['../../../fixtures/*.mid', '../../../fixtures/*.wav'], {
	query: '?url',
	import: 'default'
});

/** Example projects in groups, each in the order it teaches the app */
export const exampleGroups: TExampleGroup[] = [
	{
		title: 'Songs',
		hasSong: true,
		examples: [
			{ id: 'jingle-bells', title: 'Jingle Bells', detail: 'Two marbles play a MIDI song' },
			{ id: 'tap-along', title: 'Tap Along', detail: 'Beats found in a recording' }
		]
	},
	{
		title: 'Techniques',
		hasSong: false,
		examples: [
			{ id: 'staircase', title: 'Staircase', detail: 'One marble, eight even hits' },
			{ id: 'zigzag', title: 'Zigzag', detail: 'Mirror Last Platform, Continue Pattern' },
			{ id: 'long-gap', title: 'Long Gap', detail: 'A rail and a tunnel fill a long pause' },
			{ id: 'windmill', title: 'Windmill', detail: 'A spinning piece' },
			{ id: 'two-marbles', title: 'Two Marbles', detail: 'Two marbles, one song' },
			{ id: 'reference-20', title: 'Brass Sections', detail: 'Skins and titles per section' }
		]
	}
]
	.map((group) => ({ ...group, examples: group.examples.filter((example) => fixtures[fixturePath(example.id)] != null) }))
	.filter((group) => group.examples.length > 0);

export const examples: TExample[] = exampleGroups.flatMap((group) => group.examples);

export interface TExampleGroup {
	title: string;
	// Its examples carry a song file, shown with a music icon
	hasSong: boolean;
	examples: TExample[];
}

export interface TExample {
	id: string;
	title: string;
	detail: string;
}

export interface TLoadedExample {
	project: TProject;
	/** Song files to copy into the new package before the project opens */
	files: TExampleFile[];
}

export interface TExampleFile {
	// Package-relative path the project's source points at, such as `audio/jingle-bells.mid`
	path: string;
	url: string;
}

/** A fresh, independent copy of an example with the song files it ships, ready to open as an unsaved project */
export async function loadExample(example: TExample): Promise<TResult<TLoadedExample, Error>> {
	const load = fixtures[fixturePath(example.id)];
	if (load == null) return Err(new Error(`${example.title} isn't included in this build. Choose another example.`));
	const [isProjectOk, projectErr, project] = parseProject(JSON.stringify(await load()));
	if (!isProjectOk) return Err(projectErr);
	const files: TExampleFile[] = [];
	for (const song of project.songs) {
		if (song.path == null) continue;
		const loadUrl = companions[`../../../fixtures/${song.path.split('/').pop() ?? ''}`];
		if (loadUrl == null) return Err(new Error(`${example.title} is missing its song, ${song.name}. Choose another example.`));
		files.push({ path: song.path, url: await loadUrl() });
	}
	return Ok({ project: { ...project, id: createId('project'), title: example.title, revision: 0 }, files });
}

/** Copies an example's song files into its new package, so the package is complete like an imported one */
export async function copyExampleFiles(packagePath: string, files: TExampleFile[]): Promise<TResult<void, Error>> {
	for (const file of files) {
		const [isCopiedOk, copiedErr] = await host.addPackageFile(packagePath, file.path, file.url);
		if (!isCopiedOk) return Err(new Error(`${file.path.split('/').pop()} couldn't be copied into the project: ${copiedErr.message}. The project opens without its song.`));
	}
	return Ok(undefined);
}

function fixturePath(id: string): string {
	return `../../../fixtures/${id}.marble.json`;
}
