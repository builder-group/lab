import { isDesktop } from './desktop';

export async function openLink(value: string): Promise<void> {
	let url: URL;
	try {
		url = new URL(value);
	} catch {
		return;
	}
	if (!['https:', 'http:'].includes(url.protocol)) return;
	if (isDesktop()) {
		const { openUrl } = await import('@tauri-apps/plugin-opener');
		await openUrl(url.href);
	} else window.open(url.href, '_blank', 'noopener,noreferrer');
}
