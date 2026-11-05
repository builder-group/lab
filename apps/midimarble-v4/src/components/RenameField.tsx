import React from 'react';

/** In-place text field for renaming, committed on Return or blur and canceled with Escape */
export const RenameField: React.FC<{ value: string; onDone: (value: string | null) => void }> = (props) => {
	const { value, onDone } = props;
	const [draft, setDraft] = React.useState(value);
	const doneRef = React.useRef(false);
	function finish(next: string | null): void {
		if (doneRef.current) return;
		doneRef.current = true;
		onDone(next?.trim() ? next.trim() : null);
	}
	return (
		<input
			autoFocus
			className="mm-row-input"
			value={draft}
			onFocus={(event) => event.currentTarget.select()}
			onChange={(event) => setDraft(event.target.value)}
			onClick={(event) => event.stopPropagation()}
			onDoubleClick={(event) => event.stopPropagation()}
			onBlur={() => finish(draft)}
			onKeyDown={(event) => {
				event.stopPropagation();
				if (event.key === 'Enter') finish(draft);
				if (event.key === 'Escape') finish(null);
			}}
		/>
	);
};
