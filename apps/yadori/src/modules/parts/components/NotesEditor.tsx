import Placeholder from '@tiptap/extension-placeholder';
import TaskItem from '@tiptap/extension-task-item';
import TaskList from '@tiptap/extension-task-list';
import { Markdown } from '@tiptap/markdown';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { useFeatureState } from 'feature-react/state';
import { Bold, Check, Heading2, Italic, Link2, List, ListChecks, Unlink, X } from 'lucide-react';
import React from 'react';
import { Button, IconButton } from '../../../components/ui';
import type { ProjectSessionCx } from '../../projects/ProjectSessionCx';
import { getNotesDraft } from './NotesDraftCx';

export const NotesEditor: React.FC<TNotesEditorProps> = ({ value, session, projectId, partId }) => {
	const [linkOpen, setLinkOpen] = React.useState(false);
	const [href, setHref] = React.useState('');
	const draft = React.useMemo(
		() => getNotesDraft(session, projectId, partId),
		[session, projectId, partId]
	);
	const issue = useFeatureState(draft.$issue);
	const editor = useEditor({
		extensions: [
			StarterKit.configure({ link: { openOnClick: false } }),
			TaskList,
			TaskItem.configure({ nested: true }),
			Markdown,
			Placeholder.configure({ placeholder: 'Write notes, paste research, or start a list…' })
		],
		content: draft.hasPending ? draft.value : value,
		shouldRerenderOnTransaction: false,
		contentType: 'markdown',
		editorProps: { attributes: { 'aria-label': 'Part notes', 'class': 'notes-document' } },
		onUpdate: ({ editor }) => {
			if (!draft.change(editor.getMarkdown()))
				editor.commands.setContent(draft.value, { contentType: 'markdown', emitUpdate: false });
		},
		onBlur: () => {
			draft.flush();
		}
	});
	React.useLayoutEffect(() => {
		if (!editor) return;
		return draft.mount((suspended) => editor.setEditable(!suspended, false));
	}, [draft, editor]);
	React.useEffect(() => {
		if (!editor) return;
		draft.refresh();
		if (editor.getMarkdown() !== draft.value)
			editor.commands.setContent(draft.value, { contentType: 'markdown', emitUpdate: false });
	}, [editor, value, draft, issue]);
	if (!editor) return null;
	return (
		<div className="notes-editor">
			{issue && (
				<div className="notes-draft-issue" role="status">
					<p>
						{issue === 'conflict'
							? 'These notes changed elsewhere. Your draft is still here.'
							: issue === 'missing'
								? 'This part is no longer available. Your draft is kept in this session.'
								: 'Your notes are kept here. Try saving them again.'}
					</p>
					<div className="actions">
						{issue === 'conflict' ? (
							<>
								<Button variant="ghost" onClick={() => draft.keepDraft()}>
									Keep my draft
								</Button>
								<Button variant="ghost" onClick={() => draft.acceptIncoming()}>
									Use incoming notes
								</Button>
							</>
						) : (
							<Button variant="ghost" onClick={() => draft.flush()}>
								Retry
							</Button>
						)}
					</div>
				</div>
			)}
			<div className="notes-tools">
				<IconButton
					label="Bold (⌘B)"
					onMouseDown={(event) => event.preventDefault()}
					onClick={() => editor.chain().focus().toggleBold().run()}
				>
					<Bold size={14} />
				</IconButton>
				<IconButton
					label="Italic (⌘I)"
					onMouseDown={(event) => event.preventDefault()}
					onClick={() => editor.chain().focus().toggleItalic().run()}
				>
					<Italic size={14} />
				</IconButton>
				<IconButton
					label="Heading"
					onMouseDown={(event) => event.preventDefault()}
					onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
				>
					<Heading2 size={15} />
				</IconButton>
				<IconButton
					label="Bullet list"
					onMouseDown={(event) => event.preventDefault()}
					onClick={() => editor.chain().focus().toggleBulletList().run()}
				>
					<List size={15} />
				</IconButton>
				<IconButton
					label="Checklist"
					onMouseDown={(event) => event.preventDefault()}
					onClick={() => editor.chain().focus().toggleTaskList().run()}
				>
					<ListChecks size={15} />
				</IconButton>
				<IconButton
					label="Link"
					onMouseDown={(event) => event.preventDefault()}
					onClick={() => {
						setHref(String(editor.getAttributes('link')['href'] ?? ''));
						setLinkOpen(!linkOpen);
					}}
				>
					<Link2 size={14} />
				</IconButton>
			</div>
			{linkOpen && (
				<form
					className="notes-link-form"
					onSubmit={(event) => {
						event.preventDefault();
						if (!/^https?:\/\//i.test(href.trim())) return;
						editor.chain().focus().extendMarkRange('link').setLink({ href: href.trim() }).run();
						setLinkOpen(false);
					}}
				>
					<input
						autoFocus
						type="url"
						aria-label="Link URL"
						placeholder="https://…"
						value={href}
						onChange={(e) => setHref(e.target.value)}
					/>
					<IconButton label="Apply link" type="submit">
						<Check size={13} />
					</IconButton>
					<IconButton
						label="Remove link"
						onClick={() => {
							editor.chain().focus().unsetLink().run();
							setLinkOpen(false);
						}}
					>
						<Unlink size={13} />
					</IconButton>
					<IconButton label="Close link editor" onClick={() => setLinkOpen(false)}>
						<X size={13} />
					</IconButton>
				</form>
			)}
			<EditorContent editor={editor} />
		</div>
	);
};

interface TNotesEditorProps {
	value: string;
	session: ProjectSessionCx;
	projectId: string;
	partId: string;
}
