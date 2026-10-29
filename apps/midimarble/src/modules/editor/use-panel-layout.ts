import React from 'react';
import { pointerGesture } from './pointer-gesture';

export function usePanelLayout() {
	const panelRef = React.useRef<HTMLElement>(null);
	const preferencesRef = React.useRef<TPanelLayout>({});
	const gestureRef = React.useRef<(() => void) | null>(null);

	React.useEffect(() => {
		try {
			preferencesRef.current = parsePanelLayout(localStorage.getItem(STORAGE_KEY));
		} catch {
			preferencesRef.current = {};
		}
		function apply() {
			gestureRef.current?.();
			const root = panelRef.current;
			if (root == null) return;
			for (const panel of PANEL_NAMES) root.style.removeProperty(PANELS[panel].variable);
			if (window.innerWidth <= 1100) return;
			for (const panel of PANEL_NAMES) {
				const size = preferencesRef.current[panel];
				if (size != null)
					root.style.setProperty(PANELS[panel].variable, `${clampPanelSize(root, panel, size)}px`);
			}
		}
		apply();
		window.addEventListener('resize', apply);
		return () => {
			gestureRef.current?.();
			window.removeEventListener('resize', apply);
		};
	}, []);

	const resizePanel = React.useCallback(
		(event: React.PointerEvent<HTMLDivElement>, requestedPanel: TPanelName) => {
			const root = panelRef.current;
			if (event.button !== 0 || root == null) return;
			event.preventDefault();
			gestureRef.current?.();
			const timeline = root.querySelector<HTMLElement>('.mm-timeline');
			const panel =
				requestedPanel === 'timeline' && timeline?.classList.contains('is-midi-focused')
					? 'piano'
					: requestedPanel;
			const { variable, axis, invert } = PANELS[panel];
			const original = root.style.getPropertyValue(variable);
			const initial = panel === 'piano'
				? timeline?.getBoundingClientRect().height ?? NaN
				: Number.parseFloat(getComputedStyle(root).getPropertyValue(variable));
			if (!Number.isFinite(initial)) return;
			const start = axis === 'x' ? event.clientX : event.clientY;
			let size = initial;
			gestureRef.current = pointerGesture(event.currentTarget, event.pointerId, {
				move: (next) => {
					const delta = ((axis === 'x' ? next.clientX : next.clientY) - start) * invert;
					size = clampPanelSize(root, panel, initial + delta);
					root.style.setProperty(variable, `${size}px`);
				},
				end: (cancelled) => {
					gestureRef.current = null;
					if (cancelled) {
						if (original) root.style.setProperty(variable, original);
						else root.style.removeProperty(variable);
						return;
					}
					if (size === initial) return;
					preferencesRef.current[panel] = size;
					try {
						localStorage.setItem(STORAGE_KEY, JSON.stringify(preferencesRef.current));
					} catch {
						// Resizing still works when browser storage is unavailable
					}
				}
			});
		},
		[]
	);
	return { panelRef, resizePanel };
}

type TPanelName = 'outliner' | 'properties' | 'timeline' | 'piano';
type TPanelLayout = Partial<Record<TPanelName, number>>;
const STORAGE_KEY = 'midimarble.panels.v1';
const PANELS = {
	outliner: { variable: '--tree-width', axis: 'x', invert: 1, min: 145, max: 420 },
	properties: { variable: '--properties-width', axis: 'x', invert: -1, min: 220, max: 440 },
	timeline: { variable: '--timeline-height', axis: 'y', invert: -1, min: 145, max: 650 },
	piano: { variable: '--piano-height', axis: 'y', invert: -1, min: 230, max: 650 }
} as const;
const PANEL_NAMES: TPanelName[] = ['outliner', 'properties', 'timeline', 'piano'];

export function parsePanelLayout(saved: string | null): TPanelLayout {
	try {
		const value: unknown = JSON.parse(saved ?? '{}');
		if (value == null || typeof value !== 'object' || Array.isArray(value)) return {};
		const layout: TPanelLayout = {};
		for (const panel of PANEL_NAMES) {
			const size = (value as Record<string, unknown>)[panel];
			if (typeof size === 'number' && Number.isFinite(size))
				layout[panel] = Math.max(PANELS[panel].min, Math.min(PANELS[panel].max, size));
		}
		return layout;
	} catch {
		return {};
	}
}

function clampPanelSize(root: HTMLElement, panel: TPanelName, size: number): number {
	const { min, max, axis } = PANELS[panel];
	const other = root.querySelector<HTMLElement>(
		panel === 'outliner' ? '.properties-panel' : '.object-tree'
	);
	const limit =
		axis === 'y'
			? root.clientHeight - (panel === 'piano' ? 310 : 290)
			: root.clientWidth - (other?.clientWidth ?? 0) - 280;
	const minimum = panel === 'piano' ? Math.max(0, Math.min(min, limit)) : min;
	return Math.max(minimum, Math.min(max, limit, size));
}
