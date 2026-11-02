import { createState } from 'feature-state';
import type { ProjectSessionCx, TPendingEdit } from '../../projects/ProjectSessionCx';

/** The editor owns its document between commits; failed drafts stay associated with their session and part. */
export class NotesDraftCx {
	readonly $issue = createState<TNotesIssue>(null);
	private base: string;
	private draft: string;
	private pending = false;
	private suspended = false;
	private timer: ReturnType<typeof setTimeout> | undefined;
	private unregister: (() => void) | undefined;
	private listeners = new Set<(suspended: boolean) => void>();
	private readonly edit: TPendingEdit = {
		flush: () => this.flush(),
		setSuspended: (value) => {
			this.suspended = value;
			for (const listener of this.listeners) listener(value);
		}
	};
	constructor(
		private readonly session: ProjectSessionCx,
		private readonly projectId: string,
		private readonly partId: string
	) {
		this.base = this.read() ?? '';
		this.draft = this.base;
	}
	get value(): string {
		return this.draft;
	}
	get hasPending(): boolean {
		return this.pending;
	}
	mount(onSuspended: (value: boolean) => void): () => void {
		this.ensureRegistered();
		this.listeners.add(onSuspended);
		onSuspended(this.suspended);
		return () => {
			this.flush();
			this.listeners.delete(onSuspended);
			this.releaseIfClean();
		};
	}
	change(value: string): boolean {
		if (this.suspended) return false;
		if (value === this.draft) return true;
		this.draft = value;
		this.pending = value !== this.base || this.read() !== this.base;
		clearTimeout(this.timer);
		if (!this.pending) {
			this.setIssue(null);
			this.releaseIfClean();
			return true;
		}
		this.ensureRegistered();
		this.timer = setTimeout(() => this.flush(), 250);
		return true;
	}
	/** Read the live session rather than a potentially older React prop effect. */
	refresh(): void {
		const incoming = this.read();
		if (incoming == null) {
			if (this.pending) this.setIssue('missing');
			return;
		}
		if (!this.pending || incoming === this.draft) {
			this.base = incoming;
			this.draft = incoming;
			this.pending = false;
			clearTimeout(this.timer);
			this.setIssue(null);
			this.releaseIfClean();
		} else if (incoming !== this.base) this.setIssue('conflict');
		else if (this.$issue.get() === 'conflict') this.setIssue(null);
	}
	flush(): boolean {
		clearTimeout(this.timer);
		this.refresh();
		if (!this.pending) return true;
		if (this.suspended || this.read() == null || this.read() !== this.base) return false;
		const saved = this.session.execute(
			[{ type: 'part.update', id: this.partId, patch: { notes: this.draft } }],
			'Edit notes',
			`notes:${this.projectId}:${this.partId}`
		);
		if (!saved) {
			this.setIssue('commit');
			return false;
		}
		this.base = this.draft;
		this.pending = false;
		this.setIssue(null);
		this.releaseIfClean();
		return true;
	}
	keepDraft(): boolean {
		const incoming = this.read();
		if (incoming == null) return false;
		this.base = incoming;
		this.setIssue(null);
		const saved = this.flush();
		if (saved) this.session.flushPendingEdits();
		return saved;
	}
	acceptIncoming(): void {
		const incoming = this.read();
		if (incoming == null) return;
		clearTimeout(this.timer);
		this.base = incoming;
		this.draft = incoming;
		this.pending = false;
		this.setIssue(null);
		this.releaseIfClean();
		this.session.flushPendingEdits();
	}
	private read(): string | null {
		const project = this.session.$project.get();
		if (project?.id !== this.projectId) return null;
		return project.parts.find((part) => part.id === this.partId)?.notes ?? null;
	}
	private ensureRegistered(): void {
		this.unregister ??= this.session.registerPendingEdit(
			`notes:${this.projectId}:${this.partId}`,
			this.edit
		);
	}
	private releaseIfClean(): void {
		if (!this.pending && !this.listeners.size) {
			this.unregister?.();
			this.unregister = undefined;
		}
	}
	private setIssue(value: TNotesIssue): void {
		if (this.$issue.get() !== value) this.$issue.set(value);
	}
}
export type TNotesIssue = 'conflict' | 'missing' | 'commit' | null;

const drafts = new WeakMap<ProjectSessionCx, Map<string, NotesDraftCx>>();
export function getNotesDraft(
	session: ProjectSessionCx,
	projectId: string,
	partId: string
): NotesDraftCx {
	let entries = drafts.get(session);
	if (!entries) {
		entries = new Map();
		drafts.set(session, entries);
	}
	const key = `${projectId}:${partId}`;
	let draft = entries.get(key);
	if (!draft) {
		draft = new NotesDraftCx(session, projectId, partId);
		entries.set(key, draft);
	}
	return draft;
}
