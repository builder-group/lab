import { useFeatureState } from 'feature-react/state';
import { X } from 'lucide-react';
import React from 'react';
import { hintTexts, type THintId } from './HintsCx';
import type { StudioCx } from './StudioCx';
import { useAnchorRects, type TAnchorRect } from './use-anchor-rects';

/**
 * Draws the open first-run hint beside the element that marks where its step is (`data-hint-anchor`): the Song
 * track, an empty marble track, the next open dot, the Film switch. It waits while its anchor is out of view, while Quick Help is on and while a notice is up.
 */
export const HintLayer: React.FC<THintLayerProps> = (props) => {
	const { cx } = props;
	const open = useFeatureState(cx.hints.$open);
	const isQuickHelpOn = useFeatureState(cx.$quickHelp);
	const notice = useFeatureState(cx.$notice);
	const isActive = open != null && !isQuickHelpOn && notice == null;
	const anchor = useAnchorRects(isActive ? 'data-hint-anchor' : null, open ?? undefined)[0];

	React.useEffect(() => {
		if (isActive && anchor != null) cx.hints.markSeen(open);
	}, [cx, open, isActive, anchor]);

	if (!isActive || anchor == null) return null;
	return <HintPopover id={open} anchor={anchor} onDismiss={() => cx.hints.dismiss(open)} />;
};

interface THintLayerProps {
	cx: StudioCx;
}

const HintPopover: React.FC<{ id: THintId; anchor: TAnchorRect; onDismiss: () => void }> = (props) => {
	const { id, anchor, onDismiss } = props;
	const ref = React.useRef<HTMLDivElement>(null);
	const [width, setWidth] = React.useState(0);
	const side = hintSides[id];

	React.useLayoutEffect(() => {
		setWidth(ref.current?.offsetWidth ?? 0);
	}, [id]);

	const centerX = anchor.left + anchor.width / 2;
	let style: React.CSSProperties;
	let caret: React.CSSProperties;
	if (side === 'right') {
		style = { left: anchor.right + 10, top: anchor.top + anchor.height / 2, transform: 'translateY(-50%)' };
		caret = {};
	} else {
		// Kept inside the window; the caret still points at the anchor
		const left = Math.min(Math.max(centerX - width / 2, 8), window.innerWidth - width - 8);
		style = side === 'above' ? { left, top: anchor.top - 12, transform: 'translateY(-100%)' } : { left, top: anchor.bottom + 10 };
		caret = { left: centerX - left };
	}

	return (
		<div ref={ref} className="mm-first-hint" data-side={side} style={style} role="note">
			<span className="mm-first-hint-caret" style={caret} aria-hidden />
			<span className="mm-first-hint-dot" aria-hidden />
			<span>{hintTexts[id]}</span>
			<button className="mm-icon-button !h-5 !w-5" onClick={onDismiss} title="Dismiss" aria-label="Dismiss Hint" type="button">
				<X size={12} strokeWidth={2} />
			</button>
		</div>
	);
};

const hintSides: Record<THintId, 'right' | 'above' | 'below'> = { song: 'right', tap: 'right', dot: 'right', film: 'below' };
