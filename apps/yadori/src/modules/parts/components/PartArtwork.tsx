import { Box } from 'lucide-react';
import React from 'react';
import { isDesktop, readProjectAsset } from '../../../environment/desktop';
import { getLibraryAssetUrl } from '../../library/data';
import { getCapability, type TPart, type TProject } from '../../project/model';

const assetCache = new Map<string, string>();
const pendingAssets = new Map<string, Promise<string>>();
const MAX_CACHE_CHARACTERS = 24 * 1024 * 1024;
let cachedCharacters = 0;

function loadArtwork(key: string, projectId: string, path: string): Promise<string> {
	const cached = assetCache.get(key);
	if (cached) return Promise.resolve(cached);
	const pending = pendingAssets.get(key);
	if (pending) return pending;
	const request = readProjectAsset(projectId, path)
		.then((url) => {
			if (url.length <= MAX_CACHE_CHARACTERS) {
				assetCache.set(key, url);
				cachedCharacters += url.length;
				while (assetCache.size > 64 || cachedCharacters > MAX_CACHE_CHARACTERS) {
					const oldest = assetCache.entries().next().value;
					if (!oldest) break;
					assetCache.delete(oldest[0]);
					cachedCharacters -= oldest[1].length;
				}
			}
			return url;
		})
		.finally(() => pendingAssets.delete(key));
	pendingAssets.set(key, request);
	return request;
}
export const PartArtwork: React.FC<{ part: TPart; project: TProject; className?: string }> = ({
	part,
	project,
	className = ''
}) => {
	const appearance = getCapability(part, 'appearance');
	const assetId =
		appearance && 'assetId' in appearance && typeof appearance.assetId === 'string'
			? appearance.assetId
			: null;
	const [loaded, setLoaded] = React.useState<{ key: string; url: string } | null>(null);
	const cacheKey = `${project.id}:${assetId ?? ''}`;
	const bundled = assetId ? getLibraryAssetUrl(assetId) : null;
	const path = project.assets.find((asset) => asset.id === assetId)?.relativePath;
	React.useEffect(() => {
		if (!path || !isDesktop() || bundled) return;
		let disposed = false;
		void loadArtwork(cacheKey, project.id, path)
			.then((url) => {
				if (disposed) return;
				setLoaded((current) =>
					current?.key === cacheKey && current.url === url ? current : { key: cacheKey, url }
				);
			})
			.catch(() => undefined);
		return () => {
			disposed = true;
		};
	}, [path, cacheKey, project.id, bundled]);
	const url = assetCache.get(cacheKey) ?? (loaded?.key === cacheKey ? loaded.url : null) ?? bundled;
	return (
		<span className={`part-artwork ${className}`}>
			{url ? (
				<img src={url} alt="" draggable={false} decoding="async" />
			) : (
				<Box size={20} strokeWidth={1.4} />
			)}
		</span>
	);
};
