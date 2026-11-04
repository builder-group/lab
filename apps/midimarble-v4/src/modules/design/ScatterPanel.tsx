import { useFeatureState } from 'feature-react/state';
import { Wand2, X } from 'lucide-react';
import React from 'react';
import { addedPacks } from '@/modules/library';
import type { StudioCx } from '@/modules/studio/StudioCx';
import { $scatterPanel, runScatter, scatterItems, type TScatterPanel } from './decor-actions';

/**
 * Scatter Decor's small panel over the viewer: it asks what to scatter and how dense, starting from the last choice. Once
 * scattered, each change re-scatters in place. Everything done while it is open is one undo step, and it replaces only the
 * items it placed.
 */
export const ScatterPanel: React.FC<{ cx: StudioCx }> = (props) => {
	const { cx } = props;
	const panel = useFeatureState($scatterPanel);
	useFeatureState(addedPacks);
	useFeatureState(cx.library.$projectItems);
	const [density, setDensity] = React.useState<number | null>(null);

	// Escape closes it before it reaches the studio shortcuts
	React.useEffect(() => {
		if (panel == null) return;
		function onKeyDown(event: KeyboardEvent): void {
			if (event.key !== 'Escape') return;
			event.preventDefault();
			event.stopPropagation();
			$scatterPanel.set(null);
		}
		window.addEventListener('keydown', onKeyDown, true);
		return () => window.removeEventListener('keydown', onKeyDown, true);
	}, [panel]);

	if (panel == null) return null;
	const hasScattered = panel.group != null;
	// Nothing is placed until Scatter; after that every change shows at once
	const again = (patch: Partial<TScatterPanel>): void => {
		if (hasScattered) runScatter(cx, { ...panel, ...patch });
		else $scatterPanel.set({ ...panel, ...patch });
	};
	const items = scatterItems(cx);

	function toggle(source: string): void {
		if (panel == null) return;
		const sources = panel.sources.includes(source) ? panel.sources.filter((item) => item !== source) : [...panel.sources, source];
		if (sources.length > 0 || !hasScattered) again({ sources });
	}

	return (
		<div className="mm-floating absolute top-3 left-3 flex w-[248px] flex-col gap-2 p-3 text-[12px]" role="dialog" aria-label="Scatter Decor">
			<div className="flex items-center gap-1.5">
				<Wand2 size={13} strokeWidth={1.8} />
				<span className="flex-1 font-medium">Scatter Decor</span>
				<span className="text-[11px] text-[var(--text-secondary)]">{panel.sources.length === 0 ? 'Pick items' : !hasScattered ? '' : panel.count === 1 ? '1 item' : `${panel.count} items`}</span>
				<button className="mm-icon-button !h-5 !w-5" onClick={() => $scatterPanel.set(null)} title="Done (esc)" aria-label="Done" type="button">
					<X size={11} strokeWidth={2} />
				</button>
			</div>
			{items.length === 0 ? (
				<button className="mm-button" onClick={() => cx.library.$isAddPackOpen.set(true)} title="A Pack brings more themes, skins and decor" type="button">
					Add Pack…
				</button>
			) : null}
			<div className="flex flex-wrap gap-1" role="group" aria-label="Items">
				{items.map((item) => (
					<button key={item.id} className="mm-button" data-applied={panel.sources.includes(item.id)} aria-pressed={panel.sources.includes(item.id)} onClick={() => toggle(item.id)} type="button">
						{item.label}
					</button>
				))}
			</div>
			<label className="flex items-center gap-2">
				<span>Density</span>
				<input
					className="mm-slider flex-1"
					aria-label="Density"
					type="range"
					min={0}
					max={1}
					step={0.05}
					value={density ?? panel.density}
					style={{ '--fill': `${(density ?? panel.density) * 100}%` } as React.CSSProperties}
					onChange={(event) => setDensity(Number(event.target.value))}
					onPointerUp={() => {
						if (density != null) again({ density });
						setDensity(null);
					}}
					onKeyUp={() => {
						if (density != null) again({ density });
						setDensity(null);
					}}
				/>
			</label>
			{hasScattered ? (
				<button className="mm-button" onClick={() => again({ seed: panel.seed + 1 })} title="The same items and density in new places" type="button">
					Scatter Again
				</button>
			) : (
				<button className="mm-button" data-variant="primary" disabled={panel.sources.length === 0} onClick={() => runScatter(cx, panel)} title="Fill the free wall the camera shows with these items" type="button">
					Scatter
				</button>
			)}
		</div>
	);
};
