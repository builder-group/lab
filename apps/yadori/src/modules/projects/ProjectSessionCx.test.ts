import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getNotesDraft } from '../parts/components/NotesDraftCx';
import { createPart, type TProject } from '../project/model';
import { ProjectSessionCx } from './ProjectSessionCx';

const host = vi.hoisted(() => ({
	files: new Map<
		string,
		{ content: string; path: string; id: string; name: string; revision: number; updatedAt: string }
	>(),
	save: vi.fn(),
	export: vi.fn(),
	import: vi.fn()
}));
vi.mock('../../environment/desktop', () => ({
	isDesktop: () => true,
	listProjects: async () => [...host.files.values()],
	createProject: async (content: string) => {
		const p = JSON.parse(content) as TProject;
		const file = {
			content,
			path: `/${p.id}`,
			id: p.id,
			name: p.name,
			revision: p.revision,
			updatedAt: p.updatedAt
		};
		host.files.set(p.id, file);
		return file;
	},
	openProject: async (id: string) => {
		const file = host.files.get(id);
		if (!file) throw new Error('Missing project');
		return file;
	},
	saveProject: host.save,
	exportProject: host.export,
	importProject: host.import
}));

beforeEach(() => {
	vi.useFakeTimers();
	host.files.clear();
	host.save.mockReset();
	host.export.mockReset();
	host.import.mockReset();
	host.import.mockResolvedValue(null);
	host.save.mockImplementation(async (id: string, content: string, expected: number) => {
		const current = host.files.get(id);
		if (current?.revision !== expected) throw new Error('Conflict');
		const p = JSON.parse(content) as TProject;
		const file = {
			...current,
			id,
			content,
			path: `/${id}`,
			name: p.name,
			revision: p.revision,
			updatedAt: p.updatedAt
		};
		host.files.set(id, file);
		return file;
	});
});
afterEach(() => {
	vi.clearAllTimers();
	vi.useRealTimers();
});

