import { useFeatureState } from 'feature-react/state';
import { Headphones, Volume2, VolumeOff } from 'lucide-react';
import React from 'react';
import type { StudioCx } from '../StudioCx';

/** Mute and Solo icon toggles for a Part, or for a recording's one Song, like GarageBand's track header */
export const PartToggles: React.FC<{ cx: StudioCx; id: string; name: string }> = (props) => {
	const { cx, id, name } = props;
	const mix = useFeatureState(cx.$mix);
	const isMuted = mix.muted.includes(id);
	const isSoloed = mix.solo.includes(id);
	return (
		<div className="flex shrink-0 items-center gap-0.5" onClick={(event) => event.stopPropagation()}>
			<button className="mm-track-toggle" data-on={isMuted} data-tone="mute" aria-pressed={isMuted} aria-label={`Mute ${name}`} title={isMuted ? `Unmute ${name}` : `Mute ${name}`} onClick={() => cx.toggleMute(id)} type="button">
				{isMuted ? <VolumeOff size={14} strokeWidth={1.75} /> : <Volume2 size={14} strokeWidth={1.75} />}
			</button>
			<button className="mm-track-toggle" data-on={isSoloed} data-tone="solo" aria-pressed={isSoloed} aria-label={`Solo ${name}`} title={isSoloed ? `Unsolo ${name}` : `Solo ${name}`} onClick={() => cx.toggleSolo(id)} type="button">
				<Headphones size={13} strokeWidth={1.75} />
			</button>
		</div>
	);
};
