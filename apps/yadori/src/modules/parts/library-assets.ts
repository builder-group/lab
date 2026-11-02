import * as desktop from '../../environment/desktop';
import { getLibraryAssetUrl, libraryAssets } from '../library/data';
import type { TCommand, TLibraryItem } from '../project/model';
import type { ProjectSessionCx } from '../projects/ProjectSessionCx';

/** Applied definitions and their artwork travel with the project, independently of the catalog. */
export async function materializeLibraryAssets(
	session: ProjectSessionCx,
	item: TLibraryItem
): Promise<TCommand[]> {
	const project = session.$project.get();
	if (!project) return [];
	const appearance = item.capabilities['appearance'];
	const id = appearance && 'assetId' in appearance ? appearance.assetId : null;
	if (typeof id !== 'string' || project.assets.some((asset) => asset.id === id)) return [];
	const asset = libraryAssets.find((asset) => asset.id === id);
	const url = getLibraryAssetUrl(id);
	if (!asset || !url) return [];
	if (desktop.isDesktop()) {
		const response = await fetch(url);
		if (!response.ok) throw new Error('Library artwork could not be read.');
		const bytes = new Uint8Array(await response.arrayBuffer());
		let binary = '';
		for (const byte of bytes) binary += String.fromCharCode(byte);
		const written = await desktop.writeProjectAsset(project.id, {
			id: asset.id,
			name: asset.name,
			mediaType: asset.mediaType,
			dataBase64: btoa(binary)
		});
		if (session.$project.get()?.id !== project.id)
			throw new Error('The project changed while adding this part.');
		return [{ type: 'asset.add', asset: { ...asset, relativePath: written.relativePath } }];
	}
	return [{ type: 'asset.add', asset }];
}
