import React from 'react';
import type { TVec3 } from '../project';
import {
	deformRailProfile,
	getRailProfileHandles,
	getRailProfileProjection,
	type TRailProfileProjection
} from './rail-profile';
import './RailProfileEditor.css';

/** Edits locally while a gesture is active and commits one physical curve on release. */
export const RailProfileEditor: React.FC<TRailProfileEditorProps> = (props) => {
	const { path, locked = false, onChange } = props;
	const [edit, setEdit] = React.useState<TProfileEdit | null>(null);
	const editRef = React.useRef<TProfileEdit | null>(null);
	const active = edit?.source === path && !locked ? edit : null;
	const visible = active?.draft ?? path;
	const projection = active?.projection ?? getRailProfileProjection(path);
	const handles = active?.handles ?? getRailProfileHandles(path);
	function publish(next: TProfileEdit | null) {
		editRef.current = next;
		setEdit(next);
	}
	function cancel() {
		publish(null);
	}
	function commit() {
		const current = editRef.current;
		publish(null);
		if (current == null || current.source !== path || locked) return;
		if (
			current.draft.some(
				(point, index) => point[0] !== path[index]?.[0] || point[1] !== path[index]?.[1]
			)
		)
			onChange(current.draft);
	}
	function beginPointer(event: React.PointerEvent<SVGCircleElement>, index: number) {
		if (locked || event.button !== 0) return;
		event.preventDefault();
		event.stopPropagation();
		event.currentTarget.focus();
		const width = event.currentTarget.ownerSVGElement?.getBoundingClientRect().width ?? 240;
		event.currentTarget.setPointerCapture(event.pointerId);
		publish({
			source: path,
			draft: path,
			index,
			delta: [0, 0],
			projection,
			handles: getRailProfileHandles(path),
			pointer: { id: event.pointerId, x: event.clientX, y: event.clientY, scale: width / 240 }
		});
	}
	function movePointer(event: React.PointerEvent<SVGCircleElement>) {
		const current = editRef.current;
		if (current?.pointer?.id !== event.pointerId || current.source !== path || locked) return;
		const scale = current.projection.scale * current.pointer.scale;
		const delta: [number, number] = [
			(event.clientX - current.pointer.x) / scale,
			(current.pointer.y - event.clientY) / scale
		];
		publish({ ...current, delta, draft: deformRailProfile(current.source, current.index, delta) });
	}
	function handleKey(event: React.KeyboardEvent<SVGCircleElement>, index: number) {
		if (event.metaKey || event.ctrlKey) return;
		event.stopPropagation();
		if (event.key === 'Escape') {
			event.preventDefault();
			cancel();
			return;
		}
		if (!event.key.startsWith('Arrow') || locked) {
			if (event.key === ' ') event.preventDefault();
			return;
		}
		event.preventDefault();
		const current = editRef.current;
		if (current?.pointer != null) return;
		const base =
			current?.source === path && current.index === index
				? current
				: {
						source: path,
						draft: path,
						index,
						delta: [0, 0] as [number, number],
						projection,
						handles: getRailProfileHandles(path)
					};
		const step = event.shiftKey ? 0.1 : 0.01;
		const delta: [number, number] = [...base.delta];
		if (event.key === 'ArrowLeft') delta[0] -= step;
		if (event.key === 'ArrowRight') delta[0] += step;
		if (event.key === 'ArrowDown') delta[1] -= step;
		if (event.key === 'ArrowUp') delta[1] += step;
		publish({ ...base, delta, draft: deformRailProfile(path, index, delta) });
	}
	function position(point: TVec3): [number, number] {
		return [
			120 + (point[0] - projection.x) * projection.scale,
			52 - (point[1] - projection.y) * projection.scale
		];
	}
	function polyline(points: TVec3[]): string {
		return points.map((point) => position(point).join(',')).join(' ');
	}
	return (
		<svg
			className="rail-profile-editor"
			viewBox="0 0 240 104"
			width="100%"
			role="group"
			aria-label="Rail side profile"
			data-editing={active != null || undefined}
			onKeyDown={(event) => {
				if (!event.metaKey && !event.ctrlKey) event.stopPropagation();
			}}
		>
			<path d="M12 52H228 M120 12V92" className="rail-profile-axis" />
			{active != null && <polyline points={polyline(path)} className="rail-profile-original" />}
			<polyline points={polyline(visible)} className="rail-profile-curve" />
			<text x="226" y="98" className="rail-profile-label">
				X
			</text>
			<text x="7" y="13" className="rail-profile-label">
				Y
			</text>
			{handles.map((index) => {
				const point = visible[index];
				if (point == null) return null;
				const [x, y] = position(point);
				return (
					<circle
						key={index}
						cx={x}
						cy={y}
						r="5"
						role="button"
						tabIndex={locked ? -1 : 0}
						aria-label={`${index === 0 ? 'Rail entrance' : `Rail handle ${handles.indexOf(index) + 1}`}, X ${point[0].toFixed(2)}, Y ${point[1].toFixed(2)} metres`}
						aria-disabled={locked}
						data-entrance={index === 0 || undefined}
						data-active={active?.index === index || undefined}
						className="rail-profile-handle"
						onPointerDown={(event) => beginPointer(event, index)}
						onPointerMove={movePointer}
						onPointerUp={(event) => {
							if (editRef.current?.pointer?.id !== event.pointerId) return;
							event.stopPropagation();
							commit();
						}}
						onPointerCancel={cancel}
						onLostPointerCapture={cancel}
						onKeyDown={(event) => handleKey(event, index)}
						onKeyUp={(event) => {
							if (event.key.startsWith('Arrow')) {
								event.preventDefault();
								event.stopPropagation();
								commit();
							}
						}}
						onBlur={() => (editRef.current?.pointer == null ? commit() : cancel())}
					/>
				);
			})}
		</svg>
	);
};

interface TRailProfileEditorProps {
	path: TVec3[];
	locked?: boolean;
	onChange(path: TVec3[]): void;
}

interface TProfileEdit {
	source: TVec3[];
	draft: TVec3[];
	index: number;
	delta: [number, number];
	projection: TRailProfileProjection;
	handles: number[];
	pointer?: { id: number; x: number; y: number; scale: number };
}
