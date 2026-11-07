// Request bookkeeping for a worker that answers one message at a time. Requests wait in channels, and a
// channel holds at most one waiting request: a newer one replaces it, so the worker only ever computes
// the latest question per channel. Responses are paired with their request by id; an answer for any
// other id is ignored.

export type TQueueResponse<TValue> =
	{ id: number; ok: true; value: TValue } | { id: number; ok: false; error: string };

export interface TRequestQueueOptions<TMessage> {
	/** Posts a request to the worker */
	send: (id: number, message: TMessage) => void;
	/** Lower runs first among waiting channels; channels with equal priority run oldest first */
	priority?: (channel: string) => number;
}

export interface TEnqueueOptions {
	/**
	 * When true, requests replaced while waiting resolve with the newer request's answer, which suits
	 * plain simulation. Otherwise they reject with a `SupersededError`.
	 */
	merge?: boolean;
}

export interface TRequestQueue<TMessage> {
	enqueue: <TValue>(channel: string, message: TMessage, options?: TEnqueueOptions) => Promise<TValue>;
	/** Handles a worker answer; returns false when it belongs to no running request */
	receive: (response: TQueueResponse<unknown>) => boolean;
	/** Fails the running request, for example when the worker crashed, and continues with the next */
	fail: (error: Error) => void;
	dispose: () => void;
	/** Id of the request the worker is computing, if any */
	readonly runningId: number | null;
	readonly waitingChannels: string[];
}

export class SupersededError extends Error {
	constructor() {
		super('A newer request replaced this one');
		this.name = 'SupersededError';
	}
}

export function isSuperseded(error: unknown): boolean {
	return error instanceof SupersededError;
}

interface TWaiter {
	resolve: (value: never) => void;
	reject: (error: Error) => void;
}

interface TWaiting<TMessage> {
	channel: string;
	message: TMessage;
	waiters: TWaiter[];
	order: number;
}

export function createRequestQueue<TMessage>(options: TRequestQueueOptions<TMessage>): TRequestQueue<TMessage> {
	const { send, priority = () => 0 } = options;
	const waiting = new Map<string, TWaiting<TMessage>>();
	let running: { id: number; request: TWaiting<TMessage> } | null = null;
	let nextId = 1;
	let nextOrder = 0;
	let isDisposed = false;

	function runNext(): void {
		if (running != null || isDisposed || waiting.size === 0) return;
		let chosen: TWaiting<TMessage> | null = null;
		for (const request of waiting.values()) {
			if (
				chosen == null ||
				priority(request.channel) < priority(chosen.channel) ||
				(priority(request.channel) === priority(chosen.channel) && request.order < chosen.order)
			)
				chosen = request;
		}
		if (chosen == null) return;
		waiting.delete(chosen.channel);
		running = { id: nextId++, request: chosen };
		send(running.id, chosen.message);
	}

	return {
		enqueue<TValue>(channel: string, message: TMessage, enqueueOptions: TEnqueueOptions = {}): Promise<TValue> {
			if (isDisposed) return Promise.reject(new Error('The request queue is disposed'));
			return new Promise<TValue>((resolve, reject) => {
				const waiter = { resolve: resolve as (value: never) => void, reject };
				const replaced = waiting.get(channel);
				let waiters: TWaiter[] = [waiter];
				if (replaced != null) {
					if (enqueueOptions.merge === true) waiters = [...replaced.waiters, waiter];
					else for (const old of replaced.waiters) old.reject(new SupersededError());
				}
				// A replacement keeps the replaced request's place in line, so a busy channel is not starved
				waiting.set(channel, { channel, message, waiters, order: replaced?.order ?? nextOrder++ });
				runNext();
			});
		},
		receive(response) {
			if (running == null || response.id !== running.id) return false;
			const { waiters } = running.request;
			running = null;
			for (const waiter of waiters) {
				if (response.ok) waiter.resolve(response.value as never);
				else waiter.reject(new Error(response.error));
			}
			runNext();
			return true;
		},
		fail(error) {
			const waiters = running?.request.waiters ?? [];
			running = null;
			for (const waiter of waiters) waiter.reject(error);
			runNext();
		},
		dispose() {
			isDisposed = true;
			const error = new Error('The request queue is disposed');
			for (const waiter of running?.request.waiters ?? []) waiter.reject(error);
			for (const request of waiting.values()) for (const waiter of request.waiters) waiter.reject(error);
			running = null;
			waiting.clear();
		},
		get runningId() {
			return running?.id ?? null;
		},
		get waitingChannels() {
			return [...waiting.keys()];
		}
	};
}
