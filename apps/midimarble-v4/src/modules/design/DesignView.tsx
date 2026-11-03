import { useFeatureState } from 'feature-react/state';
import { Box, ExternalLink, LoaderCircle, Monitor } from 'lucide-react';
import React from 'react';
import type { DesignCx, TDesignStatus } from './DesignCx';

/** Viewer for the Blender scene at the playhead, like the viewer of Final Cut Pro */
export const DesignView: React.FC<TDesignViewProps> = (props) => {
	const { cx, frame, onPick } = props;
	const status = useFeatureState(cx.$status);
	const preview = useFeatureState(cx.$preview);
	const error = useFeatureState(cx.$error);
	const version = useFeatureState(cx.$blenderVersion);
	const busy = status === 'starting' || status === 'syncing' || status === 'rendering';

	if (status === 'unavailable') {
		return (
			<Placeholder icon={<Monitor size={22} strokeWidth={1.4} />} title="Design Runs in the Desktop App">
				The browser preview has no Blender. Open MidiMarble on your Mac to see the scene rendered at the playhead.
			</Placeholder>
		);
	}
	if (status === 'missing') {
		return (
			<Placeholder icon={<Box size={22} strokeWidth={1.4} />} title="Blender Is Not Installed">
				Install Blender in your Applications folder, then come back to Design.
			</Placeholder>
		);
	}

	async function onClick(event: React.MouseEvent<HTMLImageElement>): Promise<void> {
		const rect = event.currentTarget.getBoundingClientRect();
		const id = await cx.pick((event.clientX - rect.left) / rect.width, (event.clientY - rect.top) / rect.height);
		onPick(id);
	}

	return (
		<div className="relative flex h-full w-full items-center justify-center bg-[var(--canvas)] p-8">
			{preview != null ? (
				<img
					alt="Blender preview at the playhead"
					className="max-h-full max-w-full rounded-[6px] object-contain"
					style={{
						aspectRatio: `${frame.width} / ${frame.height}`,
						boxShadow: '0 0 0 0.5px rgb(0 0 0 / 0.15), 0 12px 40px rgb(0 0 0 / 0.18)',
						opacity: busy ? 0.85 : 1
					}}
					draggable={false}
					src={preview.url}
					onClick={(event) => void onClick(event)}
				/>
			) : (
				<div
					className="flex max-h-full items-center justify-center rounded-[6px] bg-[var(--content)] text-[var(--text-tertiary)]"
					style={{ aspectRatio: `${frame.width} / ${frame.height}`, height: '100%' }}
				>
					{busy ? <LoaderCircle className="animate-spin" size={22} /> : 'No preview yet'}
				</div>
			)}

			<div className="absolute top-3 left-3 flex items-center gap-2 rounded-full bg-[var(--content-raised)] px-3 py-1 text-[11px] text-[var(--text-secondary)]" style={{ boxShadow: 'var(--shadow-popover)' }}>
				{busy ? <LoaderCircle className="animate-spin" size={12} /> : <span className="h-1.5 w-1.5 rounded-full" style={{ background: status === 'error' ? 'var(--bad)' : 'var(--good)' }} />}
				<span>{statusLabels[status]}</span>
				{version != null ? <span className="text-[var(--text-tertiary)]">Blender {version.split(' ')[0]}</span> : null}
			</div>

			<button
				className="mm-button absolute top-3 right-3"
				onClick={() => void cx.openInBlender()}
				title="Open this scene in Blender for detailed work"
				type="button"
			>
				<ExternalLink size={13} />
				Edit in Blender
			</button>

			{status === 'error' && error != null ? (
				<div
					role="alert"
					className="absolute bottom-4 left-1/2 max-w-[520px] -translate-x-1/2 rounded-[10px] bg-[var(--content-raised)] px-4 py-2 text-[12px] text-[var(--bad)]"
					style={{ boxShadow: 'var(--shadow-popover)' }}
				>
					{error}
					<button className="ml-3 underline" onClick={() => cx.requestPreview(0)} type="button">
						Try Again
					</button>
				</div>
			) : null}
		</div>
	);
};

interface TDesignViewProps {
	cx: DesignCx;
	frame: { width: number; height: number };
	onPick: (entityId: string | null) => void;
}

const statusLabels: Record<TDesignStatus, string> = {
	idle: 'Blender',
	unavailable: 'Blender',
	missing: 'Blender',
	starting: 'Starting Blender…',
	syncing: 'Updating scene…',
	rendering: 'Rendering…',
	ready: 'Eevee preview',
	error: 'Blender reported a problem'
};

const Placeholder: React.FC<{ icon: React.ReactNode; title: string; children: React.ReactNode }> = (props) => {
	const { icon, title, children } = props;
	return (
		<div className="mm-placeholder bg-[var(--canvas)]">
			<span className="mb-1 text-[var(--text-tertiary)]">{icon}</span>
			<span className="mm-placeholder-title">{title}</span>
			<span className="mm-placeholder-body">{children}</span>
		</div>
	);
};
