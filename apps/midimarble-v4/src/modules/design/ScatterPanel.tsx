import { useFeatureState } from 'feature-react/state';
import { Wand2, X } from 'lucide-react';
import React from 'react';
import type { StudioCx } from '@/modules/studio/StudioCx';
import { assetDecorSource } from './decor';
import { $scatterPanel, runScatter, type TScatterPanel } from './decor-actions';
import { DECOR_ITEMS } from './decor-catalog';

/**
 * Scatter Decor's small panel over the viewer: which items and how dense, each change re-scattering in place. Everything
 * done while it is open is one undo step, and it replaces only the items it placed.
 */
export const ScatterPanel: React.FC<{ cx: StudioCx }> = (props) => {
	const { cx } = props;
	const panel = useFeatureState($scatterPanel);
	const projectItems = useFeatureState(cx.library.$projectItems);
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
	const again = (patch: Partial<TScatterPanel>): void => runScatter(cx, { ...panel, ...patch });
	// Decor from the Library that is in this project, beside the built-in items
	const assets = projectItems.flatMap((item) => (item.manifest?.role === 'decoration' ? [{ id: assetDecorSource(item.id, item.manifest.label, item.manifest.fittedParams).source, label: item.manifest.label }] : []));
	const items = [...DECOR_ITEMS.filter((item) => item.scatter), ...assets];

	function toggle(source: string): void {
		if (panel == null) return;
		const sources = panel.sources.includes(source) ? panel.sources.filter((item) => item !== source) : [...panel.sources, source];
		if (sources.length > 0) again({ sources });
	}

	return (
		<div className="mm-floating absolute top-3 left-3 flex w-[248px] flex-col gap-2 p-3 text-[12px]" role="dialog" aria-label="Scatter Decor">
			<div className="flex items-center gap-1.5">
				<Wand2 size={13} strokeWidth={1.8} />
				<span className="flex-1 font-medium">Scatter Decor</span>
				<span className="text-[11px] text-[var(--text-secondary)]">{panel.sources.length === 0 ? 'Pick items' : panel.count === 1 ? '1 item' : `${panel.count} items`}</span>
				<button className="mm-icon-button !h-5 !w-5" onClick={() => $scatterPanel.set(null)} title="Done (esc)" aria-label="Done" type="button">
					<X size={11} strokeWidth={2} />
				</button>
			</div>
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
			<button className="mm-button" onClick={() => again({ seed: panel.seed + 1 })} title="The same set and density in new places" type="button">
				Scatter Again
			</button>
		</div>
	);
};
