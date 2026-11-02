export function getIdealoProductId(value: string): string | null {
	try {
		const url = new URL(value);
		if (url.protocol !== 'https:' || !['idealo.de', 'www.idealo.de'].includes(url.hostname))
			return null;
		return (
			/^\/preisvergleich\/OffersOfProduct\/(\d+)(?:_|\/|\.html$|$)/i.exec(url.pathname)?.[1] ?? null
		);
	} catch {
		return null;
	}
}
