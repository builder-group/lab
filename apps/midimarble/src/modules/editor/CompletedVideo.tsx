import { Download, RotateCcw } from 'lucide-react';
import React from 'react';
import type { TVideoExportResult } from '../export';

/** Retains a finished render until the user downloads it or chooses to render again. */
export const CompletedVideo: React.FC<TCompletedVideoProps> = ({ video, onAgain }) => (
	<div className="completed-video">
		<video
			src={video.url}
			controls
			playsInline
			preload="metadata"
			aria-label="Completed video preview"
		/>
		<a
			className="button primary full"
			href={video.url}
			download={`${video.name}.${video.extension}`}
		>
			<Download size={15} /> Download video · {(video.bytes / 1_000_000).toFixed(1)} MB
		</a>
		<p className="helper-text">
			Your rendered film includes MIDI and contact sounds. You can retry the download without
			rendering again.
		</p>
		<button className="button full" onClick={onAgain}>
			<RotateCcw size={13} />
			Adjust render settings
		</button>
	</div>
);
export interface TCompletedVideo {
	url: string;
	name: string;
	extension: TVideoExportResult['extension'];
	bytes: number;
}
interface TCompletedVideoProps {
	video: TCompletedVideo;
	onAgain(): void;
}
