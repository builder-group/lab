import { parseProject } from './project';
import type { TProject } from './types';

export function serializeProjectFile(project: TProject): string {
	const document = parseProject(JSON.stringify(project));
	return `${JSON.stringify({ format: 'midimarble', ...document }, null, 2)}\n`;
}

export function parseProjectFile(text: string): TProject {
	if (text.length > 20 * 1024 * 1024 || new TextEncoder().encode(text).length > 20 * 1024 * 1024) {
		throw new Error('Choose a MidiMarble project smaller than 20 MB.');
	}
	let document: unknown;
	try {
		document = JSON.parse(text);
	} catch {
		throw new Error('This file is not valid JSON. Choose a saved MidiMarble .marble project.');
	}
	if (
		typeof document === 'object' &&
		document != null &&
		'format' in document &&
		document.format !== 'midimarble'
	) {
		throw new Error(
			'This file uses a different project format. Choose a MidiMarble .marble project.'
		);
	}
	return parseProject(text);
}

export function getProjectFileName(project: Pick<TProject, 'name'>): string {
	let name = project.name
		.trim()
		.replace(/\.marble$/i, '')
		.replace(/[\p{Cc}<>:"/\\|?*]/gu, '-')
		.replace(/^\.+/, '')
		.replace(/[. ]+$/, '')
		.trim();
	const characters: string[] = [];
	const encoder = new TextEncoder();
	let bytes = 0;
	for (const character of name) {
		bytes += encoder.encode(character).length;
		if (bytes > 200) break;
		characters.push(character);
	}
	name = characters.join('').replace(/[. ]+$/, '');
	if (!name) name = 'Untitled scene';
	if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)) name = `_${name}`;
	return `${name}.marble`;
}

export function readWorkingProject(saved: string | null): TWorkingProject {
	if (saved == null) return { project: null, error: null };
	try {
		return { project: parseProjectFile(saved), error: null };
	} catch (error) {
		return {
			project: null,
			error:
				error instanceof Error ? error.message : 'The browser working copy could not be opened.'
		};
	}
}

interface TWorkingProject {
	project: TProject | null;
	error: string | null;
}
