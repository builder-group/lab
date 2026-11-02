import type { TProjectFile, TProjectRecord } from '../../environment/desktop';
import { prepareProject, type TProject } from '../project/model';

// Retain the original preview key so existing browser projects remain available
const STORAGE_KEY = 'yadori.next.projects';

export function listBrowserProjects(): TProjectRecord[] {
	return readProjects().map(record);
}
export function saveBrowserProject(project: TProject): TProjectFile {
	const projects = readProjects();
	localStorage.setItem(
		STORAGE_KEY,
		JSON.stringify([...projects.filter((p) => p.id !== project.id), project])
	);
	return { ...record(project), content: JSON.stringify(project), path: 'Browser preview' };
}
export function openBrowserProject(id: string): TProjectFile {
	const project = readProjects().find((p) => p.id === id);
	if (!project) throw new Error('Project not found.');
	return { ...record(project), content: JSON.stringify(project), path: 'Browser preview' };
}

export function exportBrowserProject(project: TProject): void {
	const url = URL.createObjectURL(
		new Blob([JSON.stringify(project)], { type: 'application/json' })
	);
	const anchor = document.createElement('a');
	anchor.href = url;
	anchor.download = `${project.name}.json`;
	anchor.click();
	setTimeout(() => URL.revokeObjectURL(url), 5000);
}

function readProjects(): TProject[] {
	const value: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]');
	if (!Array.isArray(value))
		throw new Error(
			'Saved browser projects are not valid. Export or repair the local data before saving.'
		);
	return value.map(prepareProject);
}
function record(project: TProject): TProjectRecord {
	return {
		id: project.id,
		name: project.name,
		revision: project.revision,
		updatedAt: project.updatedAt
	};
}
