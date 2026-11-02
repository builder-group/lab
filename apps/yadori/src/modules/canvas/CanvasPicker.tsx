import { useFeatureState } from 'feature-react/state';
import { ArrowUpRight, Plus, Search, X } from 'lucide-react';
import React from 'react';
import { getLibraryAssetUrl, libraryItems } from '../library/data';
import { PartArtwork } from '../parts/components/PartArtwork';
import {
	getCapability,
	type TLibraryItem,
	type TPart,
	type TPoint,
	type TProject
} from '../project/model';
import { CanvasCx } from './CanvasCx';
import { getAppearance, getDimensions } from './geometry';

export const CanvasPicker: React.FC<{
	cx: CanvasCx;
	project: TProject;
	position: () => TPoint;
	resolveAssetUrl?: (id: string) => string | null;
}> = ({ cx, project, position, resolveAssetUrl }) => {
	const tab = useFeatureState(cx.$pickerTab);
	const [query, setQuery] = React.useState('');
	const q = query.toLowerCase().trim();
	const parts = project.parts.filter(
		(part) =>
			part.unit === 'each' &&
			part.buildState !== 'archived' &&
			(getCapability(part, 'appearance') || getCapability(part, 'electrical')) &&
			`${part.name} ${part.brand}`.toLowerCase().includes(q)
	);
	const items = libraryItems.filter((item) =>
		`${item.name} ${item.brand} ${item.tags.join(' ')}`.toLowerCase().includes(q)
	);
	function thumbnail(part: TPart | TLibraryItem): React.ReactNode {
		if ('buildState' in part)
			return <PartArtwork part={part} project={project} className="canvas-picker-art" />;
		const assetId = getAppearance(part)?.assetId;
		const url =
			assetId == null ? null : (resolveAssetUrl?.(assetId) ?? getLibraryAssetUrl(assetId));
		return (
			<span className="canvas-picker-art">
				{url ? <img src={url} alt="" /> : <span className="canvas-picker-placeholder" />}
			</span>
		);
	}
	return (
		<div className="canvas-picker" role="dialog" aria-label="Add to canvas">
			<div className="canvas-picker-header">
				<div className="canvas-picker-tabs">
					<button
						className={tab === 'parts' ? 'active' : ''}
						onClick={() => cx.$pickerTab.set('parts')}
					>
						Parts
					</button>
					<button
						className={tab === 'library' ? 'active' : ''}
						onClick={() => cx.$pickerTab.set('library')}
					>
						Library
					</button>
				</div>
				<button
					className="canvas-icon"
					aria-label="Close part picker"
					onClick={() => cx.$pickerOpen.set(false)}
				>
					<X size={14} />
				</button>
			</div>
			<label className="canvas-picker-search">
				<Search size={14} />
				<input
					autoFocus
					aria-label="Search parts to place"
					placeholder={tab === 'parts' ? 'Find a part…' : 'Find a library part…'}
					value={query}
					onChange={(e) => setQuery(e.target.value)}
				/>
			</label>
			<div className="canvas-picker-list">
				{tab === 'parts' ? (
					<>
						{(['in-build', 'wishlist'] as const).map((state) => {
							const group = parts.filter((part) => part.buildState === state);
							if (!group.length) return null;
							return (
								<React.Fragment key={state}>
									<div className="canvas-picker-section">
										{state === 'in-build' ? 'In this build' : 'Wishlist'}
									</div>
									{group.map((part) => {
										const instances = project.instances.filter((i) => i.partId === part.id);
										const placed = project.placements.filter((p) =>
											instances.some((i) => i.id === p.instanceId)
										);
										return (
											<div className="canvas-picker-item" key={part.id}>
												<button
													title={
														state === 'wishlist'
															? 'Add to build & place'
															: 'Place or show existing unit'
													}
													onClick={() => cx.place(part, position())}
												>
													{thumbnail(part)}
													<span>
														<strong>{part.name}</strong>
														<small>
															{state === 'wishlist'
																? 'Add to build & place'
																: `${placed.length} placed · ${part.quantity} planned`}
														</small>
													</span>
													{placed.length >= part.quantity ? (
														<ArrowUpRight size={13} />
													) : (
														<Plus size={13} />
													)}
												</button>
												{state === 'in-build' && placed.length >= part.quantity && (
													<button
														className="canvas-icon add-unit"
														aria-label={'Add another ' + part.name}
														title="Add another physical unit"
														onClick={() => cx.place(part, position(), true)}
													>
														<Plus size={12} />
													</button>
												)}
											</div>
										);
									})}
								</React.Fragment>
							);
						})}
						{!parts.length && (
							<div className="canvas-picker-empty">
								<p>No drawable parts yet.</p>
								<button className="canvas-text-button" onClick={() => cx.$pickerTab.set('library')}>
									Browse the library
								</button>
							</div>
						)}
					</>
				) : (
					<>
						{items.map((item) => (
							<div className="canvas-picker-item" key={item.id}>
								<button title="Add to build & place" onClick={() => cx.addPreset(item, position())}>
									{thumbnail(item)}
									<span>
										<strong>{item.name}</strong>
										<small>
											{item.brand || 'Generic'} · {getDimensions(item)?.widthMm ?? '?'} mm wide
										</small>
									</span>
									<Plus size={13} />
								</button>
							</div>
						))}
						{!items.length && (
							<div className="canvas-picker-empty">
								<p>No matching library part.</p>
							</div>
						)}
					</>
				)}
			</div>
			<button className="canvas-picker-custom" onClick={() => cx.createPart()}>
				<Plus size={13} />
				Create a custom part
			</button>
		</div>
	);
};
