import { useFeatureState } from 'feature-react/state';
import { ChevronLeft, Package } from 'lucide-react';
import React from 'react';
import { host } from '@/environment';
import { addedPacks, packOriginOf, STARTER_PACK_ID, type TPack } from '@/modules/library';
import type { TPackOrigin } from '@/modules/project';
import type { StudioCx } from '@/modules/studio';
import { decorItem } from './decor-catalog';
import { libraryItemLabel, packContents } from './DesignLibraryCx';

/**
 * Add Pack…: the Packs that ship inside the app and the added ones as cards, each with a detail view before adding. The
 * Starter Pack is always added and can't be removed; an added Pack stays on this Mac for every project. Import from File…
 * takes any `.marblepack`.
 */
export const AddPackSheet: React.FC<{ cx: StudioCx }> = ({ cx }) => {
	const isOpen = useFeatureState(cx.library.$isAddPackOpen);
	const bundled = useFeatureState(cx.library.$bundledPacks);
	const added = useFeatureState(addedPacks);
	const card = useFeatureState(cx.library.$packCard);

	const packs = React.useMemo(() => shownPacks(bundled, added), [bundled, added]);
	const detail = card != null ? (packs.find((pack) => pack.id === card.packId) ?? null) : null;
	const setDetail = (pack: TPack | null): void => cx.library.$packCard.set(pack != null ? packOriginOf(pack) : null);
	const close = React.useCallback(() => {
		cx.library.$packCard.set(null);
		cx.library.$isAddPackOpen.set(false);
	}, [cx]);

	React.useEffect(() => {
		if (!isOpen) return;
		void cx.library.refresh();
		function onKeyDown(event: KeyboardEvent): void {
			if (event.key !== 'Escape') return;
			event.preventDefault();
			event.stopPropagation();
			close();
		}
		window.addEventListener('keydown', onKeyDown, true);
		return () => window.removeEventListener('keydown', onKeyDown, true);
	}, [cx, isOpen, close]);

	if (!isOpen) return null;
	const isAdded = (pack: TPack): boolean => added.some((item) => item.id === pack.id);

	const action = (pack: TPack): React.ReactElement =>
		pack.id === STARTER_PACK_ID ? (
			<span className="shrink-0 text-[11px] text-[var(--text-tertiary)]" title="Every project has the Starter Pack">
				Added
			</span>
		) : (
		<button
			className="mm-button"
			data-variant={isAdded(pack) ? undefined : 'primary'}
			onClick={(event) => {
				event.stopPropagation();
				void (isAdded(pack) ? cx.library.removePack(pack) : cx.library.addPack(pack.path));
			}}
			type="button"
		>
			{isAdded(pack) ? 'Remove' : 'Add'}
		</button>
		);

	return (
		<div className="absolute inset-0 z-50 flex justify-center bg-black/10" onPointerDown={(event) => event.stopPropagation()}>
			<div role="dialog" aria-modal aria-label="Add Pack" className="mm-sheet mt-[60px] flex max-h-[70vh] w-[520px] flex-col">
				{card != null && detail == null ? (
					<MissingPackCard origin={card} onBack={() => setDetail(null)} />
				) : detail != null ? (
					<>
						<div className="flex items-center gap-2">
							<button className="mm-icon-button !h-6 !w-6" onClick={() => setDetail(null)} title="Back to Packs" aria-label="Back to Packs" type="button">
								<ChevronLeft size={14} strokeWidth={1.8} />
							</button>
							<span className="flex-1 truncate font-semibold">{detail.name}</span>
							{action(detail)}
						</div>
						<div className="flex min-h-0 flex-col gap-2 overflow-y-auto">
							<PackPicture pack={detail} size="large" />
							{detail.description != null ? <p className="text-[12px]">{detail.description}</p> : null}
							<p className="mm-caption">
								{packContents(detail)}
								{detail.author != null ? ` · ${detail.author}` : ''}
								{` · Version ${detail.version}`}
							</p>
							<ul className="flex flex-col rounded-[8px] border border-[var(--separator)] bg-[var(--content)]">
								{[...new Set(packItemLabels(detail))].map((label) => (
									<li key={label} className="flex h-7 items-center border-b border-[var(--separator)] px-3 last:border-b-0">
										<span className="flex-1 truncate">{label}</span>
									</li>
								))}
							</ul>
						</div>
					</>
				) : (
					<>
						<div className="font-semibold">Add Pack</div>
						<div className="flex min-h-0 flex-col gap-1.5 overflow-y-auto">
							{packs.map((pack) => (
								<div key={pack.id} role="button" tabIndex={0} className="flex cursor-default items-center gap-3 rounded-[8px] border border-[var(--separator)] bg-[var(--content)] p-2" onClick={() => setDetail(pack)} onKeyDown={(event) => (event.key === 'Enter' ? setDetail(pack) : undefined)}>
									<PackPicture pack={pack} size="small" />
									<span className="flex min-w-0 flex-1 flex-col">
										<span className="truncate font-medium">{pack.name}</span>
										{pack.description != null ? <span className="truncate text-[11px] text-[var(--text-secondary)]">{pack.description}</span> : null}
										<span className="truncate text-[11px] text-[var(--text-tertiary)]">{packContents(pack)}</span>
									</span>
									{action(pack)}
								</div>
							))}
						</div>
					</>
				)}
				<div className="flex items-center justify-between gap-2">
					<button className="mm-button" data-size="dialog" onClick={() => void cx.library.addPack()} type="button">
						Import from File…
					</button>
					<button className="mm-button" data-size="dialog" onClick={close} title="Close (Esc)" type="button">
						Done
					</button>
				</div>
			</div>
		</div>
	);
};

