import { createState } from 'feature-state';

/** How long the pill stays after the last call, so a run of calls reads as one */
export const PRESENCE_HOLD_MS = 1500;
/** How long a touched piece or layer stays marked; the fade in `styles.css` lasts as long */
export const TOUCH_MS = 1000;
/** Calls on their way when the person pressed Stop are turned away too */
export const STOP_GRACE_MS = 1500;
const MAX_TOUCHED = 32;

/**
 * An agent in the window: what it is doing while its calls run, and what its edits just touched. State changes only
 * when a call starts or ends and when an edit lands; everything that moves is a CSS animation.
 */
export class AgentPresenceCx {
	/** What the pill shows, null when no agent is at work */
	readonly $current = createState<TAgentPresence | null>(null);
	/** What an agent's latest edits changed; `stamp` restarts the mark when the same piece is touched again */
	readonly $touched = createState<readonly TTouched[]>([]);

	private running: { id: number; label: string }[] = [];
	private nextId = 0;
	private nextStamp = 0;
	private isStopping = false;
	private stoppedAt = Number.NEGATIVE_INFINITY;
	private epoch = 0;
	private holdTimer: ReturnType<typeof setTimeout> | undefined;

	/** A call starts; the returned function ends it */
	begin(label: string): () => void {
		clearTimeout(this.holdTimer);
		const id = this.nextId++;
		this.running.push({ id, label });
		this.publish();
		return () => this.end(id);
	}

	/** Says better what the latest call is doing, once it knows */
	relabel(label: string): void {
		const latest = this.running[this.running.length - 1];
		if (latest == null || latest.label === label) return;
		latest.label = label;
		this.publish();
	}

	/** The person pressed Stop. `stopEpoch` changes, so calls that were running or waiting can tell. */
	requestStop(): void {
		this.epoch++;
		this.stoppedAt = Date.now();
		clearTimeout(this.holdTimer);
		if (this.running.length > 0) {
			this.isStopping = true;
			this.publish();
		} else this.$current.set(null);
	}

	get stopEpoch(): number {
		return this.epoch;
	}

	/** Stop was just pressed: a call arriving now was sent before the agent could know */
	get isStopHeld(): boolean {
		return Date.now() - this.stoppedAt < STOP_GRACE_MS;
	}

	touch(keys: readonly string[]): void {
		if (!keys.length) return;
		const stamp = this.nextStamp++;
		const fresh = keys.slice(0, MAX_TOUCHED).map((key) => ({ key, stamp }));
		const isFresh = new Set(keys);
		this.$touched.set([...this.$touched.get().filter((item) => !isFresh.has(item.key)), ...fresh]);
		setTimeout(() => {
			this.$touched.set(this.$touched.get().filter((item) => item.stamp !== stamp));
		}, TOUCH_MS);
	}

	dispose(): void {
		clearTimeout(this.holdTimer);
	}

	private end(id: number): void {
		const index = this.running.findIndex((call) => call.id === id);
		if (index < 0) return;
		this.running.splice(index, 1);
		if (this.running.length > 0) {
			this.publish();
			return;
		}
		if (this.isStopping) {
			this.isStopping = false;
			this.$current.set(null);
			return;
		}
		this.holdTimer = setTimeout(() => this.$current.set(null), PRESENCE_HOLD_MS);
	}

	private publish(): void {
		const label = this.running[this.running.length - 1]?.label;
		if (label == null) return;
		const current = this.$current.get();
		if (current?.label !== label || current.isStopping !== this.isStopping) this.$current.set({ label, isStopping: this.isStopping });
	}
}

export interface TAgentPresence {
	label: string;
	isStopping: boolean;
}

export interface TTouched {
	key: string;
	stamp: number;
}
