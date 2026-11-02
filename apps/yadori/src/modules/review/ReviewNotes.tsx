import { ArrowUpRight, Check, Circle, MessageCircle, Plus } from 'lucide-react';
import React from 'react';
import { Button, Field, IconButton, Modal } from '../../components/ui';
import type { TCommand, TProject, TReviewNote } from '../project/model';

type TTarget = { type: TReviewNote['targetType']; id: string };
interface TProps {
	project: TProject;
	target: TTarget;
	onCommands(commands: TCommand[]): void;
}
export const ReviewNotes: React.FC<TProps> = ({ project, target, onCommands }) => {
	const [adding, setAdding] = React.useState(false);
	const [title, setTitle] = React.useState('');
	const [text, setText] = React.useState('');
	const notes = project.reviews.filter(
		(note) => note.targetType === target.type && note.targetId === target.id
	);
	return (
		<div className="review-notes">
			{notes.map((note) => (
				<div key={note.id} className={`review-note ${note.status}`}>
					<IconButton
						label={note.status === 'open' ? 'Resolve question' : 'Reopen question'}
						onClick={() =>
							onCommands([
								{
									type: 'review.update',
									id: note.id,
									patch: { status: note.status === 'open' ? 'resolved' : 'open' }
								}
							])
						}
					>
						{note.status === 'open' ? <Circle size={13} /> : <Check size={13} />}
					</IconButton>
					<div>
						<strong>{note.title}</strong>
						{note.text && <p>{note.text}</p>}
						<small>{note.source === 'agent' ? 'Assistant' : 'You'}</small>
					</div>
				</div>
			))}
			{adding ? (
				<form
					onSubmit={(event) => {
						event.preventDefault();
						if (!title.trim()) return;
						onCommands([
							{
								type: 'review.add',
								review: {
									id: crypto.randomUUID(),
									targetType: target.type,
									targetId: target.id,
									title: title.trim(),
									text: text.trim(),
									status: 'open',
									source: 'user',
									createdAt: new Date().toISOString()
								}
							}
						]);
						setAdding(false);
						setTitle('');
						setText('');
					}}
				>
					<Field label="Question">
						<input
							autoFocus
							required
							value={title}
							onChange={(e) => setTitle(e.target.value)}
							placeholder="What do you need to check?"
						/>
					</Field>
					<Field label="Details">
						<textarea
							value={text}
							onChange={(e) => setText(e.target.value)}
							placeholder="Context, assumptions, links…"
						/>
					</Field>
					<div className="actions">
						<Button type="submit">Add question</Button>
						<Button variant="ghost" onClick={() => setAdding(false)}>
							Cancel
						</Button>
					</div>
				</form>
			) : (
				<Button variant="ghost" icon={<Plus size={12} />} onClick={() => setAdding(true)}>
					Add question
				</Button>
			)}
		</div>
	);
};
export const ReviewDialog: React.FC<{
	project: TProject;
	onCommands(commands: TCommand[]): void;
	onClose(): void;
	onOpenTarget(target: TTarget): void;
}> = ({ project, onCommands, onClose, onOpenTarget }) => {
	const [all, setAll] = React.useState(false);
	const notes = project.reviews.filter((note) => all || note.status === 'open');
	function targetLabel(note: TReviewNote): string {
		if (note.targetType === 'project') return 'Project';
		if (note.targetType === 'part')
			return project.parts.find((part) => part.id === note.targetId)?.name ?? 'Part';
		return project.runs.find((run) => run.id === note.targetId)?.name ?? 'Cable';
	}
	return (
		<Modal title="Review" onClose={onClose} wide>
			<div className="review-toolbar">
				<span>
					{project.reviews.filter((note) => note.status === 'open').length} open questions
				</span>
				<label className="checkbox-field">
					<input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} />
					Show resolved
				</label>
			</div>
			{notes.map((note) => (
				<article key={note.id} className={`review-note ${note.status}`}>
					<IconButton
						label={note.status === 'open' ? 'Resolve question' : 'Reopen question'}
						onClick={() =>
							onCommands([
								{
									type: 'review.update',
									id: note.id,
									patch: { status: note.status === 'open' ? 'resolved' : 'open' }
								}
							])
						}
					>
						{note.status === 'open' ? <Circle size={13} /> : <Check size={13} />}
					</IconButton>
					<div>
						<strong>{note.title}</strong>
						{note.text && <p>{note.text}</p>}
						<button
							className="text-button"
							onClick={() => onOpenTarget({ type: note.targetType, id: note.targetId })}
						>
							{targetLabel(note)}
							{note.targetType !== 'project' && <ArrowUpRight size={11} />}
						</button>
					</div>
				</article>
			))}
			{!notes.length && (
				<div className="quiet-empty">
					<MessageCircle size={20} />
					<p>No open questions.</p>
				</div>
			)}
			<div className="document-section">
				<h3>Project questions</h3>
				<ReviewNotes
					project={{ ...project, reviews: [] }}
					target={{ type: 'project', id: project.id }}
					onCommands={onCommands}
				/>
			</div>
		</Modal>
	);
};
