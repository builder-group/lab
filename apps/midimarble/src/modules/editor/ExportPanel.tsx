import { Download } from 'lucide-react';
import React from 'react';
import type { TProject } from '../project';
import { CompletedVideo } from './CompletedVideo';
import type { TVideoExport } from './use-video-export';

export const ExportPanel: React.FC<TExportPanelProps> = (props) => {
	const { project, videoExport } = props;
	const {
		exporting,
		error,
		completedVideo,
		unavailableReason,
		progress,
		size,
		setSize,
		fps,
		setFps,
		start,
		cancel,
		adjustSettings,
		saveFrame
	} = videoExport;

	return (
		<>
			<span className="modal-eyebrow">RENDER ANIMATION</span>
			<h1 id="modal-title">Export video</h1>
			<p>
				{project.name} · {project.aspectRatio} · {project.duration.toFixed(1)} seconds.
				Frame-by-frame rendering with MIDI and rolling sounds.
			</p>
			{error != null && (
				<p className="export-error" role="alert">
					{error}
				</p>
			)}
			{completedVideo != null ? (
				<CompletedVideo video={completedVideo} onAgain={adjustSettings} />
			) : (
				<>
					<div className="field-grid">
						<label className="modal-field">
							Resolution
							<select
								value={size}
								disabled={exporting}
								onChange={(event) => setSize(Number(event.target.value))}
							>
								<option value={720}>720p</option>
								<option value={1080}>1080p</option>
							</select>
						</label>
						<label className="modal-field">
							Frame rate
							<select
								value={fps}
								disabled={exporting}
								onChange={(event) => setFps(Number(event.target.value))}
							>
								<option value={30}>30 fps</option>
								<option value={60}>60 fps</option>
							</select>
						</label>
					</div>
					{exporting ? (
						<>
							<div
								className="export-progress"
								role="progressbar"
								aria-label="Video export"
								aria-valuemin={0}
								aria-valuemax={100}
								aria-valuenow={Math.round(progress * 100)}
							>
								<span style={{ width: `${Math.max(2, progress * 100)}%` }} />
							</div>
							<p className="export-progress-label" role="status">
								{progress < 0.05 ? 'Preparing soundtrack…' : 'Rendering frames…'}{' '}
								<strong>{Math.round(progress * 100)}%</strong>
							</p>
							<button className="button full" onClick={cancel} title="Cancel export (Esc)">
								Cancel export
							</button>
						</>
					) : (
						<>
							{unavailableReason != null && (
								<p className="helper-text" role="status">
									{unavailableReason}
								</p>
							)}
							<button
								className="button primary full"
								disabled={unavailableReason != null}
								onClick={() => void start()}
							>
								<Download size={15} /> Render video
							</button>
							<p className="helper-text">
								WebM · VP9/VP8 + Opus · synchronized audio. All processing stays in your browser.
							</p>
							<button className="button full" disabled={unavailableReason != null} onClick={saveFrame}>
								Save current frame
							</button>
						</>
					)}
				</>
			)}
		</>
	);
};

interface TExportPanelProps {
	project: TProject;
	videoExport: TVideoExport;
}
