import { ChevronsUpDown } from 'lucide-react';
import React from 'react';
import { MenuList } from './Menu';

/**
 * Pop-up button drawn like an AppKit pop-up button. It opens a menu with a check on the current choice and an
 * option's key at the trailing edge, as in every other menu, which a native select cannot show.
 */
export const Select: React.FC<TSelectProps> = (props) => {
	const { id, value, options, onChange } = props;
	return (
		<span className="mm-select">
			<PopUpButton id={id} value={value} options={options} onChange={onChange} />
			<ChevronsUpDown size={12} strokeWidth={2} />
		</span>
	);
};

interface TSelectProps {
	id: string;
	value: string;
	options: TSelectOption[];
	onChange: (value: string) => void;
}

export interface TSelectOption {
	value: string;
	label: string;
	/** Key that chooses this option elsewhere, shown at the menu item's trailing edge */
	shortcut?: string;
}

/** The button and menu of a pop-up; `Select` and `SelectField` draw the frame around it */
export const PopUpButton: React.FC<TPopUpButtonProps> = (props) => {
	const { id, value, options, onChange, className } = props;
	const [anchor, setAnchor] = React.useState<{ x: number; y: number; alignRight: number; flipY: number; minWidth: number } | null>(null);
	const buttonRef = React.useRef<HTMLButtonElement>(null);
	const close = React.useCallback(() => {
		setAnchor(null);
		buttonRef.current?.focus({ preventScroll: true });
	}, []);
	const current = options.find((option) => option.value === value);

	function toggle(): void {
		// The frame is the pop-up's visible edge, so the menu lines up with it rather than with the bare button
		const rect = (buttonRef.current?.parentElement ?? buttonRef.current)?.getBoundingClientRect();
		if (anchor != null || rect == null) {
			setAnchor(null);
			return;
		}
		setAnchor({ x: rect.left, y: rect.bottom + 4, alignRight: rect.right, flipY: rect.top - 4, minWidth: rect.width });
	}

	return (
		<>
			<button
				ref={buttonRef}
				id={id}
				className={className}
				aria-haspopup="listbox"
				aria-expanded={anchor != null}
				data-active={anchor != null}
				// Opening on pointer down matches native pop-ups; the click that follows is ignored
				onPointerDown={(event) => {
					if (event.button !== 0) return;
					event.preventDefault();
					buttonRef.current?.focus({ preventScroll: true });
					toggle();
				}}
				onKeyDown={(event) => {
					if (event.key === 'Enter' || event.key === ' ' || event.key === 'ArrowDown' || event.key === 'ArrowUp') {
						event.preventDefault();
						event.stopPropagation();
						toggle();
					}
				}}
				type="button"
			>
				<span className="truncate">{current?.label ?? ''}</span>
			</button>
			{anchor != null ? (
				<MenuList
					entries={options.map((option) => ({
						label: option.label,
						shortcut: option.shortcut,
						checked: option.value === value,
						onSelect: () => {
							if (option.value !== value) onChange(option.value);
						}
					}))}
					anchor={anchor}
					minWidth={anchor.minWidth}
					onClose={close}
				/>
			) : null}
		</>
	);
};

interface TPopUpButtonProps {
	id: string;
	value: string;
	options: TSelectOption[];
	onChange: (value: string) => void;
	className?: string;
}
