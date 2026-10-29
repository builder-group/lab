import React from 'react';

/** Shared by the prerendered SPA shell and the first client-side route render. */
export const BootScreen: React.FC = () => (
	<div
		className="boot-screen"
		role="status"
		style={{
			display: 'flex',
			alignItems: 'center',
			justifyContent: 'center',
			gap: 12,
			minHeight: '100svh',
			background: '#202020',
			color: '#bfbfbf',
			fontSize: 12
		}}
	>
		<span
			className="brand-orbit"
			aria-hidden="true"
			style={{
				width: 18,
				height: 18,
				borderRadius: '50%',
				border: '1px solid #f28d36',
				boxShadow: 'inset 0 0 0 3px #202020',
				background: '#f28d36'
			}}
		/>
		Opening the studio…
	</div>
);