/** A Pack a project names that is neither on this Mac nor in the app: only its origin is known */
const MissingPackCard: React.FC<{ origin: TPackOrigin; onBack: () => void }> = ({ origin, onBack }) => (
	<>
		<div className="flex items-center gap-2">
			<button className="mm-icon-button !h-6 !w-6" onClick={onBack} title="Back to Packs" aria-label="Back to Packs" type="button">
				<ChevronLeft size={14} strokeWidth={1.8} />
			</button>
			<span className="flex-1 truncate font-semibold">{origin.packName}</span>
		</div>
		<p className="text-[12px]">This project uses items from this Pack, which isn't on this Mac. They keep working; to use more of it, import its file.</p>
		<p className="mm-caption">
			Version {origin.version}
			{origin.author != null ? ` · ${origin.author}` : ''}
		</p>
		{origin.link != null ? (
			<button className="mm-link self-start" onClick={() => void host.openLink(origin.link ?? '')} title={origin.link} type="button">
				Open Link
			</button>
		) : null}
	</>
);

/** The app's Packs and the added ones, each once, Starter first; an added copy has the items as they stand in the library */
export function shownPacks(bundled: readonly TPack[], added: readonly TPack[]): TPack[] {
	return [...added, ...bundled.filter((pack) => !added.some((item) => item.id === pack.id))].sort((a, b) => Number(b.id === STARTER_PACK_ID) - Number(a.id === STARTER_PACK_ID) || a.name.localeCompare(b.name));
}

/** A Pack's items in words, themes first */
export function packItemLabels(pack: TPack): string[] {
	const builtIn = pack.builtIn ?? [];
	return [...pack.themes.map((theme) => `${theme.name} (theme)`), ...builtIn.filter((item) => item.kind === 'theme').map((item) => `${item.label} (theme)`), ...builtIn.filter((item) => item.kind === 'skin').map((item) => item.label), ...pack.items.map(libraryItemLabel), ...pack.builtInDecor.map((source) => decorItem(source)?.label ?? source)];
}

/** The Pack's own picture, else its items' pictures side by side */
const PackPicture: React.FC<{ pack: TPack; size: 'small' | 'large' }> = ({ pack, size }) => {
	const box = size === 'large' ? 'h-[140px] w-full' : 'h-[56px] w-[80px] shrink-0';
	const previews = [...pack.items.flatMap((item) => item.previewUrl ?? []), ...pack.builtInDecor.flatMap((source) => decorItem(source)?.previewUrl ?? [])].slice(0, size === 'large' ? 8 : 4);
	return (
		<span className={`${box} flex items-center justify-center overflow-hidden rounded-[6px] bg-[var(--control)]`}>
			{pack.pictureUrl != null ? (
				<img alt="" src={pack.pictureUrl} className="h-full w-full object-cover" draggable={false} />
			) : previews.length > 0 ? (
				<span className="grid h-full w-full grid-cols-4 gap-px">
					{[...new Set(previews)].map((url) => (
						<img key={url} alt="" src={url} className="h-full min-h-0 w-full object-cover" draggable={false} />
					))}
				</span>
			) : (
				<Package size={22} strokeWidth={1.4} className="text-[var(--text-tertiary)]" />
			)}
		</span>
	);
};
