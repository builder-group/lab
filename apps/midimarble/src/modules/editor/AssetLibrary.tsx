import { LoaderCircle, Search, X } from 'lucide-react';
import React from 'react';
import { createPortal } from 'react-dom';
import {
	createCatalogObject,
	formatTime,
	noteName,
	objectCatalog,
	type TNote,
	type TObjectModelId
} from '../project';
import { renderAssetPreviews } from '../scene';
import { useDialogFocus } from './use-dialog-focus';

export const AssetLibrary: React.FC<TAssetLibraryProps> = (props) => {
	const { onAdd, note, onClose, marbles = [], marbleId, onMarbleChange } = props;
	const dialogRef = React.useRef<HTMLDivElement>(null);
	const searchRef = React.useRef<HTMLInputElement>(null);
	const gridRef = React.useRef<HTMLDivElement>(null);
	const [inspectedId, setInspectedId] = React.useState<TObjectModelId | null>(null);
	const categories = note ? ['All', 'Keys', 'Percussion'] : ['All', 'Keys', 'Rails', 'Percussion'];
	const [category, setCategory] = React.useState('All');
	const [query, setQuery] = React.useState('');
	const [previews, setPreviews] = React.useState<Record<string, string>>({});
	const [failed, setFailed] = React.useState(false);
	const models = React.useMemo(
		() =>
			objectCatalog.filter(
				(asset) =>
					(!note || asset.kind !== 'rail') &&
					(category === 'All' || asset.category === category) &&
					`${asset.label} ${asset.description}`.toLowerCase().includes(query.toLowerCase())
			),
		[category, query, note]
	);
	const inspected = models.find((model) => model.id === inspectedId) ?? models[0];

	function navigateCategories(event: React.KeyboardEvent<HTMLButtonElement>, name: string) {
		const index = categories.indexOf(name);
		let next: number;
		if (event.key === 'ArrowRight') next = (index + 1) % categories.length;
		else if (event.key === 'ArrowLeft') next = (index + categories.length - 1) % categories.length;
		else if (event.key === 'Home') next = 0;
		else if (event.key === 'End') next = categories.length - 1;
		else return;
		event.preventDefault();
		setCategory(categories[next] ?? 'All');
		event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('button')[next]?.focus();
	}
	function navigateModels(event: React.KeyboardEvent<HTMLButtonElement>, index: number) {
		if (event.metaKey || event.ctrlKey || event.altKey) return;
		const offsets: Record<string, number> = {
			ArrowRight: 1,
			ArrowLeft: -1,
			ArrowDown: 3,
			ArrowUp: -3
		};
		let next = index;
		if (offsets[event.key] != null) next += offsets[event.key] ?? 0;
		else if (event.key === 'Home') next = 0;
		else if (event.key === 'End') next = models.length - 1;
		else return;
		event.preventDefault();
		gridRef.current
			?.querySelectorAll<HTMLButtonElement>('button')
			[Math.max(0, Math.min(models.length - 1, next))]?.focus();
	}
	function searchKey(event: React.KeyboardEvent<HTMLInputElement>) {
		if (event.nativeEvent.isComposing) return;
		if (event.key === 'ArrowDown') {
			event.preventDefault();
			gridRef.current?.querySelector<HTMLButtonElement>('button')?.focus();
		}
		if (event.key === 'Enter' && models[0]) {
			event.preventDefault();
			onAdd(models[0].id);
		}
	}

	useDialogFocus(dialogRef, { onClose, initialFocusRef: searchRef });
	React.useEffect(() => {
		let current = true;
		void renderAssetPreviews(
			objectCatalog.map((asset) => ({ id: asset.id, object: createCatalogObject(asset.id) }))
		)
			.then((result) => {
				if (current) setPreviews(result);
			})
			.catch(() => {
				if (current) setFailed(true);
			});
		return () => {
			current = false;
		};
	}, []);
	return createPortal(
		<div
			className="asset-library-overlay"
			onClick={(event) => {
				if (event.target === event.currentTarget) onClose();
			}}
		>
			<div
				ref={dialogRef}
				className="asset-library"
				role="dialog"
				aria-modal="true"
				aria-label="Object library"
				tabIndex={-1}
			>
				<div className="popover-title">
					{note
						? `Fit object to ${noteName(note.midi)} · ${formatTime(note.time)}`
						: 'Object Library'}{' '}
					<button className="asset-close" aria-label="Close object library" onClick={onClose}>
						<X size={13} />
					</button>
				</div>
				<label className="asset-search">
					<Search size={13} />
					<input
						aria-label="Search object library"
						placeholder="Search models…"
						ref={searchRef}
						onKeyDown={searchKey}
						value={query}
						onChange={(event) => setQuery(event.target.value)}
					/>
					{query && (
						<button
							aria-label="Clear model search"
							onClick={() => {
								setQuery('');
								searchRef.current?.focus();
							}}
						>
							<X size={12} />
						</button>
					)}
				</label>
				{note && marbles.length > 1 && (
					<label className="asset-trajectory">
						<span>Trajectory</span>
						<select
							aria-label="Placement trajectory"
							value={marbleId}
							onChange={(event) => onMarbleChange?.(event.target.value)}
						>
							{marbles.map((marble) => (
								<option key={marble.id} value={marble.id}>
									{marble.name ?? 'Marble'}
								</option>
							))}
						</select>
					</label>
				)}
				<div className="asset-categories" role="tablist" aria-label="Object categories">
					{categories.map((name) => (
						<button
							key={name}
							role="tab"
							aria-selected={category === name}
							tabIndex={category === name ? 0 : -1}
							onKeyDown={(event) => navigateCategories(event, name)}
							onClick={() => setCategory(name)}
						>
							{name}
						</button>
					))}
				</div>
				<div ref={gridRef} className="asset-grid">
					{models.map((asset, index) => (
						<button
							className="asset-card"
							key={asset.id}
							title={asset.description}
							aria-label={`${note ? 'Fit' : 'Add'} ${asset.label}`}
							onFocus={() => setInspectedId(asset.id)}
							onMouseEnter={() => setInspectedId(asset.id)}
							onKeyDown={(event) => navigateModels(event, index)}
							onClick={() => onAdd(asset.id)}
						>
							<span className="asset-preview">
								{previews[asset.id] ? (
									<img src={previews[asset.id]} alt="" draggable={false} />
								) : failed ? (
									<span>{asset.category}</span>
								) : (
									<LoaderCircle className="spin" size={19} />
								)}
							</span>
							<strong>{asset.label}</strong>
							<small>
								{asset.kind === 'rail'
									? 'Rolling · no MIDI note'
									: note
										? 'Follows selected note'
										: 'World object'}
							</small>
						</button>
					))}
				</div>
				{!models.length && <p className="asset-empty">No matching models.</p>}
				{inspected && (
					<div className="asset-details">
						<strong>{inspected.label}</strong>
						<span>{inspected.description}</span>
						<small>{inspected.size.map((value) => Number(value.toFixed(3))).join(' × ')} m</small>
					</div>
				)}
				<div className="asset-footer">
					{note
						? 'Choose an instrument. It will be fitted to this note and follow changes earlier in the run.'
						: 'Choose a model to place it. Link keys to MIDI notes; use rails for rolling transitions.'}
				</div>
			</div>
		</div>,
		document.body
	);
};
interface TAssetLibraryProps {
	onClose(): void;
	note?: TNote | null;
	onAdd(modelId: TObjectModelId): void;
	marbles?: Array<{ id: string; name?: string }>;
	marbleId?: string;
	onMarbleChange?(id: string): void;
}
