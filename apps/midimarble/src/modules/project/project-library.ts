import { parseProjectFile, serializeProjectFile } from './project-file';
import type { TProject } from './types';

export async function saveLibraryProject(project: TProject): Promise<TProjectSummary> {
	const document = parseProjectFile(serializeProjectFile(project));
	const summary: TProjectSummary = {
		id: document.id,
		name: document.name,
		updatedAt: Date.now(),
		noteCount: document.notes.length,
		objectCount: document.objects.length
	};
	await runLibraryTransaction('readwrite', (store) => store.put({ ...summary, project: document }));
	return summary;
}

export function listLibraryProjects(): Promise<TProjectSummary[]> {
	return listProjectSummaries(false);
}

export function listArchivedLibraryProjects(): Promise<TProjectSummary[]> {
	return listProjectSummaries(true);
}

export function archiveLibraryProject(id: string): Promise<void> {
	return setProjectArchived(id, true);
}

export function restoreLibraryProject(id: string): Promise<void> {
	return setProjectArchived(id, false);
}

export async function loadLibraryProject(id: string): Promise<TProject | null> {
	const record = await runLibraryTransaction<TStoredProject | undefined>('readonly', (store) =>
		store.get(id)
	);
	if (record == null) return null;
	return parseProjectFile(JSON.stringify(record.project));
}

export interface TProjectSummary {
	id: string;
	name: string;
	updatedAt: number;
	noteCount: number;
	objectCount: number;
	archivedAt?: number;
}

interface TStoredProject extends TProjectSummary {
	project: TProject;
}

async function listProjectSummaries(archived: boolean): Promise<TProjectSummary[]> {
	const records = await runLibraryTransaction<TStoredProject[]>('readonly', (store) =>
		store.getAll()
	);
	return records
		.filter((record) => (record.archivedAt != null) === archived)
		.map(({ id, name, updatedAt, noteCount, objectCount, archivedAt }) => ({
			id,
			name,
			updatedAt,
			noteCount,
			objectCount,
			...(archivedAt == null ? {} : { archivedAt })
		}))
		.sort(
			(left, right) => (right.archivedAt ?? right.updatedAt) - (left.archivedAt ?? left.updatedAt)
		);
}

async function setProjectArchived(id: string, archived: boolean): Promise<void> {
	const database = await openLibraryDatabase();
	return new Promise<void>((resolve, reject) => {
		const transaction = database.transaction('projects', 'readwrite');
		const store = transaction.objectStore('projects');
		const request: IDBRequest<TStoredProject | undefined> = store.get(id);
		let missing = false;
		transaction.oncomplete = () => resolve();
		transaction.onabort = () => {
			if (missing) {
				reject(new Error('This project is no longer available in the browser library.'));
				return;
			}
			reject(
				new Error(
					`The project could not be ${archived ? 'archived' : 'restored'}. ${transaction.error?.message ?? 'Browser storage rejected the operation.'}`
				)
			);
		};
		request.onsuccess = () => {
			if (request.result == null) {
				missing = true;
				transaction.abort();
				return;
			}
			const record = { ...request.result };
			if (archived) record.archivedAt = Date.now();
			else delete record.archivedAt;
			store.put(record);
		};
	});
}

async function runLibraryTransaction<T>(
	mode: IDBTransactionMode,
	operation: (store: IDBObjectStore) => IDBRequest<T>
): Promise<T> {
	const database = await openLibraryDatabase();
	return new Promise<T>((resolve, reject) => {
		const transaction = database.transaction('projects', mode);
		const request = operation(transaction.objectStore('projects'));
		transaction.oncomplete = () => resolve(request.result);
		transaction.onabort = () => {
			const action = mode === 'readwrite' ? 'saved' : 'read';
			reject(
				new Error(
					`The browser project library could not be ${action}. ${transaction.error?.message ?? 'Browser storage rejected the operation.'}`
				)
			);
		};
	});
}

let libraryDatabase: Promise<IDBDatabase> | null = null;

function openLibraryDatabase(): Promise<IDBDatabase> {
	if (typeof indexedDB === 'undefined') {
		return Promise.reject(
			new Error('This browser does not provide storage for the project library.')
		);
	}
	if (libraryDatabase != null) return libraryDatabase;
	const opening = new Promise<IDBDatabase>((resolve, reject) => {
		const request = indexedDB.open('midimarble', 1);
		let blocked = false;
		request.onupgradeneeded = () => {
			if (!request.result.objectStoreNames.contains('projects')) {
				request.result.createObjectStore('projects', { keyPath: 'id' });
			}
		};
		request.onerror = () =>
			reject(
				new Error(
					`The browser project library could not be opened. ${request.error?.message ?? 'Check browser storage permissions.'}`
				)
			);
		request.onblocked = () => {
			blocked = true;
			reject(
				new Error('Close other MidiMarble tabs and retry opening the browser project library.')
			);
		};
		request.onsuccess = () => {
			const database = request.result;
			if (blocked) {
				database.close();
				return;
			}
			database.onversionchange = () => {
				database.close();
				libraryDatabase = null;
			};
			resolve(database);
		};
	});
	libraryDatabase = opening.catch((error: unknown) => {
		libraryDatabase = null;
		throw error;
	});
	return libraryDatabase;
}
