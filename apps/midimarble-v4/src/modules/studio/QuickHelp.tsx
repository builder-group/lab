import { useFeatureState } from 'feature-react/state';
import { X } from 'lucide-react';
import React from 'react';
import { controlHelp, placeQuickHelpLabels, regionsFor, type TControlHelp } from './quick-help';
import type { StudioCx } from './StudioCx';
import { useAnchorRects } from './use-anchor-rects';

/**
 * Quick Help like GarageBand's: labels the window's regions in place with one line each, and a panel like Logic's
 * Quick Help explains the control under the pointer with that control's own tooltip. Nothing blocks the window;
 * Escape, ⇧⌘/ or the panel's close button end it.
 */
export const QuickHelp: React.FC<TQuickHelpProps> = (props) => {
	const { cx } = props;
	const isOn = useFeatureState(cx.$quickHelp);
	if (!isOn) return null;
	return <QuickHelpOverlay cx={cx} />;
};

interface TQuickHelpProps {
	cx: StudioCx;
}

const QuickHelpOverlay: React.FC<{ cx: StudioCx }> = (props) => {
	const { cx } = props;
	const workspace = useFeatureState(cx.$workspace);
	const rects = useAnchorRects('data-quick-help');
	const [help, setHelp] = React.useState<TControlHelp | null>(null);
	const panelRef = React.useRef<HTMLDivElement>(null);
	const regions = regionsFor(workspace);

	React.useEffect(() => {
		function onPointerOver(event: PointerEvent): void {
			const target = event.target instanceof Element ? event.target : null;
			if (target == null || panelRef.current?.contains(target) === true) return;
			setHelp(controlHelp(target, workspace));
		}
		function onKeyDown(event: KeyboardEvent): void {
			// Open menus and sheets take Escape first
			if (event.key !== 'Escape' || document.querySelector('[role="menu"], [role="dialog"]') != null) return;
			event.preventDefault();
			event.stopPropagation();
			cx.$quickHelp.set(false);
		}
		document.addEventListener('pointerover', onPointerOver, true);
		window.addEventListener('keydown', onKeyDown, true);
		return () => {
			document.removeEventListener('pointerover', onPointerOver, true);
			window.removeEventListener('keydown', onKeyDown, true);
		};
	}, [cx, workspace]);

	const wall = rects.find((rect) => rect.key === 'wall') ?? null;
	const viewport = { width: window.innerWidth, height: window.innerHeight };
	const panel = wall == null ? undefined : { left: wall.right - 12 - PANEL_WIDTH, top: wall.bottom - BAR_ROOM - PANEL_HEIGHT, right: wall.right - 12, bottom: wall.bottom - BAR_ROOM };
	const items = rects.flatMap((rect) => {
		const region = regions.find((item) => item.id === rect.key);
		return region == null ? [] : [{ region, rect }];
	});
	const places = placeQuickHelpLabels(items, wall, viewport, panel);

	return (
		<div className="pointer-events-none fixed inset-0 z-[45]" aria-live="polite">
			{items.map(({ region, rect }) => {
				const place = places.get(region.id);
				return (
					<React.Fragment key={rect.key}>
						<div className="mm-qh-region" style={{ left: rect.left, top: rect.top, width: rect.width, height: rect.height }} />
						<div className="mm-qh-label" style={place}>
							<span className="mm-qh-label-title">{region.title}</span>
							<span>{region.line}</span>
						</div>
					</React.Fragment>
				);
			})}
			<div
				ref={panelRef}
				className="mm-qh-panel pointer-events-auto"
				role="region"
				aria-label="Quick Help"
				style={wall != null ? { bottom: window.innerHeight - wall.bottom + BAR_ROOM, right: window.innerWidth - wall.right + 12 } : { bottom: BAR_ROOM, right: 12 }}
			>
				<div className="flex items-center">
					<span className="flex-1 text-[11px] font-semibold text-[var(--text-secondary)]">Quick Help</span>
					<button className="mm-icon-button !h-5 !w-5" onClick={() => cx.$quickHelp.set(false)} title="Close Quick Help (Esc)" aria-label="Close Quick Help" type="button">
						<X size={12} strokeWidth={2} />
					</button>
				</div>
				{help != null ? (
					<div className="flex flex-col gap-0.5">
						<div className="flex items-baseline gap-2">
							<span className="min-w-0 flex-1 font-semibold">{help.title}</span>
							{help.shortcut != null ? <kbd className="mm-keycap">{help.shortcut}</kbd> : null}
						</div>
						{help.detail != null ? <span className="text-[11px] text-[var(--text-secondary)]">{help.detail}</span> : null}
					</div>
				) : (
					<span className="text-[11px] text-[var(--text-secondary)]">Point at a control to see what it does</span>
				)}
			</div>
		</div>
	);
};

// The panel's size, kept clear of the labels
/** Its panel sits above the floating bar, so the bar can be pointed at */
const BAR_ROOM = 60;
const PANEL_WIDTH = 260;
const PANEL_HEIGHT = 96;
