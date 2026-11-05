/**
 * Decoded preview frames by URL, least recently used first out. Frames are drawn only once decoded, so playback
 * never shows a half-loaded image.
 */
export class PreviewImageCache {
	private readonly images = new Map<string, TCachedImage>();

	constructor(private readonly limit = 150) {}

	/** The decoded image of a URL, or null while it loads or when it failed */
	get(url: string): HTMLImageElement | null {
		const entry = this.images.get(url);
		if (entry == null || entry.state !== 'ready') return null;
		// Most recently used last
		this.images.delete(url);
		this.images.set(url, entry);
		return entry.image;
	}

	/** Starts decoding a URL once; `onReady` runs when it is ready to draw */
	load(url: string, onReady?: (url: string) => void): void {
		if (this.images.has(url)) return;
		const image = new Image();
		image.decoding = 'async';
		const entry: TCachedImage = { image, state: 'loading' };
		this.images.set(url, entry);
		image.src = url;
		image
			.decode()
			.then(() => {
				entry.state = 'ready';
				onReady?.(url);
			})
			.catch(() => {
				// A frame replaced while loading, or deleted with an old scene; the next request tries again
				this.images.delete(url);
			});
		this.evict();
	}

	clear(): void {
		this.images.clear();
	}

	private evict(): void {
		for (const url of this.images.keys()) {
			if (this.images.size <= this.limit) return;
			this.images.delete(url);
		}
	}
}

interface TCachedImage {
	image: HTMLImageElement;
	state: 'loading' | 'ready';
}
