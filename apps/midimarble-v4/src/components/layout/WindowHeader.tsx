import { isTauri } from '@tauri-apps/api/core';
import React from 'react';
import { usePlatform } from '@/hooks';
import { cn } from '@/lib';

export const WindowHeader: React.FC<TWindowHeaderProps> = (props) => {
	const { title, floating = false, className } = props;

	return (
		<header
			className={cn(
				'flex h-11 shrink-0 items-center px-4 select-none',
				floating && 'absolute inset-x-0 top-0 z-10',
				className
			)}
		>
			<WindowControlsInset />
			{title ? <span className="ml-2 text-sm font-semibold text-black/70">{title}</span> : null}
			<div data-tauri-drag-region className="h-full flex-1" />
		</header>
	);
};

interface TWindowHeaderProps {
	title?: string;
	floating?: boolean;
	className?: string;
}

/**
 * Keeps content clear of the macOS traffic lights, which end about 74 px from the window edge in the
 * native window. The browser surface has no traffic lights and keeps a smaller inset.
 */
export const WindowControlsInset: React.FC = () => {
	const platform = usePlatform();
	// The user agent backs up the OS plugin, so the inset never disappears in the native window
	const isMac = platform === 'macos' || navigator.userAgent.includes('Mac');
	const width = !isMac ? 0 : isTauri() ? 72 : 60;

	return <div data-tauri-drag-region className="h-full shrink-0" style={{ width }} />;
};