describe('managed project session', () => {
	it('blocks edits and history changes while close persists the current project', async () => {
		const session = new ProjectSessionCx();
		await session.create('Build');
		const part = createPart('Battery');
		session.execute([{ type: 'part.add', part }]);
		let finish: (() => void) | undefined;
		const normalSave = host.save.getMockImplementation();
		host.save.mockImplementationOnce(async (...args: unknown[]) => {
			await new Promise<void>((resolve) => {
				finish = resolve;
			});
			return normalSave?.(...args);
		});
		const closing = session.close();
		await Promise.resolve();
		expect(
			session.execute([{ type: 'part.update', id: part.id, patch: { name: 'Late edit' } }])
		).toBe(false);
		session.undo();
		expect(session.$history.get().undo).toBe(1);
		expect(finish).toBeTypeOf('function');
		finish?.();
		expect(await closing).toBe(true);
		expect(session.$project.get()).toBeNull();
		const saved = [...host.files.values()][0];
		expect(JSON.parse(saved?.content ?? '{}').parts[0].name).toBe('Battery');
	});
	it('retains a failed-save project in memory and supports a later retry', async () => {
		const session = new ProjectSessionCx();
		await session.create('Build');
		session.execute([{ type: 'part.add', part: createPart('Pump') }]);
		host.save.mockRejectedValueOnce(new Error('Disk unavailable'));
		await session.flush();
		expect(session.$save.get().state).toBe('error');
		expect(await session.close()).toBe(false);
		expect(session.$project.get()?.parts[0]?.name).toBe('Pump');
		await session.retrySave();
		expect(session.$save.get().state).toBe('saved');
		expect(await session.close()).toBe(true);
	});
	it('exports the in-memory recovery snapshot after a failed save', async () => {
		const session = new ProjectSessionCx();
		await session.create('Build');
		session.execute([{ type: 'part.add', part: createPart('Fuse') }]);
		host.save.mockRejectedValueOnce(new Error('Disk unavailable'));
		await session.flush();
		await session.export();
		const [id, content] = host.export.mock.calls[0] ?? [];
		expect(id).toBe(session.$project.get()?.id);
		expect(JSON.parse(content).parts[0].name).toBe('Fuse');
		expect(session.$save.get().state).toBe('error');
	});
	it('undo restores values while maintaining a monotonically increasing revision', async () => {
		const session = new ProjectSessionCx();
		await session.create('Build');
		const part = createPart('Cable');
		session.execute([{ type: 'part.add', part }]);
		session.execute([{ type: 'part.update', id: part.id, patch: { name: 'Thick cable' } }]);
		session.undo();
		expect(session.$project.get()?.parts[0]?.name).toBe('Cable');
		expect(session.$project.get()?.revision).toBe(3);
		session.redo();
		expect(session.$project.get()?.parts[0]?.name).toBe('Thick cable');
		expect(session.$project.get()?.revision).toBe(4);
		await session.close();
	});
	it('commits a burst of notes once after 250ms without publishing a project per keystroke', async () => {
		const { session, part, draft } = await notesFixture();
		const before = session.$project.get();
		draft.change('A');
		await vi.advanceTimersByTimeAsync(150);
		draft.change('A pump');
		await vi.advanceTimersByTimeAsync(249);
		expect(session.$project.get()).toBe(before);
		expect(host.save).not.toHaveBeenCalled();
		await vi.advanceTimersByTimeAsync(1);
		expect(session.$project.get()?.parts.find((p) => p.id === part.id)?.notes).toBe('A pump');
		expect(session.$project.get()?.revision).toBe((before?.revision ?? 0) + 1);
		await session.close();
	});
	it('flushes pending notes before a close locks editing and persists them', async () => {
		const { session, part, draft } = await notesFixture();
		const suspended = vi.fn();
		const detach = draft.mount(suspended);
		draft.change('Last sentence before closing');
		expect(await session.close()).toBe(true);
		expect(savedNotes(part.id)).toBe('Last sentence before closing');
		expect(suspended.mock.calls.map(([value]) => value)).toContain(true);
		expect(session.$project.get()).toBeNull();
		await vi.advanceTimersByTimeAsync(1000);
		expect(host.save).toHaveBeenCalledTimes(1);
		detach();
	});
	it('rejects late editor transactions while a close is saving and resumes after a failed close', async () => {
		const { session, part, draft } = await notesFixture();
		const detach = draft.mount(() => undefined);
		draft.change('Accepted before close');
		let rejectSave: ((error: Error) => void) | undefined;
		host.save.mockImplementationOnce(
			() =>
				new Promise((_, reject) => {
					rejectSave = reject;
				})
		);
		const closing = session.close();
		await Promise.resolve();
		expect(draft.change('Late transaction after transition lock')).toBe(false);
		expect(draft.hasPending).toBe(false);
		expect(draft.value).toBe('Accepted before close');
		rejectSave?.(new Error('Disk unavailable'));
		expect(await closing).toBe(false);
		expect(draft.change('Accepted after close failed')).toBe(true);
		await session.retrySave();
		expect(savedNotes(part.id)).toBe('Accepted after close failed');
		detach();
		expect(await session.close()).toBe(true);
	});
	it('saves a draft to its original project before opening another project', async () => {
		const { session, part } = await notesFixture();
		const originalId = session.$project.get()?.id ?? '';
		await session.create('Other project');
		const otherId = session.$project.get()?.id ?? '';
		await session.open(originalId);
		const draft = getNotesDraft(session, originalId, part.id);
		draft.change('Belongs to the first build');
		await session.open(otherId);
		expect(savedNotes(part.id)).toBe('Belongs to the first build');
		expect(session.$project.get()?.id).toBe(otherId);
		expect(session.$project.get()?.parts).toHaveLength(0);
		await session.close();
	});
	it('includes pending notes in create, import and recovery export boundaries', async () => {
		const { session, part, draft } = await notesFixture();
		const originalId = session.$project.get()?.id ?? '';
		draft.change('Before create');
		await session.create('Next');
		expect(savedNotes(part.id)).toBe('Before create');
		await session.open(originalId);
		const reopened = getNotesDraft(session, originalId, part.id);
		reopened.refresh();
		reopened.change('Before import');
		await session.import();
		expect(savedNotes(part.id)).toBe('Before import');
		expect(host.import).toHaveBeenCalledTimes(1);
		reopened.change('Last unsaved export sentence');
		host.save.mockRejectedValueOnce(new Error('Disk unavailable'));
		await session.export();
		const [, content] = host.export.mock.calls[0] ?? [];
		expect((JSON.parse(content) as TProject).parts[0]?.notes).toBe('Last unsaved export sentence');
		expect(session.$save.get().state).toBe('error');
		expect(session.$project.get()?.parts[0]?.notes).toBe('Last unsaved export sentence');
	});
	it('flushes a pending typing group before undo and restores it with redo', async () => {
		const { session, part, draft } = await notesFixture('Original notes');
		draft.change('One typing group');
		session.undo();
		expect(session.$project.get()?.parts.find((p) => p.id === part.id)?.notes).toBe(
			'Original notes'
		);
		expect(draft.hasPending).toBe(false);
		session.redo();
		expect(session.$project.get()?.parts.find((p) => p.id === part.id)?.notes).toBe(
			'One typing group'
		);
		await session.close();
	});
	it('flushes on editor unmount and protects the latest session from an older prop effect', async () => {
		const { session, part, draft } = await notesFixture('Before');
		const detach = draft.mount(() => undefined);
		draft.change('Written before changing parts');
		detach();
		draft.refresh();
		expect(draft.value).toBe('Written before changing parts');
		expect(session.$project.get()?.parts.find((p) => p.id === part.id)?.notes).toBe(draft.value);
		await session.flush();
		expect(savedNotes(part.id)).toBe(draft.value);
		await session.close();
	});
	it('retains a conflicting draft across unmount and blocks close until the user resolves it', async () => {
		const { session, part, draft } = await notesFixture('Original');
		const projectId = session.$project.get()?.id ?? '';
		const detach = draft.mount(() => undefined);
		draft.change('My local draft');
		session.execute([{ type: 'part.update', id: part.id, patch: { notes: 'Incoming edit' } }]);
		draft.refresh();
		expect(draft.$issue.get()).toBe('conflict');
		detach();
		expect(await session.close()).toBe(false);
		expect(session.$save.get().state).toBe('error');
		const recovered = getNotesDraft(session, projectId, part.id);
		expect(recovered).toBe(draft);
		expect(recovered.value).toBe('My local draft');
		expect(session.$project.get()?.parts[0]?.notes).toBe('Incoming edit');
		expect(recovered.keepDraft()).toBe(true);
		expect(await session.close()).toBe(true);
		expect(savedNotes(part.id)).toBe('My local draft');
	});
	it('lets the user accept incoming notes without committing or reviving the discarded draft', async () => {
		const { session, part, draft } = await notesFixture('Original');
		draft.change('My draft');
		session.execute([{ type: 'part.update', id: part.id, patch: { notes: 'Incoming edit' } }]);
		expect(session.flushPendingEdits()).toBe(false);
		const revision = session.$project.get()?.revision;
		draft.acceptIncoming();
		expect(draft.value).toBe('Incoming edit');
		expect(session.$project.get()?.revision).toBe(revision);
		await vi.advanceTimersByTimeAsync(250);
		expect(session.$project.get()?.parts[0]?.notes).toBe('Incoming edit');
		expect(await session.close()).toBe(true);
	});
	it('flushes drafts before removing a part so undo can recover its latest notes', async () => {
		const { session, part, draft } = await notesFixture();
		draft.change('Notes must survive deletion undo');
		session.execute([{ type: 'part.remove', id: part.id }]);
		expect(session.$project.get()?.parts).toHaveLength(0);
		session.undo();
		expect(session.$project.get()?.parts[0]?.notes).toBe('Notes must survive deletion undo');
		await session.close();
	});
	it('retains a disk error when an incoming-notes conflict is resolved', async () => {
		const { session, part, draft } = await notesFixture('Original');
		session.execute([{ type: 'part.update', id: part.id, patch: { name: 'Water pump' } }]);
		host.save.mockRejectedValueOnce(new Error('Disk unavailable'));
		await session.flush();
		draft.change('Local notes');
		session.execute([{ type: 'part.update', id: part.id, patch: { notes: 'Incoming' } }]);
		expect(session.flushPendingEdits()).toBe(false);
		draft.acceptIncoming();
		expect(session.$save.get().state).toBe('error');
		expect(session.$save.get().error).toBe('Disk unavailable');
		expect(await session.close()).toBe(false);
		await session.retrySave();
		expect(await session.close()).toBe(true);
	});
	it('handles nested pending flushes and stale registration cleanup without losing a new editor', async () => {
		const { session, part } = await notesFixture();
		const old = session.registerPendingEdit('editor', { flush: () => true });
		let pending = true;
		const flush = vi.fn(() => {
			if (pending) {
				pending = false;
				expect(session.flushPendingEdits()).toBe(true);
				return session.execute([
					{ type: 'part.update', id: part.id, patch: { notes: 'Nested flush' } }
				]);
			}
			return true;
		});
		session.registerPendingEdit('editor', { flush });
		old();
		await session.flush();
		expect(flush).toHaveBeenCalledTimes(1);
		expect(savedNotes(part.id)).toBe('Nested flush');
		await session.close();
	});
});

async function notesFixture(notes = '') {
	const session = new ProjectSessionCx();
	await session.create('Notes build');
	const part = createPart('Pump', { notes });
	session.execute([{ type: 'part.add', part }]);
	await session.flush();
	host.save.mockClear();
	const draft = getNotesDraft(session, session.$project.get()?.id ?? '', part.id);
	return { session, part, draft };
}
function savedNotes(partId: string): string | undefined {
	for (const file of host.files.values()) {
		const part = (JSON.parse(file.content) as TProject).parts.find((part) => part.id === partId);
		if (part) return part.notes;
	}
	return undefined;
}
