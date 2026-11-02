import { createState } from 'feature-state';
import {
	createLibraryPart,
	createPart,
	type TBuildState,
	type TCommand,
	type TLibraryItem,
	type TPart,
	type TSource
} from '../project/model';
import type { ProjectSessionCx } from '../projects/ProjectSessionCx';

export class PartsCx {
	readonly $filter = createState<'in-build' | 'wishlist' | 'all' | 'archived' | 'to-buy'>(
		'in-build'
	);
	readonly $query = createState('');
	readonly $tag = createState<string | null>(null);
	readonly $sort = createState<'manual' | 'name' | 'cost-high' | 'cost-low'>('manual');
	readonly $selectedId = createState<string | null>(null);
	readonly $fullPage = createState(false);
	readonly $captureOpen = createState(false);
	constructor(readonly session: ProjectSessionCx) {}
	open(id: string, full = false): void {
		this.$selectedId.set(id);
		this.$fullPage.set(full);
	}
	close(): void {
		this.$selectedId.set(null);
		this.$fullPage.set(false);
	}
	capture(text: string, name?: string, options: { open?: boolean } = {}): TPart | null {
		const project = this.session.$project.get();
		if (!project || !text.trim()) return null;
		const url = parseUrl(text);
		if (url) {
			const source = project.sources.find(
				(source) => canonicalUrl(source.url) === canonicalUrl(url.href)
			);
			if (source) {
				const existing = project.parts.find((part) => part.id === source.partId);
				this.$query.set('');
				this.$tag.set(null);
				if (existing) this.$filter.set(existing.buildState);
				this.open(source.partId);
				this.$captureOpen.set(false);
				this.session.notify('This link is already saved.');
				return project.parts.find((part) => part.id === source.partId) ?? null;
			}
		}
		const part = createPart(name?.trim() || (url ? titleFromUrl(url) : text.trim()));
		const commands: TCommand[] = [{ type: 'part.add', part }];
		if (url) commands.push({ type: 'source.add', source: makeSource(part.id, url.href) });
		if (!this.session.execute(commands, 'Add part')) return null;
		this.$captureOpen.set(false);
		this.$query.set('');
		this.$tag.set(null);
		this.$filter.set('wishlist');
		if (options.open !== false) this.open(part.id);
		return part;
	}
	addLibrary(item: TLibraryItem, buildState: TBuildState = 'wishlist'): TPart | null {
		const project = this.session.$project.get();
		if (!project) return null;
		const existing = project.parts.find(
			(part) => part.libraryLink?.itemId === item.id && part.buildState !== 'archived'
		);
		if (existing) {
			this.$query.set('');
			this.$tag.set(null);
			this.$filter.set(existing.buildState);
			this.open(existing.id);
			this.$captureOpen.set(false);
			this.session.notify('This library item is already in your parts.');
			return existing;
		}
		const part = { ...createLibraryPart(item), buildState };
		const commands: TCommand[] = [{ type: 'part.add', part }];
		if (item.sourceUrl)
			commands.push({ type: 'source.add', source: makeSource(part.id, item.sourceUrl, 'product') });
		if (!this.session.execute(commands, 'Add from library')) return null;
		this.$captureOpen.set(false);
		this.$query.set('');
		this.$tag.set(null);
		this.$filter.set(buildState === 'in-build' ? 'in-build' : 'wishlist');
		this.open(part.id);
		return part;
	}
	update(part: TPart, patch: Partial<Omit<TPart, 'id'>>, coalesceKey?: string): void {
		this.session.execute([{ type: 'part.update', id: part.id, patch }], 'Update part', coalesceKey);
	}
	setBuildState(part: TPart, buildState: TBuildState): void {
		this.update(part, { buildState });
	}
	addSource(partId: string, url: string, title?: string, kind?: TSource['kind']): void {
		const parsed = parseUrl(url);
		if (!parsed) {
			this.session.notify('Enter an http or https link.');
			return;
		}
		const project = this.session.$project.get();
		if (
			project?.sources.some(
				(source) =>
					source.partId === partId && canonicalUrl(source.url) === canonicalUrl(parsed.href)
			)
		) {
			this.session.notify('This link is already attached.');
			return;
		}
		this.session.execute(
			[
				{
					type: 'source.add',
					source: {
						...makeSource(partId, parsed.href, kind),
						...(title?.trim() ? { title: title.trim() } : {})
					}
				}
			],
			'Add link'
		);
	}
}
export function parseUrl(value: string): URL | null {
	try {
		const url = new URL(value.trim());
		return ['https:', 'http:'].includes(url.protocol) ? url : null;
	} catch {
		return null;
	}
}
export function canonicalUrl(value: string): string {
	const url = parseUrl(value);
	if (!url) return value;
	url.hash = '';
	for (const key of [...url.searchParams.keys()])
		if (/^(utm_|fbclid$|gclid$)/.test(key)) url.searchParams.delete(key);
	url.searchParams.sort();
	return url.href;
}
export function makeSource(partId: string, url: string, kind?: TSource['kind']): TSource {
	const host = parseUrl(url)?.hostname ?? '';
	return {
		id: crypto.randomUUID(),
		partId,
		kind: kind ?? (/youtu\.?be/.test(host) ? 'video' : 'product'),
		title: host.replace(/^www\./, ''),
		url,
		provider: null,
		productId: null,
		notes: ''
	};
}
function titleFromUrl(url: URL): string {
	const last = url.pathname.split('/').filter(Boolean).at(-1);
	let text: string;
	try {
		text = last
			? decodeURIComponent(last)
					.replace(/\.html?$/, '')
					.replace(/[-_]+/g, ' ')
			: '';
	} catch {
		text = '';
	}
	return text.length > 4 && !/^\d+$/.test(text)
		? text.charAt(0).toUpperCase() + text.slice(1)
		: `Part from ${url.hostname.replace(/^www\./, '')}`;
}
