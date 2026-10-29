import React from 'react';
import {
	archiveLibraryProject,
	listArchivedLibraryProjects,
	listLibraryProjects,
	loadLibraryProject,
	readWorkingProject,
	restoreLibraryProject,
	saveLibraryProject,
	serializeProjectFile,
	type TProject,
	type TProjectSummary
} from '../project';

export function useProjectSession(): TProjectSession {
	const [session, setSession] = React.useState<TProjectSessionState>({
		ready: false,
		initialProject: null,
		initialError: null,
		recentProjects: [],
		archivedProjects: []
	});

	React.useEffect(() => {
		let cancelled = false;
		async function restore() {
			const errors = new Set<string>();
			let lastId: string | null = null;
			let legacy: TProject | null = null;
			try {
				lastId = localStorage.getItem(LAST_PROJECT_KEY);
			} catch (error) {
				errors.add(
					getErrorMessage(error, 'The last project could not be read from browser storage.')
				);
			}
			try {
				const workingCopy = readWorkingProject(localStorage.getItem(WORKING_COPY_KEY));
				legacy = workingCopy.project;
				if (workingCopy.error != null) errors.add(workingCopy.error);
			} catch (error) {
				errors.add(getErrorMessage(error, 'The browser recovery copy could not be read.'));
			}

			let recentProjects: TProjectSummary[] = [];
			let archivedProjects: TProjectSummary[] = [];
			const [recentResult, archivedResult] = await Promise.allSettled([
				listLibraryProjects(),
				listArchivedLibraryProjects()
			]);
			if (recentResult.status === 'fulfilled') recentProjects = recentResult.value;
			else
				errors.add(
					getErrorMessage(recentResult.reason, 'The browser project library could not be read.')
				);
			if (archivedResult.status === 'fulfilled') archivedProjects = archivedResult.value;
			else
				errors.add(getErrorMessage(archivedResult.reason, 'Archived projects could not be read.'));
			const archivedIds = new Set(archivedProjects.map((project) => project.id));

			let initialProject: TProject | null = null;
			if (lastId != null && !archivedIds.has(lastId)) {
				try {
					initialProject = await loadLibraryProject(lastId);
				} catch (error) {
					errors.add(getErrorMessage(error, 'The last library project could not be opened.'));
				}
			}
			if (legacy != null && !archivedIds.has(legacy.id)) initialProject ??= legacy;
			const latest = recentProjects[0];
			if (initialProject == null && latest != null && latest.id !== lastId) {
				try {
					initialProject = await loadLibraryProject(latest.id);
				} catch (error) {
					errors.add(getErrorMessage(error, 'The latest library project could not be opened.'));
				}
			}
			if (cancelled) return;
			setSession({
				ready: true,
				initialProject,
				initialError: errors.size > 0 ? Array.from(errors).join(' ') : null,
				recentProjects,
				archivedProjects
			});
		}
		void restore();
		return () => {
			cancelled = true;
		};
	}, []);

	const persistProject = React.useCallback(async (project: TProject): Promise<void> => {
		const text = serializeProjectFile(project);
		let libraryError: string | null = null;
		try {
			const summary = await saveLibraryProject(project);
			setSession((current) => ({
				...current,
				recentProjects: [
					summary,
					...current.recentProjects.filter((entry) => entry.id !== summary.id)
				].sort((left, right) => right.updatedAt - left.updatedAt),
				archivedProjects: current.archivedProjects.filter((entry) => entry.id !== summary.id)
			}));
		} catch (error) {
			libraryError = getErrorMessage(error, 'The browser project library is unavailable.');
		}

		if (libraryError == null) {
			try {
				localStorage.setItem(LAST_PROJECT_KEY, project.id);
			} catch {
				// The saved project remains available through the library when this pointer is unavailable.
			}
		}
		let recoverySaved = false;
		try {
			localStorage.setItem(WORKING_COPY_KEY, text);
			recoverySaved = true;
			if (libraryError != null) localStorage.removeItem(LAST_PROJECT_KEY);
		} catch {
			// A completed library transaction already preserves this project if recovery storage is full.
		}
		if (libraryError == null) return;
		if (recoverySaved) {
			throw new Error(
				`A working recovery copy was saved, but the project library is unavailable. Download a .marble file to keep this project. ${libraryError}`
			);
		}
		throw new Error(
			`This project could not be saved in browser storage. Download a .marble file to keep this project. ${libraryError}`
		);
	}, []);

	const loadRecentProject = React.useCallback(
		(id: string): Promise<TProject | null> => loadLibraryProject(id),
		[]
	);

	const refreshProjects = React.useCallback(async (): Promise<void> => {
		const [recentProjects, archivedProjects] = await Promise.all([
			listLibraryProjects(),
			listArchivedLibraryProjects()
		]);
		setSession((current) => ({ ...current, recentProjects, archivedProjects }));
	}, []);

	const archiveProject = React.useCallback(
		async (id: string): Promise<void> => {
			await archiveLibraryProject(id);
			await refreshProjects();
		},
		[refreshProjects]
	);

	const restoreProject = React.useCallback(
		async (id: string): Promise<void> => {
			await restoreLibraryProject(id);
			await refreshProjects();
		},
		[refreshProjects]
	);

	return { ...session, persistProject, loadRecentProject, archiveProject, restoreProject };
}

interface TProjectSessionState {
	ready: boolean;
	initialProject: TProject | null;
	initialError: string | null;
	recentProjects: TProjectSummary[];
	archivedProjects: TProjectSummary[];
}

interface TProjectSession extends TProjectSessionState {
	persistProject: (project: TProject) => Promise<void>;
	loadRecentProject: (id: string) => Promise<TProject | null>;
	archiveProject: (id: string) => Promise<void>;
	restoreProject: (id: string) => Promise<void>;
}

const LAST_PROJECT_KEY = 'midimarble.last-project-id';
const WORKING_COPY_KEY = 'midimarble.project.v1';

function getErrorMessage(error: unknown, fallback: string): string {
	return error instanceof Error ? error.message : fallback;
}
