import { ChevronRight, ChevronsUpDown } from 'lucide-react';
import React from 'react';
import { HelpTip } from './HelpTip';
import { PopUpButton, type TSelectOption } from './Select';

// Inspector fields on the two-column grid of `Panel`, each with its label inside like Figma UI3

/** Pop-up button with its label inside, for choices such as the frame or a skin */
export const SelectField: React.FC<TSelectFieldProps> = (props) => {
	const { id, label, value, options, span = 2, onChange } = props;
	return (
		<span className="mm-ifield" data-span={span}>
			<label htmlFor={id} className="mm-ifield-label">
				{label}
			</label>
			<PopUpButton id={id} value={value} options={options} onChange={onChange} className="mm-ifield-popup" />
			<ChevronsUpDown size={12} strokeWidth={2} className="mm-ifield-chevron" />
		</span>
	);
};

interface TSelectFieldProps {
	id: string;
	label: string;
	value: string;
	options: TSelectOption[];
	span?: 1 | 2;
	onChange: (value: string) => void;
}

/** Text field with its label inside that commits on Return or blur and reverts on Escape */
export const TextField: React.FC<TTextFieldProps> = (props) => {
	const { id, label, name, value, unit, placeholder, span, allowEmpty = true, onCommit, onKeyDown, children } = props;
	const [draft, setDraft] = React.useState(value);
	const [source, setSource] = React.useState(value);
	// Reset the draft during render when the committed value changes elsewhere, such as through undo
	if (source !== value) {
		setSource(value);
		setDraft(value);
	}

	function commit(): void {
		if (draft === value) return;
		if (!allowEmpty && !draft.trim().length) {
			setDraft(value);
			return;
		}
		onCommit(draft);
	}

	return (
		<span className="mm-ifield" data-span={span}>
			<label htmlFor={id} className="mm-ifield-label" data-glyph={label.length <= 1} title={name}>
				{label}
			</label>
			<input
				id={id}
				aria-label={name}
				value={draft}
				placeholder={placeholder}
				onChange={(event) => setDraft(event.target.value)}
				onBlur={commit}
				onKeyDown={(event) => {
					if (event.key === 'Enter') event.currentTarget.blur();
					if (event.key === 'Escape') {
						setDraft(value);
						requestAnimationFrame(() => (event.target as HTMLInputElement).blur());
					}
					onKeyDown?.(event);
				}}
			/>
			{unit != null ? <span className="mm-ifield-unit">{unit}</span> : null}
			{children}
		</span>
	);
};

interface TTextFieldProps {
	id: string;
	label: string;
	/** Full name for the tooltip and assistive technology */
	name: string;
	value: string;
	unit?: string;
	placeholder?: string;
	span?: 2;
	/** False reverts an empty entry instead of committing it */
	allowEmpty?: boolean;
	onCommit: (value: string) => void;
	onKeyDown?: (event: React.KeyboardEvent<HTMLInputElement>) => void;
	/** Trailing controls inside the field, such as a stepper */
	children?: React.ReactNode;
}

/** A read-only value in the shape of a field, such as a song's tempo */
export const ReadoutField: React.FC<{ label: string; name: string; span?: 2; children: React.ReactNode }> = (props) => {
	const { label, name, span, children } = props;
	return (
		<span className="mm-ifield" data-readonly="true" data-span={span} title={name}>
			<span className="mm-ifield-label" data-glyph={label.length <= 1}>
				{label}
			</span>
			<span className="mm-ifield-value">{children}</span>
		</span>
	);
};

/**
 * A row naming something related that selects it on click, like a hit or the platform that plays it, with
 * an optional action button on the right such as Unlink
 */
export const LinkRow: React.FC<TLinkRowProps> = (props) => {
	const { icon, title, onOpen, action } = props;
	return (
		<div className="mm-insp-row" data-span="2">
			<button className="mm-insp-link" onClick={onOpen} title={title} type="button">
				{icon}
				<span className="mm-insp-link-text">{props.children}</span>
				<ChevronRight size={12} strokeWidth={2} className="mm-insp-link-arrow" />
			</button>
			{action}
		</div>
	);
};

interface TLinkRowProps {
	icon?: React.ReactNode;
	/** Tooltip, such as `Select Hit 1` */
	title: string;
	onOpen: () => void;
	action?: React.ReactNode;
	children: React.ReactNode;
}

/** One compact state line with a dot, such as Blender's link to a piece, with the detail in a help tip */
export const StateRow: React.FC<TStateRowProps> = (props) => {
	const { tone, label, detail, action } = props;
	return (
		<div className="mm-insp-row" data-span="2" data-state>
			<span className="mm-dot" data-tone={tone === 'neutral' ? undefined : tone} />
			<span className="mm-insp-link-text">{label}</span>
			{detail != null ? <HelpTip text={detail} /> : null}
			{action}
		</div>
	);
};

interface TStateRowProps {
	tone: 'good' | 'warn' | 'bad' | 'neutral';
	label: string;
	detail?: string;
	/** An icon button on the right, such as Reset */
	action?: React.ReactNode;
}

/** A checkbox with its label on the grid, like Figma's Clip content */
export const CheckField: React.FC<{ id: string; label: string; checked: boolean; span?: 2; title?: string; onChange: (checked: boolean) => void }> = (props) => {
	const { id, label, checked, span = 2, title, onChange } = props;
	return (
		<label className="mm-insp-check" htmlFor={id} data-span={span} title={title}>
			<input id={id} type="checkbox" className="mm-checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
			<span>{label}</span>
		</label>
	);
};
