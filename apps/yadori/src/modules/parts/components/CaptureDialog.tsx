import { ArrowUpRight, Box, Link2, Search } from 'lucide-react';
import React from 'react';
import { Button, Modal } from '../../../components/ui';
import { getLibraryAssetUrl, libraryItems } from '../../library/data';
import type { TLibraryItem } from '../../project/model';
import type { PartsCx } from '../PartsCx';

export const CaptureDialog: React.FC<{
	cx: PartsCx;
	onClose(): void;
	onAddLibrary(item: TLibraryItem): void;
}> = ({ cx, onClose, onAddLibrary }) => {
	const [tab, setTab] = React.useState<'capture' | 'library'>('capture');
	const [query, setQuery] = React.useState('');
	const items = libraryItems.filter((item) =>
		`${item.name} ${item.brand} ${item.tags.join(' ')}`.toLowerCase().includes(query.toLowerCase())
	);
	return (
		<Modal title="Add part" onClose={onClose} wide>
			<div className="capture-tabs">
				<button className={tab === 'capture' ? 'selected' : ''} onClick={() => setTab('capture')}>
					Capture
				</button>
				<button className={tab === 'library' ? 'selected' : ''} onClick={() => setTab('library')}>
					Library
				</button>
			</div>
			{tab === 'capture' ? (
				<form
					onSubmit={(event) => {
						event.preventDefault();
						cx.capture(query);
					}}
				>
					<div className="capture-input">
						<Link2 size={17} />
						<input
							autoFocus
							aria-label="Name or product link"
							placeholder="Name or product link"
							value={query}
							onChange={(event) => setQuery(event.target.value)}
						/>
					</div>
					<p className="capture-hint">Saved to Wishlist. Add details whenever you’re ready.</p>
					<div className="modal-actions">
						<Button onClick={onClose}>Cancel</Button>
						<Button variant="primary" disabled={!query.trim()} type="submit">
							Save part <ArrowUpRight size={13} />
						</Button>
					</div>
				</form>
			) : (
				<>
					<div className="search-control">
						<Search size={15} />
						<input
							autoFocus
							aria-label="Search library"
							placeholder="Search library…"
							value={query}
							onChange={(event) => setQuery(event.target.value)}
						/>
					</div>
					<div className="capture-library-list">
						{items.map((item) => {
							const appearance = item.capabilities['appearance'];
							const assetId =
								appearance && 'assetId' in appearance && typeof appearance.assetId === 'string'
									? appearance.assetId
									: null;
							const url = assetId ? getLibraryAssetUrl(assetId) : null;
							return (
								<button key={item.id} onClick={() => onAddLibrary(item)}>
									<span className="library-thumb">
										{url ? <img src={url} alt="" /> : <Box size={19} />}
									</span>
									<span>
										<strong>{item.name}</strong>
										<small>{item.brand}</small>
									</span>
									<span className="library-row-action">Add to Wishlist</span>
								</button>
							);
						})}
						{!items.length && <div className="quiet-empty">No matching library items.</div>}
					</div>
				</>
			)}
		</Modal>
	);
};
