import { useFeatureState } from 'feature-react/state';
import React from 'react';
import type { StudioCx } from '@/modules/studio';
import { libraryItemLabel } from './DesignLibraryCx';
import { resolveTheme } from './project-themes';

/** Export Pack…: a name, the current theme and the project's skins and decor to take along, then the save panel */
export const ExportPackSheet: React.FC<{ cx: StudioCx }> = ({ cx }) => {
	const options = useFeatureState(cx.library.$exportPack);
	const items = useFeatureState(cx.library.$projectItems);
	const history = useFeatureState(cx.$history);
	const project = history?.present ?? null;

	React.useEffect(() => {
		if (options == null) return;
		function onKeyDown(event: KeyboardEvent): void {
			if (event.key !== 'Escape') return;
			event.preventDefault();
			event.stopPropagation();
			cx.library.$exportPack.set(null);
		}
		window.addEventListener('keydown', onKeyDown, true);
		return () => window.removeEventListener('keydown', onKeyDown, true);
	}, [cx, options == null]); // eslint-disable-line react-hooks/exhaustive-deps -- rebinding on each keystroke isn't needed

	if (options == null || project == null) return null;
	const assets = items.filter((item) => item.manifest?.role === 'skin' || item.manifest?.role === 'decoration');
	const isEmpty = !options.includesTheme && options.assetIds.length === 0;

	function toggle(id: string): void {
		if (options == null) return;
		cx.library.$exportPack.set({ ...options, assetIds: options.assetIds.includes(id) ? options.assetIds.filter((item) => item !== id) : [...options.assetIds, id] });
	}

	async function exportPack(): Promise<void> {
		if (options == null) return;
		const [isExportedOk, , path] = await cx.library.exportPack(options);
		if (isExportedOk && path != null) cx.library.$exportPack.set(null);
	}

	return (
		<div className="absolute inset-0 z-50 flex justify-center bg-black/10" onPointerDown={(event) => event.stopPropagation()}>
			<div role="dialog" aria-modal aria-label="Export Pack" className="mm-sheet mt-[60px] flex w-[420px] flex-col">
				<div className="font-semibold">Export Pack</div>
				<label className="flex items-center gap-3">
					<span className="w-[64px] text-right text-[var(--text-secondary)]">Name</span>
					<input className="mm-input flex-1" autoFocus value={options.name} onChange={(event) => cx.library.$exportPack.set({ ...options, name: event.target.value })} />
				</label>
				<label className="flex items-center gap-3">
					<span className="w-[64px] text-right text-[var(--text-secondary)]">Author</span>
					<input className="mm-input flex-1" placeholder="Optional" value={options.author ?? ''} onChange={(event) => cx.library.$exportPack.set({ ...options, author: event.target.value })} />
				</label>
				<label className="flex items-center gap-3">
					<span className="w-[64px] text-right text-[var(--text-secondary)]">Link</span>
					<input className="mm-input flex-1" placeholder="Optional: where to get this Pack" value={options.link ?? ''} onChange={(event) => cx.library.$exportPack.set({ ...options, link: event.target.value })} />
				</label>
				<div className="flex max-h-[220px] flex-col overflow-y-auto rounded-[8px] border border-[var(--separator)] bg-[var(--content)]">
					<label className="flex h-7 items-center gap-2 border-b border-[var(--separator)] px-3 last:border-b-0">
						<input type="checkbox" className="mm-checkbox" checked={options.includesTheme} onChange={() => cx.library.$exportPack.set({ ...options, includesTheme: !options.includesTheme })} />
						<span className="flex-1 truncate">{resolveTheme(project.design).name}</span>
						<span className="text-[11px] text-[var(--text-tertiary)]">Theme</span>
					</label>
					{assets.map((item) => (
						<label key={item.id} className="flex h-7 items-center gap-2 border-b border-[var(--separator)] px-3 last:border-b-0">
							<input type="checkbox" className="mm-checkbox" checked={options.assetIds.includes(item.id)} onChange={() => toggle(item.id)} />
							<span className="flex-1 truncate">{libraryItemLabel(item)}</span>
							<span className="text-[11px] text-[var(--text-tertiary)]">{item.manifest?.role === 'skin' ? 'Skin' : 'Decor'}</span>
						</label>
					))}
				</div>
				<div className="flex items-center justify-end gap-2">
					<button className="mm-button" data-size="dialog" onClick={() => cx.library.$exportPack.set(null)} title="Cancel (Esc)" type="button">
						Cancel
					</button>
					<button className="mm-button" data-size="dialog" data-variant="primary" disabled={isEmpty || options.name.trim() === ''} onClick={() => void exportPack()} type="button">
						Export…
					</button>
				</div>
			</div>
		</div>
	);
};
