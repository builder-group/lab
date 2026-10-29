import React from 'react';
import type { TProject } from '../project';
import { NumberField } from './PropertyFields';

export const EditorDialogs: React.FC<TEditorDialogsProps> = (props) => {
	const { modal, project, onGravityChange, onClose } = props;
	return (
		<>
			{modal === 'help' && (
				<>
					<span className="modal-eyebrow">CONTROLS & WORKFLOW</span>
					<h1 id="modal-title">Build around the music</h1>
					<ol className="help-steps">
						<li>
							<strong>Import or write MIDI</strong>
							<span>
								Open a track’s piano roll to draw, audition and trim notes or edit velocity. MIDI
								controls the sound; rail contacts add rolling texture.
							</span>
						</li>
						<li>
							<strong>Add world objects</strong>
							<span>
								Use the floating + toolbar or Shift A to browse 3D models. World objects influence
								the marble and stay where you put them.
							</span>
						</li>
						<li>
							<strong>Link deliberately</strong>
							<span>
								Select an object, press L, then click a note. Or drag an outliner object onto a
								timeline note. Or choose an object from a note’s Properties. Rails can follow a
								trajectory time. Unlink keeps the current world position.
							</span>
						</li>
						<li>
							<strong>Compose the camera</strong>
							<span>
								Orbit to a view, select Camera and add a keyframe. Camera diamonds can be moved in
								the timeline. Export renders the camera view.
							</span>
						</li>
					</ol>
					<div className="shortcut-grid">
						{[
							['F3 / ⌘K', 'Search commands'],
							['Space', 'Play / pause'],
							['V / G / R / S', 'Select / move / rotate / scale'],
							['X / Y / Z', 'Constrain transform'],
							['Esc', 'Cancel transform or link'],
							['MMB', 'Orbit · Shift to pan'],
							['Wheel', 'Zoom'],
							['F / Home', 'Frame selected / all'],
							['⇧A / ⇧D', 'Add / duplicate'],
							['← / →', 'Step a frame'],
							['Shift Space', 'Toggle panels'],
							['⌘Z / ⇧⌘Z', 'Undo / redo'],
							['⌘S', 'Download project']
						].map(([key, label]) => (
							<span key={key}>
								<kbd>{key}</kbd>
								{label}
							</span>
						))}
					</div>
					<strong>Piano roll</strong>
					<div className="shortcut-grid">
						{[
							['⇧click / ⌘A', 'Select notes / all in track'],
							['Drag / ⇧drag', 'Box select / add to selection'],
							['←→ / ↑↓', 'Move / transpose selection'],
							['⇧↑ / ⇧↓', 'Transpose an octave'],
							['⌘D / ⌘drag', 'Duplicate selection'],
							['⌘C / ⌘V', 'Copy notes / paste at playhead'],
							['B / V', 'Draw / select notes'],
							['Esc', 'Keep the active note selected']
						].map(([key, label]) => (
							<span key={key}>
								<kbd>{key}</kbd>
								{label}
							</span>
						))}
					</div>
					<p className="helper-text">Use Ctrl in place of ⌘ on Windows and Linux.</p>
					<p className="helper-text">
						<a
							href="https://github.com/builder-group/lab/tree/develop/apps/midimarble"
							target="_blank"
							rel="noreferrer"
						>
							Source code
						</a>
						{' · '}
						<a href="/third-party-licenses.md" target="_blank" rel="noreferrer">
							Third-party licenses
						</a>
						{' · '}
						<a href="/audio/ATTRIBUTION.txt" target="_blank" rel="noreferrer">
							Sound bank credits
						</a>
					</p>
					<button className="button primary full" onClick={() => onClose()}>
						Back to scene
					</button>
				</>
			)}
			{modal === 'settings' && (
				<>
					<h1 id="modal-title">Project settings</h1>
					<NumberField
						label="Gravity"
						value={project.gravity}
						min={0.1}
						max={40}
						onChange={(gravity) => onGravityChange(gravity)}
					/>
					<button className="button primary full" onClick={() => onClose()}>
						Done
					</button>
				</>
			)}
		</>
	);
};

interface TEditorDialogsProps {
	modal: 'help' | 'settings';
	project: TProject;
	onGravityChange: (gravity: number) => void;
	onClose: () => void;
}
