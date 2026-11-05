import React from 'react';

/** Icon for a piece type, in the lucide stroke style used across the app */
export const PieceIcon: React.FC<{ type: string; size?: number }> = (props) => {
	const { type, size = 16 } = props;
	switch (type) {
		case 'rail':
			return <RailIcon size={size} />;
		case 'tunnel':
			return <TunnelIcon size={size} />;
		case 'windmill':
			return <WindmillIcon size={size} />;
		case 'bowl':
			return <BowlIcon size={size} />;
		case 'marble':
			return <MarbleIcon size={size} />;
		default:
			return <PlatformIcon size={size} />;
	}
};

// Piece icons are drawn to match the lucide stroke style

function PlatformIcon(props: { size: number }): React.ReactElement {
	return (
		<svg width={props.size} height={props.size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
			<rect x="3" y="14" width="18" height="4" rx="1.2" transform="rotate(-14 12 16)" />
			<circle cx="9.5" cy="7" r="2.6" />
		</svg>
	);
}

function RailIcon(props: { size: number }): React.ReactElement {
	return (
		<svg width={props.size} height={props.size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
			<path d="M3 8.5c5 0 9 2.5 18 7" />
			<path d="M3 12.5c5 0 9 2.5 18 7" />
			<path d="M7 8.8v3.9M12 10.2v3.9M17 12.6v3.9" strokeWidth={1.2} />
		</svg>
	);
}

function TunnelIcon(props: { size: number }): React.ReactElement {
	return (
		<svg width={props.size} height={props.size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
			<path d="M5 7.5h12a3.5 3.5 0 0 1 0 7H5" />
			<path d="M5 7.5a3.5 3.5 0 0 0 0 7" strokeDasharray="1.5 2" />
			<circle cx="12" cy="11" r="1.6" />
		</svg>
	);
}

function WindmillIcon(props: { size: number }): React.ReactElement {
	return (
		<svg width={props.size} height={props.size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
			<circle cx="12" cy="12" r="2" />
			<path d="M12 10V3.5M14 12h6.5M12 14v6.5M10 12H3.5" />
		</svg>
	);
}

/** A bowl holding a marble */
function BowlIcon(props: { size: number }): React.ReactElement {
	return (
		<svg width={props.size} height={props.size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
			<path d="M19.5 5.5c1 5-1.5 9-6 10.5L3.5 19.5" />
			<path d="M17 6.5c.5 3.5-1.2 6.2-4.5 7.4L3 17" strokeWidth={1.2} />
			<circle cx="12.5" cy="8.5" r="2.4" />
		</svg>
	);
}

/** A marble with the release arrow above it */
function MarbleIcon(props: { size: number }): React.ReactElement {
	return (
		<svg width={props.size} height={props.size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
			<circle cx="12" cy="14.5" r="5.5" />
			<path d="M12 2.5v4M10 5l2 2 2-2" />
			<circle cx="10" cy="12.6" r="1" fill="currentColor" stroke="none" />
		</svg>
	);
}
